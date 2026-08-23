import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateAutomationDeskConfig } from "./contracts.js";
import { runDailyAutomationDesk } from "./dailyRunner.js";
import { createSqliteStorage } from "../storage/index.js";
import type { CandidateProfile, JobPosting } from "../shared/contracts.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "daily-runner-test-"));
}

const config = validateAutomationDeskConfig({
  version: 1,
  timeZone: "Asia/Riyadh",
  automationMode: "full-auto",
  caps: {
    dailyApplications: 2,
    maxApplicationsPerEmployer: 1,
    employerCooldownDays: 30
  },
  thresholds: {
    minFitScore: 50,
    minAtsScore: 80
  },
  sources: [
    {
      id: "dmgevents-greenhouse",
      kind: "greenhouse",
      capability: "structured-submit",
      enabled: true,
      boardToken: "dmgevents"
    },
    {
      id: "official-company-review",
      kind: "company-page",
      capability: "review-only",
      enabled: true
    }
  ],
  answers: [
    {
      key: "nationality",
      value: "Saudi",
      approval: "auto-submit",
      provenance: {
        sourceKind: "candidate-profile",
        sourceRef: "APPLICATION_REFERENCE.md:1",
        verifiedAt: "2026-08-14T00:00:00.000Z"
      }
    }
  ]
});

const profile: CandidateProfile = {
  id: "profile:synthetic-candidate",
  fullName: "Avery Morgan",
  country: "Saudi Arabia",
  headline: "Live event operations professional",
  targetRoleFamilies: ["venue operations", "event production", "site management"],
  certifications: [],
  coreProofPoints: [
    "Delivered site operations for Formula 1 and FIFA events.",
    "Managed suppliers, schedules, and venue teams for large live events."
  ],
  documents: [],
  recurringAnswers: []
};

function buildGreenhouseJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "greenhouse:dmgevents:123",
    source: {
      kind: "job-board",
      name: "greenhouse-board:dmgevents",
      url: "https://job-boards.greenhouse.io/dmgevents/jobs/123"
    },
    title: "Venue Operations Manager",
    company: "DMG Events",
    location: "Riyadh, Saudi Arabia",
    description: "Lead venue operations, suppliers, site management, and event delivery teams.",
    tags: ["official-source", "saudi-arabia", "board:dmgevents"],
    applicationTarget: {
      url: "https://job-boards.greenhouse.io/dmgevents/jobs/123",
      platform: "greenhouse",
      boardToken: "dmgevents",
      jobId: "123"
    },
    discoveredAt: "2026-08-14T08:00:00.000Z",
    ...overrides
  };
}

test("runs one trusted daily automation cycle and queues only qualified roles", async (t) => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  t.after(async () => {
    await storage.close();
    rmSync(dir, { recursive: true });
  });

  const result = await runDailyAutomationDesk({
    storage,
    config,
    profile,
    jobs: [
      buildGreenhouseJob(),
      buildGreenhouseJob({ id: "duplicate", discoveredAt: "2026-08-13T08:00:00.000Z" }),
      buildGreenhouseJob({
        id: "untrusted",
        source: { kind: "job-board", name: "aggregator", url: "https://example.test/1" },
        applicationTarget: { url: "https://example.test/1" },
        tags: ["saudi-arabia"]
      })
    ],
    now: "2026-08-15T08:00:00.000Z"
  });

  assert.equal(result.skipped, false);
  assert.equal(result.run.status, "completed");
  assert.equal(result.run.counts.discovered, 3);
  assert.equal(result.run.counts.qualified, 1);
  assert.equal(result.run.counts.queued, 1);
  assert.equal(result.run.counts.submitted, 0);
  assert.equal(result.queued[0]?.job.id, "greenhouse:dmgevents:123");
  assert.equal((await storage.listQueueJobs()).length, 1);

});

test("returns the existing result instead of creating a second run for the same daily key", async (t) => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  t.after(async () => {
    await storage.close();
    rmSync(dir, { recursive: true });
  });
  const options = {
    storage,
    config,
    profile,
    jobs: [buildGreenhouseJob()],
    now: "2026-08-15T08:00:00.000Z"
  };

  const first = await runDailyAutomationDesk(options);
  const second = await runDailyAutomationDesk(options);

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(second.run.id, first.run.id);
  assert.equal((await storage.listQueueJobs()).length, 1);
});

test("runs again on the same day when the effective automation configuration changes", async (t) => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  t.after(async () => {
    await storage.close();
    rmSync(dir, { recursive: true });
  });
  const now = "2026-08-15T08:00:00.000Z";

  const first = await runDailyAutomationDesk({
    storage,
    config,
    profile,
    jobs: [buildGreenhouseJob()],
    now
  });
  const changedConfig = validateAutomationDeskConfig({
    ...config,
    thresholds: {
      ...config.thresholds,
      minFitScore: 71
    }
  });
  const second = await runDailyAutomationDesk({
    storage,
    config: changedConfig,
    profile,
    jobs: [buildGreenhouseJob()],
    now
  });

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, false);
  assert.notEqual(second.run.id, first.run.id);
  assert.notEqual(second.run.idempotencyKey, first.run.idempotencyKey);
});

test("blocks a new role when the employer cooldown is active from a prior application", async (t) => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  t.after(async () => {
    await storage.close();
    rmSync(dir, { recursive: true });
  });

  await storage.upsertApplicationRecord({
    id: "application:prior-dmg-role",
    jobId: "prior-dmg-role",
    jobTitle: "Site Operations Manager",
    company: "DMG Events",
    sourceName: "greenhouse-board:dmgevents",
    status: "applied",
    notes: [],
    workerDecisions: [],
    statusHistory: [
      { status: "discovered", changedAt: "2026-08-01T08:00:00.000Z" },
      { status: "applied", changedAt: "2026-08-01T10:00:00.000Z" }
    ],
    followUps: [],
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z"
  });

  const result = await runDailyAutomationDesk({
    storage,
    config,
    profile,
    jobs: [buildGreenhouseJob({ id: "greenhouse:dmgevents:next" })],
    now: "2026-08-15T08:00:00.000Z"
  });

  assert.equal(result.queued.length, 0);
  assert.equal(result.reviewRequired[0]?.reason, "employer-cooldown-active");
});

test("uses a zero daily cap as a safe pause without queueing roles", async (t) => {
  const dir = makeTempDir();
  const storage = createSqliteStorage({ storagePath: join(dir, "test.sqlite") });
  t.after(async () => {
    await storage.close();
    rmSync(dir, { recursive: true });
  });

  const result = await runDailyAutomationDesk({
    storage,
    config: validateAutomationDeskConfig({
      ...config,
      caps: {
        ...config.caps,
        dailyApplications: 0,
        maxApplicationsPerEmployer: 0
      }
    }),
    profile,
    jobs: [buildGreenhouseJob()],
    now: "2026-08-15T08:00:00.000Z"
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.counts.queued, 0);
  assert.equal(result.queued.length, 0);
});
