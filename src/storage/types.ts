import type {
  ApplicationRecord,
  AtsAssessment,
  JobPosting,
  QueueJob,
  QueueStage,
  TailoredResume
} from "../shared/contracts.js";

export type StorageOptions = {
  storagePath?: string;
};

export type QueueClaimOptions = {
  workerId: string;
  leaseDurationMs?: number;
  now?: string;
  stages?: QueueStage[];
};

export type PipelineStorageSnapshot = {
  schemaVersion: number;
  jobs: Record<string, JobPosting>;
  tailoredResumes: Record<string, TailoredResume>;
  atsAssessments: Record<string, AtsAssessment>;
  applicationRecords: Record<string, ApplicationRecord>;
  queueJobs: Record<string, QueueJob>;
};

export type PipelineStorage = {
  storagePath: string;
  readSnapshot: () => Promise<PipelineStorageSnapshot>;
  getJobPosting: (jobId: string) => Promise<JobPosting | undefined>;
  listJobPostings: () => Promise<JobPosting[]>;
  upsertJobPosting: (job: JobPosting) => Promise<JobPosting>;
  getTailoredResume: (resumeId: string) => Promise<TailoredResume | undefined>;
  listTailoredResumes: () => Promise<TailoredResume[]>;
  upsertTailoredResume: (resume: TailoredResume) => Promise<TailoredResume>;
  getAtsAssessment: (assessmentId: string) => Promise<AtsAssessment | undefined>;
  listAtsAssessments: () => Promise<AtsAssessment[]>;
  upsertAtsAssessment: (assessment: AtsAssessment) => Promise<AtsAssessment>;
  getApplicationRecord: (applicationId: string) => Promise<ApplicationRecord | undefined>;
  getApplicationRecordByJobId: (jobId: string) => Promise<ApplicationRecord | undefined>;
  listApplicationRecords: () => Promise<ApplicationRecord[]>;
  upsertApplicationRecord: (applicationRecord: ApplicationRecord) => Promise<ApplicationRecord>;
  getQueueJob: (queueJobId: string) => Promise<QueueJob | undefined>;
  getQueueJobByIdempotencyKey: (idempotencyKey: string) => Promise<QueueJob | undefined>;
  listQueueJobs: () => Promise<QueueJob[]>;
  upsertQueueJob: (queueJob: QueueJob) => Promise<QueueJob>;
  claimNextQueueJob: (options: QueueClaimOptions) => Promise<QueueJob | undefined>;
};
