import type { CandidateProfile, JobPosting, TailoredResume } from "../shared/contracts.js";
import { extractJobKeywords } from "../tailor/index.js";

const DEFAULT_MAX_KEYWORDS = 14;
const DEFAULT_MAX_PROOF_POINTS = 3;

/**
 * Terms that are technically frequent in a posting but say nothing about the
 * work. Letting these into a letter is the fastest way to sound automated.
 */
const LETTER_NOISE_TERMS = new Set([
  "saudi",
  "saudi arabia",
  "arabia",
  "ksa",
  "official",
  "official source",
  "source",
  "jeddah",
  "riyadh",
  "dammam",
  "tabuk",
  "neom",
  "kaec",
  "qiddiya",
  "company",
  "description",
  "qualifications",
  "job",
  "role",
  "family",
  "save",
  "only",
  "apply",
  "candidate",
  "applicants",
  "team",
  "work",
  "across",
  "authority",
  "experience",
  "years",
  "degree",
  "minimum",
  "required",
  "skills",
  "ability",
  "responsibilities",
  "including",
  "ensure",
  "support",
  "other",
  "related",
  "strong",
  "excellent",
  "good",
  "knowledge"
]);

/**
 * Scope words worth naming in a letter. Requiring a keyword to be a target
 * title, a multi-word phrase, or one of these domain terms keeps the alignment
 * sentence concrete instead of generic.
 */
const LETTER_SCOPE_TERMS: readonly string[] = [
  "operation",
  "operations",
  "venue",
  "site",
  "install",
  "installation",
  "build",
  "overlay",
  "production",
  "event",
  "logistics",
  "warehouse",
  "inventory",
  "procurement",
  "supplier",
  "contractor",
  "vendor",
  "facilities",
  "maintenance",
  "safety",
  "health",
  "quality",
  "compliance",
  "permit",
  "schedule",
  "budget",
  "delivery",
  "readiness",
  "commissioning",
  "handover",
  "load",
  "crew",
  "staff",
  "stakeholder",
  "client",
  "guest",
  "security",
  "transport",
  "fleet",
  "warehousing",
  "stock",
  "asset",
  "technical",
  "mechanical",
  "electrical",
  "structure",
  "stage",
  "rigging",
  "autocad",
  "reporting",
  "tender",
  "contract",
  "customs",
  "clearance",
  "shipment",
  "supervision"
];

export type CoverLetterTone = "direct" | "warm" | "formal";

export type CoverLetterDraft = {
  jobId: string;
  salutation: string;
  paragraphs: string[];
  signOff: string;
  body: string;
  wordCount: number;
  keywordsUsed: string[];
  evidenceUsed: string[];
  refinedByLlm: boolean;
  generatedAt: string;
};

export type BuildCoverLetterOptions = {
  tone?: CoverLetterTone;
  /** Named hiring contact, when one has been verified from a public source. */
  recipientName?: string;
  maxKeywords?: number;
  maxProofPoints?: number;
  /** Short, factual sentence about why this employer specifically. */
  companyHook?: string;
  now?: string;
};

const TONE_OPENERS: Record<CoverLetterTone, (job: JobPosting) => string> = {
  direct: (job) => `I am applying for the ${job.title} role at ${job.company}.`,
  warm: (job) => `I would like to put myself forward for the ${job.title} role at ${job.company}.`,
  formal: (job) => `I write to express my interest in the ${job.title} position at ${job.company}.`
};

/**
 * Builds a factual, template-driven cover letter from profile evidence only.
 * No claim in the output exists unless it is already present in the candidate
 * profile or the job posting, which keeps the letter honest by construction.
 */
export function buildCoverLetterDraft(
  profile: CandidateProfile,
  job: JobPosting,
  resume?: TailoredResume,
  options: BuildCoverLetterOptions = {}
): CoverLetterDraft {
  const generatedAt = options.now ?? new Date().toISOString();
  const tone = options.tone ?? "direct";
  const maxKeywords = options.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  const maxProofPoints = options.maxProofPoints ?? DEFAULT_MAX_PROOF_POINTS;

  const keywords = selectLetterKeywords(job, maxKeywords);
  const proofPoints = selectProofPoints(profile, resume, keywords, maxProofPoints);
  const certifications = resume?.selectedCertifications?.length
    ? resume.selectedCertifications
    : profile.certifications.slice(0, 2);

  const salutation = options.recipientName
    ? `Dear ${options.recipientName},`
    : `Dear ${job.company} hiring team,`;

  const openingParagraph = [
    TONE_OPENERS[tone](job),
    profile.headline,
    options.companyHook ?? ""
  ]
    .map((sentence) => ensureSentence(sentence))
    .filter((sentence) => sentence.length > 0)
    .join(" ");

  const evidenceParagraph = proofPoints.length > 0
    ? `Recent delivery evidence: ${proofPoints.map((point) => stripTrailingPeriod(point)).join("; ")}.`
    : "My delivery record covers site setup, supplier coordination, and load-out on live event programmes.";

  const alignmentParagraph = buildAlignmentParagraph(job, keywords, certifications);

  const closingParagraph = buildClosingParagraph(profile, job);

  const paragraphs = [openingParagraph, evidenceParagraph, alignmentParagraph, closingParagraph].filter(
    (paragraph) => paragraph.trim().length > 0
  );

  const body = paragraphs.join("\n\n");

  return {
    jobId: job.id,
    salutation,
    paragraphs,
    signOff: "Kind regards,",
    body,
    wordCount: countWords(body),
    keywordsUsed: keywords.filter((keyword) => body.toLowerCase().includes(keyword.toLowerCase())),
    evidenceUsed: proofPoints,
    refinedByLlm: false,
    generatedAt
  };
}

