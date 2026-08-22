import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AutomationRun } from "../automation/contracts.js";
import type {
  ApplicationRecord,
  AtsAssessment,
  JobPosting,
  QueueJob,
  TailoredResume
} from "../shared/contracts.js";
import type {
  PipelineStorage,
  PipelineStorageSnapshot,
  QueueClaimOptions,
  StorageOptions
} from "./types.js";

const STORAGE_SCHEMA_VERSION = 3;
const DEFAULT_STORAGE_PATH = resolve(process.cwd(), "data", "pipeline-store.json");
const DEFAULT_QUEUE_LEASE_DURATION_MS = 5 * 60 * 1000;
const snapshotUpdateQueues = new Map<string, Promise<void>>();
export type FileBackedStorageOptions = StorageOptions;

export function resolveDefaultStoragePath(storagePath?: string): string {
  return storagePath ? resolve(storagePath) : DEFAULT_STORAGE_PATH;
}

export function createFileBackedStorage(
  options: FileBackedStorageOptions = {}
): PipelineStorage {
  const storagePath = resolveDefaultStoragePath(options.storagePath);

  return {
    storagePath,
    close: async () => undefined,
    readSnapshot: async () => readSnapshot(storagePath),
    getJobPosting: async (jobId) => (await readSnapshot(storagePath)).jobs[jobId],
    listJobPostings: async () =>
      Object.values((await readSnapshot(storagePath)).jobs).sort(compareJobs),
    upsertJobPosting: async (job) =>
      updateSnapshot(storagePath, async (snapshot) => {
        snapshot.jobs[job.id] = job;
        return job;
      }),
    getTailoredResume: async (resumeId) => (await readSnapshot(storagePath)).tailoredResumes[resumeId],
    listTailoredResumes: async () =>
      Object.values((await readSnapshot(storagePath)).tailoredResumes).sort(compareTailoredResumes),
    upsertTailoredResume: async (resume) =>
      updateSnapshot(storagePath, async (snapshot) => {
        snapshot.tailoredResumes[resume.id] = resume;
        return resume;
      }),
    getAtsAssessment: async (assessmentId) => (await readSnapshot(storagePath)).atsAssessments[assessmentId],
    listAtsAssessments: async () =>
      Object.values((await readSnapshot(storagePath)).atsAssessments).sort(compareAtsAssessments),
    upsertAtsAssessment: async (assessment) =>
      updateSnapshot(storagePath, async (snapshot) => {
        snapshot.atsAssessments[assessment.id] = assessment;
        return assessment;
      }),
    getApplicationRecord: async (applicationId) =>
      (await readSnapshot(storagePath)).applicationRecords[applicationId],
    getApplicationRecordByJobId: async (jobId) =>
      Object.values((await readSnapshot(storagePath)).applicationRecords).find(
        (applicationRecord) => applicationRecord.jobId === jobId
      ),
    listApplicationRecords: async () =>
      Object.values((await readSnapshot(storagePath)).applicationRecords).sort(
        compareApplicationRecords
      ),
    upsertApplicationRecord: async (applicationRecord) =>
      updateSnapshot(storagePath, async (snapshot) => {
        snapshot.applicationRecords[applicationRecord.id] = applicationRecord;
        return applicationRecord;
      }),
    getAutomationRun: async (runId) => (await readSnapshot(storagePath)).automationRuns[runId],
    getAutomationRunByIdempotencyKey: async (idempotencyKey) =>
      Object.values((await readSnapshot(storagePath)).automationRuns).find(
        (run) => run.idempotencyKey === idempotencyKey
      ),
    listAutomationRuns: async () =>
      Object.values((await readSnapshot(storagePath)).automationRuns).sort(compareAutomationRuns),
    upsertAutomationRun: async (run) =>
      updateSnapshot(storagePath, async (snapshot) => {
        const conflictingRun = Object.values(snapshot.automationRuns).find(
          (existing) => existing.id !== run.id && existing.idempotencyKey === run.idempotencyKey
        );
        if (conflictingRun) {
          throw new Error(
            `Automation run idempotency conflict: key "${run.idempotencyKey}" is already owned by ${conflictingRun.id}.`
          );
        }
        snapshot.automationRuns[run.id] = run;
        return run;
      }),
    getQueueJob: async (queueJobId) => (await readSnapshot(storagePath)).queueJobs[queueJobId],
    getQueueJobByIdempotencyKey: async (idempotencyKey) =>
      Object.values((await readSnapshot(storagePath)).queueJobs).find(
        (queueJob) => queueJob.idempotencyKey === idempotencyKey
      ),
    listQueueJobs: async () =>
      Object.values((await readSnapshot(storagePath)).queueJobs).sort(compareQueueJobs),
    upsertQueueJob: async (queueJob) =>
      updateSnapshot(storagePath, async (snapshot) => {
        snapshot.queueJobs[queueJob.id] = queueJob;
        return queueJob;
      }),
    claimNextQueueJob: async (options) => {
      return updateSnapshot(storagePath, async (snapshot) =>
        claimNextQueueJobFromSnapshot(snapshot, options)
      );
    }
  };
}

