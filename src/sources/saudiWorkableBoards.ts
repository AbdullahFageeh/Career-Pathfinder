import type { RawJobPostingInput } from "../ingest/index.js";
import { SAUDI_CITY_TERMS, SAUDI_LOCATION_TERMS } from "../policy/eligibility.js";
import { lane1ExactJobTitles } from "../policy/targetTitles.js";

const WORKABLE_WIDGET_API = "https://apply.workable.com/api/v1/widget/accounts";

export type SaudiWorkableDiscoveryOptions = {
  siteTokens: readonly string[];
  filterByTargetTitles?: boolean;
  maxListingsPerSite?: number;
  fetchImpl?: typeof fetch;
  now?: string;
};

export type SaudiWorkableDiscoveryResult = {
  fetchedAt: string;
  sitesQueried: string[];
  sitesFailed: Array<{ siteToken: string; reason: string }>;
  listings: RawJobPostingInput[];
};

type WorkableLocation = {
  location_str?: string;
  city?: string;
  country_name?: string;
  country?: string;
  telecommuting?: boolean;
};

type WorkableJob = {
  id?: string | number;
  shortcode?: string;
  title?: string;
  url?: string;
  shortlink?: string;
  location?: WorkableLocation;
  locations?: WorkableLocation[];
  description?: string;
  full_description?: string;
  published_on?: string;
  created_at?: string;
};

type WorkablePayload = {
  name?: string;
  account?: { name?: string };
  jobs?: WorkableJob[];
};

/**
 * Reads public Workable widget data for explicitly configured employer accounts.
 * Workable application creation remains review-only because authenticated
 * candidate endpoints require the employer's Workable account credential.
 */
export async function discoverSaudiWorkableRoles(
  options: SaudiWorkableDiscoveryOptions
): Promise<SaudiWorkableDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.now ?? new Date().toISOString();
  const siteTokens = normalizeTokens(options.siteTokens);
  const sitesFailed: SaudiWorkableDiscoveryResult["sitesFailed"] = [];
  const listings: RawJobPostingInput[] = [];
  const maxListings = clamp(options.maxListingsPerSite, 1, 500, 50);

  for (const siteToken of siteTokens) {
    try {
      const payload = await fetchWorkableSite(siteToken, fetchImpl);
      let accepted = 0;
      for (const job of payload.jobs ?? []) {
        const normalized = normalizeWorkableJob(siteToken, payload, job, fetchedAt);
        if (!normalized || !looksSaudi(normalized.location ?? "")) {
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

/** Converts a public Workable widget job into an ingest-ready Saudi job record. */
export function normalizeWorkableJob(
  siteToken: string,
  payload: WorkablePayload,
  job: WorkableJob,
  fetchedAt: string
): RawJobPostingInput | undefined {
  const jobId = line(job.id) ?? line(job.shortcode);
  const title = line(job.title);
  if (!jobId || !title) {
    return undefined;
  }

  const location = resolveLocation(job);
  const applyUrl = line(job.url) ?? line(job.shortlink);
  const description = stripHtml(job.full_description ?? "") ?? stripHtml(job.description ?? "") ?? title;
  const company = line(payload.name) ?? line(payload.account?.name) ?? formatCompanyName(siteToken);
  const cityTag = detectSaudiCity(location);

  return {
    id: `workable:${siteToken}:${jobId}`,
    source: {
      kind: "job-board",
      name: `workable-site:${siteToken}`,
      ...(applyUrl ? { url: applyUrl } : {})
    },
    title,
    company,
    location,
    description,
    tags: [
      "official-source",
      "source:workable",
      "saudi-arabia",
      `site:${siteToken}`,
      ...(cityTag ? [cityTag.replace(/\s+/g, "-")] : [])
    ],
    applicationTarget: {
      ...(applyUrl ? { url: applyUrl } : {}),
      platform: "workable",
      siteToken,
      jobId
    },
    discoveredAt: normalizeTimestamp(job.published_on) ?? normalizeTimestamp(job.created_at) ?? fetchedAt
  };
}

async function fetchWorkableSite(siteToken: string, fetchImpl: typeof fetch): Promise<WorkablePayload> {
  const response = await fetchImpl(`${WORKABLE_WIDGET_API}/${encodeURIComponent(siteToken)}?details=true`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Workable site "${siteToken}" responded with status ${response.status}.`);
  }
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as WorkablePayload;
}

function resolveLocation(job: WorkableJob): string {
  const locations = [job.location, ...(job.locations ?? [])].filter(
    (location): location is WorkableLocation => Boolean(location)
  );
  const labels = locations.map(formatLocation).filter(Boolean);
  return Array.from(new Set(labels)).join(" / ");
}

function formatLocation(location: WorkableLocation): string | undefined {
  const direct = line(location.location_str);
  if (direct) {
    return direct;
  }
  return [line(location.city), line(location.country_name) ?? line(location.country)].filter(Boolean).join(", ") || undefined;
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
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function stripHtml(value: string): string | undefined {
  return line(value.replace(/<[^>]+>/g, " "));
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
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
