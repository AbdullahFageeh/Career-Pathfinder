import type { RawJobPostingInput } from "../ingest/index.js";
import { SAUDI_CITY_TERMS, SAUDI_LOCATION_TERMS } from "../policy/eligibility.js";
import { lane1ExactJobTitles } from "../policy/targetTitles.js";

const LEVER_POSTINGS_API = "https://api.lever.co/v0/postings";

export type SaudiLeverDiscoveryOptions = {
  siteTokens: readonly string[];
  filterByTargetTitles?: boolean;
  maxListingsPerSite?: number;
  fetchImpl?: typeof fetch;
  now?: string;
};

export type SaudiLeverDiscoveryResult = {
  fetchedAt: string;
  sitesQueried: string[];
  sitesFailed: Array<{ siteToken: string; reason: string }>;
  listings: RawJobPostingInput[];
};

type LeverPosting = {
  id?: string;
  text?: string;
  categories?: { location?: string; allLocations?: string[] };
  country?: string | null;
  descriptionPlain?: string;
  description?: string;
  openingPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
};

/**
 * Reads published jobs from explicitly configured public Lever sites. Lever
 * application endpoints stay review-only because creating a candidate requires
 * an API key owned by the hiring employer, not the applicant.
 */
export async function discoverSaudiLeverRoles(
  options: SaudiLeverDiscoveryOptions
): Promise<SaudiLeverDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.now ?? new Date().toISOString();
  const siteTokens = normalizeTokens(options.siteTokens);
  const sitesFailed: SaudiLeverDiscoveryResult["sitesFailed"] = [];
  const listings: RawJobPostingInput[] = [];
  const maxListings = clamp(options.maxListingsPerSite, 1, 500, 50);

  for (const siteToken of siteTokens) {
    try {
      const postings = await fetchLeverSite(siteToken, fetchImpl);
      let accepted = 0;
      for (const posting of postings) {
        const normalized = normalizeLeverPosting(siteToken, posting, fetchedAt);
        if (!normalized) {
          continue;
        }
        if (!looksSaudi(normalized.location ?? "")) {
          continue;
        }
        if (options.filterByTargetTitles !== false && !matchesTargetTitle(normalized.title)) {
          continue;
        }
        listings.push(normalized);
        accepted += 1;
        if (accepted >= maxListings) {
          break;
        }
      }
    } catch (error) {
      sitesFailed.push({
        siteToken,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    fetchedAt,
    sitesQueried: siteTokens,
    sitesFailed,
    listings: dedupeListings(listings)
  };
}

/** Converts a public Lever posting into an ingest-ready Saudi job record. */
export function normalizeLeverPosting(
  siteToken: string,
  posting: LeverPosting,
  fetchedAt: string
): RawJobPostingInput | undefined {
  const jobId = line(posting.id);
  const title = line(posting.text);
  if (!jobId || !title) {
    return undefined;
  }

  const location = line(posting.categories?.location) ?? line(posting.categories?.allLocations?.join(" / ")) ?? "";
  const applyUrl = line(posting.applyUrl) ?? line(posting.hostedUrl);
  const description = line(posting.descriptionPlain) ?? stripHtml(posting.description ?? "") ?? line(posting.openingPlain) ?? title;
  const country = line(posting.country)?.toUpperCase();
  const cityTag = detectSaudiCity(location);

  return {
    id: `lever:${siteToken}:${jobId}`,
    source: {
      kind: "job-board",
      name: `lever-site:${siteToken}`,
      ...(applyUrl ? { url: applyUrl } : {})
    },
    title,
    company: formatCompanyName(siteToken),
    location: country === "SA" && !location ? "Saudi Arabia" : location,
    description,
    tags: [
      "official-source",
      "source:lever",
      "saudi-arabia",
      `site:${siteToken}`,
      ...(cityTag ? [cityTag.replace(/\s+/g, "-")] : [])
    ],
    applicationTarget: {
      ...(applyUrl ? { url: applyUrl } : {}),
      platform: "lever",
      siteToken,
      jobId
    },
    discoveredAt: normalizeTimestamp(posting.updatedAt) ?? normalizeTimestamp(posting.createdAt) ?? fetchedAt
  };
}

async function fetchLeverSite(siteToken: string, fetchImpl: typeof fetch): Promise<LeverPosting[]> {
  const response = await fetchImpl(`${LEVER_POSTINGS_API}/${encodeURIComponent(siteToken)}?mode=json`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Lever site "${siteToken}" responded with status ${response.status}.`);
  }
  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload as LeverPosting[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: LeverPosting[] }).data;
  }
  return [];
}

function looksSaudi(location: string): boolean {
  const normalized = location.toLowerCase();
  return SAUDI_LOCATION_TERMS.some((term) => normalized.includes(term)) || /\bsa\b/.test(normalized);
}

function matchesTargetTitle(title: string): boolean {
  const normalized = title.toLowerCase();
  return lane1ExactJobTitles.some((target) => normalized.includes(target.toLowerCase()));
}

function detectSaudiCity(location: string): string | undefined {
  const normalized = location.toLowerCase();
  return SAUDI_CITY_TERMS.find((city) => normalized.includes(city));
}

function normalizeTokens(tokens: readonly string[]): string[] {
  return Array.from(new Set(tokens.map((token) => token.trim()).filter(Boolean)));
}

function dedupeListings(listings: RawJobPostingInput[]): RawJobPostingInput[] {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    if (seen.has(listing.id)) {
      return false;
    }
    seen.add(listing.id);
    return true;
  });
}

function line(value: unknown): string | undefined {
  return typeof value === "string" && value.replace(/\s+/g, " ").trim()
    ? value.replace(/\s+/g, " ").trim()
    : undefined;
}

function stripHtml(value: string): string | undefined {
  return line(value.replace(/<[^>]+>/g, " "));
}

function normalizeTimestamp(value: number | string | undefined): string | undefined {
  if (typeof value === "number") {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function formatCompanyName(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(value as number)));
}
