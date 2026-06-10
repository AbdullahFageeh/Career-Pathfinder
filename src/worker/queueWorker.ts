import type { IngestJobPostingInput } from "../ingest/index.js";
import {
  PIPELINE_QUEUE_STAGES,
  createNextPipelineStageJob,
  enqueueSingleJobPipeline,
  getNextPipelineStage,
  markQueueJobCompleted,
  markQueueJobFailed,
  type EnqueueSingleJobPipelineOptions,
  type SingleJobPipelineQueuePayload
} from "../queue/index.js";
import { createSqliteStorage, type PipelineStorage, type StorageOptions } from "../storage/index.js";
import type { QueueJob } from "../shared/contracts.js";
import {
  persistIngestedJobPosting,
  renderStoredTailoredResume,
  scoreStoredTailoredResume,
  tailorJobPosting,
  type SingleJobPipelineStageOptions
} from "./singleJobPipeline.js";

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000;

export type EnqueueSingleJobPipelineRunOptions = StorageOptions &
  EnqueueSingleJobPipelineOptions & {
    storage?: PipelineStorage;
  };

export type PipelineQueueRunOptions = StorageOptions & {
  storage?: PipelineStorage;
  workerId?: string;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  maxJobs?: number;
  now?: string;
};

export type PipelineQueueRunResult = {
  workerId: string;
  claimed: number;
  completed: number;
  failed: number;
  deadLettered: number;
  remaining: number;
};

export async function enqueueSingleJobPipelineRun(
  input: IngestJobPostingInput,
  options: EnqueueSingleJobPipelineRunOptions = {}
): Promise<QueueJob> {
  const storage = resolveQueueStorage(options);

  return enqueueSingleJobPipeline(storage, input, {
    at: options.at,
    scheduledFor: options.scheduledFor,
    referencePath: options.referencePath,
    profileId: options.profileId,
    initialApplicationNote: options.initialApplicationNote,
    renderOutputDir: options.renderOutputDir,
    maxAttempts: options.maxAttempts
  });
}

export async function runPipelineQueueOnce(
  options: PipelineQueueRunOptions = {}
): Promise<PipelineQueueRunResult> {
  const storage = resolveQueueStorage(options);
  const workerId = options.workerId ?? `worker:${Date.now()}`;
  const maxJobs = options.maxJobs ?? Number.MAX_SAFE_INTEGER;
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  let deadLettered = 0;

  while (claimed < maxJobs) {
    const queueJob = await storage.claimNextQueueJob({
      workerId,
      leaseDurationMs: options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
      now: options.now,
      stages: [...PIPELINE_QUEUE_STAGES]
    });

    if (!queueJob) {
      break;
    }

    claimed += 1;

    try {
      await processPipelineQueueJob(storage, queueJob);
      await storage.upsertQueueJob(
        markQueueJobCompleted(queueJob, {
          at: options.now
        })
      );
      completed += 1;
    } catch (error) {
      const failedQueueJob = markQueueJobFailed(queueJob, error, {
        at: options.now,
        retryDelayMs: options.retryDelayMs
      });

      await storage.upsertQueueJob(failedQueueJob);

      if (failedQueueJob.state === "dead-letter") {
        deadLettered += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    workerId,
    claimed,
    completed,
    failed,
    deadLettered,
    remaining: (await storage.listQueueJobs()).filter(
      (queueJob) => queueJob.state !== "completed" && queueJob.state !== "dead-letter"
    ).length
  };
}

async function processPipelineQueueJob(
  storage: PipelineStorage,
  queueJob: QueueJob
): Promise<void> {
  const payload = normalizeQueuePayload(queueJob);
  const stageOptions = createStageOptions(storage, payload);

  switch (queueJob.stage) {
    case "ingest": {
      if (!payload.input) {
        throw new Error(`Queue job "${queueJob.id}" is missing an ingest input payload.`);
      }

      await persistIngestedJobPosting(payload.input, stageOptions);
      await enqueueNextStage(storage, queueJob, payload);
      return;
    }
    case "tailor": {
      const job = await requireStoredJob(storage, queueJob.jobId);
      await tailorJobPosting(job, stageOptions);
      await enqueueNextStage(storage, queueJob, payload);
      return;
    }
    case "render": {
      const job = await requireStoredJob(storage, queueJob.jobId);
      const tailoredResume = await requireStoredTailoredResume(storage, queueJob.jobId);
      await renderStoredTailoredResume(job, tailoredResume, stageOptions);
      await enqueueNextStage(storage, queueJob, payload);
      return;
    }
    case "score-ats": {
      const job = await requireStoredJob(storage, queueJob.jobId);
      const tailoredResume = await requireStoredTailoredResume(storage, queueJob.jobId);
      await scoreStoredTailoredResume(job, tailoredResume, stageOptions);
      return;
    }
    default:
      throw new Error(`Queue stage "${queueJob.stage}" is not supported by the manual worker.`);
  }
}

async function enqueueNextStage(
  storage: PipelineStorage,
  queueJob: QueueJob,
  payload: SingleJobPipelineQueuePayload
): Promise<void> {
  const nextStage = getNextPipelineStage(queueJob.stage);

  if (!nextStage) {
    return;
  }

  const nextQueueJob = createNextPipelineStageJob(queueJob, nextStage, payload);
  const existingQueueJob = await storage.getQueueJobByIdempotencyKey(nextQueueJob.idempotencyKey);

  if (existingQueueJob) {
    return;
  }

  await storage.upsertQueueJob(nextQueueJob);
}

function createStageOptions(
  storage: PipelineStorage,
  payload: SingleJobPipelineQueuePayload
): SingleJobPipelineStageOptions {
  return {
    storage,
    referencePath: payload.referencePath,
    profileId: payload.profileId,
    initialApplicationNote: payload.initialApplicationNote,
    renderOptions: payload.renderOutputDir
      ? {
          outputDir: payload.renderOutputDir
        }
      : undefined
  };
}

function normalizeQueuePayload(queueJob: QueueJob): SingleJobPipelineQueuePayload {
  const payload = queueJob.payload;

  if (!payload || Array.isArray(payload)) {
    return {};
  }

  return {
    input: isIngestJobPostingInput(payload.input) ? payload.input : undefined,
    referencePath: readOptionalString(payload.referencePath),
    profileId: readOptionalString(payload.profileId),
    initialApplicationNote: readOptionalString(payload.initialApplicationNote),
    renderOutputDir: readOptionalString(payload.renderOutputDir)
  };
}

async function requireStoredJob(storage: PipelineStorage, jobId: string) {
  const job = await storage.getJobPosting(jobId);

  if (!job) {
    throw new Error(`Queued job "${jobId}" is missing a stored JobPosting.`);
  }

  return job;
}

async function requireStoredTailoredResume(storage: PipelineStorage, jobId: string) {
  const tailoredResume = await storage.getTailoredResume(`${jobId}:tailored`);

  if (!tailoredResume) {
    throw new Error(`Queued job "${jobId}" is missing a stored TailoredResume.`);
  }

  return tailoredResume;
}

function resolveQueueStorage(
  options: StorageOptions & {
    storage?: PipelineStorage;
  }
): PipelineStorage {
  return (
    options.storage ??
    createSqliteStorage({
      storagePath: options.storagePath
    })
  );
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isIngestJobPostingInput(value: unknown): value is IngestJobPostingInput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.source) &&
    typeof value.source.name === "string" &&
    typeof value.title === "string" &&
    typeof value.company === "string" &&
    typeof value.description === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
