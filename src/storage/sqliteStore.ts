import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type {
  ApplicationRecord,
  AtsAssessment,
  JobPosting,
  QueueJob,
  QueueStage,
  TailoredResume
} from "../shared/contracts.js";
import type {
  PipelineStorage,
  PipelineStorageSnapshot,
  QueueClaimOptions,
  StorageOptions
} from "./types.js";

const STORAGE_SCHEMA_VERSION = 1;
const DEFAULT_SQLITE_STORAGE_PATH = resolve(process.cwd(), "data", "pipeline-store.sqlite");
const DEFAULT_QUEUE_LEASE_DURATION_MS = 5 * 60 * 1000;

export type SqliteStorageOptions = StorageOptions;

type StoredRow = {
  id: string;
  data: string;
};

export function resolveDefaultSqliteStoragePath(storagePath?: string): string {
  return storagePath ? resolve(storagePath) : DEFAULT_SQLITE_STORAGE_PATH;
}

export function createSqliteStorage(options: SqliteStorageOptions = {}): PipelineStorage {
  const storagePath = resolveDefaultSqliteStoragePath(options.storagePath);
  let databasePromise: Promise<DatabaseSync> | undefined;

  async function getDatabase(): Promise<DatabaseSync> {
    if (!databasePromise) {
      databasePromise = openDatabase(storagePath);
    }

    return databasePromise;
  }

  return {
    storagePath,
    readSnapshot: async () => readSnapshotFromDatabase(await getDatabase()),
    getJobPosting: async (jobId) => getStoredEntity(await getDatabase(), "jobs", jobId),
    listJobPostings: async () =>
      listStoredEntities(await getDatabase(), "jobs", "discovered_at ASC, id ASC"),
    upsertJobPosting: async (job) => {
      upsertJobPosting(await getDatabase(), job);
      return job;
    },
    getTailoredResume: async (resumeId) =>
      getStoredEntity(await getDatabase(), "tailored_resumes", resumeId),
    listTailoredResumes: async () =>
      listStoredEntities(await getDatabase(), "tailored_resumes", "generated_at ASC, id ASC"),
    upsertTailoredResume: async (resume) => {
      upsertTailoredResume(await getDatabase(), resume);
      return resume;
    },
    getAtsAssessment: async (assessmentId) =>
      getStoredEntity(await getDatabase(), "ats_assessments", assessmentId),
    listAtsAssessments: async () =>
      listStoredEntities(await getDatabase(), "ats_assessments", "assessed_at ASC, id ASC"),
    upsertAtsAssessment: async (assessment) => {
      upsertAtsAssessment(await getDatabase(), assessment);
      return assessment;
    },
    getApplicationRecord: async (applicationId) =>
      getStoredEntity(await getDatabase(), "application_records", applicationId),
    getApplicationRecordByJobId: async (jobId) =>
      getStoredEntityByColumn(await getDatabase(), "application_records", "job_id", jobId),
    listApplicationRecords: async () =>
      listStoredEntities(await getDatabase(), "application_records", "updated_at ASC, id ASC"),
    upsertApplicationRecord: async (applicationRecord) => {
      upsertApplicationRecord(await getDatabase(), applicationRecord);
      return applicationRecord;
    },
    getQueueJob: async (queueJobId) =>
      getStoredEntity(await getDatabase(), "queue_jobs", queueJobId),
    getQueueJobByIdempotencyKey: async (idempotencyKey) =>
      getStoredEntityByColumn(await getDatabase(), "queue_jobs", "idempotency_key", idempotencyKey),
    listQueueJobs: async () =>
      listStoredEntities(await getDatabase(), "queue_jobs", "scheduled_for ASC, created_at ASC, id ASC"),
    upsertQueueJob: async (queueJob) => {
      upsertQueueJob(await getDatabase(), queueJob);
      return queueJob;
    },
    claimNextQueueJob: async (claimOptions) =>
      claimNextQueueJob(await getDatabase(), claimOptions)
  };
}

