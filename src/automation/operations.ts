import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ingestJobPosting, type RawJobPostingInput } from "../ingest/index.js";
import { loadCandidateProfile } from "../profile/index.js";
import {
  discoverSaudiGreenhouseRoles,
  discoverSaudiLeverRoles,
  discoverSaudiWorkableRoles,
  type SaudiBoardDiscoveryOptions,
  type SaudiBoardDiscoveryResult,
  type SaudiLeverDiscoveryOptions,
  type SaudiLeverDiscoveryResult,
  type SaudiWorkableDiscoveryOptions,
  type SaudiWorkableDiscoveryResult
} from "../sources/index.js";
import { type PipelineStorage, withPipelineStorage } from "../storage/index.js";
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
    sourcesQueried: number;
    sourcesFailed: number;
    listings: number;
  };
  run: DailyAutomationDeskResult;
  markdown: string;
  outputPath?: string;
};

type CombinedDiscovery = {
  fetchedAt: string;
  sourcesQueried: string[];
  sourcesFailed: Array<{ source: string; reason: string }>;
  listings: RawJobPostingInput[];
};

type DailyAutomationOperationDependencies = {
  loadCandidateProfile: typeof loadCandidateProfile;
  discoverSaudiGreenhouseRoles: (
    options?: SaudiBoardDiscoveryOptions
  ) => Promise<SaudiBoardDiscoveryResult>;
  discoverSaudiLeverRoles: (options: SaudiLeverDiscoveryOptions) => Promise<SaudiLeverDiscoveryResult>;
  discoverSaudiWorkableRoles: (options: SaudiWorkableDiscoveryOptions) => Promise<SaudiWorkableDiscoveryResult>;
  readFile: typeof readFile;
};

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), "automation.config.json");

const DEFAULT_DEPENDENCIES: DailyAutomationOperationDependencies = {
  loadCandidateProfile,
  discoverSaudiGreenhouseRoles,
  discoverSaudiLeverRoles,
  discoverSaudiWorkableRoles,
  readFile
};

/**
 * Executes one daily Saudi job discovery pass from explicitly configured public
 * ATS sources. The sources are combined before the trust, fit, cap, queue, and
 * adapter-level safeguards run, so a new discovery channel cannot bypass them.
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
  return withPipelineStorage(options, async (storage) => {
    const greenhouseTokens = configuredTokens(config, "greenhouse", "boardToken");
    const leverTokens = configuredTokens(config, "lever", "siteToken");
    const workableTokens = configuredTokens(config, "workable", "siteToken");

    const [greenhouse, lever, workable] = await Promise.all([
      greenhouseTokens.length > 0
        ? deps.discoverSaudiGreenhouseRoles({
            boardTokens: greenhouseTokens,
            includeRemote: config.includeRemote,
            filterByTargetTitles: false,
            now: options.now
          })
        : Promise.resolve(emptyGreenhouseDiscovery(options.now)),
      leverTokens.length > 0
        ? deps.discoverSaudiLeverRoles({
            siteTokens: leverTokens,
            includeRemote: config.includeRemote,
            filterByTargetTitles: false,
            now: options.now
          })
        : Promise.resolve(emptyLeverDiscovery(options.now)),
      workableTokens.length > 0
        ? deps.discoverSaudiWorkableRoles({
            siteTokens: workableTokens,
            includeRemote: config.includeRemote,
            filterByTargetTitles: false,
            now: options.now
          })
        : Promise.resolve(emptyWorkableDiscovery(options.now))
    ]);

    const discovery = combineDiscoveries(greenhouse, lever, workable, options.now);
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
        sourcesQueried: discovery.sourcesQueried.length,
        sourcesFailed: discovery.sourcesFailed.length,
        listings: discovery.listings.length
      },
      run,
      markdown,
      ...(outputPath ? { outputPath } : {})
    };
  });
}

function configuredTokens(
  config: AutomationDeskConfig,
  kind: "greenhouse" | "lever" | "workable",
  key: "boardToken" | "siteToken"
): string[] {
  return config.sources
    .filter((source) => source.enabled && source.kind === kind && source[key])
    .map((source) => source[key] as string);
}

function combineDiscoveries(
  greenhouse: SaudiBoardDiscoveryResult,
  lever: SaudiLeverDiscoveryResult,
  workable: SaudiWorkableDiscoveryResult,
  now: string | undefined
): CombinedDiscovery {
  return {
    fetchedAt: now ?? new Date().toISOString(),
    sourcesQueried: [
      ...greenhouse.boardsQueried.map((token) => `greenhouse:${token}`),
      ...lever.sitesQueried.map((token) => `lever:${token}`),
      ...workable.sitesQueried.map((token) => `workable:${token}`)
    ],
    sourcesFailed: [
      ...greenhouse.boardsFailed.map((entry) => ({ source: `greenhouse:${entry.boardToken}`, reason: entry.reason })),
      ...lever.sitesFailed.map((entry) => ({ source: `lever:${entry.siteToken}`, reason: entry.reason })),
      ...workable.sitesFailed.map((entry) => ({ source: `workable:${entry.siteToken}`, reason: entry.reason }))
    ],
    listings: [...greenhouse.listings, ...lever.listings, ...workable.listings]
  };
}

function emptyGreenhouseDiscovery(now: string | undefined): SaudiBoardDiscoveryResult {
  return {
    fetchedAt: now ?? new Date().toISOString(),
    sourceName: "greenhouse-board",
    boardsQueried: [],
    boardsFailed: [],
    listings: []
  };
}

function emptyLeverDiscovery(now: string | undefined): SaudiLeverDiscoveryResult {
  return {
    fetchedAt: now ?? new Date().toISOString(),
    sitesQueried: [],
    sitesFailed: [],
    listings: []
  };
}

function emptyWorkableDiscovery(now: string | undefined): SaudiWorkableDiscoveryResult {
  return {
    fetchedAt: now ?? new Date().toISOString(),
    sitesQueried: [],
    sitesFailed: [],
    listings: []
  };
}

async function normalizeDiscoveredJobs(discovery: CombinedDiscovery, storage: PipelineStorage): Promise<JobPosting[]> {
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
