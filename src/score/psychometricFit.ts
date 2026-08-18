import type { CandidateProfile, JobPosting } from "../shared/contracts.js";

export type PsychometricAlignment = {
  score: number;
  band: "strong" | "possible" | "hold";
  matchedSignals: string[];
  cautions: string[];
};

export type IkigaiAlignment = {
  score: number;
  matchedSignals: string[];
};

export type CareerDomainAlignment = {
  score: number;
  compatible: boolean;
  matchedSignals: string[];
  blockers: string[];
};

export type VerifiedSpecialtyAlignment = {
  compatible: boolean;
  blockers: string[];
};

type SignalGroup = {
  label: string;
  score: number;
  terms: readonly string[];
};

/**
 * This is an evidence-only translation of Abdullah's psychometric report.
 * It is intentionally not a personality diagnosis and never infers employer
 * culture. It rewards role text that explicitly signals structured delivery,
 * systems improvement, empathetic leadership, hands-on implementation, and
 * expert autonomy; it holds roles explicitly centred on competitive sales or
 * repetitive processing.
 */
const PSYCHOMETRIC_SIGNALS: readonly SignalGroup[] = [
  {
    label: "structured project delivery",
    score: 24,
    terms: [
      "project delivery",
      "project management",
      "project manager",
      "implementation",
      "planning",
      "programme delivery",
      "program delivery",
      "structured"
    ]
  },
  {
    label: "systems and root-cause work",
    score: 24,
    terms: [
      "operational systems",
      "systems design",
      "workflow",
      "process improvement",
      "continuous improvement",
      "root cause",
      "diagnosis",
      "optimisation",
      "optimization"
    ]
  },
  {
    label: "human-centred leadership",
    score: 20,
    terms: [
      "human-centred",
      "human centered",
      "stakeholder coaching",
      "team development",
      "mentoring",
      "coaching",
      "talent development",
      "organizational development",
      "organisation development"
    ]
  },
  {
    label: "live hands-on delivery",
    score: 18,
    terms: [
      "site implementation",
      "site operations",
      "site-based",
      "venue",
      "event",
      "sports",
      "installation",
      "build phase",
      "field operations"
    ]
  },
  {
    label: "expert autonomy and design",
    score: 14,
    terms: ["consulting", "consultant", "advisory", "specialist", "solution design", "own the design", "architect"]
  }
];

const IKIGAI_SIGNALS: readonly SignalGroup[] = [
  {
    label: "human-centric operations",
    score: 30,
    terms: ["human-centred", "human centered", "employee experience", "wellbeing", "people operations"]
  },
  {
    label: "diagnostic advisory work",
    score: 25,
    terms: ["consulting", "consultant", "advisory", "diagnosis", "assessment", "workflow design"]
  },
  {
    label: "teaching and development",
    score: 20,
    terms: ["mentoring", "coaching", "training", "facilitation", "teaching", "capability development"]
  },
  {
    label: "live mission-driven delivery",
    score: 25,
    terms: ["events", "event", "sports", "site", "venue", "live operations", "community"]
  }
];

const CAREER_DOMAIN_SIGNALS: readonly SignalGroup[] = [
  {
    label: "event, venue, or production delivery",
    score: 45,
    terms: ["event", "venue", "production", "conference", "producer", "entertainment", "sports"]
  },
  {
    label: "site, installation, or logistics delivery",
    score: 35,
    terms: ["site operations", "site manager", "installation", "overlay", "build phase", "load-out", "logistics"]
  },
  {
    label: "project or programme implementation",
    score: 30,
    terms: ["project manager", "project delivery", "programme manager", "program manager", "implementation manager"]
  },
  {
    label: "human systems and workforce development",
    score: 30,
    terms: ["organizational development", "organisation development", "people operations", "workforce development", "learning and development", "employee experience"]
  }
];

