import { Buffer } from "node:buffer";

import {
  lane1ExactJobTitles,
  lane1TargetTitleGroups,
  type TargetTitleGroup
} from "../policy/targetTitles.js";
import type { JobPosting } from "../shared/contracts.js";

const ARBEITSAGENTUR_BASE_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
const ARBEITSAGENTUR_PUBLIC_API_KEY = "jobboerse-jobsuche";
const DEFAULT_RESULTS_PER_TITLE = 10;
const DEFAULT_PUBLISHED_WITHIN_DAYS = 30;
const DEFAULT_REQUEST_CONCURRENCY = 4;
const DEFAULT_MAX_LISTINGS = 50;

type Lane1Family = TargetTitleGroup["family"];

type ArbeitsagenturSearchLocation = {
  ort?: string;
  plz?: string;
  region?: string;
  land?: string;
};

type ArbeitsagenturSearchListing = {
  refnr: string;
  titel: string;
  beruf?: string;
  arbeitgeber?: string;
  arbeitsort?: ArbeitsagenturSearchLocation;
  aktuelleVeroeffentlichungsdatum?: string;
  modifikationsTimestamp?: string;
  eintrittsdatum?: string;
  kundennummerHash?: string;
};

type ArbeitsagenturSearchResponse = {
  stellenangebote?: ArbeitsagenturSearchListing[];
  page?: number;
  size?: number;
  maxErgebnisse?: number;
};

type ArbeitsagenturDetailLocation = {
  adresse?: {
    strasse?: string;
    hausnummer?: string;
    plz?: string;
    ort?: string;
    region?: string;
    land?: string;
  };
};

type ArbeitsagenturJobDetail = {
  referenznummer?: string;
  stellenangebotsTitel?: string;
  stellenangebotsBeschreibung?: string;
  firma?: string;
  stellenlokationen?: ArbeitsagenturDetailLocation[];
  veroeffentlichungszeitraum?: {
    von?: string;
  };
};

type AggregatedSearchHit = {
  searchListing: ArbeitsagenturSearchListing;
  matchedTitles: Set<string>;
  matchedFamilies: Set<Lane1Family>;
};

export type Lane1JobSearchOptions = {
  location?: string;
  radiusKm?: number;
  page?: number;
  resultsPerTitle?: number;
  publishedWithinDays?: number;
  includeDetails?: boolean;
  maxListings?: number;
  requestConcurrency?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type Lane1SearchQuery = {
  family: Lane1Family;
  title: string;
};

export type Lane1ScrapedJobPosting = JobPosting & {
  matchedTitles: string[];
  matchedFamilies: Lane1Family[];
  sourceListingId: string;
  sourceListingUrl: string;
};

export type Lane1JobSearchResult = {
  fetchedAt: string;
  sourceName: "arbeitsagentur";
  queries: Lane1SearchQuery[];
  listings: Lane1ScrapedJobPosting[];
};

const lane1Queries: readonly Lane1SearchQuery[] = lane1TargetTitleGroups.flatMap((group) =>
  group.titles.map((title) => ({
    family: group.family,
    title
  }))
);

export async function fetchLane1JobListings(
  options: Lane1JobSearchOptions = {}
): Promise<Lane1JobSearchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestConcurrency = clampNumber(
    options.requestConcurrency,
    1,
    10,
    DEFAULT_REQUEST_CONCURRENCY
  );
  const maxListings = clampNumber(options.maxListings, 1, 200, DEFAULT_MAX_LISTINGS);

  const searchResponses = await mapWithConcurrency(lane1Queries, requestConcurrency, async (query) => {
    const listings = await searchArbeitsagenturJobs(query, options, fetchImpl);
    return listings.map((listing) => ({
      query,
      listing
    }));
  });

  const dedupedHits = new Map<string, AggregatedSearchHit>();

  for (const response of searchResponses) {
    for (const { query, listing } of response) {
      const matchedTitles = findLane1TitleMatches(listing.titel);

      if (matchedTitles.length === 0) {
        continue;
      }

      const existingHit = dedupedHits.get(listing.refnr);

      if (existingHit) {
        matchedTitles.forEach((title) => existingHit.matchedTitles.add(title));
        existingHit.matchedFamilies.add(query.family);
        continue;
      }

      dedupedHits.set(listing.refnr, {
        searchListing: listing,
        matchedTitles: new Set(matchedTitles),
        matchedFamilies: new Set([query.family])
      });
    }
  }

  const selectedHits = Array.from(dedupedHits.values())
    .sort((left, right) => getListingTimestamp(right.searchListing) - getListingTimestamp(left.searchListing))
    .slice(0, maxListings);

  const detailByReference = options.includeDetails === false
    ? new Map<string, ArbeitsagenturJobDetail | null>()
    : new Map(
        (
          await mapWithConcurrency(selectedHits, requestConcurrency, async (hit) => [
            hit.searchListing.refnr,
            await fetchArbeitsagenturJobDetail(hit.searchListing.refnr, fetchImpl, options.signal)
          ] as const)
        )
      );

  const listings = selectedHits.map((hit) =>
    normalizeLane1Listing(hit, detailByReference.get(hit.searchListing.refnr) ?? null)
  );

  return {
    fetchedAt: new Date().toISOString(),
    sourceName: "arbeitsagentur",
    queries: [...lane1Queries],
    listings
  };
}

