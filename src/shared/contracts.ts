export type SourceReferenceKind = "cv" | "linkedin" | "manual";

export type SourceReference = {
  kind: SourceReferenceKind;
  reference: string;
  confirmedAt?: string;
  note?: string;
};

export type ConfidenceLevel = "seeded" | "confirmed";

export type CandidateFact = {
  value: string;
  confidence: ConfidenceLevel;
  source: SourceReference;
};

export type DocumentReference = {
  key: string;
  path: string;
  description: string;
  requiredFor?: string[];
  source: SourceReference;
};

export type RecurringAnswer = {
  key: string;
  question: string;
  answer: string;
  source: SourceReference;
};

export type CandidateProfile = {
  id: string;
  fullName: string;
  headline: string;
  targetRoleFamilies: string[];
  certifications: string[];
  coreProofPoints: string[];
  documents: DocumentReference[];
  recurringAnswers: RecurringAnswer[];
};

export type JobSourceKind = "job-board" | "company-page" | "manual";

export type JobSource = {
  kind: JobSourceKind;
  name: string;
  url?: string;
};

export type JobPosting = {
  id: string;
  source: JobSource;
  title: string;
  company: string;
  location?: string;
  description: string;
  detectedRoleFamily?: string;
  tags: string[];
  discoveredAt: string;
};

export type TailoredResume = {
  id: string;
  jobId: string;
  variantName: string;
  generatedAt: string;
  outputPath?: string;
  evidenceUsed: string[];
};

export type AtsAssessment = {
  id: string;
  jobId: string;
  score: number;
  passed: boolean;
  blockingIssues: string[];
  suggestions: string[];
  assessedAt: string;
};

export type ContactChannel = "email" | "linkedin" | "company-page" | "other";

export type ContactRecord = {
  id: string;
  jobId: string;
  name?: string;
  role?: string;
  channel: ContactChannel;
  value: string;
  sourceUrl?: string;
  confidence: ConfidenceLevel;
};

export type ApplicationStatus =
  | "discovered"
  | "screened"
  | "tailored"
  | "ats-passed"
  | "contact-enriched"
  | "applied"
  | "followed-up"
  | "closed";

export type ApplicationRecord = {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  atsScore?: number;
  resumeId?: string;
  notes: string[];
  workerDecisions: string[];
  createdAt: string;
  updatedAt: string;
};

export type AutomationMode = "observe" | "supervised" | "full-auto";

export type PolicyConfig = {
  mode: AutomationMode;
  atsThreshold: number;
  dailyApplicationCap: number;
  companyCooldownDays: number;
  allowedPlatforms: string[];
  blockedCompanies: string[];
  targetTitles: string[];
  preferredLocations: string[];
};

export type QueueStage =
  | "discover"
  | "ingest"
  | "tailor"
  | "score-ats"
  | "enrich-contact"
  | "apply"
  | "follow-up";

export type QueueState = "pending" | "processing" | "completed" | "failed" | "dead-letter";

export type QueueJob = {
  id: string;
  applicationId: string;
  stage: QueueStage;
  state: QueueState;
  attempts: number;
  lastError?: string;
  scheduledFor: string;
};
