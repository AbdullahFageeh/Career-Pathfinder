import type { CandidateProfile, JobPosting } from "../shared/contracts.js";
import {
  assessJobEligibility,
  resolveSaudiCity,
  type JobEligibilityAssessment,
  type JobEligibilityOptions
} from "../policy/eligibility.js";
import { lane1ExactJobTitles } from "../policy/targetTitles.js";

export type FitDimensionKey =
  | "title-family"
  | "evidence-overlap"
  | "seniority"
  | "location"
  | "application-channel"
  | "freshness";

export type FitDimension = {
  key: FitDimensionKey;
  label: string;
  score: number;
  maxScore: number;
  notes: string[];
};

export type JobFitScore = {
  jobId: string;
  score: number;
  band: "strong" | "possible" | "stretch" | "skip";
  dimensions: FitDimension[];
  matchedTitleTerms: string[];
  matchedEvidenceTerms: string[];
  reasons: string[];
  eligibility: JobEligibilityAssessment;
  scoredAt: string;
};

export type RankedJobOpportunity = {
  job: JobPosting;
  fit: JobFitScore;
  rank: number;
};

export type FitScoringOptions = JobEligibilityOptions & {
  /** City the candidate can reach without relocation, defaults to Jeddah. */
  homeCity?: string;
  /** Cities that are commutable or short-stay friendly from the home city. */
  nearbyCities?: readonly string[];
  /** Reference timestamp used for freshness scoring. */
  now?: string;
  /** Extra title terms treated as direct-fit beyond the Lane 1 shortlist. */
  additionalTargetTitles?: readonly string[];
};

const TITLE_FAMILY_MAX = 30;
const EVIDENCE_OVERLAP_MAX = 25;
const SENIORITY_MAX = 15;
const LOCATION_MAX = 15;
const APPLICATION_CHANNEL_MAX = 10;
const FRESHNESS_MAX = 5;

const DEFAULT_HOME_CITY = "jeddah";
const DEFAULT_NEARBY_CITIES: readonly string[] = [
  "kaec",
  "king abdullah economic city",
  "rabigh",
  "makkah",
  "mecca",
  "taif",
  "yanbu",
  "madinah",
  "medina"
];

const SENIOR_TITLE_TERMS: readonly string[] = [
  "head of",
  "director",
  "vice president",
  "vp ",
  "chief"
];

const MANAGER_TITLE_TERMS: readonly string[] = ["manager", "lead", "supervisor", "superintendent"];

const COORDINATOR_TITLE_TERMS: readonly string[] = [
  "coordinator",
  "specialist",
  "officer",
  "executive",
  "administrator"
];

const ENTRY_TITLE_TERMS: readonly string[] = [
  "intern",
  "trainee",
  "graduate",
  "assistant",
  "operator",
  "driver",
  "helper",
  "clerk",
  "agent"
];

const STRONG_CHANNEL_TERMS: readonly string[] = [
  "greenhouse.io",
  "myworkdayjobs.com",
  "workday",
  "smartrecruiters.com",
  "successfactors",
  "taleo",
  "oraclecloud.com",
  "icims.com",
  "lever.co",
  "ashbyhq.com",
  "careers."
];

const WEAK_CHANNEL_TERMS: readonly string[] = ["facebook.com", "t.me", "wa.me", "whatsapp", "bit.ly"];

const EVIDENCE_STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "into",
  "over",
  "under",
  "across",
  "team",
  "teams",
  "work",
  "working",
  "role",
  "roles",
  "year",
  "years",
  "plus",
  "more",
  "than",
  "per",
  "day",
  "days"
]);

/**
 * Scores how well one posting fits the candidate, combining title alignment,
 * evidence overlap, seniority sanity, travel cost, and channel quality.
 * Ineligible postings are hard-capped so they can never top a shortlist.
 */
export function scoreJobFit(
  profile: CandidateProfile,
  job: JobPosting,
  options: FitScoringOptions = {}
): JobFitScore {
  const scoredAt = options.now ?? new Date().toISOString();
  const eligibility = assessJobEligibility(job, options);

  const titleFamily = scoreTitleFamily(profile, job, options);
  const evidenceOverlap = scoreEvidenceOverlap(profile, job);
  const seniority = scoreSeniority(job);
  const location = scoreLocation(job, options);
  const applicationChannel = scoreApplicationChannel(job);
  const freshness = scoreFreshness(job, scoredAt);

  const dimensions = [titleFamily, evidenceOverlap, seniority, location, applicationChannel, freshness];
  const rawScore = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const score = eligibility.eligible ? rawScore : Math.min(rawScore, 20);

  const reasons = buildReasons(dimensions, eligibility);

  return {
    jobId: job.id,
    score,
    band: resolveBand(score, eligibility),
    dimensions,
    matchedTitleTerms: extractNoteTerms(titleFamily),
    matchedEvidenceTerms: extractNoteTerms(evidenceOverlap),
    reasons,
    eligibility,
    scoredAt
  };
}

