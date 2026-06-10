import type {
  ApplicationPlatform,
  JobPosting,
  JobSourceKind
} from "../shared/contracts.js";

export type RawJobPostingInput = {
  id: string;
  source: {
    kind?: JobSourceKind;
    name: string;
    url?: string;
  };
  title: string;
  company: string;
  location?: string;
  description: string;
  detectedRoleFamily?: string;
  applicationTarget?: {
    url?: string;
    platform?: ApplicationPlatform;
    boardToken?: string;
    jobId?: string;
    submissionUrl?: string;
  };
  tags?: string[];
  discoveredAt?: string;
};

export type IngestJobPostingInput = JobPosting | RawJobPostingInput;

export type IngestJobPostingOptions = {
  defaultDiscoveredAt?: string;
};

export function ingestJobPosting(
  input: IngestJobPostingInput,
  options: IngestJobPostingOptions = {}
): JobPosting {
  const tags = normalizeTags(input.tags ?? []);
  const detectedRoleFamily =
    normalizeOptionalLine(input.detectedRoleFamily) ?? deriveRoleFamilyFromTags(tags);

  return {
    id: requireLine(input.id, "Job id"),
    source: {
      kind: input.source.kind ?? "manual",
      name: requireLine(input.source.name, "Job source name"),
      url: normalizeOptionalLine(input.source.url)
    },
    title: requireLine(input.title, "Job title"),
    company: requireLine(input.company, "Job company"),
    location: normalizeOptionalLine(input.location),
    description: requireBlock(input.description, "Job description"),
    detectedRoleFamily,
    applicationTarget: normalizeApplicationTarget(input.applicationTarget),
    tags,
    discoveredAt:
      normalizeTimestamp(input.discoveredAt) ??
      normalizeTimestamp(options.defaultDiscoveredAt) ??
      new Date().toISOString()
  };
}

function normalizeApplicationTarget(
  value: RawJobPostingInput["applicationTarget"] | JobPosting["applicationTarget"] | undefined
): JobPosting["applicationTarget"] {
  if (!value) {
    return undefined;
  }

  const url = normalizeOptionalLine(value.url);
  const boardToken = normalizeOptionalLine(value.boardToken);
  const jobId = normalizeOptionalLine(value.jobId);
  const submissionUrl = normalizeOptionalLine(value.submissionUrl);
  const platform = normalizeApplicationPlatform(value.platform);

  if (!url && !platform && !boardToken && !jobId && !submissionUrl) {
    return undefined;
  }

  return {
    ...(url ? { url } : {}),
    ...(platform ? { platform } : {}),
    ...(boardToken ? { boardToken } : {}),
    ...(jobId ? { jobId } : {}),
    ...(submissionUrl ? { submissionUrl } : {})
  };
}

function normalizeTags(tags: readonly string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => normalizeWhitespace(tag))
        .filter((tag) => tag.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function deriveRoleFamilyFromTags(tags: readonly string[]): string | undefined {
  return tags.find((tag) => tag.startsWith("family:"))?.slice("family:".length);
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function requireLine(value: string, label: string): string {
  const normalized = normalizeWhitespace(value);

  if (normalized.length === 0) {
    throw new Error(`${label} is required for ingestion.`);
  }

  return normalized;
}

function requireBlock(value: string, label: string): string {
  const normalized = normalizeBlock(value);

  if (normalized.length === 0) {
    throw new Error(`${label} is required for ingestion.`);
  }

  return normalized;
}

function normalizeOptionalLine(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeApplicationPlatform(
  value: ApplicationPlatform | undefined
): ApplicationPlatform | undefined {
  return value === "greenhouse" ? value : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeBlock(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
