import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateProfile, JobPosting } from "../shared/contracts.js";

import { scoreAtsReadiness } from "../ats/index.js";
import { buildTailoredResume } from "../tailor/index.js";
import {
  addApplicationNote,
  addWorkerDecision,
  applySubmissionAttemptToRecord,
  attachAtsAssessmentToRecord,
  attachTailoredResumeToRecord,
  completeFollowUp,
  createApplicationRecord,
  getOutstandingFollowUps,
  scheduleFollowUp,
  updateApplicationStatus
} from "./index.js";

const sampleProfile: CandidateProfile = {
  id: "candidate-seed",
  fullName: "Avery Morgan",
  headline:
    "Installation, production, and site operations leader with delivery experience across complex live-event and venue environments.",
  targetRoleFamilies: [
    "Installation Manager",
    "Production Manager",
    "Site Operations",
    "Site Manager",
    "Venue Operations"
  ],
  certifications: [
    "NEBOSH International General Certificate in Occupational Health and Safety",
    "PMP Certification Training Course",
    "Fundamentals of Artificial Intelligence"
  ],
  coreProofPoints: [
    "6-venue build delivery",
    "100% AutoCAD layout compliance",
    "installations completed 20% ahead of schedule",
    "setup accelerated by 30%",
    "safety incidents reduced by 25%",
    "Formula 1 venue operations supporting 50,000+ attendees"
  ],
  documents: [],
  recurringAnswers: []
};

const siteManagerJob: JobPosting = {
  id: "job-site-manager",
  source: {
    kind: "job-board",
    name: "arbeitsagentur",
    url: "https://example.com/site-manager"
  },
  title: "Site Manager (m/w/d)",
  company: "ISS Integrated Facility Serv. GmbH",
  location: "Hannover, Niedersachsen, Deutschland",
  description:
    "Lead site operations, venue readiness, contractor coordination, health and safety, and live event delivery for a high-footfall environment.",
  detectedRoleFamily: "site-venue-operations",
  tags: ["lane-1", "source:arbeitsagentur", "family:site-venue-operations", "matched-title:site-manager"],
  discoveredAt: "2026-06-09T13:00:00.000Z"
};

const productionManagerJob: JobPosting = {
  id: "job-production-manager",
  source: {
    kind: "job-board",
    name: "arbeitsagentur",
    url: "https://example.com/production-manager"
  },
  title: "Production Manager (m/w/d)",
  company: "Messe Build Systems GmbH",
  location: "Hamburg, Deutschland",
  description:
    "Lead production planning, installation delivery, build execution, and vendor coordination for large-scale event projects.",
  detectedRoleFamily: "production-delivery",
  tags: ["lane-1", "source:arbeitsagentur", "family:production-delivery", "matched-title:production-manager"],
  discoveredAt: "2026-06-09T13:30:00.000Z"
};

test("createApplicationRecord initializes a discover-stage tracker record", () => {
  const record = createApplicationRecord({
    job: siteManagerJob,
    note: "Discovered from lane 1 search."
  });

  assert.equal(record.id, "application:job-site-manager");
  assert.equal(record.status, "discovered");
  assert.equal(record.jobTitle, siteManagerJob.title);
  assert.equal(record.company, siteManagerJob.company);
  assert.equal(record.notes.length, 1);
  assert.equal(record.statusHistory.length, 1);
  assert.equal(record.statusHistory[0].status, "discovered");
  assert.equal(record.followUps.length, 0);
});

test("tracker record advances through tailored and ATS-passed states", () => {
  const baseRecord = createApplicationRecord({ job: siteManagerJob });
  const tailoredResume = buildTailoredResume(sampleProfile, siteManagerJob);
  const atsAssessment = scoreAtsReadiness(siteManagerJob, tailoredResume);

  const tailoredRecord = attachTailoredResumeToRecord(baseRecord, tailoredResume);
  const passedRecord = attachAtsAssessmentToRecord(tailoredRecord, atsAssessment);

  assert.equal(tailoredRecord.status, "tailored");
  assert.equal(tailoredRecord.resumeId, tailoredResume.id);
  assert.equal(passedRecord.status, "ats-passed");
  assert.equal(passedRecord.atsScore, atsAssessment.score);
  assert.deepEqual(
    passedRecord.statusHistory.map((entry) => entry.status),
    ["discovered", "tailored", "ats-passed"]
  );
});

