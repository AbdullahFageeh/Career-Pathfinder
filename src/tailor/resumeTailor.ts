import type {
  CandidateProfile,
  JobPosting,
  TailoredResume,
  TailoredResumeSection,
  TailoringEvidence,
  TailoringEvidenceKind
} from "../shared/contracts.js";

const DEFAULT_MAX_KEYWORDS = 15;
const DEFAULT_MAX_ROLE_FAMILIES = 3;
const DEFAULT_MAX_PROOF_POINTS = 5;
const DEFAULT_MAX_CERTIFICATIONS = 3;

const TITLE_PHRASE_WEIGHT = 8;
const DETECTED_ROLE_FAMILY_WEIGHT = 6;
const TITLE_TOKEN_WEIGHT = 4;
const TAG_TOKEN_WEIGHT = 3;
const DESCRIPTION_TOKEN_WEIGHT = 1;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "lead",
  "manager",
  "of",
  "on",
  "or",
  "specialist",
  "senior",
  "that",
  "the",
  "to",
  "with"
]);

export type JobKeywordSource = "title" | "description" | "detected-role-family" | "tag";

type WeightedKeyword = {
  term: string;
  normalizedTerm: string;
  tokens: string[];
  weight: number;
  sources: Set<JobKeywordSource>;
};

type RankedEvidence = TailoringEvidence & {
  order: number;
};

export type TailorResumeOptions = {
  maxKeywords?: number;
  maxRoleFamilies?: number;
  maxProofPoints?: number;
  maxCertifications?: number;
};

export type ExtractedJobKeyword = {
  term: string;
  weight: number;
  sources: JobKeywordSource[];
};

export function buildTailoredResume(
  profile: CandidateProfile,
  job: JobPosting,
  options: TailorResumeOptions = {}
): TailoredResume {
  const extractedKeywords = extractWeightedJobKeywords(job, options.maxKeywords);
  const rankedHeadline = scoreEvidence("headline", profile.headline, extractedKeywords, 0);
  const rankedRoleFamilies = scoreEvidenceList(
    "target-role-family",
    profile.targetRoleFamilies,
    extractedKeywords
  );
  const rankedProofPoints = scoreEvidenceList("proof-point", profile.coreProofPoints, extractedKeywords);
  const rankedCertifications = scoreEvidenceList(
    "certification",
    profile.certifications,
    extractedKeywords
  );

  const selectedRoleFamilies = selectRankedEvidence(
    rankedRoleFamilies,
    profile.targetRoleFamilies,
    options.maxRoleFamilies ?? DEFAULT_MAX_ROLE_FAMILIES
  );
  const selectedProofPoints = selectRankedEvidence(
    rankedProofPoints,
    profile.coreProofPoints,
    options.maxProofPoints ?? DEFAULT_MAX_PROOF_POINTS
  );
  const selectedCertifications = selectRankedEvidence(
    rankedCertifications,
    profile.certifications,
    options.maxCertifications ?? DEFAULT_MAX_CERTIFICATIONS
  );

  const evidenceTrail = compactEvidenceTrail([
    rankedHeadline,
    ...selectedRoleFamilies,
    ...selectedProofPoints,
    ...selectedCertifications
  ]);
  const matchedKeywords = Array.from(
    new Set(evidenceTrail.flatMap((evidence) => evidence.matchedKeywords))
  );

  const tailoredSummary = buildTailoredSummary(
    profile,
    job,
    selectedRoleFamilies.map((item) => item.value),
    selectedProofPoints.map((item) => item.value),
    selectedCertifications.map((item) => item.value)
  );

  const sections = buildTailoredSections(
    tailoredSummary,
    selectedRoleFamilies.map((item) => item.value),
    selectedProofPoints.map((item) => item.value),
    selectedCertifications.map((item) => item.value)
  );

  return {
    id: `${job.id}:tailored`,
    jobId: job.id,
    variantName: `${job.title} at ${job.company}`,
    generatedAt: new Date().toISOString(),
    evidenceUsed: evidenceTrail.map((evidence) => evidence.value),
    matchedKeywords,
    tailoredHeadline: profile.headline,
    tailoredSummary,
    selectedRoleFamilies: selectedRoleFamilies.map((item) => item.value),
    selectedProofPoints: selectedProofPoints.map((item) => item.value),
    selectedCertifications: selectedCertifications.map((item) => item.value),
    sections,
    evidenceTrail
  };
}

export function extractJobKeywords(
  job: JobPosting,
  maxKeywords = DEFAULT_MAX_KEYWORDS
): ExtractedJobKeyword[] {
  return extractWeightedJobKeywords(job, maxKeywords).map((keyword) => ({
    term: keyword.term,
    weight: keyword.weight,
    sources: Array.from(keyword.sources).sort()
  }));
}

function buildTailoredSummary(
  profile: CandidateProfile,
  job: JobPosting,
  roleFamilies: string[],
  proofPoints: string[],
  certifications: string[]
): string {
  const sentences = [profile.headline.trim()];
  const focusLead = roleFamilies.length > 0 ? joinList(roleFamilies.slice(0, 2)) : job.title;
  const focusSentence = `Focused on ${job.title} opportunities with strongest fit across ${focusLead}.`;
  sentences.push(focusSentence);

  if (proofPoints.length > 0) {
    sentences.push(`Top supporting evidence: ${joinList(proofPoints.slice(0, 3))}.`);
  }

  if (certifications.length > 0) {
    sentences.push(`Relevant certifications: ${joinList(certifications.slice(0, 2))}.`);
  }

  return sentences.join(" ");
}