/**
 * Ranks a batch of postings so the operator always has an ordered, defensible
 * "work these first" list instead of an undifferentiated pile.
 */
export function rankJobOpportunities(
  profile: CandidateProfile,
  jobs: readonly JobPosting[],
  options: FitScoringOptions & {
    limit?: number;
    includeIneligible?: boolean;
    minimumScore?: number;
  } = {}
): RankedJobOpportunity[] {
  const scored = jobs.map((job) => ({
    job,
    fit: scoreJobFit(profile, job, options)
  }));

  const filtered = scored.filter((entry) => {
    if (!options.includeIneligible && !entry.fit.eligibility.eligible) {
      return false;
    }
    if (typeof options.minimumScore === "number" && entry.fit.score < options.minimumScore) {
      return false;
    }
    return true;
  });

  const sorted = filtered.sort((left, right) => {
    if (right.fit.score !== left.fit.score) {
      return right.fit.score - left.fit.score;
    }
    const rightDiscovered = Date.parse(right.job.discoveredAt);
    const leftDiscovered = Date.parse(left.job.discoveredAt);
    if (Number.isFinite(rightDiscovered) && Number.isFinite(leftDiscovered) && rightDiscovered !== leftDiscovered) {
      return rightDiscovered - leftDiscovered;
    }
    return left.job.id.localeCompare(right.job.id);
  });

  const limited = typeof options.limit === "number" ? sorted.slice(0, Math.max(0, options.limit)) : sorted;

  return limited.map((entry, index) => ({
    job: entry.job,
    fit: entry.fit,
    rank: index + 1
  }));
}