test("applySubmissionAttemptToRecord only advances to applied after a submitted attempt", () => {
  const baseRecord = createApplicationRecord({ job: siteManagerJob });
  const atsReadyRecord = updateApplicationStatus(
    updateApplicationStatus(baseRecord, "tailored", {
      at: "2026-06-10T10:00:00.000Z",
      reason: "Tailored resume attached."
    }),
    "ats-passed",
    {
      at: "2026-06-10T10:01:00.000Z",
      reason: "ATS threshold met with score 88."
    }
  );
  const reviewRecord = applySubmissionAttemptToRecord(atsReadyRecord, {
    id: "application:job-site-manager:submission:1",
    attemptedAt: "2026-06-10T10:05:00.000Z",
    mode: "supervised",
    platform: "greenhouse",
    outcome: "review-needed",
    method: "manual-review",
    targetUrl: "https://boards.greenhouse.io/acme/jobs/1234567",
    uploadedDocuments: [],
    failureReason: "Missing required location answer."
  });
  const submittedRecord = applySubmissionAttemptToRecord(reviewRecord, {
    id: "application:job-site-manager:submission:2",
    attemptedAt: "2026-06-10T10:10:00.000Z",
    mode: "supervised",
    platform: "greenhouse",
    outcome: "submitted",
    method: "greenhouse-job-board-api",
    targetUrl: "https://boards.greenhouse.io/acme/jobs/1234567",
    uploadedDocuments: [],
    confirmationMessage: "Application received."
  });

  assert.equal(reviewRecord.status, "ats-passed");
  assert.equal(reviewRecord.submissionAttempts?.length, 1);
  assert.equal(submittedRecord.status, "applied");
  assert.equal(submittedRecord.submissionAttempts?.length, 2);
  assert.equal(
    submittedRecord.statusHistory[submittedRecord.statusHistory.length - 1]?.status,
    "applied"
  );
});

test("tracker record stores notes, worker decisions, and follow-up lifecycle", () => {
  const baseRecord = createApplicationRecord({ job: siteManagerJob });
  const withStatus = updateApplicationStatus(baseRecord, "screened", {
    at: "2026-06-10T10:00:00.000Z",
    reason: "Initial screening complete."
  });
  const withNote = addApplicationNote(withStatus, "Needs manual review before apply.", {
    at: "2026-06-10T10:05:00.000Z"
  });
  const withDecision = addWorkerDecision(withNote, "Paused auto-apply until recruiter details are verified.", {
    at: "2026-06-10T10:06:00.000Z"
  });
  const withFollowUp = scheduleFollowUp(withDecision, {
    dueAt: "2026-06-12T09:00:00.000Z",
    reason: "Check for recruiter contact details.",
    createdAt: "2026-06-10T10:07:00.000Z"
  });
  const outstanding = getOutstandingFollowUps(withFollowUp, "2026-06-11T09:00:00.000Z");
  const completed = completeFollowUp(withFollowUp, withFollowUp.followUps[0].id, {
    completedAt: "2026-06-12T09:05:00.000Z",
    note: "Checked company page and LinkedIn."
  });

  assert.equal(withNote.notes.length, 1);
  assert.equal(withDecision.workerDecisions.length, 1);
  assert.equal(outstanding.length, 1);
  assert.equal(completed.followUps[0].status, "completed");
  assert.equal(completed.followUps[0].note, "Checked company page and LinkedIn.");
});

test("getOutstandingFollowUps keeps overdue scheduled follow-ups visible", () => {
  const baseRecord = createApplicationRecord({ job: siteManagerJob });
  const withFutureFollowUp = scheduleFollowUp(baseRecord, {
    dueAt: "2026-06-12T09:00:00.000Z",
    reason: "Check recruiter contact details.",
    createdAt: "2026-06-10T10:07:00.000Z"
  });
  const withOverdueFollowUp = scheduleFollowUp(withFutureFollowUp, {
    dueAt: "2026-06-10T08:30:00.000Z",
    reason: "Review overdue application handoff.",
    createdAt: "2026-06-09T10:07:00.000Z"
  });

  const outstanding = getOutstandingFollowUps(withOverdueFollowUp, "2026-06-11T09:00:00.000Z");

  assert.deepEqual(
    outstanding.map((followUp) => followUp.reason),
    ["Review overdue application handoff.", "Check recruiter contact details."]
  );
});

test("tracker record rejects resume and ATS assessment from a different job", () => {
  const baseRecord = createApplicationRecord({ job: siteManagerJob });
  const tailoredResume = buildTailoredResume(sampleProfile, productionManagerJob);
  const atsAssessment = scoreAtsReadiness(productionManagerJob, tailoredResume);

  assert.throws(
    () => attachTailoredResumeToRecord(baseRecord, tailoredResume),
    /Cannot attach tailored resume/
  );
  assert.throws(
    () => attachAtsAssessmentToRecord(baseRecord, atsAssessment),
    /Cannot attach ATS assessment/
  );
});