const CAREER_DOMAIN_BLOCKERS: readonly SignalGroup[] = [
  {
    label: "finance or accounting specialty",
    score: 100,
    terms: ["finance manager", "accounting", "accounts payable", "accounts receivable", "transactions accounting", "credit manager"]
  },
  {
    label: "software, cybersecurity, or product engineering specialty",
    score: 100,
    terms: ["engineering manager", "software engineer", "cyber security", "cybersecurity", "backend", "frontend", "devops"]
  },
  {
    label: "sales-first specialty",
    score: 100,
    terms: ["sales director", "business development", "cold calling", "sales quota", "commission targets"]
  },
  {
    label: "front-of-house service specialty",
    score: 100,
    terms: ["waiter", "waitress", "hostess", "barista", "restaurant server"]
  }
];

const SPECIALTY_REQUIREMENTS: ReadonlyArray<{
  label: string;
  jobTerms: readonly string[];
  profileEvidenceTerms: readonly string[];
}> = [
  {
    label: "financial-services governance and SAMA regulation",
    jobTerms: ["sama", "corporate governance", "financial institutions", "cma regulations", "regulatory obligations"],
    profileEvidenceTerms: ["sama", "financial regulation", "corporate governance", "compliance officer"]
  },
  {
    label: "theming, fine-art, or 3D-design specialization",
    jobTerms: ["fine arts", "3d animations", "3d models", "thematic concepts", "theme parks"],
    profileEvidenceTerms: ["fine arts", "3d animation", "3d modelling", "theming", "theme park"]
  },
  {
    label: "conference-content production specialization",
    jobTerms: ["content production", "cpd accreditation", "copywriting", "database marketing"],
    profileEvidenceTerms: ["content production", "conference programming", "cpd accreditation", "copywriting"]
  },
  {
    label: "attraction-ride maintenance and engineering specialization",
    jobTerms: ["attraction rides", "electromechanical", "ride maintenance", "annual rehabilitation", "engineering certificate", "preventive maintenance"],
    profileEvidenceTerms: ["attraction maintenance", "ride maintenance", "electromechanical", "mechanical technician", "electrical technician"]
  },
  {
    label: "senior commercial project-controls specialization",
    jobTerms: ["quantity surveying", "aconex connected cost", "commercial controls", "portfolio cost data", "pgmp", "programme management professional"],
    profileEvidenceTerms: ["quantity surveying", "aconex", "commercial project controls", "pgmp", "portfolio cost management"]
  },
  {
    label: "maintenance-competency and enterprise-asset-system specialization",
    jobTerms: ["maintenance competency", "sap", "maximo", "enterprise asset management", "eam system"],
    profileEvidenceTerms: ["maintenance competency", "sap pm", "maximo", "enterprise asset management", "eam system"]
  },
  {
    label: "hospitality and food-and-beverage operations specialization",
    jobTerms: ["food and beverage", "dining hall", "high-volume restaurants", "food halls", "restaurant operations", "hospitality operations"],
    profileEvidenceTerms: ["hospitality operations", "food and beverage operations", "restaurant management"]
  },
  {
    label: "go-to-market, demand-generation, and revenue-operations specialization",
    jobTerms: ["go-to-market strategy", "gtm strategy", "revenue operations", "revops", "demand generation", "top-of-funnel"],
    profileEvidenceTerms: ["go-to-market", "gtm strategy", "revenue operations", "revops", "demand generation", "marketing strategy"]
  },
  {
    label: "employee-lifecycle, HR, payroll, and time-attendance specialization",
    jobTerms: ["employee lifecycle", "time and attendance", "time & attendance", "payroll coordination", "employment law", "hr systems", "employee relations"],
    profileEvidenceTerms: ["employee lifecycle", "human resources", "hr operations", "payroll", "time and attendance", "employment law"]
  },
  {
    label: "customer-experience tooling and customer-success platform specialization",
    jobTerms: ["zendesk", "vitally", "customer-success tooling", "customer success tooling", "support platform", "cx operations"],
    profileEvidenceTerms: ["zendesk", "vitally", "customer success operations", "support operations", "cx operations"]
  }
];

