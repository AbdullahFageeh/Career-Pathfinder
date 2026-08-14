import { createHash } from "node:crypto";

import { enqueueSingleJobPipeline } from "../queue/pipelineQueue.js";
import { rankJobOpportunities } from "../score/fitScore.js";
import type { ApplicationRecord, CandidateProfile, JobPosting, QueueJob } from "../shared/contracts.js";
import type { PipelineStorage } from "../storage/index.js";
import { dedupeFreshTrustedJobs } from "../sources/sourceRegistry.js";
import { findReusableApprovedAnswer, type AutomationDeskConfig, type AutomationRun } from "./contracts.js";
import {
  completeAutomationRun,
  createAutomationRun,
  failAutomationRun,
  getAutomationRunByIdempotencyKey
} from "./runStore.js";

export type DailyAutomationDeskOptions = {
  storage: PipelineStorage;
  config: AutomationDeskConfig;
  profile: CandidateProfile;
  jobs: JobPosting[];
  now?: string;
  referencePath?: string;
  profileId?: string;
  renderOutputDir?: string;
};

export type DailyAutomationDeskResult = {
  run: AutomationRun;
  skipped: boolean;
  queued: Array<{
    job: JobPosting;
    queueJob: QueueJob;
    fitScore: number;
  }>;
  reviewRequired: Array<{
    job: JobPosting;
    reason: string;
  }>;
};

/**
 * Runs one daily, idempotent application-desk cycle. It deliberately stops at
 * queue creation: the existing worker remains responsible for tailoring,
 * rendering, scoring, and adapter-level submission checks. This boundary lets
 * the scheduled run decide *what* may progress while adapters decide *whether*
 * a remote application can be sent safely.
 */
export async function runDailyAutomationDesk(
  options: DailyAutomationDeskOptions
): Promise<DailyAutomationDeskResult> {
  const now = options.now ?? new Date().toISOString();
  const idempotencyKey = createDailyIdempotencyKey(now, options.config);
  const existingRun = await getAutomationRunByIdempotencyKey(options.storage, idempotencyKey);

  if (existingRun) {
    return {
      run: existingRun,
      skipped: true,
      queued: [],
      reviewRequired: []
    };
  }

  const run = await createAutomationRun(options.storage, {
    idempotencyKey,
    configVersion: options.config.version,
    startedAt: now
  });

  try {
    const trusted = dedupeFreshTrustedJobs(options.jobs, options.config, { now });
    const reviewRequired: DailyAutomationDeskResult["reviewRequired"] = trusted.excluded.map((entry) => ({
      job: entry.job,
      reason: entry.reason
    }));
    const ranked = rankJobOpportunities(
      options.profile,
      trusted.accepted.map((entry) => entry.job),
      {
        now,
        minimumScore: options.config.thresholds.minFitScore,
        candidate: {
          isSaudiNational: isSaudiNational(options.config)
        }
      }
    );

    const selected = await selectQueueableRoles(
      ranked,
      options.storage,
      options.config,
      reviewRequired,
      now
    );
    const queued: DailyAutomationDeskResult["queued"] = [];

    for (const candidate of selected) {
      const queueJob = await enqueueSingleJobPipeline(options.storage, candidate.job, {
        referencePath: options.referencePath,
        profileId: options.profileId,
        renderOutputDir: options.renderOutputDir,
        applyMode: options.config.automationMode,
        allowFullAutoSubmission: options.config.autoSubmitEnabled,
        initialApplicationNote: `Daily automation desk run ${run.id}. Fit score: ${candidate.fit.score}.`
      });
      queued.push({
        job: candidate.job,
        queueJob,
        fitScore: candidate.fit.score
      });
    }

    const completed = await completeAutomationRun(options.storage, run, {
      counts: {
        discovered: options.jobs.length,
        qualified: ranked.length,
        queued: queued.length,
        submitted: 0,
        reviewRequired: reviewRequired.length,
        failed: 0
      },
      completedAt: now
    });

    return {
      run: completed,
      skipped: false,
      queued,
      reviewRequired
    };
  } catch (error) {
    await failAutomationRun(
      options.storage,
      run,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

function createDailyIdempotencyKey(timestamp: string, config: AutomationDeskConfig): string {
  const date = new Date(timestamp).toISOString().slice(0, 10);
  const fingerprint = createHash("sha256")
    .update(stableJson(config))
    .digest("hex")
    .slice(0, 12);
  return `daily:${date}:config:${config.version}:${fingerprint}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSaudiNational(config: AutomationDeskConfig): boolean {
  const answer = findReusableApprovedAnswer(config.answers, "nationality");
  return typeof answer?.value === "string" && answer.value.trim().toLowerCase() === "saudi";
}

async function selectQueueableRoles(
  ranked: ReturnType<typeof rankJobOpportunities>,
  storage: PipelineStorage,
  config: AutomationDeskConfig,
  reviewRequired: DailyAutomationDeskResult["reviewRequired"],
  now: string
): Promise<ReturnType<typeof rankJobOpportunities>> {
  if (config.caps.dailyApplications === 0) {
    for (const candidate of ranked) {
      reviewRequired.push({ job: candidate.job, reason: "daily-cap-exceeded" });
    }
    return [];
  }

  const selected: ReturnType<typeof rankJobOpportunities> = [];
  const employerCounts = new Map<string, number>();
  const applicationHistory = await storage.listApplicationRecords();
  const historicalEmployerCounts = countRecentEmployerApplications(
    applicationHistory,
    now,
    config.caps.employerCooldownDays
  );
  const applicationsByJobId = new Map(applicationHistory.map((record) => [record.jobId, record]));

  for (const candidate of ranked) {
    if (selected.length >= config.caps.dailyApplications) {
      reviewRequired.push({ job: candidate.job, reason: "daily-cap-exceeded" });
      continue;
    }

    const normalizedEmployer = candidate.job.company.trim().toLowerCase();
    const selectedForEmployer = employerCounts.get(normalizedEmployer) ?? 0;
    const historicalForEmployer = historicalEmployerCounts.get(normalizedEmployer) ?? 0;
    if (selectedForEmployer + historicalForEmployer >= config.caps.maxApplicationsPerEmployer) {
      reviewRequired.push({ job: candidate.job, reason: "employer-cooldown-active" });
      continue;
    }

    const existing = applicationsByJobId.get(candidate.job.id);
    if (existing?.status === "applied" || existing?.status === "followed-up") {
      reviewRequired.push({ job: candidate.job, reason: "already-applied" });
      continue;
    }

    selected.push(candidate);
    employerCounts.set(normalizedEmployer, selectedForEmployer + 1);
  }

  return selected;
}

function countRecentEmployerApplications(
  records: ApplicationRecord[],
  now: string,
  cooldownDays: number
): Map<string, number> {
  const counts = new Map<string, number>();
  if (cooldownDays === 0) {
    return counts;
  }

  for (const record of records) {
    const appliedAt = [...record.statusHistory]
      .reverse()
      .find((entry) => entry.status === "applied" || entry.status === "followed-up")?.changedAt;
    if (!appliedAt || !isWithinCooldown(appliedAt, now, cooldownDays)) {
      continue;
    }

    const employer = record.company.trim().toLowerCase();
    counts.set(employer, (counts.get(employer) ?? 0) + 1);
  }

  return counts;
}

function isWithinCooldown(timestamp: string, now: string, cooldownDays: number): boolean {
  const elapsed = Date.parse(now) - Date.parse(timestamp);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < cooldownDays * 24 * 60 * 60 * 1000;
}
