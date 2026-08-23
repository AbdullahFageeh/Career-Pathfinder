import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileBackedStorage, createSqliteStorage } from "../storage/index.js";
import type { PipelineStorage } from "../storage/index.js";
import {
  createAutomationRun,
  completeAutomationRun,
  failAutomationRun,
  getAutomationRunByIdempotencyKey
} from "./runStore.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "run-store-test-"));
}
async function closeStorageAndRemoveDir(storage: PipelineStorage, dir: string): Promise<void> {
  await storage.close?.();
  rmSync(dir, { recursive: true, force: true });
}

test("creates a new automation run record and persists it", async () => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  try {
    const run = await createAutomationRun(storage, {
      idempotencyKey: "daily-2026-08-14",
      configVersion: 1
    });

    assert.equal(run.status, "running");
    assert.equal(run.idempotencyKey, "daily-2026-08-14");
    assert.equal(run.configVersion, 1);
    assert.ok(run.id.startsWith("run:"));
    assert.equal(run.counts.discovered, 0);
  } finally {
    await closeStorageAndRemoveDir(storage, dir);
  }
});

test("marks a run completed with final counts", async () => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  try {
    const run = await createAutomationRun(storage, {
      idempotencyKey: "daily-2026-08-14",
      configVersion: 1
    });

    const completed = await completeAutomationRun(storage, run, {
      counts: {
        discovered: 12,
        qualified: 5,
        queued: 4,
        submitted: 2,
        reviewRequired: 2,
        failed: 0
      }
    });

    assert.equal(completed.status, "completed");
    assert.equal(completed.counts.submitted, 2);
    assert.ok(completed.completedAt);
  } finally {
    await closeStorageAndRemoveDir(storage, dir);
  }
});

test("marks a run failed with an error summary", async () => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  try {
    const run = await createAutomationRun(storage, {
      idempotencyKey: "daily-2026-08-14",
      configVersion: 1
    });

    const failed = await failAutomationRun(storage, run, "Source discovery timed out.");

    assert.equal(failed.status, "failed");
    assert.equal(failed.errorSummary, "Source discovery timed out.");
  } finally {
    await closeStorageAndRemoveDir(storage, dir);
  }
});

test("persists a completed automation run in the file-backed store", async () => {
  const dir = makeTempDir();
  const storage = createFileBackedStorage({ storagePath: join(dir, "test.json") });
  try {
    const run = await createAutomationRun(storage, {
      idempotencyKey: "daily-2026-08-14",
      configVersion: 1
    });
    const completed = await completeAutomationRun(storage, run, {
      counts: {
        discovered: 3,
        qualified: 2,
        queued: 2,
        submitted: 1,
        reviewRequired: 1,
        failed: 0
      }
    });

    const snapshot = await storage.readSnapshot();
    assert.equal(snapshot.automationRuns[completed.id]?.status, "completed");
    assert.equal(snapshot.applicationRecords[completed.id], undefined);
  } finally {
    await closeStorageAndRemoveDir(storage, dir);
  }
});

test("enforces idempotency-key uniqueness in the file-backed store", async () => {
  const dir = makeTempDir();
  const storage = createFileBackedStorage({ storagePath: join(dir, "test.json") });
  try {
    const first = await createAutomationRun(storage, {
      idempotencyKey: "daily-2026-08-14",
      configVersion: 1
    });

    await assert.rejects(
      () =>
        storage.upsertAutomationRun({
          ...first,
          id: "run:duplicate",
          startedAt: "2026-08-14T01:00:00.000Z"
        }),
      /idempotency/i
    );
  } finally {
    await closeStorageAndRemoveDir(storage, dir);
  }
});

test("normalizes a storage-level unique conflict into an idempotency error", async () => {
  const storage = {
    getAutomationRunByIdempotencyKey: async () => undefined,
    upsertAutomationRun: async () => {
      throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: automation_runs.idempotency_key");
    }
  } as unknown as PipelineStorage;

  await assert.rejects(
    () => createAutomationRun(storage, { idempotencyKey: "daily-2026-08-14", configVersion: 1 }),
    /idempotency conflict/i
  );
});

test("prevents a duplicate run for the same idempotency key", async () => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  try {
    await createAutomationRun(storage, {
      idempotencyKey: "daily-2026-08-14",
      configVersion: 1
    });

    const existing = await getAutomationRunByIdempotencyKey(storage, "daily-2026-08-14");

    assert.ok(existing);
    assert.equal(existing.idempotencyKey, "daily-2026-08-14");

    await assert.rejects(
      () => createAutomationRun(storage, { idempotencyKey: "daily-2026-08-14", configVersion: 1 }),
      /idempotency/i
    );
  } finally {
    await closeStorageAndRemoveDir(storage, dir);
  }
});