export type LlmChatRequest = {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export type LlmChatResponse = {
  content: string;
};

export type LlmClient = (request: LlmChatRequest) => Promise<LlmChatResponse>;

export type RefineCoverLetterOptions = {
  client?: LlmClient;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Maximum words allowed in the refined letter body. Defaults to 240. */
  maxWords?: number;
};

export type RefineCoverLetterResult = {
  draft: CoverLetterDraft;
  refined: boolean;
  skippedReason?: string;
  rejectedReason?: string;
};

/**
 * Optionally rewrites the deterministic draft with an OpenAI-compatible model.
 * The rewrite is accepted only when it introduces no numbers, employers, or
 * certifications that are absent from the source evidence, so the system cannot
 * quietly invent experience. Without an API key the deterministic draft is
 * returned unchanged, which keeps the repository fully usable offline.
 */
export async function refineCoverLetterWithLlm(
  draft: CoverLetterDraft,
  profile: CandidateProfile,
  job: JobPosting,
  options: RefineCoverLetterOptions = {}
): Promise<RefineCoverLetterResult> {
  const client = options.client ?? createDefaultLlmClient(options);

  if (!client) {
    return {
      draft,
      refined: false,
      skippedReason:
        "No LLM credentials found. Set LLM_API_KEY or OPENAI_API_KEY to enable optional letter refinement."
    };
  }

  const maxWords = options.maxWords ?? 240;
  const allowedEvidence = [
    profile.headline,
    ...profile.coreProofPoints,
    ...profile.certifications,
    ...profile.targetRoleFamilies,
    job.title,
    job.company,
    job.location ?? "",
    draft.body
  ];

  let response: LlmChatResponse;
  try {
    response = await client({
      model: options.model ?? "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: [
            "You are an editor for job application letters.",
            "Rewrite the supplied draft so it reads naturally and specifically.",
            "Absolute rules: never add employers, dates, numbers, metrics, certifications, or claims that are not present in the supplied evidence.",
            "Never use flattery, filler, or generic enthusiasm statements.",
            `Keep the body under ${maxWords} words and return the body text only, in plain paragraphs.`
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Role: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}`,
            "",
            "Allowed evidence:",
            ...allowedEvidence
              .filter((item) => item.trim().length > 0)
              .map((item) => `- ${item}`),
            "",
            "Draft to rewrite:",
            draft.body
          ].join("\n")
        }
      ]
    });
  } catch (error) {
    return {
      draft,
      refined: false,
      skippedReason: `LLM refinement failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const refinedBody = response.content.trim();
  if (refinedBody.length === 0) {
    return {
      draft,
      refined: false,
      skippedReason: "LLM returned an empty letter body."
    };
  }

  const invention = findInventedClaims(refinedBody, allowedEvidence);
  if (invention) {
    return {
      draft,
      refined: false,
      rejectedReason: `Refined letter was rejected because it introduced an unsupported claim (${invention}).`
    };
  }

  if (countWords(refinedBody) > maxWords + 40) {
    return {
      draft,
      refined: false,
      rejectedReason: "Refined letter was rejected because it exceeded the allowed length."
    };
  }

  const paragraphs = refinedBody
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);

  return {
    draft: {
      ...draft,
      paragraphs,
      body: paragraphs.join("\n\n"),
      wordCount: countWords(refinedBody),
      refinedByLlm: true
    },
    refined: true
  };
}

/** Renders a cover letter draft as plain text ready to paste into an email. */
export function formatCoverLetterText(
  draft: CoverLetterDraft,
  profile: CandidateProfile
): string {
  return [draft.salutation, "", draft.body, "", draft.signOff, profile.fullName, ""].join("\n");
}

/**
 * Detects numbers, capitalised organisation names, and certification acronyms
 * that appear in generated text but not in the allowed evidence.
 */
export function findInventedClaims(
  generatedText: string,
  allowedEvidence: readonly string[]
): string | undefined {
  const allowedHaystack = allowedEvidence.join(" \n ").toLowerCase();

  const numbers = generatedText.match(/\d+(?:[.,]\d+)?/g) ?? [];
  for (const number of numbers) {
    if (!allowedHaystack.includes(number.toLowerCase())) {
      return `unsupported number ${number}`;
    }
  }

  const acronyms = generatedText.match(/\b[A-Z]{3,}\b/g) ?? [];
  for (const acronym of acronyms) {
    if (!allowedHaystack.includes(acronym.toLowerCase())) {
      return `unsupported acronym ${acronym}`;
    }
  }

  return undefined;
}

/**
 * Picks the posting terms that describe actual scope, skipping location,
 * provenance, and boilerplate terms so the letter reads like a person wrote it.
 */
function selectLetterKeywords(job: JobPosting, maxKeywords: number): string[] {
  const locationTokens = new Set(
    (job.location ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
  const companyTokens = new Set(
    job.company
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );

  return extractJobKeywords(job, maxKeywords)
    .map((keyword) => keyword.term)
    .filter((term) => {
      const normalized = term.toLowerCase();
      if (LETTER_NOISE_TERMS.has(normalized)) {
        return false;
      }
      const tokens = normalized.split(/\s+/);
      if (tokens.every((token) => locationTokens.has(token) || companyTokens.has(token))) {
        return false;
      }
      if (tokens.length > 1) {
        return true;
      }
      return LETTER_SCOPE_TERMS.some((scopeTerm) => normalized.startsWith(scopeTerm));
    });
}

function buildAlignmentParagraph(
  job: JobPosting,
  keywords: readonly string[],
  certifications: readonly string[]
): string {
  const focusTerms = keywords.slice(0, 5);
  const sentences: string[] = [];

  if (focusTerms.length > 0) {
    sentences.push(
      `Your posting focuses on ${formatList(focusTerms)}; my live-event operations background includes closely related delivery in these areas.`
    );
  } else {
    sentences.push(`The scope in your posting is closely related to the live-event delivery work I have supported.`);
  }

  if (certifications.length > 0) {
    sentences.push(`I hold ${formatList(certifications.slice(0, 2))}.`);
  }

  return sentences.join(" ");
}

function buildClosingParagraph(profile: CandidateProfile, job: JobPosting): string {
  const contactParts = [profile.email, profile.phone].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const contactSentence =
    contactParts.length > 0 ? `You can reach me on ${contactParts.join(" or ")}.` : "";

  return [
    `I would welcome a short call to walk through how I would run delivery for this ${job.title} scope.`,
    contactSentence
  ]
    .filter((sentence) => sentence.length > 0)
    .join(" ");
}

function selectProofPoints(
  profile: CandidateProfile,
  resume: TailoredResume | undefined,
  keywords: readonly string[],
  limit: number
): string[] {
  const pool = resume?.selectedProofPoints?.length ? resume.selectedProofPoints : profile.coreProofPoints;
  if (pool.length === 0) {
    return [];
  }

  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const scored = pool.map((point, index) => {
    const normalizedPoint = point.toLowerCase();
    const matches = normalizedKeywords.filter((keyword) => normalizedPoint.includes(keyword)).length;
    const hasNumber = /\d/.test(point) ? 1 : 0;
    return {
      point,
      index,
      score: matches * 2 + hasNumber
    };
  });

  return scored
    .sort((left, right) => (right.score !== left.score ? right.score - left.score : left.index - right.index))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.point);
}

function createDefaultLlmClient(options: RefineCoverLetterOptions): LlmClient | undefined {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const baseUrl = (
    options.baseUrl ??
    process.env.LLM_API_BASE ??
    process.env.OPENAI_API_BASE ??
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (request) => {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages
      })
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return {
      content: payload.choices?.[0]?.message?.content ?? ""
    };
  };
}

function formatList(items: readonly string[]): string {
  const cleaned = items.map((item) => stripTrailingPeriod(item)).filter((item) => item.length > 0);
  if (cleaned.length <= 1) {
    return cleaned[0] ?? "";
  }
  if (cleaned.length === 2) {
    return `${cleaned[0]} and ${cleaned[1]}`;
  }
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stripTrailingPeriod(value: string): string {
  return value.trim().replace(/\.$/, "");
}

function countWords(value: string): number {
  return value.split(/\s+/).filter((word) => word.trim().length > 0).length;
}
