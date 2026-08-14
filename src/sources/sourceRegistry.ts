import type { AutomationDeskConfig, AutomationSourceConfig, ReviewReason, SourceCapability } from "../automation/contracts.js";
import type { JobPosting } from "../shared/contracts.js";

export const DEFAULT_SOURCE_FRESHNESS_DAYS = 21;

export type TrustedSourceAssessment = {
  job: JobPosting;
  accepted: boolean;
  capability?: SourceCapability;
  source?: AutomationSourceConfig;
  reviewReason?: Extract<ReviewReason, "source-not-trusted" | "source-stale">;
};

export type TrustedSourceBatch = {
  accepted: Array<{
    job: JobPosting;
    assessment: TrustedSourceAssessment;
  }>;
  excluded: Array<{
    job: JobPosting;
    reason: "duplicate" | Extract<ReviewReason, "source-not-trusted" | "source-stale">;
    assessment?: TrustedSourceAssessment;
  }>;
};

export type TrustedSourceOptions = {
  now?: string;
  maxAgeDays?: number;
};

/**
 * Resolves a job only against explicitly enabled source entries. Greenhouse must
 * match its configured board token; company pages remain review-only unless a
 * future source entry proves an official structured submission path.
 */
export function assessTrustedSource(
  job: JobPosting,
  config: AutomationDeskConfig,
  options: TrustedSourceOptions = {}
): TrustedSourceAssessment {
  if (!isFresh(job.discoveredAt, options.now, options.maxAgeDays)) {
    return {
      job,
      accepted: false,
      reviewReason: "source-stale"
    };
  }

  const source = resolveConfiguredSource(job, config.sources);
  if (!source) {
    return {
      job,
      accepted: false,
      reviewReason: "source-not-trusted"
    };
  }

  return {
    job,
    accepted: true,
    capability: source.capability,
    source
  };
}

/**
 * Filters all jobs through the source trust policy and deduplicates accepted
 * postings by their canonical application destination. For a duplicate, the
 * freshest listing survives and the other record is retained as an exclusion.
 */
export function dedupeFreshTrustedJobs(
  jobs: JobPosting[],
  config: AutomationDeskConfig,
  options: TrustedSourceOptions = {}
): TrustedSourceBatch {
  const chosen = new Map<string, { job: JobPosting; assessment: TrustedSourceAssessment; index: number }>();
  const excluded: TrustedSourceBatch["excluded"] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (!job) {
      continue;
    }
    const assessment = assessTrustedSource(job, config, options);
    if (!assessment.accepted) {
      excluded.push({ job, reason: assessment.reviewReason ?? "source-not-trusted", assessment });
      continue;
    }

    const key = applicationFingerprint(job);
    const existing = chosen.get(key);
    if (!existing) {
      chosen.set(key, { job, assessment, index });
      continue;
    }

    if (isMoreRecent(job, existing.job)) {
      excluded.push({ job: existing.job, reason: "duplicate", assessment: existing.assessment });
      chosen.set(key, { job, assessment, index: existing.index });
    } else {
      excluded.push({ job, reason: "duplicate", assessment });
    }
  }

  return {
    accepted: [...chosen.values()]
      .sort((left, right) => left.index - right.index)
      .map(({ job, assessment }) => ({ job, assessment })),
    excluded
  };
}

function resolveConfiguredSource(
  job: JobPosting,
  configuredSources: AutomationSourceConfig[]
): AutomationSourceConfig | undefined {
  const enabledSources = configuredSources.filter((source) => source.enabled);
  const platform = job.applicationTarget?.platform;

  if (platform === "greenhouse") {
    const boardToken = job.applicationTarget?.boardToken ?? readBoardToken(job.tags);
    if (!boardToken || !hasOfficialSourceSignal(job)) {
      return undefined;
    }
    return enabledSources.find(
      (source) => source.kind === "greenhouse" && source.boardToken?.toLowerCase() === boardToken.toLowerCase()
    );
  }

  if (job.source.kind === "company-page" && hasOfficialSourceSignal(job)) {
    return enabledSources.find((source) => source.kind === "company-page");
  }

  if (job.source.kind === "manual") {
    return enabledSources.find((source) => source.kind === "manual");
  }

  return undefined;
}

function hasOfficialSourceSignal(job: JobPosting): boolean {
  return job.tags.some((tag) => tag.trim().toLowerCase() === "official-source");
}

function readBoardToken(tags: string[]): string | undefined {
  const tag = tags.find((entry) => entry.toLowerCase().startsWith("board:"));
  return tag?.slice("board:".length).trim() || undefined;
}

function isFresh(discoveredAt: string, now: string | undefined, maxAgeDays: number | undefined): boolean {
  const discoveredTimestamp = Date.parse(discoveredAt);
  const nowTimestamp = Date.parse(now ?? new Date().toISOString());
  const safeMaxAgeDays = maxAgeDays ?? DEFAULT_SOURCE_FRESHNESS_DAYS;

  if (!Number.isFinite(discoveredTimestamp) || !Number.isFinite(nowTimestamp) || safeMaxAgeDays < 0) {
    return false;
  }

  return nowTimestamp - discoveredTimestamp <= safeMaxAgeDays * 24 * 60 * 60 * 1000;
}

function applicationFingerprint(job: JobPosting): string {
  const target = job.applicationTarget?.url ?? job.source.url;
  if (target) {
    return `url:${normalizeUrl(target)}`;
  }
  return `role:${normalizeText(job.company)}|${normalizeText(job.title)}|${normalizeText(job.location ?? "")}`;
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMoreRecent(candidate: JobPosting, incumbent: JobPosting): boolean {
  return Date.parse(candidate.discoveredAt) > Date.parse(incumbent.discoveredAt);
}
