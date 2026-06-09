import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ApplicationRecord,
  AtsAssessment,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";
import { createFileBackedStorage } from "./index.js";

const sampleJob: JobPosting = {
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
  tags: ["lane-1", "source:arbeitsagentur", "family:site-venue-operations"],
  discoveredAt: "2026-06-09T13:00:00.000Z"
};

const sampleResume: TailoredResume = {
  id: "job-site-manager:tailored",
  jobId: sampleJob.id,
  variantName: "Site Manager (m/w/d) at ISS Integrated Facility Serv. GmbH",
  generatedAt: "2026-06-09T13:05:00.000Z",
  evidenceUsed: ["Delivered installation and build execution across 6 venues"],
  matchedKeywords: ["site", "operations", "health", "safety"],
  tailoredHeadline: "Installation Manager | Production Manager | Site Operations",
  tailoredSummary:
    "Focused on Site Manager opportunities with strongest fit across Site Operations and Venue Operations.",
  selectedRoleFamilies: ["Site Operations", "Venue Operations"],
  selectedProofPoints: [
    "Delivered installation and build execution across 6 venues",
    "Reduced safety incidents by 25% through inspections and compliance enforcement"
  ],
  selectedCertifications: ["NEBOSH International General Certificate in Occupational Health and Safety (2024)"],
  sections: [
    {
      key: "summary",
      title: "Tailored Summary",
      lines: ["Focused on Site Manager opportunities with strongest fit across Site Operations and Venue Operations."]
    }
  ],
  evidenceTrail: [
    {
      kind: "proof-point",
      value: "Delivered installation and build execution across 6 venues",
      score: 42,
      matchedKeywords: ["site", "operations"]
    }
  ]
};

const sampleAssessment: AtsAssessment = {
  id: "job-site-manager:tailored:ats",
  jobId: sampleJob.id,
  score: 84,
  passed: true,
  blockingIssues: [],
  suggestions: [],
  threshold: 80,
  missingKeywords: [],
  componentScores: [
    {
      key: "keyword-coverage",
      label: "Keyword Coverage",
      score: 29,
      maxScore: 35,
      notes: ["Matched 5 of 6 keywords."]
    }
  ],
  assessedAt: "2026-06-09T13:06:00.000Z"
};

const sampleApplicationRecord: ApplicationRecord = {
  id: "application:job-site-manager",
  jobId: sampleJob.id,
  jobTitle: sampleJob.title,
  company: sampleJob.company,
  sourceName: sampleJob.source.name,
  location: sampleJob.location,
  sourceUrl: sampleJob.source.url,
  status: "ats-passed",
  atsScore: sampleAssessment.score,
  resumeId: sampleResume.id,
  notes: [],
  workerDecisions: [],
  statusHistory: [
    {
      status: "discovered",
      changedAt: "2026-06-09T13:00:00.000Z",
      reason: "Application record created."
    },
    {
      status: "tailored",
      changedAt: "2026-06-09T13:05:00.000Z",
      reason: "Tailored resume attached."
    },
    {
      status: "ats-passed",
      changedAt: "2026-06-09T13:06:00.000Z",
      reason: "ATS threshold met with score 84."
    }
  ],
  followUps: [],
  createdAt: "2026-06-09T13:00:00.000Z",
  updatedAt: "2026-06-09T13:06:00.000Z"
};

test("file-backed storage persists core pipeline artifacts across instances", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-storage-"));
  const storagePath = join(tempDir, "pipeline-store.json");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const firstStorage = createFileBackedStorage({ storagePath });

  await firstStorage.upsertJobPosting(sampleJob);
  await firstStorage.upsertTailoredResume(sampleResume);
  await firstStorage.upsertAtsAssessment(sampleAssessment);
  await firstStorage.upsertApplicationRecord(sampleApplicationRecord);

  const secondStorage = createFileBackedStorage({ storagePath });
  const snapshot = await secondStorage.readSnapshot();

  assert.equal(Object.keys(snapshot.jobs).length, 1);
  assert.equal(Object.keys(snapshot.tailoredResumes).length, 1);
  assert.equal(Object.keys(snapshot.atsAssessments).length, 1);
  assert.equal(Object.keys(snapshot.applicationRecords).length, 1);
  assert.deepEqual(await secondStorage.getJobPosting(sampleJob.id), sampleJob);
  assert.deepEqual(await secondStorage.getTailoredResume(sampleResume.id), sampleResume);
  assert.deepEqual(await secondStorage.getAtsAssessment(sampleAssessment.id), sampleAssessment);
  assert.deepEqual(
    await secondStorage.getApplicationRecord(sampleApplicationRecord.id),
    sampleApplicationRecord
  );
  assert.deepEqual(
    await secondStorage.getApplicationRecordByJobId(sampleJob.id),
    sampleApplicationRecord
  );
});