const PSYCHOMETRIC_MISMATCHES: readonly SignalGroup[] = [
  {
    label: "competitive-sales emphasis",
    score: 28,
    terms: ["cold calling", "sales quota", "commission targets", "competitive negotiation", "call centre", "call center"]
  },
  {
    label: "repetitive-processing emphasis",
    score: 18,
    terms: ["data entry", "repetitive administration", "routine administration", "clerical processing", "back-office processing"]
  }
];

export function assessPsychometricAlignment(job: JobPosting): PsychometricAlignment {
  const text = jobText(job);
  const matchedSignals = matchSignals(text, PSYCHOMETRIC_SIGNALS);
  const mismatches = matchSignals(text, PSYCHOMETRIC_MISMATCHES);
  const positiveScore = matchedSignals.reduce((total, signal) => total + signal.score, 0);
  const mismatchScore = mismatches.reduce((total, signal) => total + signal.score, 0);
  const score = clamp(25 + positiveScore - mismatchScore, 0, 100);
  const cautions = mismatches.map((signal) => `Explicit ${signal.label} found in posting text.`);

  if (!text.includes("culture") && !text.includes("psychological safety") && !text.includes("inclusive")) {
    cautions.push("Employer culture and psychological safety cannot be verified from posting text; review before applying.");
  }

  return {
    score,
    band: score >= 70 ? "strong" : score >= 45 ? "possible" : "hold",
    matchedSignals: matchedSignals.map((signal) => `Explicit ${signal.label} signal.`),
    cautions
  };
}

/**
 * Keeps workstyle alignment grounded in Abdullah's proven and intended career domains.
 * A strong workstyle match cannot promote an unrelated specialty into the application queue.
 */
export function assessCareerDomainAlignment(job: JobPosting): CareerDomainAlignment {
  const text = jobText(job);
  const matchedSignals = matchSignals(text, CAREER_DOMAIN_SIGNALS);
  const blockers = matchSignals(text, CAREER_DOMAIN_BLOCKERS);
  const score = clamp(matchedSignals.reduce((total, signal) => total + signal.score, 0), 0, 100);

  return {
    score,
    compatible: blockers.length === 0 && score >= 30,
    matchedSignals: matchedSignals.map((signal) => `Explicit ${signal.label} signal.`),
    blockers: blockers.map((signal) => `Explicit ${signal.label} found in posting text.`)
  };
}

/**
 * Holds a role only where its posting makes a specialist requirement explicit
 * and the supplied candidate profile has no matching verified evidence.
 */
export function assessVerifiedSpecialtyAlignment(
  profile: CandidateProfile,
  job: JobPosting
): VerifiedSpecialtyAlignment {
  const posting = jobText(job);
  const profileText = [
    profile.headline,
    ...profile.targetRoleFamilies,
    ...profile.coreProofPoints,
    ...profile.certifications
  ]
    .join(" ")
    .toLowerCase();
  const blockers = SPECIALTY_REQUIREMENTS.filter(
    (requirement) =>
      requirement.jobTerms.some((term) => posting.includes(term)) &&
      !requirement.profileEvidenceTerms.some((term) => profileText.includes(term))
  ).map((requirement) => `Posting requires explicit ${requirement.label}, which is not evidenced in the candidate profile.`);

  return { compatible: blockers.length === 0, blockers };
}

/**
 * Secondary alignment from the practical, career-direction portions of the
 * Ikigai report. It remains subordinate to the psychometric score.
 */
export function assessIkigaiAlignment(job: JobPosting): IkigaiAlignment {
  const text = jobText(job);
  const matchedSignals = matchSignals(text, IKIGAI_SIGNALS);
  const score = clamp(matchedSignals.reduce((total, signal) => total + signal.score, 0), 0, 100);

  return {
    score,
    matchedSignals: matchedSignals.map((signal) => `Explicit ${signal.label} signal.`)
  };
}

function matchSignals(text: string, signals: readonly SignalGroup[]): SignalGroup[] {
  return signals.filter((signal) => signal.terms.some((term) => text.includes(term)));
}

function jobText(job: JobPosting): string {
  return `${job.title} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
