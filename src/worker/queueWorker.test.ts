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
- Master CV PDF: /Users/abdullah/Desktop/Abdullah_Fageeh_CV_2026.pdf
`;

function createApplyReadyProfileReferenceFixture(resumePath: string): string {
  return `# Job Application Reference
## Identity and contact
- Full legal name: Abdullah Fageeh
- Preferred display name: Abdullah Fageeh
- Email: abdullah@example.com
- Phone: +49 123 4567

## Professional headline
- Default headline: Installation Manager | Production Manager | Site Operations
- Target role families:
  - Installation Manager
  - Production Manager
  - Site Operations
  - Site Manager
  - Venue Operations

## Common screening answers
- Work authorization: Yes

## Core proof points
- Delivered installation and build execution across 6 venues
- Maintained 100% AutoCAD layout compliance
- Completed installations 20% ahead of schedule

## Certifications
- NEBOSH International General Certificate in Occupational Health and Safety (2024)

## Documents and file references
- Master CV PDF: ${resumePath}
`;
}

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

const greenhouseSiteManagerJob: JobPosting = {
  id: "job-greenhouse-site-manager",
  source: {
    kind: "job-board",
    name: "greenhouse",
    url: "https://boards.greenhouse.io/acme/jobs/1234567?gh_src=test-source"
  },
  title: "Site Manager",
  company: "Acme Events",
  location: "Berlin, Germany",
  description:
    "Lead site setup, contractor coordination, event readiness, and operational delivery.",
  detectedRoleFamily: "site-venue-operations",
  applicationTarget: {
    platform: "greenhouse",
    url: "https://boards.greenhouse.io/acme/jobs/1234567?gh_src=test-source",
    boardToken: "acme",
    jobId: "1234567"
  },
  tags: ["source:greenhouse", "family:site-venue-operations"],
  discoveredAt: "2026-06-10T08:00:00.000Z"
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

test("runPipelineQueueOnce optionally processes the apply stage after ATS scoring", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-queue-apply-"));
  const referencePath = join(tempDir, "APPLICATION_REFERENCE.md");
  const storagePath = join(tempDir, "data", "pipeline-store.sqlite");
  const outputDir = join(tempDir, "artifacts", "resumes");
  const resumePath = join(tempDir, "Abdullah_Fageeh_CV.pdf");
  let getCount = 0;
  let postCount = 0;

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(referencePath, createApplyReadyProfileReferenceFixture(resumePath), "utf8");
  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";

    if (method === "POST") {
      postCount += 1;
      const body = init?.body;

      assert.ok(body instanceof FormData);
      assert.equal(body.get("first_name"), "Abdullah");
      assert.equal(body.get("work_authorization"), "yes");
      assert.ok(body.get("resume") instanceof File);

      return new Response(
        JSON.stringify({
          status: "ok",
          message: "Application received."
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    getCount += 1;
    assert.match(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      /questions=true/
    );

    return new Response(
      JSON.stringify({
        questions: [
          {
            label: "First Name",
            required: true,
            fields: [{ name: "first_name", type: "input_text" }]
          },
          {
            label: "Last Name",
            required: true,
            fields: [{ name: "last_name", type: "input_text" }]
          },
          {
            label: "Email",
            required: true,
            fields: [{ name: "email", type: "input_text" }]
          },
          {
            label: "Resume/CV",
            required: true,
            fields: [{ name: "resume", type: "input_file" }]
          },
          {
            label: "Work authorization",
            required: true,
            fields: [
              {
                name: "work_authorization",
                type: "multi_value_single_select",
                values: [
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" }
                ]
              }
            ]
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  };

  await enqueueSingleJobPipelineRun(greenhouseSiteManagerJob, {
    at: "2026-06-10T08:00:00.000Z",
    storagePath,
    referencePath,
    renderOutputDir: outputDir,
    applyMode: "supervised"
  });

  const run = await runPipelineQueueOnce({
    storagePath,
    workerId: "worker:apply",
    greenhouseJobBoardApiKey: "test-key",
    applyFetchImpl: fetchImpl
  });
  const storage = createSqliteStorage({ storagePath });
  const snapshot = await storage.readSnapshot();
  const applicationRecord = await storage.getApplicationRecordByJobId(greenhouseSiteManagerJob.id);

  assert.equal(getCount, 1);
  assert.equal(postCount, 1);
  assert.equal(run.claimed, 5);
  assert.equal(run.completed, 5);
  assert.equal(run.remaining, 0);
  assert.equal(applicationRecord?.status, "applied");
  assert.equal(applicationRecord?.submissionAttempts?.length, 1);
  assert.deepEqual(
    Object.values(snapshot.queueJobs)
      .map((queueJob) => queueJob.stage)
      .sort(),
    ["apply", "ingest", "render", "score-ats", "tailor"]
  );
});


test("enqueueSingleJobPipelineRun returns the active downstream stage instead of starting a duplicate run", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-queue-downstream-dedupe-"));
  const referencePath = join(tempDir, "APPLICATION_REFERENCE.md");
  const storagePath = join(tempDir, "data", "pipeline-store.sqlite");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(referencePath, profileReferenceFixture, "utf8");
  await enqueueSingleJobPipelineRun(siteManagerJob, { storagePath, referencePath });
  await runPipelineQueueOnce({ storagePath, workerId: "worker:ingest-only", maxJobs: 1 });

  const active = await enqueueSingleJobPipelineRun(siteManagerJob, { storagePath, referencePath });

  assert.equal(active.id, "queue:job-site-manager:run-1:tailor");
  assert.equal(active.stage, "tailor");
});

test("enqueueSingleJobPipelineRun persists explicit full-auto authorization in the queue payload", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-queue-full-auto-"));
  const storagePath = join(tempDir, "data", "pipeline-store.sqlite");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const queueJob = await enqueueSingleJobPipelineRun(siteManagerJob, {
    storagePath,
    applyMode: "full-auto",
    allowFullAutoSubmission: true
  });

  assert.equal(queueJob.payload?.allowFullAutoSubmission, true);
});
