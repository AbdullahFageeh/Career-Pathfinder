import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { JobPosting } from "../shared/contracts.js";
import { createSqliteStorage } from "../storage/index.js";
import {
  enqueueSingleJobPipelineRun,
  runPipelineQueueOnce
} from "./index.js";

const profileReferenceFixture = `# Job Application Reference
## Identity and contact
- Full legal name: Abdullah Fageeh
- Preferred display name: Abdullah Fageeh

## Professional headline
- Default headline: Installation Manager | Production Manager | Site Operations
- Target role families:
  - Installation Manager
  - Production Manager
  - Site Operations
  - Site Manager
  - Venue Operations

## Common screening answers
- Health and safety summary: NEBOSH International General Certificate in Occupational Health and Safety (2024)
- Project management summary: PMP Certification Training Course (2024)
- AI / digital skills summary: Fundamentals of Artificial Intelligence, SDAIA (2025)

## Core proof points
- Delivered installation and build execution across 6 venues
- Maintained 100% AutoCAD layout compliance
- Completed installations 20% ahead of schedule
- Accelerated setup by 30% on deadline-driven projects
- Reduced safety incidents by 25% through inspections and compliance enforcement
- Supported venue operations in Formula 1 environments serving 50,000+ attendees

## Certifications
- NEBOSH International General Certificate in Occupational Health and Safety (2024)
- PMP Certification Training Course (2024)
- Fundamentals of Artificial Intelligence, SDAIA (2025)

## Documents and file references
- Master CV PDF: /Users/abdullah/Downloads/Abdullah_Fageeh_CV_26.pdf
`;

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

test("runPipelineQueueOnce processes a queued job through ingest, tailor, render, and score", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-queue-worker-"));
  const referencePath = join(tempDir, "APPLICATION_REFERENCE.md");
  const storagePath = join(tempDir, "data", "pipeline-store.sqlite");
  const outputDir = join(tempDir, "artifacts", "resumes");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(referencePath, profileReferenceFixture, "utf8");

  const firstQueuedJob = await enqueueSingleJobPipelineRun(siteManagerJob, {
    storagePath,
    referencePath,
    renderOutputDir: outputDir
  });
  const secondQueuedJob = await enqueueSingleJobPipelineRun(siteManagerJob, {
    storagePath,
    referencePath,
    renderOutputDir: outputDir
  });
  assert.equal(firstQueuedJob.id, "queue:job-site-manager:run-1:ingest");
  assert.equal(firstQueuedJob.runNumber, 1);
  assert.equal(secondQueuedJob.id, firstQueuedJob.id);

  const firstRun = await runPipelineQueueOnce({
    storagePath,
    workerId: "worker:test"
  });
  const secondRun = await runPipelineQueueOnce({
    storagePath,
    workerId: "worker:test-second"
  });
  const storage = createSqliteStorage({ storagePath });
  const snapshot = await storage.readSnapshot();
  const applicationRecord = await storage.getApplicationRecordByJobId(siteManagerJob.id);
  const renderedArtifact = await readFile(
    snapshot.tailoredResumes["job-site-manager:tailored"]?.outputPath ?? "",
    "utf8"
  );

  assert.equal(firstRun.claimed, 4);
  assert.equal(firstRun.completed, 4);
  assert.equal(firstRun.failed, 0);
  assert.equal(firstRun.deadLettered, 0);
  assert.equal(firstRun.remaining, 0);
  assert.equal(secondRun.claimed, 0);
  assert.equal(applicationRecord?.status, "ats-passed");
  assert.deepEqual(
    Object.values(snapshot.queueJobs)
      .map((queueJob) => queueJob.stage)
      .sort(),
    ["ingest", "render", "score-ats", "tailor"]
  );
  assert.ok(Object.values(snapshot.queueJobs).every((queueJob) => queueJob.state === "completed"));
  assert.match(renderedArtifact, /<h1>Abdullah Fageeh<\/h1>/);
  assert.match(renderedArtifact, /Site Manager \(m\/w\/d\)/);
});

test("enqueueSingleJobPipelineRun allows a completed job to be re-enqueued as a new run", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-queue-rerun-"));
  const referencePath = join(tempDir, "APPLICATION_REFERENCE.md");
  const storagePath = join(tempDir, "data", "pipeline-store.sqlite");
  const outputDir = join(tempDir, "artifacts", "resumes");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(referencePath, profileReferenceFixture, "utf8");

  await enqueueSingleJobPipelineRun(siteManagerJob, {
    storagePath,
    referencePath,
    renderOutputDir: outputDir
  });
  const firstRun = await runPipelineQueueOnce({
    storagePath,
    workerId: "worker:first-run"
  });
  const rerunQueueJob = await enqueueSingleJobPipelineRun(siteManagerJob, {
    storagePath,
    referencePath,
    renderOutputDir: outputDir
  });
  const secondRun = await runPipelineQueueOnce({
    storagePath,
    workerId: "worker:second-run"
  });
  const storage = createSqliteStorage({ storagePath });
  const snapshot = await storage.readSnapshot();

  assert.equal(firstRun.claimed, 4);
  assert.equal(firstRun.completed, 4);
  assert.equal(rerunQueueJob.id, "queue:job-site-manager:run-2:ingest");
  assert.equal(rerunQueueJob.runNumber, 2);
  assert.equal(secondRun.claimed, 4);
  assert.equal(secondRun.completed, 4);
  assert.equal(Object.keys(snapshot.queueJobs).length, 8);
  assert.deepEqual(
    Object.values(snapshot.queueJobs)
      .filter((queueJob) => queueJob.stage === "ingest")
      .map((queueJob) => queueJob.runNumber)
      .sort((left, right) => left - right),
    [1, 2]
  );
  assert.ok(Object.values(snapshot.queueJobs).every((queueJob) => queueJob.state === "completed"));
});