async function readSnapshot(storagePath: string): Promise<PipelineStorageSnapshot> {
  try {
    const raw = await readFile(storagePath, "utf8");
    return normalizeSnapshot(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptySnapshot();
    }

    throw error;
  }
}

async function updateSnapshot<Result>(
  storagePath: string,
  updater: (snapshot: PipelineStorageSnapshot) => Promise<Result>
): Promise<Result> {
  const previousQueue = snapshotUpdateQueues.get(storagePath) ?? Promise.resolve();
  let releaseCurrentQueue!: () => void;
  const currentQueue = new Promise<void>((resolve) => {
    releaseCurrentQueue = resolve;
  });
  const queueTail = previousQueue.catch(() => undefined).then(() => currentQueue);

  snapshotUpdateQueues.set(storagePath, queueTail);

  await previousQueue.catch(() => undefined);

  try {
    const snapshot = await readSnapshot(storagePath);
    const result = await updater(snapshot);
    await writeSnapshot(storagePath, snapshot);
    return result;
  } finally {
    releaseCurrentQueue();

    if (snapshotUpdateQueues.get(storagePath) === queueTail) {
      snapshotUpdateQueues.delete(storagePath);
    }
  }
}

async function writeSnapshot(
  storagePath: string,
  snapshot: PipelineStorageSnapshot
): Promise<void> {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const tempPath = `${storagePath}.${process.pid}.${randomUUID()}.tmp`;

  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(normalizedSnapshot, null, 2)}\n`, "utf8");
  await rename(tempPath, storagePath);
}

function normalizeSnapshot(value: unknown): PipelineStorageSnapshot {
  if (!isRecord(value)) {
    return createEmptySnapshot();
  }

  return {
    schemaVersion: toSchemaVersion(value.schemaVersion),
    jobs: toRecordMap<JobPosting>(value.jobs),
    tailoredResumes: toRecordMap<TailoredResume>(value.tailoredResumes),
    atsAssessments: toRecordMap<AtsAssessment>(value.atsAssessments),
    applicationRecords: toRecordMap<ApplicationRecord>(value.applicationRecords),
    queueJobs: toRecordMap<QueueJob>(value.queueJobs),
    automationRuns: toRecordMap<AutomationRun>(value.automationRuns)
  };
}

function createEmptySnapshot(): PipelineStorageSnapshot {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    jobs: {},
    tailoredResumes: {},
    atsAssessments: {},
    applicationRecords: {},
    queueJobs: {},
    automationRuns: {}
  };
}

function toRecordMap<Value>(value: unknown): Record<string, Value> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value)) as Record<string, Value>;
}

function toSchemaVersion(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  return STORAGE_SCHEMA_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function compareAutomationRuns(left: AutomationRun, right: AutomationRun): number {
  return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
}

function compareJobs(left: JobPosting, right: JobPosting): number {
  return left.discoveredAt.localeCompare(right.discoveredAt) || left.id.localeCompare(right.id);
}

function compareTailoredResumes(left: TailoredResume, right: TailoredResume): number {
  return left.generatedAt.localeCompare(right.generatedAt) || left.id.localeCompare(right.id);
}

function compareAtsAssessments(left: AtsAssessment, right: AtsAssessment): number {
  return left.assessedAt.localeCompare(right.assessedAt) || left.id.localeCompare(right.id);
}

function compareApplicationRecords(left: ApplicationRecord, right: ApplicationRecord): number {
  return left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);
}

function claimNextQueueJobFromSnapshot(
  snapshot: PipelineStorageSnapshot,
  options: QueueClaimOptions
): QueueJob | undefined {
  const now = normalizeClaimTimestamp(options.now);
  const claimableJob = Object.values(snapshot.queueJobs)
    .filter((queueJob) => isQueueJobClaimable(queueJob, now, options.stages))
    .sort(compareQueueJobs)[0];

  if (!claimableJob) {
    return undefined;
  }

  const leaseExpiresAt = new Date(
    Date.parse(now) + (options.leaseDurationMs ?? DEFAULT_QUEUE_LEASE_DURATION_MS)
  ).toISOString();
  const claimedJob: QueueJob = {
    ...claimableJob,
    state: "processing",
    attempts: claimableJob.attempts + 1,
    workerId: options.workerId,
    leaseExpiresAt,
    updatedAt: now
  };

  snapshot.queueJobs[claimedJob.id] = claimedJob;
  return claimedJob;
}

function isQueueJobClaimable(
  queueJob: QueueJob,
  now: string,
  stages: QueueClaimOptions["stages"]
): boolean {
  if (stages && stages.length > 0 && !stages.includes(queueJob.stage)) {
    return false;
  }

  if (queueJob.state === "completed" || queueJob.state === "dead-letter") {
    return false;
  }

  if (queueJob.state === "processing") {
    return (
      typeof queueJob.leaseExpiresAt === "string" && queueJob.leaseExpiresAt <= now
    );
  }

  return queueJob.scheduledFor <= now;
}

function normalizeClaimTimestamp(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function compareQueueJobs(left: QueueJob, right: QueueJob): number {
  return (
    left.scheduledFor.localeCompare(right.scheduledFor) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}
