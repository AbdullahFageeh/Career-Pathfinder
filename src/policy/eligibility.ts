import type { JobPosting } from "../shared/contracts.js";

export type EligibilityBlockerKind =
  | "outside-target-country"
  | "nationality-restricted"
  | "low-legitimacy-signal"
  | "blocked-company"
  | "missing-application-channel";

export type EligibilityBlocker = {
  kind: EligibilityBlockerKind;
  message: string;
};

export type EligibilityWarningKind =
  | "unverified-location"
  | "unofficial-source"
  | "seniority-mismatch-risk"
  | "language-requirement";

export type EligibilityWarning = {
  kind: EligibilityWarningKind;
  message: string;
};

export type JobEligibilityAssessment = {
  jobId: string;
  eligible: boolean;
  blockers: EligibilityBlocker[];
  warnings: EligibilityWarning[];
  resolvedCity?: string;
  requiresSaudiNationality: boolean;
  remoteFriendly: boolean;
  assessedAt: string;
};

export type CandidateEligibilityContext = {
  isSaudiNational?: boolean;
  hasSaudiWorkAuthorization?: boolean;
  homeCity?: string;
};

export type JobEligibilityOptions = {
  candidate?: CandidateEligibilityContext;
  blockedCompanies?: readonly string[];
  requireApplicationChannel?: boolean;
  now?: string;
};

/**
 * Known Saudi cities and regions used to resolve a posting to the hard
 * geographic filter defined in AGENTS.md.
 */
export const SAUDI_LOCATION_TERMS: readonly string[] = [
  "saudi arabia",
  "saudi",
  "ksa",
  "k.s.a",
  "المملكة العربية السعودية",
  "السعودية"
];

export const SAUDI_CITY_TERMS: readonly string[] = [
  "jeddah",
  "jiddah",
  "riyadh",
  "ar riyadh",
  "dammam",
  "khobar",
  "al khobar",
  "dhahran",
  "jubail",
  "yanbu",
  "makkah",
  "mecca",
  "madinah",
  "medina",
  "taif",
  "abha",
  "tabuk",
  "hail",
  "jazan",
  "jizan",
  "najran",
  "buraidah",
  "qassim",
  "khamis mushait",
  "kaec",
  "king abdullah economic city",
  "rabigh",
  "neom",
  "umluj",
  "diriyah",
  "qiddiya",
  "red sea",
  "amaala",
  "trojena",
  "sindalah",
  "al ula",
  "alula",
  "hafar al batin",
  "arar",
  "sakaka",
  "al baha",
  "jeddah corniche"
];

const REMOTE_TERMS: readonly string[] = ["remote", "work from home", "hybrid", "telecommute"];

const NATIONALITY_RESTRICTION_TERMS: readonly string[] = [
  "saudi national",
  "saudi nationals",
  "saudi national only",
  "saudi nationals only",
  "saudis only",
  "saudi nationality is required",
  "must be a saudi national",
  "saudi national candidates only",
  "open to saudi nationals",
  "for saudi nationals",
  "saudi citizens only"
];

const NATIONALITY_RESTRICTION_TAGS: readonly string[] = [
  "saudi-national-only",
  "saudi-nationals-only",
  "saudi-only-nationality"
];

const LOW_LEGITIMACY_TERMS: readonly string[] = [
  "commission only",
  "commission-only",
  "100% commission",
  "unlimited earning potential",
  "be your own boss",
  "network marketing",
  "multi-level marketing",
  "mlm",
  "pay a registration fee",
  "registration fee required",
  "training fee",
  "pay for training",
  "investment required to start",
  "send your bank details",
  "whatsapp only application",
  "no experience needed high salary",
  "earn from home daily payout"
];

const LANGUAGE_REQUIREMENT_TERMS: readonly string[] = [
  "arabic speaker required",
  "fluent arabic required",
  "native arabic",
  "arabic is a must"
];

const OFFICIAL_SOURCE_TAGS: readonly string[] = ["official-source", "official", "company-page"];

/**
 * Evaluates whether a discovered posting is worth spending application effort
 * on. This is intentionally conservative: anything that cannot be resolved to
 * Saudi Arabia, or that carries a hard nationality restriction the candidate
 * cannot satisfy, is blocked before it can reach tailoring or outreach.
 */
