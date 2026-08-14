import type { RawJobPostingInput } from "../ingest/index.js";
import { SAUDI_CITY_TERMS, SAUDI_LOCATION_TERMS } from "../policy/eligibility.js";
import { lane1ExactJobTitles } from "../policy/targetTitles.js";

const GREENHOUSE_BOARDS_API = "https://boards-api.greenhouse.io/v1/boards";
const DEFAULT_MAX_LISTINGS_PER_BOARD = 50;
const DEFAULT_REQUEST_CONCURRENCY = 3;
const DEFAULT_REQUEST_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Curated public boards verified to accept Greenhouse API queries and to carry
 * Saudi-based vacancies. This is intentionally short: the CLI accepts custom
 * tokens, while a small verified default avoids wasting a daily run on dead
 * endpoints.
 */
export const DEFAULT_SAUDI_BOARD_TOKENS: readonly string[] = ["dmgevents", "tamara", "careem"];

export type SaudiBoardDiscoveryOptions = {
  boardTokens?: readonly string[];
  /** Extra title terms treated as target roles beyond the Lane 1 shortlist. */
  targetTitleTerms?: readonly string[];
  /** When false, keeps every Saudi role regardless of title. Defaults to true. */
  filterByTargetTitles?: boolean;
  maxListingsPerBoard?: number;
  requestConcurrency?: number;
  /** Number of retries after a transient network, 429, or 5xx failure. Defaults to 2. */
  requestRetries?: number;
  /** Base retry delay in milliseconds. Delay doubles for each retry. Defaults to 250. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  /** Injectable only for deterministic tests; normal runs use a timer. */
  sleepImpl?: Sleep;
  signal?: AbortSignal;
  now?: string;
};

export type SaudiBoardDiscoveryResult = {
  fetchedAt: string;
  sourceName: "greenhouse-board";
  boardsQueried: string[];
  boardsFailed: Array<{ boardToken: string; reason: string }>;
  listings: RawJobPostingInput[];
};

type GreenhouseBoardJob = {
  id?: number;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  content?: string;
  location?: {
    name?: string;
  };
  offices?: Array<{
    name?: string;
    location?: string;
  }>;
  metadata?: Array<{
    name?: string;
    value?: unknown;
  }>;
};

type GreenhouseBoardResponse = {
  jobs?: GreenhouseBoardJob[];
};

/**
 * Fetches Saudi-based roles from public Greenhouse job boards. Greenhouse is
 * used because its board API is public, stable, unauthenticated, and because
 * the existing apply module can already prefill Greenhouse forms in a
 * supervised browser session.
 */
export async function discoverSaudiGreenhouseRoles(
  options: SaudiBoardDiscoveryOptions = {}
): Promise<SaudiBoardDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const boardTokens = normalizeBoardTokens(options.boardTokens ?? DEFAULT_SAUDI_BOARD_TOKENS);
  const maxListingsPerBoard = clampNumber(options.maxListingsPerBoard, 1, 500, DEFAULT_MAX_LISTINGS_PER_BOARD);
  const requestConcurrency = clampNumber(options.requestConcurrency, 1, 10, DEFAULT_REQUEST_CONCURRENCY);
  const requestRetries = clampNumber(options.requestRetries, 0, 4, DEFAULT_REQUEST_RETRIES);
  const retryDelayMs = clampNumber(options.retryDelayMs, 0, 5_000, DEFAULT_RETRY_DELAY_MS);
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const fetchedAt = options.now ?? new Date().toISOString();
  const boardsFailed: Array<{ boardToken: string; reason: string }> = [];

  const boardResults = await mapWithConcurrency(boardTokens, requestConcurrency, async (boardToken) => {
    try {
      const jobs = await fetchBoardJobs(boardToken, fetchImpl, {
        signal: options.signal,
        requestRetries,
        retryDelayMs,
        sleepImpl
      });
      return {
        boardToken,
        jobs
      };
    } catch (error) {
      boardsFailed.push({
        boardToken,
        reason: error instanceof Error ? error.message : String(error)
      });
      return {
        boardToken,
        jobs: [] as GreenhouseBoardJob[]
      };
    }
  });

  const listings: RawJobPostingInput[] = [];

  for (const board of boardResults) {
    const boardListings: RawJobPostingInput[] = [];

    for (const job of board.jobs) {
      const location = readJobLocation(job);
      if (!looksSaudi(location)) {
        continue;
      }
      if (options.filterByTargetTitles !== false && !matchesTargetTitle(job.title ?? "", options.targetTitleTerms)) {
        continue;
      }
      const normalized = normalizeBoardJob(board.boardToken, job, location, fetchedAt);

      if (normalized) {
        boardListings.push(normalized);
      }
      if (boardListings.length >= maxListingsPerBoard) {
        break;
      }
    }

    listings.push(...boardListings);
  }

  return {
    fetchedAt,
    sourceName: "greenhouse-board",
    boardsQueried: boardTokens,
    boardsFailed,
    listings: dedupeListings(listings)
  };
}

