import assert from "node:assert/strict";
import test from "node:test";
import type { ApplicationRecord, ApplicationStatus, JobPosting } from "../shared/contracts.js";
import { ensureFollowUpLadder } from "../followup/index.js";
import { createApplicationRecord, updateApplicationStatus } from "../tracker/index.js";
import { buildFunnelReport, formatFunnelReportMarkdown } from "./index.js";

const now = "2026-08-12T09:00:00.000Z";

function buildJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-a",
    source: { kind: "company-page", name: "Employer Careers" },
    title: "Venue Operations Manager",
    company: "Example Events",
    location: "Jeddah, Saudi Arabia",
    description: "Lead venue operations.",
    tags: ["official-source", "saudi-arabia"],
    discoveredAt: "2026-08-01T09:00:00.000Z",
    ...overrides
  };
}

function advanceTo(
  record: ApplicationRecord,
  statuses: readonly ApplicationStatus[],
  at: string
): ApplicationRecord {
  return statuses.reduce((current, status) => updateApplicationStatus(current, status, { at }), record);
}

test("buildFunnelReport counts stages and conversion rates", () => {
  const applied = advanceTo(
    createApplicationRecord({ job: buildJob({ id: "job-a" }), createdAt: "2026-08-08T09:00:00.000Z" }),
    ["screened", "tailored", "ats-passed", "applied"],
    "2026-08-08T09:00:00.000Z"
  );
  const tailoredOnly = advanceTo(
    createApplicationRecord({
      job: buildJob({ id: "job-b", company: "Second Employer" }),
      createdAt: "2026-08-10T09:00:00.000Z"
    }),
    ["screened", "tailored"],
    "2026-08-10T09:00:00.000Z"
  );

  const report = buildFunnelReport([{ ...applied, atsScore: 82 }, { ...tailoredOnly, atsScore: 68 }], { now });

  assert.equal(report.totalRecords, 2);
  assert.equal(report.appliedCount, 1);
  assert.equal(report.atsPassedCount, 1);
  assert.equal(report.applyRate, 0.5);
  assert.equal(report.weeklyApplied, 1);
  assert.equal(report.averageAtsScore, 75);
  assert.equal(report.stages.find((stage) => stage.status === "applied")?.current, 1);
  assert.equal(report.stages.find((stage) => stage.status === "tailored")?.reached, 2);
});

test("buildFunnelReport surfaces due follow-ups and follow-up rate", () => {
  const applied = advanceTo(
    createApplicationRecord({ job: buildJob(), createdAt: "2026-08-01T09:00:00.000Z" }),
    ["screened", "tailored", "ats-passed", "applied"],
    "2026-08-01T09:00:00.000Z"
  );
  const { record } = ensureFollowUpLadder(applied);

  const report = buildFunnelReport([record], { now });

  assert.equal(report.dueFollowUps.length, 2);
  assert.equal(report.followUpRate, 0);
  assert.equal(report.dueFollowUps[0]?.company, "Example Events");
});

test("buildFunnelReport flags stalled records past the threshold", () => {
  const stale = advanceTo(
    createApplicationRecord({ job: buildJob(), createdAt: "2026-07-01T09:00:00.000Z" }),
    ["screened"],
    "2026-07-01T09:00:00.000Z"
  );
  const fresh = advanceTo(
    createApplicationRecord({
      job: buildJob({ id: "job-fresh", company: "Fresh Employer" }),
      createdAt: "2026-08-11T09:00:00.000Z"
    }),
    ["screened"],
    "2026-08-11T09:00:00.000Z"
  );

  const report = buildFunnelReport([stale, fresh], { now, staleAfterDays: 10 });

  assert.equal(report.staleApplications.length, 1);
  assert.equal(report.staleApplications[0]?.company, "Example Events");
  assert.equal(report.staleApplications[0]?.idleDays, 42);
});

test("buildFunnelReport handles an empty pipeline", () => {
  const report = buildFunnelReport([], { now });

  assert.equal(report.totalRecords, 0);
  assert.equal(report.applyRate, 0);
  assert.equal(report.followUpRate, 0);
  assert.equal(report.averageAtsScore, undefined);
  assert.equal(report.dueFollowUps.length, 0);
});

test("formatFunnelReportMarkdown renders headline, stages, and empty states", () => {
  const report = buildFunnelReport([], { now });
  const markdown = formatFunnelReportMarkdown(report);

  assert.match(markdown, /# Application funnel report/);
  assert.match(markdown, /Tracked opportunities: 0/);
  assert.match(markdown, /Average ATS readiness: not scored yet/);
  assert.match(markdown, /Nothing is due\./);
  assert.match(markdown, /No record has been idle past the threshold\./);
});

test("formatFunnelReportMarkdown lists employers when records exist", () => {
  const record = advanceTo(
    createApplicationRecord({ job: buildJob(), createdAt: "2026-08-08T09:00:00.000Z" }),
    ["screened", "tailored", "ats-passed", "applied"],
    "2026-08-08T09:00:00.000Z"
  );

  const markdown = formatFunnelReportMarkdown(buildFunnelReport([record], { now }));

  assert.match(markdown, /## Most-worked employers/);
  assert.match(markdown, /Example Events/);
});
