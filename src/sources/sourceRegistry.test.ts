import assert from "node:assert/strict";
import test from "node:test";
import type { JobPosting } from "../shared/contracts.js";
import { validateAutomationDeskConfig } from "../automation/contracts.js";
import { assessTrustedSource, dedupeFreshTrustedJobs } from "./sourceRegistry.js";

const config = validateAutomationDeskConfig({
  version: 1,
  timeZone: "Asia/Riyadh",
  automationMode: "full-auto",
  caps: {
    dailyApplications: 4,
    maxApplicationsPerEmployer: 1,
    employerCooldownDays: 30
  },
  thresholds: {
    minFitScore: 70,
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
      id: "eventco-lever",
      kind: "lever",
      capability: "review-only",
      enabled: true,
      siteToken: "eventco"
    },
    {
      id: "seven-workable",
      kind: "workable",
      capability: "review-only",
      enabled: true,
      siteToken: "seven-7"
    },
    {
      id: "official-company-review",
      kind: "company-page",
      capability: "review-only",
      enabled: true
    }
  ],
  answers: []
});

function buildJob(overrides: Partial<JobPosting> = {}): JobPosting {
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
    description: "Lead venue operations for a major Saudi event.",
    tags: ["official-source", "saudi-arabia", "source:greenhouse-board", "board:dmgevents"],
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

test("accepts a fresh configured official Greenhouse role for structured submission", () => {
  const assessment = assessTrustedSource(buildJob(), config, { now: "2026-08-15T08:00:00.000Z" });

  assert.equal(assessment.accepted, true);
  assert.equal(assessment.capability, "structured-submit");
  assert.equal(assessment.source?.id, "dmgevents-greenhouse");
});

test("blocks stale roles before they enter the automation queue", () => {
  const assessment = assessTrustedSource(
    buildJob({ discoveredAt: "2026-07-01T08:00:00.000Z" }),
    config,
    { now: "2026-08-15T08:00:00.000Z" }
  );

  assert.equal(assessment.accepted, false);
  assert.equal(assessment.reviewReason, "source-stale");
});

test("blocks an unconfigured aggregator listing even when its title looks relevant", () => {
  const assessment = assessTrustedSource(
    buildJob({
      id: "aggregator:1",
      source: { kind: "job-board", name: "random-aggregator", url: "https://example.test/jobs/1" },
      applicationTarget: { url: "https://example.test/jobs/1" },
      tags: ["saudi-arabia"]
    }),
    config,
    { now: "2026-08-15T08:00:00.000Z" }
  );

  assert.equal(assessment.accepted, false);
  assert.equal(assessment.reviewReason, "source-not-trusted");
});

test("keeps configured company-page sources in review-only mode", () => {
  const assessment = assessTrustedSource(
    buildJob({
      id: "company-page:1",
      source: { kind: "company-page", name: "Employer Careers", url: "https://careers.example.test/role/1" },
      applicationTarget: { url: "https://careers.example.test/role/1" },
      tags: ["official-source", "saudi-arabia"]
    }),
    config,
    { now: "2026-08-15T08:00:00.000Z" }
  );

  assert.equal(assessment.accepted, true);
  assert.equal(assessment.capability, "review-only");
});

test("accepts configured Workable and Lever sites only in review-only mode", () => {
  const lever = assessTrustedSource(
    buildJob({
      id: "lever:eventco:123",
      source: { kind: "job-board", name: "lever-site:eventco", url: "https://jobs.lever.co/eventco/123" },
      applicationTarget: {
        url: "https://jobs.lever.co/eventco/123/apply",
        platform: "lever",
        siteToken: "eventco",
        jobId: "123"
      },
      tags: ["official-source", "saudi-arabia", "source:lever", "site:eventco"]
    }),
    config,
    { now: "2026-08-15T08:00:00.000Z" }
  );
  const workable = assessTrustedSource(
    buildJob({
      id: "workable:seven-7:123",
      source: { kind: "job-board", name: "workable-site:seven-7", url: "https://apply.workable.com/seven-7/j/123" },
      applicationTarget: {
        url: "https://apply.workable.com/seven-7/j/123",
        platform: "workable",
        siteToken: "seven-7",
        jobId: "123"
      },
      tags: ["official-source", "saudi-arabia", "source:workable", "site:seven-7"]
    }),
    config,
    { now: "2026-08-15T08:00:00.000Z" }
  );

  assert.equal(lever.capability, "review-only");
  assert.equal(workable.capability, "review-only");
});

test("deduplicates roles by application URL and keeps the freshest record", () => {
  const jobs = dedupeFreshTrustedJobs(
    [
      buildJob({ id: "older", discoveredAt: "2026-08-13T08:00:00.000Z" }),
      buildJob({ id: "newer", discoveredAt: "2026-08-14T08:00:00.000Z" }),
      buildJob({
        id: "other",
        applicationTarget: {
          url: "https://job-boards.greenhouse.io/dmgevents/jobs/999",
          platform: "greenhouse",
          boardToken: "dmgevents",
          jobId: "999"
        }
      })
    ],
    config,
    { now: "2026-08-15T08:00:00.000Z" }
  );

  assert.deepEqual(
    jobs.accepted.map((entry: { job: { id: string } }) => entry.job.id),
    ["newer", "other"]
  );
  assert.equal(jobs.excluded.length, 1);
  assert.equal(jobs.excluded[0]?.reason, "duplicate");
});
