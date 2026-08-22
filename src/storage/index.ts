export {
  createFileBackedStorage,
  resolveDefaultStoragePath,
  type FileBackedStorageOptions
} from "./fileStore.js";
export {
  createSqliteStorage,
  resolveDefaultSqliteStoragePath,
  type SqliteStorageOptions
} from "./sqliteStore.js";
export {
  withPipelineStorage,
  type PipelineStorageProviderOptions
} from "./lifecycle.js";
export type {
  PipelineStorage,
  PipelineStorageSnapshot,
  QueueClaimOptions,
  StorageOptions
} from "./types.js";
export const storageModule = {
  key: "storage",
  summary: "Persist jobs, queue state, ATS scores, and worker leases.",
  responsibilities: [
    "Define storage boundaries for core entities and logs.",
    "Support durable queue state, worker claims, and artifact references.",
    "Keep the application history as the system source of truth."
  ]
} as const;