/** Converts one public Greenhouse board job into an ingest-ready posting. */
export function normalizeBoardJob(
  boardToken: string,
  job: GreenhouseBoardJob,
  location: string,
  fetchedAt: string
): RawJobPostingInput | undefined {
  const sourceJobId = job.id === undefined ? undefined : String(job.id);
  const title = normalizeText(job.title);
  if (!sourceJobId || !title) {
    return undefined;
  }

  const description = normalizeText(stripHtml(decodeHtmlEntities(job.content ?? ""))) || title;
  const applyUrl = normalizeText(job.absolute_url) || undefined;
  const city = detectSaudiCity(location);

  const tags = [
    "official-source",
    "saudi-arabia",
    "source:greenhouse-board",
    `board:${boardToken}`,
    ...(city ? [city.replace(/\s+/g, "-")] : [])
  ];

  return {
    id: `greenhouse:${boardToken}:${sourceJobId}`,
    source: {
      kind: "job-board",
      name: `greenhouse-board:${boardToken}`,
      ...(applyUrl ? { url: applyUrl } : {})
    },
    title,
    company: formatCompanyName(boardToken),
    location,
    description,
    tags,
    applicationTarget: {
      ...(applyUrl ? { url: applyUrl } : {}),
      platform: "greenhouse",
      boardToken,
      jobId: sourceJobId
    },
    discoveredAt: normalizeText(job.updated_at) || fetchedAt
  };
}

async function fetchBoardJobs(
  boardToken: string,
  fetchImpl: typeof fetch,
  options: {
    signal?: AbortSignal;
    requestRetries: number;
    retryDelayMs: number;
    sleepImpl: Sleep;
  }
): Promise<GreenhouseBoardJob[]> {
  const url = `${GREENHOUSE_BOARDS_API}/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const totalAttempts = options.requestRetries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new Error("Greenhouse discovery was aborted.");
    }

    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json"
        },
        ...(options.signal ? { signal: options.signal } : {})
      });

      if (!response.ok) {
        throw new Error(`Greenhouse board "${boardToken}" responded with status ${response.status}.`);
      }

      const payload = (await response.json()) as GreenhouseBoardResponse;
      return Array.isArray(payload.jobs) ? payload.jobs : [];
    } catch (error) {
      lastError = error;
      const retriesRemain = attempt < totalAttempts - 1;
      if (!retriesRemain || !isTransientGreenhouseError(error)) {
        break;
      }
      await options.sleepImpl(options.retryDelayMs * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isTransientGreenhouseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("aborted")) {
    return false;
  }
  const status = message.match(/status\s+(\d{3})/)?.[1];
  if (status) {
    const code = Number(status);
    return code === 429 || code >= 500;
  }
  // Fetch transport failures generally have no HTTP status and are worth one retry.
  return true;
}

function readJobLocation(job: GreenhouseBoardJob): string {
  const primary = normalizeText(job.location?.name);
  if (primary.length > 0) {
    return primary;
  }

  for (const office of job.offices ?? []) {
    const officeLocation = normalizeText(office.location);
    if (officeLocation.length > 0) {
      return officeLocation;
    }
    const officeName = normalizeText(office.name);
    if (officeName.length > 0) {
      return officeName;
    }
  }

  return "";
}

function looksSaudi(location: string): boolean {
  const normalized = location.toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return (
    SAUDI_LOCATION_TERMS.some((term) => normalized.includes(term)) ||
    SAUDI_CITY_TERMS.some((term) => normalized.includes(term))
  );
}

function detectSaudiCity(location: string): string | undefined {
  const normalized = location.toLowerCase();
  const matches = SAUDI_CITY_TERMS.filter((city) => normalized.includes(city));
  if (matches.length === 0) {
    return undefined;
  }
  return matches.reduce((longest, current) => (current.length > longest.length ? current : longest));
}

function matchesTargetTitle(title: string, additionalTerms: readonly string[] = []): boolean {
  const normalized = title.toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  const terms = [...lane1ExactJobTitles, ...additionalTerms].map((term) => term.toLowerCase());
  if (terms.some((term) => normalized.includes(term))) {
    return true;
  }
  const coreTerms = [
    "operations",
    "site",
    "venue",
    "production",
    "installation",
    "overlay",
    "event",
    "logistics",
    "facilities",
    "delivery"
  ];
  return coreTerms.some((term) => normalized.includes(term));
}

function dedupeListings(listings: readonly RawJobPostingInput[]): RawJobPostingInput[] {
  const seen = new Map<string, RawJobPostingInput>();
  for (const listing of listings) {
    if (!seen.has(listing.id)) {
      seen.set(listing.id, listing);
    }
  }
  return Array.from(seen.values());
}

function normalizeBoardTokens(tokens: readonly string[]): string[] {
  return Array.from(
    new Set(
      tokens
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0)
    )
  );
}

function formatCompanyName(boardToken: string): string {
  return boardToken
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    ndash: "-",
    mdash: "-"
  };

  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, entity: string) => named[entity.toLowerCase()] ?? match);
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function clampNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  handler: (item: Input) => Promise<Output>
): Promise<Output[]> {
  const results: Output[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await handler(item);
    }
  });

  await Promise.all(workers);
  return results;
}