async function openDatabase(storagePath: string): Promise<DatabaseSync> {
  await mkdir(dirname(storagePath), { recursive: true });

  const sqlite = await import("node:sqlite");
  const database = new sqlite.DatabaseSync(storagePath);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  applyMigrations(database);
  return database;
}

function applyMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      discovered_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tailored_resumes (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tailored_resumes_job_id
      ON tailored_resumes (job_id);
    CREATE TABLE IF NOT EXISTS ats_assessments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      assessed_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ats_assessments_job_id
      ON ats_assessments (job_id);
    CREATE TABLE IF NOT EXISTS application_records (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_application_records_job_id
      ON application_records (job_id);
    CREATE TABLE IF NOT EXISTS queue_jobs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT,
      last_error TEXT,
      worker_id TEXT,
      lease_expires_at TEXT,
      scheduled_for TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_jobs_claim
      ON queue_jobs (state, scheduled_for, stage, created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_jobs_job_id
      ON queue_jobs (job_id);
  `);
}

function readSnapshotFromDatabase(database: DatabaseSync): PipelineStorageSnapshot {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    jobs: readStoredEntityMap<JobPosting>(database, "jobs"),
    tailoredResumes: readStoredEntityMap<TailoredResume>(database, "tailored_resumes"),
    atsAssessments: readStoredEntityMap<AtsAssessment>(database, "ats_assessments"),
    applicationRecords: readStoredEntityMap<ApplicationRecord>(database, "application_records"),
    queueJobs: readStoredEntityMap<QueueJob>(database, "queue_jobs")
  };
}

function readStoredEntityMap<Value>(database: DatabaseSync, table: string): Record<string, Value> {
  const rows = database.prepare(`SELECT id, data FROM ${table}`).all() as StoredRow[];

  return Object.fromEntries(
    rows.map((row) => [row.id, deserializeJson<Value>(row.data)])
  ) as Record<string, Value>;
}

function getStoredEntity<Value>(
  database: DatabaseSync,
  table: string,
  id: string
): Value | undefined {
  const row = database.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;

  return row ? deserializeJson<Value>(row.data) : undefined;
}

function getStoredEntityByColumn<Value>(
  database: DatabaseSync,
  table: string,
  column: string,
  value: string
): Value | undefined {
  const row = database
    .prepare(`SELECT data FROM ${table} WHERE ${column} = ?`)
    .get(value) as { data: string } | undefined;

  return row ? deserializeJson<Value>(row.data) : undefined;
}

function listStoredEntities<Value>(
  database: DatabaseSync,
  table: string,
  orderBy: string
): Value[] {
  const rows = database.prepare(`SELECT data FROM ${table} ORDER BY ${orderBy}`).all() as Array<{
    data: string;
  }>;

  return rows.map((row) => deserializeJson<Value>(row.data));
}

function upsertJobPosting(database: DatabaseSync, job: JobPosting): void {
  database
    .prepare(`
      INSERT INTO jobs (id, discovered_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        discovered_at = excluded.discovered_at,
        data = excluded.data
    `)
    .run(job.id, job.discoveredAt, serializeJson(job));
}

function upsertTailoredResume(database: DatabaseSync, resume: TailoredResume): void {
  database
    .prepare(`
      INSERT INTO tailored_resumes (id, job_id, generated_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        job_id = excluded.job_id,
        generated_at = excluded.generated_at,
        data = excluded.data
    `)
    .run(resume.id, resume.jobId, resume.generatedAt, serializeJson(resume));
}

function upsertAtsAssessment(database: DatabaseSync, assessment: AtsAssessment): void {
  database
    .prepare(`
      INSERT INTO ats_assessments (id, job_id, assessed_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        job_id = excluded.job_id,
        assessed_at = excluded.assessed_at,
        data = excluded.data
    `)
    .run(assessment.id, assessment.jobId, assessment.assessedAt, serializeJson(assessment));
}

function upsertApplicationRecord(database: DatabaseSync, applicationRecord: ApplicationRecord): void {
  database
    .prepare(`
      INSERT INTO application_records (id, job_id, updated_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        job_id = excluded.job_id,
        updated_at = excluded.updated_at,
        data = excluded.data
    `)
    .run(
      applicationRecord.id,
      applicationRecord.jobId,
      applicationRecord.updatedAt,
      serializeJson(applicationRecord)
    );
}

function upsertQueueJob(database: DatabaseSync, queueJob: QueueJob): void {
  database
    .prepare(`
      INSERT INTO queue_jobs (
        id,
        job_id,
        application_id,
        stage,
        state,
        attempts,
        max_attempts,
        idempotency_key,
        payload,
        last_error,
        worker_id,
        lease_expires_at,
        scheduled_for,
        created_at,
        updated_at,
        completed_at,
        data
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        job_id = excluded.job_id,
        application_id = excluded.application_id,
        stage = excluded.stage,
        state = excluded.state,
        attempts = excluded.attempts,
        max_attempts = excluded.max_attempts,
        idempotency_key = excluded.idempotency_key,
        payload = excluded.payload,
        last_error = excluded.last_error,
        worker_id = excluded.worker_id,
        lease_expires_at = excluded.lease_expires_at,
        scheduled_for = excluded.scheduled_for,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        data = excluded.data
    `)
    .run(
      queueJob.id,
      queueJob.jobId,
      queueJob.applicationId,
      queueJob.stage,
      queueJob.state,
      queueJob.attempts,
      queueJob.maxAttempts,
      queueJob.idempotencyKey,
      queueJob.payload ? serializeJson(queueJob.payload) : null,
      queueJob.lastError ?? null,
      queueJob.workerId ?? null,
      queueJob.leaseExpiresAt ?? null,
      queueJob.scheduledFor,
      queueJob.createdAt,
      queueJob.updatedAt,
      queueJob.completedAt ?? null,
      serializeJson(queueJob)
    );
}

function claimNextQueueJob(
  database: DatabaseSync,
  options: QueueClaimOptions
): QueueJob | undefined {
  const now = normalizeClaimTimestamp(options.now);
  const leaseExpiresAt = new Date(
    Date.parse(now) + (options.leaseDurationMs ?? DEFAULT_QUEUE_LEASE_DURATION_MS)
  ).toISOString();

  database.exec("BEGIN IMMEDIATE");

  try {
    const row = findClaimableQueueJobRow(database, now, options.stages);

    if (!row) {
      database.exec("COMMIT");
      return undefined;
    }

    const queueJob = deserializeJson<QueueJob>(row.data);
    const claimedJob: QueueJob = {
      ...queueJob,
      state: "processing",
      attempts: queueJob.attempts + 1,
      workerId: options.workerId,
      leaseExpiresAt,
      updatedAt: now
    };

    upsertQueueJob(database, claimedJob);
    database.exec("COMMIT");
    return claimedJob;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function findClaimableQueueJobRow(
  database: DatabaseSync,
  now: string,
  stages: readonly QueueStage[] | undefined
): { data: string } | undefined {
  const parameters: string[] = [now, now];
  let query = `
    SELECT data
    FROM queue_jobs
    WHERE (
      ((state = 'pending' OR state = 'failed') AND scheduled_for <= ?)
      OR (state = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
    )
  `;

  if (stages && stages.length > 0) {
    query += ` AND stage IN (${stages.map(() => "?").join(", ")})`;
    parameters.push(...stages);
  }

  query += " ORDER BY scheduled_for ASC, created_at ASC, id ASC LIMIT 1";

  return database.prepare(query).get(...parameters) as { data: string } | undefined;
}

function normalizeClaimTimestamp(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function deserializeJson<Value>(value: string): Value {
  return JSON.parse(value) as Value;
}