/** Renders a ranked shortlist as a Markdown action list. */
export function formatShortlistMarkdown(
  ranked: readonly RankedJobOpportunity[],
  options: {
    generatedAt?: string;
    title?: string;
  } = {}
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const title = options.title ?? "Daily application shortlist";

  if (ranked.length === 0) {
    return [`# ${title}`, "", `Generated: ${generatedAt}`, "", "No eligible opportunities were found."].join("\n");
  }

  const rows = ranked.map((entry) => {
    const city = entry.fit.eligibility.resolvedCity ?? entry.job.location ?? "unknown";
    const link = entry.job.applicationTarget?.url ?? entry.job.source.url ?? "";
    return `| ${entry.rank} | ${entry.fit.score} | ${entry.fit.band} | ${escapeCell(entry.job.title)} | ${escapeCell(
      entry.job.company
    )} | ${escapeCell(city)} | ${link ? `[apply](${link})` : "no link"} |`;
  });

  const details = ranked.map((entry) => {
    const lines = [
      `### ${entry.rank}. ${entry.job.title} - ${entry.job.company}`,
      "",
      `- Fit score: ${entry.fit.score}/100 (${entry.fit.band})`,
      `- Why: ${entry.fit.reasons.join(" ")}`
    ];
    if (entry.fit.eligibility.warnings.length > 0) {
      lines.push(`- Check before applying: ${entry.fit.eligibility.warnings.map((item) => item.message).join(" ")}`);
    }
    return lines.join("\n");
  });

  return [
    `# ${title}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "| # | Score | Band | Role | Company | City | Link |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Why these roles",
    "",
    ...details,
    ""
  ].join("\n");
}

function scoreTitleFamily(
  profile: CandidateProfile,
  job: JobPosting,
  options: FitScoringOptions
): FitDimension {
  const normalizedTitle = job.title.toLowerCase();
  const targetTitles = [
    ...lane1ExactJobTitles,
    ...profile.targetRoleFamilies,
    ...(options.additionalTargetTitles ?? [])
  ].map((title) => title.toLowerCase());

  const exactMatches = targetTitles.filter((title) => normalizedTitle.includes(title));
  const titleTokens = tokenize(normalizedTitle);
  const targetTokens = new Set(targetTitles.flatMap((title) => tokenize(title)));
  const tokenMatches = Array.from(new Set(titleTokens.filter((token) => targetTokens.has(token))));

  const notes: string[] = [];
  let score = 0;

  if (exactMatches.length > 0) {
    score = TITLE_FAMILY_MAX;
    notes.push(`Direct target title match: ${unique(exactMatches).join(", ")}.`);
  } else if (tokenMatches.length > 0) {
    score = Math.min(TITLE_FAMILY_MAX - 6, 6 * tokenMatches.length);
    notes.push(`Adjacent title overlap on ${tokenMatches.join(", ")}.`);
  } else {
    notes.push("Title does not overlap the target role families.");
  }

  const familyTag = job.tags.find((tag) => tag.toLowerCase().startsWith("family:"));
  if (familyTag) {
    notes.push(`Tagged role family ${familyTag.slice("family:".length)}.`);
  }

  return {
    key: "title-family",
    label: "Target title alignment",
    score,
    maxScore: TITLE_FAMILY_MAX,
    notes
  };
}

function scoreEvidenceOverlap(profile: CandidateProfile, job: JobPosting): FitDimension {
  const jobTokens = new Set(tokenize(`${job.title} ${job.description} ${job.tags.join(" ")}`));
  const evidencePool = [
    profile.headline,
    ...profile.coreProofPoints,
    ...profile.certifications,
    ...profile.targetRoleFamilies
  ];

  const matchedTerms = unique(
    evidencePool
      .flatMap((item) => tokenize(item))
      .filter((token) => jobTokens.has(token))
  );

  const ratio = evidencePool.length === 0 ? 0 : Math.min(1, matchedTerms.length / 12);
  const score = Math.round(EVIDENCE_OVERLAP_MAX * ratio);

  return {
    key: "evidence-overlap",
    label: "Evidence overlap",
    score,
    maxScore: EVIDENCE_OVERLAP_MAX,
    notes:
      matchedTerms.length > 0
        ? [`Profile evidence shares ${matchedTerms.length} terms with the posting: ${matchedTerms.slice(0, 10).join(", ")}.`]
        : ["No profile evidence terms appear in the posting."]
  };
}

function scoreSeniority(job: JobPosting): FitDimension {
  const normalizedTitle = job.title.toLowerCase();

  if (MANAGER_TITLE_TERMS.some((term) => normalizedTitle.includes(term))) {
    return {
      key: "seniority",
      label: "Seniority match",
      score: SENIORITY_MAX,
      maxScore: SENIORITY_MAX,
      notes: ["Manager or supervisor level, matching current delivery responsibility."]
    };
  }

  if (SENIOR_TITLE_TERMS.some((term) => normalizedTitle.includes(term))) {
    return {
      key: "seniority",
      label: "Seniority match",
      score: 9,
      maxScore: SENIORITY_MAX,
      notes: ["Senior leadership level; a stretch that needs a strong narrative."]
    };
  }

  if (COORDINATOR_TITLE_TERMS.some((term) => normalizedTitle.includes(term))) {
    return {
      key: "seniority",
      label: "Seniority match",
      score: 10,
      maxScore: SENIORITY_MAX,
      notes: ["Coordinator or specialist level; realistic but below current scope."]
    };
  }

  if (ENTRY_TITLE_TERMS.some((term) => normalizedTitle.includes(term))) {
    return {
      key: "seniority",
      label: "Seniority match",
      score: 3,
      maxScore: SENIORITY_MAX,
      notes: ["Entry level; likely a step down in pay and scope."]
    };
  }

  return {
    key: "seniority",
    label: "Seniority match",
    score: 7,
    maxScore: SENIORITY_MAX,
    notes: ["Seniority could not be inferred from the title."]
  };
}

function scoreLocation(job: JobPosting, options: FitScoringOptions): FitDimension {
  const homeCity = (options.homeCity ?? DEFAULT_HOME_CITY).toLowerCase();
  const nearbyCities = (options.nearbyCities ?? DEFAULT_NEARBY_CITIES).map((city) => city.toLowerCase());
  const locationText = (job.location ?? "").toLowerCase();
  const normalizedTags = job.tags.map((tag) => tag.toLowerCase());
  const resolvedCity = resolveSaudiCity(locationText, normalizedTags);

  if (locationText.includes("remote") || normalizedTags.includes("remote")) {
    return {
      key: "location",
      label: "Location cost",
      score: LOCATION_MAX,
      maxScore: LOCATION_MAX,
      notes: ["Remote friendly, so no relocation or commute cost."]
    };
  }

  if (resolvedCity && (resolvedCity.includes(homeCity) || homeCity.includes(resolvedCity))) {
    return {
      key: "location",
      label: "Location cost",
      score: LOCATION_MAX,
      maxScore: LOCATION_MAX,
      notes: [`Based in the home city (${resolvedCity}).`]
    };
  }

  if (resolvedCity && nearbyCities.some((city) => resolvedCity.includes(city) || city.includes(resolvedCity))) {
    return {
      key: "location",
      label: "Location cost",
      score: 11,
      maxScore: LOCATION_MAX,
      notes: [`Within short-travel range of the home city (${resolvedCity}).`]
    };
  }

  if (resolvedCity) {
    return {
      key: "location",
      label: "Location cost",
      score: 6,
      maxScore: LOCATION_MAX,
      notes: [`Requires relocation or rotation to ${resolvedCity}.`]
    };
  }

  return {
    key: "location",
    label: "Location cost",
    score: 3,
    maxScore: LOCATION_MAX,
    notes: ["City is unresolved, so travel cost is unknown."]
  };
}

function scoreApplicationChannel(job: JobPosting): FitDimension {
  const url = (job.applicationTarget?.url ?? job.applicationTarget?.submissionUrl ?? job.source.url ?? "").toLowerCase();

  if (!url) {
    return {
      key: "application-channel",
      label: "Application channel",
      score: 2,
      maxScore: APPLICATION_CHANNEL_MAX,
      notes: ["No application link captured, so this needs manual sourcing."]
    };
  }

  if (WEAK_CHANNEL_TERMS.some((term) => url.includes(term))) {
    return {
      key: "application-channel",
      label: "Application channel",
      score: 2,
      maxScore: APPLICATION_CHANNEL_MAX,
      notes: ["Application link is a social or shortened URL; verify legitimacy first."]
    };
  }

  if (job.applicationTarget?.platform === "greenhouse") {
    return {
      key: "application-channel",
      label: "Application channel",
      score: APPLICATION_CHANNEL_MAX,
      maxScore: APPLICATION_CHANNEL_MAX,
      notes: ["Greenhouse target, which this system can prefill in a supervised session."]
    };
  }

  if (STRONG_CHANNEL_TERMS.some((term) => url.includes(term))) {
    return {
      key: "application-channel",
      label: "Application channel",
      score: 8,
      maxScore: APPLICATION_CHANNEL_MAX,
      notes: ["Applies through a recognised applicant tracking system."]
    };
  }

  return {
    key: "application-channel",
    label: "Application channel",
    score: 5,
    maxScore: APPLICATION_CHANNEL_MAX,
    notes: ["Applies through a generic web form or careers page."]
  };
}

function scoreFreshness(job: JobPosting, now: string): FitDimension {
  const discovered = Date.parse(job.discoveredAt);
  const reference = Date.parse(now);

  if (!Number.isFinite(discovered) || !Number.isFinite(reference)) {
    return {
      key: "freshness",
      label: "Lead freshness",
      score: 2,
      maxScore: FRESHNESS_MAX,
      notes: ["Discovery date is unavailable."]
    };
  }

  const ageDays = Math.max(0, Math.floor((reference - discovered) / 86_400_000));

  if (ageDays <= 3) {
    return {
      key: "freshness",
      label: "Lead freshness",
      score: FRESHNESS_MAX,
      maxScore: FRESHNESS_MAX,
      notes: [`Discovered ${ageDays} day(s) ago.`]
    };
  }
  if (ageDays <= 14) {
    return {
      key: "freshness",
      label: "Lead freshness",
      score: 3,
      maxScore: FRESHNESS_MAX,
      notes: [`Discovered ${ageDays} days ago.`]
    };
  }
  return {
    key: "freshness",
    label: "Lead freshness",
    score: 1,
    maxScore: FRESHNESS_MAX,
    notes: [`Discovered ${ageDays} days ago; confirm the posting is still open.`]
  };
}

function buildReasons(
  dimensions: readonly FitDimension[],
  eligibility: JobEligibilityAssessment
): string[] {
  const reasons = dimensions
    .slice()
    .sort((left, right) => right.score / right.maxScore - left.score / left.maxScore)
    .slice(0, 3)
    .flatMap((dimension) => dimension.notes.slice(0, 1));

  if (!eligibility.eligible) {
    reasons.unshift(`Blocked: ${eligibility.blockers.map((blocker) => blocker.message).join(" ")}`);
  }

  return reasons;
}

function resolveBand(score: number, eligibility: JobEligibilityAssessment): JobFitScore["band"] {
  if (!eligibility.eligible) {
    return "skip";
  }
  if (score >= 75) {
    return "strong";
  }
  if (score >= 55) {
    return "possible";
  }
  if (score >= 35) {
    return "stretch";
  }
  return "skip";
}

function extractNoteTerms(dimension: FitDimension): string[] {
  const note = dimension.notes[0] ?? "";
  const afterColon = note.includes(":") ? note.slice(note.indexOf(":") + 1) : "";
  return afterColon
    .replace(/\.$/, "")
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !EVIDENCE_STOP_WORDS.has(token));
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
