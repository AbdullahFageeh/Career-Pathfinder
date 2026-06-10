import type { IngestJobPostingInput } from "../ingest/index.js";
import type { QueueJob } from "../shared/contracts.js";
import type { PipelineStorage } from "../storage/index.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 60 * 1000;

export const PIPELINE_QUEUE_STAGES = [
  "ingest",
  "tailor",
  "render",
  "score-ats"
] as const;

export type SingleJobPipelineQueuePayload = {
  input?: IngestJobPostingInput;
  referencePath?: string;
  profileId?: string;
  initialApplicationNote?: string;
  renderOutputDir?: string;
};

export type EnqueueSingleJobPipelineOptions = {
  at?: string;
  scheduledFor?: string;
  referencePath?: string;
  profileId?: string;
  initialApplicationNote?: string;
  renderOutputDir?: string;
  maxAttempts?: number;
};

export async function enqueueSingleJobPipeline(
  storage: PipelineStorage,
  input: IngestJobPostingInput,
  options: EnqueueSingleJobPipelineOptions = {}
): Promise<QueueJob> {
  const queueJob = createPipelineQueueJob({
    stage: "ingest",
    jobId: input.id,
    applicationId: `application:${input.id}`,
    payload: {
      input,
      referencePath: options.referencePath,
      profileId: options.profileId,
      initialApplicationNote: options.initialApplicationNote,
      renderOutputDir: options.renderOutputDir
    },
    at: options.at,
    scheduledFor: options.scheduledFor,
    maxAttempts: options.maxAttempts
  });

  return enqueuePipelineQueueJob(storage, queueJob);
}

export function createNextPipelineStageJob(
  queueJob: QueueJob,
  nextStage: (typeof PIPELINE_QUEUE_STAGES)[number],
  payload: SingleJobPipelineQueuePayload,
  options: {
    at?: string;
    scheduledFor?: string;
  } = {}
): QueueJob {
  return createPipelineQueueJob({
    stage: nextStage,
    jobId: queueJob.jobId,
    applicationId: queueJob.applicationId,
    payload,
    at: options.at,
    scheduledFor: options.scheduledFor,
    maxAttempts: queueJob.maxAttempts
  });
}

export function getNextPipelineStage(
  stage: QueueJob["stage"]
): (typeof PIPELINE_QUEUE_STAGES)[number] | undefined {
  switch (stage) {
    case "ingest":
      return "tailor";
    case "tailor":
      return "render";
    case "render":
      return "score-ats";
    default:
      return undefined;
  }
}

export function markQueueJobCompleted(
  queueJob: QueueJob,
  options: {
    at?: string;
  } = {}
): QueueJob {
  const completedAt = normalizeTimestamp(options.at);

  return {
    ...queueJob,
    state: "completed",
    workerId: undefined,
    leaseExpiresAt: undefined,
    updatedAt: completedAt,
    completedAt
  };
}

export function markQueueJobFailed(
  queueJob: QueueJob,
  error: unknown,
  options: {
    at?: string;
    retryDelayMs?: number;
  } = {}
): QueueJob {
  const updatedAt = normalizeTimestamp(options.at);
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (queueJob.attempts >= queueJob.maxAttempts) {
    return {
      ...queueJob,
      state: "dead-letter",
      lastError: errorMessage,
      workerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt
    };
  }

  return {
    ...queueJob,
    state: "failed",
    lastError: errorMessage,
    workerId: undefined,
    leaseExpiresAt: undefined,
    scheduledFor: new Date(
      Date.parse(updatedAt) + (options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
    ).toISOString(),
    updatedAt
  };
}

async function enqueuePipelineQueueJob(
  storage: PipelineStorage,
  queueJob: QueueJob
): Promise<QueueJob> {
  const existingQueueJob = await storage.getQueueJobByIdempotencyKey(queueJob.idempotencyKey);

  if (existingQueueJob) {
    return existingQueueJob;
  }

  await storage.upsertQueueJob(queueJob);
  return queueJob;
}

function createPipelineQueueJob(input: {
  stage: (typeof PIPELINE_QUEUE_STAGES)[number];
  jobId: string;
  applicationId: string;
  payload: SingleJobPipelineQueuePayload;
  at?: string;
  scheduledFor?: string;
  maxAttempts?: number;
}): QueueJob {
  const createdAt = normalizeTimestamp(input.at);
  const scheduledFor = normalizeTimestamp(input.scheduledFor ?? input.at);

  return {
    id: `queue:${input.jobId}:${input.stage}`,
    jobId: input.jobId,
    applicationId: input.applicationId,
    stage: input.stage,
    state: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    idempotencyKey: `pipeline:${input.jobId}:${input.stage}`,
    payload: toPayloadObject(input.payload),
    scheduledFor,
    createdAt,
    updatedAt: createdAt
  };
}

function toPayloadObject(payload: SingleJobPipelineQueuePayload): QueueJob["payload"] {
  return JSON.parse(JSON.stringify(payload)) as QueueJob["payload"];
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}
