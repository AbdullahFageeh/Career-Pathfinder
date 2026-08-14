import type { PipelineStorage } from "../storage/index.js";
import type { AutomationRun, AutomationRunCounts } from "./contracts.js";

export type CreateAutomationRunInput = {
  idempotencyKey: string;
  configVersion: number;
  startedAt?: string;
};

export type CompleteAutomationRunInput = {
  counts: AutomationRunCounts;
  completedAt?: string;
};

function emptyRunCounts(): AutomationRunCounts {
  return {
    discovered: 0,
    qualified: 0,
    queued: 0,
    submitted: 0,
    reviewRequired: 0,
    failed: 0
  };
}

/**
 * Creates a durable daily-run record. A matching idempotency key is treated as
 * an existing run, preventing a retry or scheduler overlap from starting a
 * second orchestration pass for the same day and configuration.
 */
export async function createAutomationRun(
  storage: PipelineStorage,
  input: CreateAutomationRunInput
): Promise<AutomationRun> {
  const existing = await getAutomationRunByIdempotencyKey(storage, input.idempotencyKey);
  if (existing) {
    throw new Error(
      `Automation run idempotency conflict: a run with key "${input.idempotencyKey}" already exists (id: ${existing.id}, status: ${existing.status}).`
    );
  }

  const startedAt = input.startedAt ?? new Date().toISOString();
  const run: AutomationRun = {
    id: `run:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: input.idempotencyKey,
    configVersion: input.configVersion,
    status: "running",
    startedAt,
    counts: emptyRunCounts()
  };

  try {
    return await storage.upsertAutomationRun(run);
  } catch (error) {
    if (isIdempotencyConflict(error)) {
      throw new Error(
        `Automation run idempotency conflict: a run with key "${input.idempotencyKey}" already exists or is being created.`
      );
    }
    throw error;
  }
}

function isIdempotencyConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("idempotency") || message.includes("unique constraint") || message.includes("sqlite_constraint");
}

export async function completeAutomationRun(
  storage: PipelineStorage,
  run: AutomationRun,
  input: CompleteAutomationRunInput
): Promise<AutomationRun> {
  return storage.upsertAutomationRun({
    ...run,
    status: "completed",
    counts: input.counts,
    completedAt: input.completedAt ?? new Date().toISOString(),
    errorSummary: undefined
  });
}

export async function failAutomationRun(
  storage: PipelineStorage,
  run: AutomationRun,
  errorSummary: string
): Promise<AutomationRun> {
  return storage.upsertAutomationRun({
    ...run,
    status: "failed",
    completedAt: new Date().toISOString(),
    errorSummary
  });
}

export function getAutomationRunById(storage: PipelineStorage, runId: string): Promise<AutomationRun | undefined> {
  return storage.getAutomationRun(runId);
}

export function getAutomationRunByIdempotencyKey(
  storage: PipelineStorage,
  idempotencyKey: string
): Promise<AutomationRun | undefined> {
  return storage.getAutomationRunByIdempotencyKey(idempotencyKey);
}