function buildTailoredSections(
  tailoredSummary: string,
  roleFamilies: string[],
  proofPoints: string[],
  certifications: string[]
): TailoredResumeSection[] {
  const sections: TailoredResumeSection[] = [
    {
      key: "summary",
      title: "Tailored Summary",
      lines: [tailoredSummary]
    },
    {
      key: "target-role-families",
      title: "Target Role Families",
      lines: roleFamilies
    },
    {
      key: "proof-points",
      title: "Selected Proof Points",
      lines: proofPoints
    },
    {
      key: "certifications",
      title: "Relevant Certifications",
      lines: certifications
    }
  ];

  return sections.filter((section) => section.lines.length > 0);
}

function selectRankedEvidence(
  rankedItems: RankedEvidence[],
  fallbackValues: readonly string[],
  limit: number
): RankedEvidence[] {
  const selected = rankedItems
    .filter((item) => item.score > 0)
    .sort(compareRankedEvidence)
    .slice(0, limit);

  if (selected.length >= limit) {
    return selected;
  }

  const seen = new Set(selected.map((item) => item.value));

  for (const fallbackValue of fallbackValues) {
    if (seen.has(fallbackValue)) {
      continue;
    }

    const rankedFallback = rankedItems.find((item) => item.value === fallbackValue);

    if (!rankedFallback) {
      continue;
    }

    selected.push(rankedFallback);
    seen.add(fallbackValue);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function compactEvidenceTrail(evidence: RankedEvidence[]): TailoringEvidence[] {
  const bestByKey = new Map<string, TailoringEvidence>();

  for (const item of evidence) {
    const key = `${item.kind}:${item.value}`;
    const existing = bestByKey.get(key);

    if (!existing || item.score > existing.score) {
      bestByKey.set(key, {
        kind: item.kind,
        value: item.value,
        score: item.score,
        matchedKeywords: item.matchedKeywords
      });
    }
  }

  return Array.from(bestByKey.values()).sort(comparePlainEvidence);
}

function scoreEvidenceList(
  kind: Exclude<TailoringEvidenceKind, "headline">,
  values: readonly string[],
  keywords: readonly WeightedKeyword[]
): RankedEvidence[] {
  return values.map((value, index) => scoreEvidence(kind, value, keywords, index));
}

function scoreEvidence(
  kind: TailoringEvidenceKind,
  value: string,
  keywords: readonly WeightedKeyword[],
  order: number
): RankedEvidence {
  const valueTokens = tokenizeForComparison(value);
  const matchedKeywords: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    if (keyword.tokens.length === 0) {
      continue;
    }

    const matchesKeyword = keyword.tokens.every((token) => valueTokens.has(token));

    if (!matchesKeyword) {
      continue;
    }

    matchedKeywords.push(keyword.term);
    score += keyword.weight * keyword.tokens.length;
  }

  return {
    kind,
    value,
    score,
    matchedKeywords: matchedKeywords.sort(),
    order
  };
}

function extractWeightedJobKeywords(
  job: JobPosting,
  maxKeywords = DEFAULT_MAX_KEYWORDS
): WeightedKeyword[] {
  const weightedKeywords = new Map<string, WeightedKeyword>();

  addWeightedPhrase(weightedKeywords, job.title, TITLE_PHRASE_WEIGHT, "title");

  if (job.detectedRoleFamily) {
    addWeightedPhrase(
      weightedKeywords,
      humanizeRoleFamily(job.detectedRoleFamily),
      DETECTED_ROLE_FAMILY_WEIGHT,
      "detected-role-family"
    );
  }

  addWeightedTokens(weightedKeywords, job.title, TITLE_TOKEN_WEIGHT, "title");
  addWeightedTokens(weightedKeywords, job.description, DESCRIPTION_TOKEN_WEIGHT, "description");

  for (const tag of job.tags) {
    addWeightedTokens(weightedKeywords, tag.replace(/^[^:]+:/, ""), TAG_TOKEN_WEIGHT, "tag");
  }

  return Array.from(weightedKeywords.values())
    .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term))
    .slice(0, maxKeywords);
}

function addWeightedPhrase(
  destination: Map<string, WeightedKeyword>,
  phrase: string,
  weight: number,
  source: JobKeywordSource
): void {
  const tokens = Array.from(tokenizeForComparison(phrase));

  if (tokens.length === 0) {
    return;
  }

  const term = normalizeWhitespace(phrase);
  const key = `phrase:${tokens.join(" ")}`;
  const existing = destination.get(key);

  if (existing) {
    existing.weight += weight;
    existing.sources.add(source);
    return;
  }

  destination.set(key, {
    term,
    normalizedTerm: tokens.join(" "),
    tokens,
    weight,
    sources: new Set([source])
  });
}

function addWeightedTokens(
  destination: Map<string, WeightedKeyword>,
  content: string,
  weight: number,
  source: JobKeywordSource
): void {
  for (const token of tokenizeForComparison(content)) {
    const key = `token:${token}`;
    const existing = destination.get(key);

    if (existing) {
      existing.weight += weight;
      existing.sources.add(source);
      continue;
    }

    destination.set(key, {
      term: token,
      normalizedTerm: token,
      tokens: [token],
      weight,
      sources: new Set([source])
    });
  }
}

function tokenizeForComparison(value: string): Set<string> {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (cleaned.length === 0) {
    return new Set();
  }

  return new Set(
    cleaned
      .split(/\s+/)
      .map(stemToken)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  );
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }

  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function humanizeRoleFamily(value: string): string {
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function joinList(values: readonly string[]): string {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function compareRankedEvidence(left: RankedEvidence, right: RankedEvidence): number {
  return right.score - left.score || left.order - right.order || left.value.localeCompare(right.value);
}

function comparePlainEvidence(left: TailoringEvidence, right: TailoringEvidence): number {
  return right.score - left.score || left.value.localeCompare(right.value);
}