export function assessJobEligibility(
  job: JobPosting,
  options: JobEligibilityOptions = {}
): JobEligibilityAssessment {
  const assessedAt = options.now ?? new Date().toISOString();
  const haystack = buildHaystack(job);
  const normalizedTags = job.tags.map((tag) => tag.toLowerCase());
  const locationText = (job.location ?? "").toLowerCase();

  const resolvedCity = resolveSaudiCity(locationText, normalizedTags);
  const remoteFriendly = containsAny(locationText, REMOTE_TERMS) || containsAny(haystack, REMOTE_TERMS);
  const locationLooksSaudi =
    Boolean(resolvedCity) ||
    containsAny(locationText, SAUDI_LOCATION_TERMS) ||
    normalizedTags.includes("saudi-arabia") ||
    normalizedTags.includes("saudi");

  const requiresSaudiNationality =
    NATIONALITY_RESTRICTION_TAGS.some((tag) => normalizedTags.includes(tag)) ||
    containsAny(haystack, NATIONALITY_RESTRICTION_TERMS);

  const blockers: EligibilityBlocker[] = [];
  const warnings: EligibilityWarning[] = [];

  if (!locationLooksSaudi) {
    blockers.push({
      kind: "outside-target-country",
      message: job.location
        ? `Location "${job.location}" could not be resolved to Saudi Arabia.`
        : "Posting has no location and could not be resolved to Saudi Arabia."
    });
  }

  if (requiresSaudiNationality && options.candidate?.isSaudiNational !== true) {
    blockers.push({
      kind: "nationality-restricted",
      message: "Posting is restricted to Saudi nationals and the candidate profile does not confirm that status."
    });
  }

  const legitimacyHit = findFirstMatch(haystack, LOW_LEGITIMACY_TERMS);
  if (legitimacyHit) {
    blockers.push({
      kind: "low-legitimacy-signal",
      message: `Posting contains a low-legitimacy signal ("${legitimacyHit}").`
    });
  }

  const blockedCompany = (options.blockedCompanies ?? []).find(
    (company) => company.trim().toLowerCase() === job.company.trim().toLowerCase()
  );
  if (blockedCompany) {
    blockers.push({
      kind: "blocked-company",
      message: `Company "${job.company}" is on the blocked list.`
    });
  }

  const applicationUrl = job.applicationTarget?.url ?? job.applicationTarget?.submissionUrl;
  if (options.requireApplicationChannel === true && !applicationUrl) {
    blockers.push({
      kind: "missing-application-channel",
      message: "Posting has no application URL, so it cannot be actioned automatically."
    });
  }

  if (locationLooksSaudi && !resolvedCity && !remoteFriendly) {
    warnings.push({
      kind: "unverified-location",
      message: "Country resolved to Saudi Arabia but the city could not be identified."
    });
  }

  if (!OFFICIAL_SOURCE_TAGS.some((tag) => normalizedTags.includes(tag)) && job.source.kind !== "company-page") {
    warnings.push({
      kind: "unofficial-source",
      message: "Lead is not marked as an official employer or platform source; verify before acting."
    });
  }

  const languageHit = findFirstMatch(haystack, LANGUAGE_REQUIREMENT_TERMS);
  if (languageHit) {
    warnings.push({
      kind: "language-requirement",
      message: `Posting states an Arabic language requirement ("${languageHit}").`
    });
  }

  return {
    jobId: job.id,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    ...(resolvedCity ? { resolvedCity } : {}),
    requiresSaudiNationality,
    remoteFriendly,
    assessedAt
  };
}

/**
 * Splits a batch of postings into the ones worth working and the ones that
 * should never consume application effort.
 */
export function partitionEligibleJobs(
  jobs: readonly JobPosting[],
  options: JobEligibilityOptions = {}
): {
  eligible: JobPosting[];
  excluded: Array<{ job: JobPosting; assessment: JobEligibilityAssessment }>;
  assessments: Map<string, JobEligibilityAssessment>;
} {
  const eligible: JobPosting[] = [];
  const excluded: Array<{ job: JobPosting; assessment: JobEligibilityAssessment }> = [];
  const assessments = new Map<string, JobEligibilityAssessment>();

  for (const job of jobs) {
    const assessment = assessJobEligibility(job, options);
    assessments.set(job.id, assessment);
    if (assessment.eligible) {
      eligible.push(job);
      continue;
    }
    excluded.push({ job, assessment });
  }

  return {
    eligible,
    excluded,
    assessments
  };
}

export function resolveSaudiCity(
  locationText: string,
  normalizedTags: readonly string[] = []
): string | undefined {
  const searchSpace = [locationText, ...normalizedTags].join(" ").toLowerCase();
  const matches = SAUDI_CITY_TERMS.filter((city) => searchSpace.includes(city));
  if (matches.length === 0) {
    return undefined;
  }
  return matches.reduce((longest, current) => (current.length > longest.length ? current : longest));
}

function buildHaystack(job: JobPosting): string {
  return [job.title, job.company, job.location ?? "", job.description, job.tags.join(" ")]
    .join("\n")
    .toLowerCase();
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function findFirstMatch(text: string, terms: readonly string[]): string | undefined {
  return terms.find((term) => text.includes(term));
}
