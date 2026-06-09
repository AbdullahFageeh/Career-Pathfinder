import type {
  AtsAssessment,
  AtsAssessmentDimension,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";
import { extractJobKeywords } from "../tailor/index.js";

const DEFAULT_ATS_THRESHOLD = 80;
const DEFAULT_MAX_KEYWORDS = 8;

const KEYWORD_COVERAGE_MAX_SCORE = 35;
const ROLE_ALIGNMENT_MAX_SCORE = 25;
const EVIDENCE_STRENGTH_MAX_SCORE = 25;
const RESUME_STRUCTURE_MAX_SCORE = 15;

const ATS_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

export type AtsScoringOptions = {
  threshold?: number;
  maxKeywords?: number;
};

export function scoreAtsReadiness(
  job: JobPosting,
  resume: TailoredResume,
  options: AtsScoringOptions = {}
): AtsAssessment {
  const threshold = clampNumber(options.threshold, 0, 100, DEFAULT_ATS_THRESHOLD);
  const extractedKeywords = extractJobKeywords(job, options.maxKeywords ?? DEFAULT_MAX_KEYWORDS);
  const normalizedResumeTokenSet = tokenizeResume(resume);
  const normalizedMatchedKeywords = new Set(
    resume.matchedKeywords.flatMap((keyword) => Array.from(tokenizeForComparison(keyword)))
  );

  const keywordCoverage = scoreKeywordCoverage(
    extractedKeywords,
    normalizedResumeTokenSet,
    normalizedMatchedKeywords
  );
  const roleAlignment = scoreRoleAlignment(job, resume);
  const evidenceStrength = scoreEvidenceStrength(resume);
  const resumeStructure = scoreResumeStructure(resume);

  const componentScores: AtsAssessmentDimension[] = [
    keywordCoverage,
    roleAlignment,
    evidenceStrength,
    resumeStructure
  ];

  const score = componentScores.reduce((sum, component) => sum + component.score, 0);
  const missingKeywords = extractedKeywords
    .filter((keyword) => !keywordMatchesResume(keyword.term, normalizedResumeTokenSet, normalizedMatchedKeywords))
    .map((keyword) => keyword.term);

  const blockingIssues = buildBlockingIssues(componentScores, missingKeywords, resume);
  const suggestions = buildSuggestions(componentScores, missingKeywords, resume);

  return {
    id: `${resume.id}:ats`,
    jobId: job.id,
    score,
    passed: score >= threshold && blockingIssues.length === 0,
    blockingIssues,
    suggestions,
    threshold,
    missingKeywords,
    componentScores,
    assessedAt: new Date().toISOString()
  };
}

function scoreKeywordCoverage(
  extractedKeywords: ReturnType<typeof extractJobKeywords>,
  normalizedResumeTokenSet: Set<string>,
  normalizedMatchedKeywords: Set<string>
): AtsAssessmentDimension {
  const totalWeight = extractedKeywords.reduce((sum, keyword) => sum + keyword.weight, 0);
  const matchedWeight = extractedKeywords.reduce((sum, keyword) => {
    if (keywordMatchesResume(keyword.term, normalizedResumeTokenSet, normalizedMatchedKeywords)) {
      return sum + keyword.weight;
    }

    return sum;
  }, 0);

  const coverageRatio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const score = Math.round(KEYWORD_COVERAGE_MAX_SCORE * coverageRatio);
  const matchedCount = extractedKeywords.filter((keyword) =>
    keywordMatchesResume(keyword.term, normalizedResumeTokenSet, normalizedMatchedKeywords)
  ).length;

  return {
    key: "keyword-coverage",
    label: "Keyword Coverage",
    score,
    maxScore: KEYWORD_COVERAGE_MAX_SCORE,
    notes: [
      `Matched ${matchedCount} of ${extractedKeywords.length} priority job keywords.`,
      `Weighted coverage ratio: ${Math.round(coverageRatio * 100)}%.`
    ]
  };
}

function scoreRoleAlignment(job: JobPosting, resume: TailoredResume): AtsAssessmentDimension {
  let score = 0;
  const notes: string[] = [];
  const normalizedSummaryTokens = tokenizeForComparison(resume.tailoredSummary);
  const normalizedHeadlineTokens = tokenizeForComparison(resume.tailoredHeadline);
  const normalizedRoleFamilyTokens = new Set(
    resume.selectedRoleFamilies.flatMap((family) => Array.from(tokenizeForComparison(family)))
  );

  if (resume.tailoredSummary.includes(job.title)) {
    score += 10;
    notes.push("Tailored summary names the target role title explicitly.");
  }

  const jobTitleTokens = tokenizeForComparison(job.title);
  const matchedTitleTokens = Array.from(jobTitleTokens).filter(
    (token) => normalizedSummaryTokens.has(token) || normalizedRoleFamilyTokens.has(token)
  ).length;

  if (matchedTitleTokens > 0) {
    score += Math.min(8, matchedTitleTokens * 2);
    notes.push(`Matched ${matchedTitleTokens} role-title tokens in the summary or selected role families.`);
  }

  if (job.detectedRoleFamily) {
    const detectedRoleFamilyTokens = tokenizeForComparison(job.detectedRoleFamily.replace(/-/g, " "));
    const matchedDetectedTokens = Array.from(detectedRoleFamilyTokens).filter(
      (token) =>
        normalizedSummaryTokens.has(token) ||
        normalizedRoleFamilyTokens.has(token) ||
        normalizedHeadlineTokens.has(token)
    ).length;

    if (matchedDetectedTokens > 0) {
      score += Math.min(7, matchedDetectedTokens * 2 + 1);
      notes.push(`Matched ${matchedDetectedTokens} detected role-family tokens across the tailored resume.`);
    }
  }

  return {
    key: "role-alignment",
    label: "Role Alignment",
    score: Math.min(ROLE_ALIGNMENT_MAX_SCORE, score),
    maxScore: ROLE_ALIGNMENT_MAX_SCORE,
    notes: notes.length > 0 ? notes : ["Role title or family alignment is currently weak."]
  };
}

function scoreEvidenceStrength(resume: TailoredResume): AtsAssessmentDimension {
  let score = 0;
  const notes: string[] = [];
  const quantifiedProofPoints = resume.selectedProofPoints.filter(containsQuantifiedSignal);
  const positiveEvidence = resume.evidenceTrail.filter((item) => item.score > 0);

  if (resume.selectedProofPoints.length >= 3) {
    score += 8;
    notes.push("Resume includes at least three tailored proof points.");
  } else if (resume.selectedProofPoints.length === 2) {
    score += 5;
    notes.push("Resume includes two tailored proof points.");
  } else if (resume.selectedProofPoints.length === 1) {
    score += 2;
    notes.push("Resume includes one tailored proof point.");
  }

  if (quantifiedProofPoints.length >= 2) {
    score += 8;
    notes.push("Proof points include quantified delivery outcomes.");
  } else if (quantifiedProofPoints.length === 1) {
    score += 4;
    notes.push("Resume includes one quantified proof point.");
  }

  if (positiveEvidence.length >= 4) {
    score += 5;
    notes.push("Evidence trail contains several positively matched items.");
  } else if (positiveEvidence.length >= 2) {
    score += 3;
    notes.push("Evidence trail contains some positively matched items.");
  }

  if (resume.selectedCertifications.length > 0) {
    score += 4;
    notes.push("Resume keeps relevant certifications visible.");
  }

  return {
    key: "evidence-strength",
    label: "Evidence Strength",
    score: Math.min(EVIDENCE_STRENGTH_MAX_SCORE, score),
    maxScore: EVIDENCE_STRENGTH_MAX_SCORE,
    notes: notes.length > 0 ? notes : ["Resume evidence is too thin or insufficiently quantified."]
  };
}

function scoreResumeStructure(resume: TailoredResume): AtsAssessmentDimension {
  let score = 0;
  const notes: string[] = [];
  const sectionKeys = new Set(resume.sections.map((section) => section.key));

  if (resume.tailoredHeadline.trim().length > 0 && resume.tailoredSummary.trim().length >= 40) {
    score += 5;
    notes.push("Resume includes a headline and a readable tailored summary.");
  }

  if (sectionKeys.has("proof-points") && resume.selectedProofPoints.length > 0) {
    score += 4;
    notes.push("Resume has a dedicated proof-points section.");
  }

  if (sectionKeys.has("target-role-families") && resume.selectedRoleFamilies.length > 0) {
    score += 3;
    notes.push("Resume keeps role-targeting context visible.");
  }

  if (sectionKeys.has("certifications") && resume.selectedCertifications.length > 0) {
    score += 3;
    notes.push("Resume keeps certifications in a separate section.");
  }

  return {
    key: "resume-structure",
    label: "Resume Structure",
    score: Math.min(RESUME_STRUCTURE_MAX_SCORE, score),
    maxScore: RESUME_STRUCTURE_MAX_SCORE,
    notes: notes.length > 0 ? notes : ["Resume structure is missing core ATS-friendly sections."]
  };
}

function buildBlockingIssues(
  componentScores: readonly AtsAssessmentDimension[],
  missingKeywords: readonly string[],
  resume: TailoredResume
): string[] {
  const issues: string[] = [];
  const keywordCoverage = getComponentScore(componentScores, "keyword-coverage");
  const evidenceStrength = getComponentScore(componentScores, "evidence-strength");
  const resumeStructure = getComponentScore(componentScores, "resume-structure");

  if (keywordCoverage < 18) {
    issues.push("Keyword coverage is too thin for the target role.");
  }

  if (missingKeywords.length >= 4) {
    issues.push("Several high-priority job keywords are still missing from the tailored resume.");
  }

  if (resume.selectedProofPoints.length < 2) {
    issues.push("The tailored resume needs at least two relevant proof points.");
  }

  if (resume.selectedProofPoints.filter(containsQuantifiedSignal).length === 0) {
    issues.push("The tailored resume needs at least one quantified achievement.");
  }

  if (evidenceStrength < 13) {
    issues.push("Supporting evidence is not yet strong enough for a safe ATS pass.");
  }

  if (resumeStructure < 9) {
    issues.push("Resume structure is missing ATS-friendly sections or enough summary detail.");
  }

  return issues;
}

function buildSuggestions(
  componentScores: readonly AtsAssessmentDimension[],
  missingKeywords: readonly string[],
  resume: TailoredResume
): string[] {
  const suggestions = new Set<string>();
  const keywordCoverage = getComponentScore(componentScores, "keyword-coverage");
  const roleAlignment = getComponentScore(componentScores, "role-alignment");
  const evidenceStrength = getComponentScore(componentScores, "evidence-strength");

  if (missingKeywords.length > 0) {
    suggestions.add(`Add or strengthen role-relevant language around: ${missingKeywords.slice(0, 3).join(", ")}.`);
  }

  if (keywordCoverage < 25) {
    suggestions.add("Tighten the summary and proof points around the highest-weight job keywords.");
  }

  if (roleAlignment < 15) {
    suggestions.add("Make the target role clearer in the summary and selected role families.");
  }

  if (resume.selectedProofPoints.filter(containsQuantifiedSignal).length < 2) {
    suggestions.add("Surface more quantified results so the resume shows measurable impact.");
  }

  if (resume.selectedCertifications.length === 0) {
    suggestions.add("Include any relevant certification or training that supports the target role.");
  }

  if (evidenceStrength < 18) {
    suggestions.add("Promote the strongest matched proof points higher in the tailored output.");
  }

  return Array.from(suggestions);
}

function tokenizeResume(resume: TailoredResume): Set<string> {
  const combined = [
    resume.tailoredHeadline,
    resume.tailoredSummary,
    ...resume.selectedRoleFamilies,
    ...resume.selectedProofPoints,
    ...resume.selectedCertifications,
    ...resume.matchedKeywords,
    ...resume.evidenceUsed,
    ...resume.sections.flatMap((section) => section.lines)
  ].join(" ");

  return tokenizeForComparison(combined);
}

function keywordMatchesResume(
  keyword: string,
  normalizedResumeTokenSet: Set<string>,
  normalizedMatchedKeywords: Set<string>
): boolean {
  const keywordTokens = Array.from(tokenizeForComparison(keyword));

  if (keywordTokens.length === 0) {
    return false;
  }

  return keywordTokens.every(
    (token) => normalizedResumeTokenSet.has(token) || normalizedMatchedKeywords.has(token)
  );
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
      .filter((token) => token.length > 1 && !ATS_STOP_WORDS.has(token))
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

function containsQuantifiedSignal(value: string): boolean {
  return /(?:\d|%|\+|ahead|faster|reduced|improved|saved|delivered)/i.test(value);
}

function getComponentScore(
  componentScores: readonly AtsAssessmentDimension[],
  key: AtsAssessmentDimension["key"]
): number {
  return componentScores.find((component) => component.key === key)?.score ?? 0;
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

  return Math.min(max, Math.max(min, Math.round(value)));
}
