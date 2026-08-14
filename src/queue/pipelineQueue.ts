import type { GreenhouseDataConsent } from "../apply/index.js";
import type { IngestJobPostingInput } from "../ingest/index.js";
import type { AutomationMode, QueueJob } from "../shared/contracts.js";
import type { PipelineStorage } from "../storage/index.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 60 * 1000;

export const PIPELINE_QUEUE_STAGES = [
  "ingest",
  "tailor",
  "render",
  "score-ats",
  "apply"
] as const;

export type SingleJobPipelineQueuePayload = {
  input?: IngestJobPostingInput;
  referencePath?: string;
  profileId?: string;
  initialApplicationNote?: string;
  renderOutputDir?: string;
  applyMode?: AutomationMode;
  allowFullAutoSubmission?: boolean;
  dataConsent?: GreenhouseDataConsent;
};

export type EnqueueSingleJobPipelineOptions = {
  at?: string;
  scheduledFor?: string;
  referencePath?: string;
  profileId?: string;
  initialApplicationNote?: string;
  renderOutputDir?: string;
  applyMode?: AutomationMode;
  allowFullAutoSubmission?: boolean;
  dataConsent?: GreenhouseDataConsent;
  maxAttempts?: number;
};

export async function enqueueSingleJobPipeline(
  storage: PipelineStorage,
  input: IngestJobPostingInput,
  options: EnqueueSingleJobPipelineOptions = {}
): Promise<QueueJob> {
  const existingQueueJobs = await storage.listQueueJobs();
  const activeQueueJob = findActiveQueueJob(existingQueueJobs, input.id);

  if (activeQueueJob) {
    return {
      ...activeQueueJob,
      runNumber: readQueueJobRunNumber(activeQueueJob)
    };
  }

  const queueJob = createPipelineQueueJob({
    stage: "ingest",
    runNumber: getNextRunNumber(existingQueueJobs, input.id),
    jobId: input.id,
    applicationId: `application:${input.id}`,
    payload: {
      input,
      referencePath: options.referencePath,
      profileId: options.profileId,
      initialApplicationNote: options.initialApplicationNote,
      renderOutputDir: options.renderOutputDir,
      applyMode: options.applyMode,
      allowFullAutoSubmission: options.allowFullAutoSubmission,
      dataConsent: options.dataConsent
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
    runNumber: readQueueJobRunNumber(queueJob),
    jobId: queueJob.jobId,
    applicationId: queueJob.applicationId,
    payload,
    at: options.at,
    scheduledFor: options.scheduledFor,
    maxAttempts: queueJob.maxAttempts
  });
}

export function getNextPipelineStage(
  stage: QueueJob["stage"],
  payload: Pick<SingleJobPipelineQueuePayload, "applyMode"> = {}
): (typeof PIPELINE_QUEUE_STAGES)[number] | undefined {
  switch (stage) {
    case "ingest":
      return "tailor";
    case "tailor":
      return "render";
    case "render":
      return "score-ats";
    case "score-ats":
      return shouldRunApplyStage(payload) ? "apply" : undefined;
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
    runNumber: readQueueJobRunNumber(queueJob),
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
      runNumber: readQueueJobRunNumber(queueJob),
      state: "dead-letter",
      lastError: errorMessage,
      workerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt
    };
  }

  return {
    ...queueJob,
    runNumber: readQueueJobRunNumber(queueJob),
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
  runNumber: number;
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
    id: `queue:${input.jobId}:run-${input.runNumber}:${input.stage}`,
    runNumber: input.runNumber,
    jobId: input.jobId,
    applicationId: input.applicationId,
    stage: input.stage,
    state: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    idempotencyKey: `pipeline:${input.jobId}:run-${input.runNumber}:${input.stage}`,
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

function findActiveQueueJob(queueJobs: QueueJob[], jobId: string): QueueJob | undefined {
  return queueJobs
    .filter((queueJob) => queueJob.jobId === jobId && !isTerminalQueueState(queueJob.state))
    .sort(
      (left, right) =>
        readQueueJobRunNumber(right) - readQueueJobRunNumber(left) ||
        right.updatedAt.localeCompare(left.updatedAt)
    )[0];
}

function getNextRunNumber(queueJobs: QueueJob[], jobId: string): number {
  return (
    queueJobs
      .filter((queueJob) => queueJob.jobId === jobId && queueJob.stage === "ingest")
      .reduce(
        (maxRunNumber, queueJob) => Math.max(maxRunNumber, readQueueJobRunNumber(queueJob)),
        0
      ) + 1
  );
}

function readQueueJobRunNumber(queueJob: Pick<QueueJob, "id" | "runNumber">): number {
  if (Number.isInteger(queueJob.runNumber) && queueJob.runNumber > 0) {
    return queueJob.runNumber;
  }

  const parsedRunNumber = queueJob.id.match(/:run-(\d+):/)?.[1];

  if (!parsedRunNumber) {
    return 1;
  }

  return Number(parsedRunNumber);
}

function shouldRunApplyStage(
  payload: Pick<SingleJobPipelineQueuePayload, "applyMode">
): boolean {
  return payload.applyMode === "supervised" || payload.applyMode === "full-auto";
}

function isTerminalQueueState(queueState: QueueJob["state"]): boolean {
  return queueState === "completed" || queueState === "dead-letter";
}
