import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  ApplicationRecord,
  AtsAssessment,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";

const STORAGE_SCHEMA_VERSION = 1;
const DEFAULT_STORAGE_PATH = resolve(process.cwd(), "data", "pipeline-store.json");
const snapshotUpdateQueues = new Map<string, Promise<void>>();

export type FileBackedStorageOptions = {
  storagePath?: string;
};

export type PipelineStorageSnapshot = {
  schemaVersion: number;
  jobs: Record<string, JobPosting>;
  tailoredResumes: Record<string, TailoredResume>;
  atsAssessments: Record<string, AtsAssessment>;
  applicationRecords: Record<string, ApplicationRecord>;
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
};

export function resolveDefaultStoragePath(storagePath?: string): string {
  return storagePath ? resolve(storagePath) : DEFAULT_STORAGE_PATH;
}

export function createFileBackedStorage(
  options: FileBackedStorageOptions = {}
): PipelineStorage {
  const storagePath = resolveDefaultStoragePath(options.storagePath);

  return {
    storagePath,
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
      })
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
    applicationRecords: toRecordMap<ApplicationRecord>(value.applicationRecords)
  };
}

function createEmptySnapshot(): PipelineStorageSnapshot {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    jobs: {},
    tailoredResumes: {},
    atsAssessments: {},
    applicationRecords: {}
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
