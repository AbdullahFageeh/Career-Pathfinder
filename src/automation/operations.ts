import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ingestJobPosting } from "../ingest/index.js";
import { loadCandidateProfile } from "../profile/index.js";
import {
  discoverSaudiGreenhouseRoles,
  type SaudiBoardDiscoveryOptions,
  type SaudiBoardDiscoveryResult
} from "../sources/index.js";
import { createSqliteStorage, type PipelineStorage } from "../storage/index.js";
import type { CandidateProfile, JobPosting } from "../shared/contracts.js";
import { validateAutomationDeskConfig, type AutomationDeskConfig } from "./contracts.js";
import { runDailyAutomationDesk, type DailyAutomationDeskResult } from "./dailyRunner.js";
import { formatAutomationReviewQueueMarkdown } from "./reviewQueue.js";

export type DailyAutomationOperationOptions = {
  configPath?: string;
  storagePath?: string;
  referencePath?: string;
  profileId?: string;
  outputPath?: string;
  now?: string;
  storage?: PipelineStorage;
};

export type DailyAutomationOperationResult = {
  config: AutomationDeskConfig;
  discovery: {
    boardsQueried: number;
    boardsFailed: number;
    listings: number;
  };
  run: DailyAutomationDeskResult;
  markdown: string;
  outputPath?: string;
};

type DailyAutomationOperationDependencies = {
  loadCandidateProfile: typeof loadCandidateProfile;
  discoverSaudiGreenhouseRoles: (
    options?: SaudiBoardDiscoveryOptions
  ) => Promise<SaudiBoardDiscoveryResult>;
  readFile: typeof readFile;
};

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), "automation.config.json");

const DEFAULT_DEPENDENCIES: DailyAutomationOperationDependencies = {
  loadCandidateProfile,
  discoverSaudiGreenhouseRoles,
  readFile
};

/**
 * Executes a daily Saudi job discovery pass from explicit, configured
 * Greenhouse boards. It writes an operator report and leaves remote submission
 * to the existing queue worker and its adapter-level safeguards.
 */
export async function runDailyAutomationOperation(
  options: DailyAutomationOperationOptions = {},
  dependencies: Partial<DailyAutomationOperationDependencies> = {}
): Promise<DailyAutomationOperationResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const configPath = resolve(options.configPath ?? DEFAULT_CONFIG_PATH);
  const config = validateAutomationDeskConfig(parseJson(await deps.readFile(configPath, "utf8"), configPath));
  const profile = await deps.loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const storage = options.storage ?? createSqliteStorage({ storagePath: options.storagePath });
  const boardTokens = config.sources
    .filter((source) => source.enabled && source.kind === "greenhouse" && source.boardToken)
    .map((source) => source.boardToken as string);
  const discovery = await deps.discoverSaudiGreenhouseRoles({
    boardTokens,
    filterByTargetTitles: false,
    now: options.now
  });
  const jobs = await normalizeDiscoveredJobs(discovery, storage);
  const run = await runDailyAutomationDesk({
    storage,
    config,
    profile,
    jobs,
    now: options.now,
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const markdown = formatAutomationReviewQueueMarkdown({
    generatedAt: options.now,
    run: run.run,
    queued: run.queued.map((entry) => ({
      job: entry.job,
      fitScore: entry.fitScore,
      queueJobId: entry.queueJob.id
    })),
    reviewRequired: run.reviewRequired
  });
  const outputPath = options.outputPath ? resolve(options.outputPath) : undefined;

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, "utf8");
  }

  return {
    config,
    discovery: {
      boardsQueried: discovery.boardsQueried.length,
      boardsFailed: discovery.boardsFailed.length,
      listings: discovery.listings.length
    },
    run,
    markdown,
    ...(outputPath ? { outputPath } : {})
  };
}

async function normalizeDiscoveredJobs(
  discovery: SaudiBoardDiscoveryResult,
  storage: PipelineStorage
): Promise<JobPosting[]> {
  const jobs = new Map<string, JobPosting>();

  for (const listing of discovery.listings) {
    const job = ingestJobPosting(listing, { defaultDiscoveredAt: discovery.fetchedAt });
    jobs.set(job.id, job);
    await storage.upsertJobPosting(job);
  }

  return [...jobs.values()];
}

function parseJson(content: string, configPath: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Unable to parse automation configuration "${configPath}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
