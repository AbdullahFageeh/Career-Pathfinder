import assert from "node:assert/strict";
import test from "node:test";
import type { ApplicationRecord, CandidateProfile, JobPosting } from "../shared/contracts.js";
import { createApplicationRecord, updateApplicationStatus } from "../tracker/index.js";
import {
  buildFollowUpPlan,
  ensureFollowUpLadder,
  formatDueFollowUpsMarkdown,
  listDueFollowUps
} from "./index.js";

const profile: CandidateProfile = {
  id: "candidate-seed",
  fullName: "Avery Morgan",
  email: "avery@example.test",
  phone: "+966500000000",
  headline: "Event operations and installation manager.",
  targetRoleFamilies: ["Venue Operations Manager"],
  certifications: [],
  coreProofPoints: [],
  documents: [],
  recurringAnswers: []
};

const job: JobPosting = {
  id: "job-venue-ops",
  source: { kind: "company-page", name: "Employer Careers" },
  title: "Venue Operations Manager",
  company: "Example Events",
  location: "Jeddah, Saudi Arabia",
  description: "Lead venue operations.",
  tags: ["official-source", "saudi-arabia"],
  discoveredAt: "2026-08-01T09:00:00.000Z"
};

function buildAppliedRecord(appliedAt = "2026-08-01T09:00:00.000Z"): ApplicationRecord {
  const created = createApplicationRecord({ job, createdAt: "2026-08-01T08:00:00.000Z" });
  return ["screened", "tailored", "ats-passed", "applied"].reduce(
    (record, status) =>
      updateApplicationStatus(record, status as ApplicationRecord["status"], {
        at: appliedAt
      }),
    created
  );
}

test("buildFollowUpPlan schedules the day 3, 7, and 14 ladder from the applied date", () => {
  const plan = buildFollowUpPlan(buildAppliedRecord(), { profile });

  assert.equal(plan.appliedAt, "2026-08-01T09:00:00.000Z");
  assert.deepEqual(
    plan.steps.map((step) => step.offsetDays),
    [3, 7, 14]
  );
  assert.equal(plan.steps[0]?.dueAt, "2026-08-04T09:00:00.000Z");
  assert.match(plan.steps[0]?.message ?? "", /Subject: Venue Operations Manager application/);
  assert.match(plan.steps[2]?.message ?? "", /Closing the loop/);
});

test("buildFollowUpPlan skips records that have not been applied to", () => {
  const plan = buildFollowUpPlan(createApplicationRecord({ job }));

  assert.equal(plan.steps.length, 0);
  assert.match(plan.skippedReason ?? "", /has not reached the applied status/);
});

test("buildFollowUpPlan honours custom offsets and avoids duplicate due dates", () => {
  const { record } = ensureFollowUpLadder(buildAppliedRecord(), { profile, offsetDays: [5] });
  const secondPlan = buildFollowUpPlan(record, { profile, offsetDays: [5, 12] });

  assert.deepEqual(
    secondPlan.steps.map((step) => step.offsetDays),
    [12]
  );
});

test("ensureFollowUpLadder attaches scheduled follow-ups to the record", () => {
  const { record, plan } = ensureFollowUpLadder(buildAppliedRecord(), {
    profile,
    now: "2026-08-01T10:00:00.000Z"
  });

  assert.equal(plan.steps.length, 3);
  assert.equal(record.followUps.length, 3);
  assert.ok(record.followUps.every((followUp) => followUp.status === "scheduled"));
});

test("listDueFollowUps returns only what is due, most overdue first", () => {
  const { record } = ensureFollowUpLadder(buildAppliedRecord(), { profile });
  const due = listDueFollowUps([record], "2026-08-09T09:00:00.000Z");

  assert.equal(due.length, 2);
  assert.equal(due[0]?.overdueDays, 5);
  assert.equal(due[1]?.overdueDays, 1);
});

test("formatDueFollowUpsMarkdown renders drafts and an empty state", () => {
  const { record } = ensureFollowUpLadder(buildAppliedRecord(), { profile });
  const markdown = formatDueFollowUpsMarkdown(listDueFollowUps([record], "2026-08-05T09:00:00.000Z"), {
    generatedAt: "2026-08-05T09:00:00.000Z"
  });

  assert.match(markdown, /# Follow-ups due/);
  assert.match(markdown, /Venue Operations Manager - Example Events/);
  assert.match(markdown, /```text/);

  const empty = formatDueFollowUpsMarkdown([], { generatedAt: "2026-08-05T09:00:00.000Z" });
  assert.match(empty, /Nothing is due right now\./);
});
