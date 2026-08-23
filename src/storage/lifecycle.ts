import { createSqliteStorage } from "./sqliteStore.js";
import type { PipelineStorage, StorageOptions } from "./types.js";

export type PipelineStorageProviderOptions = StorageOptions & {
  storage?: PipelineStorage;
};

export async function withPipelineStorage<Result>(
  options: PipelineStorageProviderOptions,
  operation: (storage: PipelineStorage) => Promise<Result>
): Promise<Result> {
  const ownsStorage = !options.storage;
  const storage =
    options.storage ??
    createSqliteStorage({
      storagePath: options.storagePath
    });

  try {
    return await operation(storage);
  } finally {
    if (ownsStorage) {
      await storage.close();
    }
  }
}
