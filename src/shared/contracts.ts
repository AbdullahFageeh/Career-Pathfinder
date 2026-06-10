export type SourceReferenceKind = "cv" | "linkedin" | "manual";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

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
  preferredName?: string;
  email?: string;
  phone?: string;
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

export type ApplicationPlatform = "greenhouse";

export type ApplicationTarget = {
  url?: string;
  platform?: ApplicationPlatform;
  boardToken?: string;
  jobId?: string;
  submissionUrl?: string;
};

export type JobPosting = {
  id: string;
  source: JobSource;
  title: string;
  company: string;
  location?: string;
  description: string;
  detectedRoleFamily?: string;
  applicationTarget?: ApplicationTarget;
  tags: string[];
  discoveredAt: string;
};
export type TailoringEvidenceKind =
  | "headline"
  | "target-role-family"
  | "proof-point"
  | "certification";

export type TailoringEvidence = {
  kind: TailoringEvidenceKind;
  value: string;
  score: number;
  matchedKeywords: string[];
};

export type TailoredResumeSectionKey =
  | "summary"
  | "target-role-families"
  | "proof-points"
  | "certifications";

export type TailoredResumeSection = {
  key: TailoredResumeSectionKey;
  title: string;
  lines: string[];
};

export type TailoredResume = {
  id: string;
  jobId: string;
  variantName: string;
  generatedAt: string;
  outputPath?: string;
  evidenceUsed: string[];
  matchedKeywords: string[];
  tailoredHeadline: string;
  tailoredSummary: string;
  selectedRoleFamilies: string[];
  selectedProofPoints: string[];
  selectedCertifications: string[];
  sections: TailoredResumeSection[];
  evidenceTrail: TailoringEvidence[];
};

export type AtsAssessmentDimensionKey =
  | "keyword-coverage"
  | "role-alignment"
  | "evidence-strength"
  | "resume-structure";

export type AtsAssessmentDimension = {
  key: AtsAssessmentDimensionKey;
  label: string;
  score: number;
  maxScore: number;
  notes: string[];
};

export type AtsAssessment = {
  id: string;
  jobId: string;
  score: number;
  passed: boolean;
  blockingIssues: string[];
  suggestions: string[];
  threshold: number;
  missingKeywords: string[];
  componentScores: AtsAssessmentDimension[];
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

export type AutomationMode = "observe" | "supervised" | "full-auto";

export type ApplicationStatus =
  | "discovered"
  | "screened"
  | "tailored"
  | "ats-passed"
  | "contact-enriched"
  | "applied"
  | "followed-up"
  | "closed";

export type ApplicationStatusHistoryEntry = {
  status: ApplicationStatus;
  changedAt: string;
  reason?: string;
};

export type ApplicationNoteEntry = {
  message: string;
  createdAt: string;
};

export type WorkerDecisionEntry = {
  decision: string;
  createdAt: string;
};

export type ApplicationFollowUpStatus = "scheduled" | "completed" | "cancelled";

export type ApplicationFollowUp = {
  id: string;
  dueAt: string;
  reason: string;
  status: ApplicationFollowUpStatus;
  createdAt: string;
  completedAt?: string;
  note?: string;
};

export type ApplicationDocumentKind = "resume";

export type ApplicationDocumentSource = "tailored-resume" | "candidate-profile";

export type ApplicationDocumentReference = {
  kind: ApplicationDocumentKind;
  label: string;
  path: string;
  source: ApplicationDocumentSource;
};

export type ApplicationSubmissionOutcome = "submitted" | "review-needed" | "failed";

export type ApplicationSubmissionMethod = "greenhouse-job-board-api" | "manual-review";

export type ApplicationSubmissionAttempt = {
  id: string;
  attemptedAt: string;
  mode: AutomationMode;
  platform: ApplicationPlatform | "unsupported";
  outcome: ApplicationSubmissionOutcome;
  method: ApplicationSubmissionMethod;
  targetUrl: string;
  submissionUrl?: string;
  uploadedDocuments: ApplicationDocumentReference[];
  responseStatus?: number;
  confirmationMessage?: string;
  failureReason?: string;
};

export type ApplicationRecord = {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  sourceName: string;
  location?: string;
  sourceUrl?: string;
  applicationUrl?: string;
  applicationPlatform?: ApplicationPlatform;
  status: ApplicationStatus;
  atsScore?: number;
  resumeId?: string;
  notes: ApplicationNoteEntry[];
  workerDecisions: WorkerDecisionEntry[];
  statusHistory: ApplicationStatusHistoryEntry[];
  followUps: ApplicationFollowUp[];
  submissionAttempts?: ApplicationSubmissionAttempt[];
  createdAt: string;
  updatedAt: string;
};

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
  | "render"
  | "score-ats"
  | "enrich-contact"
  | "apply"
  | "follow-up";

export type QueueState = "pending" | "processing" | "completed" | "failed" | "dead-letter";

export type QueueJob = {
  id: string;
  runNumber: number;
  jobId: string;
  applicationId: string;
  stage: QueueStage;
  state: QueueState;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  payload?: JsonObject;
  lastError?: string;
  workerId?: string;
  leaseExpiresAt?: string;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