async function searchArbeitsagenturJobs(
  query: Lane1SearchQuery,
  options: Lane1JobSearchOptions,
  fetchImpl: typeof fetch
): Promise<ArbeitsagenturSearchListing[]> {
  const url = new URL(`${ARBEITSAGENTUR_BASE_URL}/pc/v4/app/jobs`);
  url.searchParams.set("was", query.title);
  url.searchParams.set("page", String(clampNumber(options.page, 1, 100, 1)));
  url.searchParams.set(
    "size",
    String(clampNumber(options.resultsPerTitle, 1, 100, DEFAULT_RESULTS_PER_TITLE))
  );
  url.searchParams.set(
    "veroeffentlichtseit",
    String(clampNumber(options.publishedWithinDays, 0, 100, DEFAULT_PUBLISHED_WITHIN_DAYS))
  );
  url.searchParams.set("angebotsart", "1");
  url.searchParams.set("zeitarbeit", "false");

  if (options.location) {
    url.searchParams.set("wo", options.location);
    if (typeof options.radiusKm === "number") {
      url.searchParams.set("umkreis", String(clampNumber(options.radiusKm, 1, 200, 25)));
    }
  }

  const response = await fetchImpl(url, {
    headers: createArbeitsagenturHeaders(),
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(
      `Arbeitsagentur search failed for "${query.title}" with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as ArbeitsagenturSearchResponse;
  return Array.isArray(payload.stellenangebote) ? payload.stellenangebote : [];
}

async function fetchArbeitsagenturJobDetail(
  referenceNumber: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<ArbeitsagenturJobDetail | null> {
  const detailUrl = createArbeitsagenturDetailUrl(referenceNumber);
  const response = await fetchImpl(detailUrl, {
    headers: createArbeitsagenturHeaders(),
    signal
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as ArbeitsagenturJobDetail;
}

function normalizeLane1Listing(
  hit: AggregatedSearchHit,
  detail: ArbeitsagenturJobDetail | null
): Lane1ScrapedJobPosting {
  const sourceListingId = hit.searchListing.refnr;
  const sourceListingUrl = createArbeitsagenturDetailUrl(sourceListingId);
  const matchedTitles = Array.from(hit.matchedTitles).sort();
  const matchedFamilies = Array.from(hit.matchedFamilies).sort();
  const description = sanitizeDescription(
    detail?.stellenangebotsBeschreibung ?? hit.searchListing.beruf ?? hit.searchListing.titel
  );

  return {
    id: `arbeitsagentur:${sourceListingId}`,
    source: {
      kind: "job-board",
      name: "arbeitsagentur",
      url: sourceListingUrl
    },
    title: detail?.stellenangebotsTitel ?? hit.searchListing.titel,
    company: detail?.firma ?? hit.searchListing.arbeitgeber ?? "Unknown employer",
    location: formatJobLocation(hit.searchListing, detail),
    description,
    detectedRoleFamily: matchedFamilies[0],
    tags: buildListingTags(matchedFamilies, matchedTitles),
    discoveredAt:
      hit.searchListing.modifikationsTimestamp ??
      detail?.veroeffentlichungszeitraum?.von ??
      hit.searchListing.aktuelleVeroeffentlichungsdatum ??
      new Date().toISOString(),
    matchedTitles,
    matchedFamilies,
    sourceListingId,
    sourceListingUrl
  };
}

function createArbeitsagenturHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    "X-API-Key": ARBEITSAGENTUR_PUBLIC_API_KEY
  };
}

function createArbeitsagenturDetailUrl(referenceNumber: string): string {
  const encodedReference = Buffer.from(referenceNumber, "utf8").toString("base64");
  return `${ARBEITSAGENTUR_BASE_URL}/pc/v4/jobdetails/${encodedReference}`;
}

function findLane1TitleMatches(jobTitle: string): string[] {
  const normalizedJobTitle = normalizeForComparison(jobTitle);

  return lane1ExactJobTitles.filter((targetTitle) =>
    containsWholePhrase(normalizedJobTitle, normalizeForComparison(targetTitle))
  );
}

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsWholePhrase(normalizedText: string, normalizedPhrase: string): boolean {
  if (!normalizedText || !normalizedPhrase) {
    return false;
  }

  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function sanitizeDescription(description: string): string {
  return description
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatJobLocation(
  listing: ArbeitsagenturSearchListing,
  detail: ArbeitsagenturJobDetail | null
): string | undefined {
  const primaryParts = [
    listing.arbeitsort?.ort,
    normalizeLocationToken(listing.arbeitsort?.region),
    normalizeLocationToken(listing.arbeitsort?.land)
  ];
  const primaryLocation = joinLocationParts(primaryParts);

  if (primaryLocation) {
    return primaryLocation;
  }

  const detailLocation = detail?.stellenlokationen?.[0]?.adresse;
  return joinLocationParts([
    detailLocation?.ort,
    normalizeLocationToken(detailLocation?.region),
    normalizeLocationToken(detailLocation?.land)
  ]);
}

function normalizeLocationToken(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .toLowerCase()
    .split(/[_ ]+/)
    .filter(Boolean)
    .map((token) =>
      token
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("-")
    )
    .join(" ");
}

function joinLocationParts(parts: Array<string | undefined>): string | undefined {
  const uniqueParts = Array.from(
    new Set(
      parts
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
    )
  );

  return uniqueParts.length > 0 ? uniqueParts.join(", ") : undefined;
}

function buildListingTags(
  matchedFamilies: readonly Lane1Family[],
  matchedTitles: readonly string[]
): string[] {
  return [
    "lane-1",
    "source:arbeitsagentur",
    ...matchedFamilies.map((family) => `family:${family}`),
    ...matchedTitles.map((title) => `matched-title:${toTagValue(title)}`)
  ];
}

function toTagValue(value: string): string {
  return normalizeForComparison(value).replace(/\s+/g, "-");
}

function getListingTimestamp(listing: ArbeitsagenturSearchListing): number {
  return (
    Date.parse(listing.modifikationsTimestamp ?? "") ||
    Date.parse(listing.aktuelleVeroeffentlichungsdatum ?? "") ||
    Date.parse(listing.eintrittsdatum ?? "") ||
    0
  );
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}
