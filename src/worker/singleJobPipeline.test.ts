import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { JobPosting } from "../shared/contracts.js";
import { createSqliteStorage } from "../storage/index.js";
import { runSingleJobPipeline } from "./index.js";

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

test("runSingleJobPipeline persists one job flow idempotently", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-pipeline-"));
  const referencePath = join(tempDir, "APPLICATION_REFERENCE.md");
  const storagePath = join(tempDir, "data", "pipeline-store.sqlite");
  const outputDir = join(tempDir, "artifacts", "resumes");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(referencePath, profileReferenceFixture, "utf8");

  const firstRun = await runSingleJobPipeline(siteManagerJob, {
    referencePath,
    storagePath,
    renderOptions: {
      outputDir
    }
  });
  const secondRun = await runSingleJobPipeline(siteManagerJob, {
    referencePath,
    storagePath,
    renderOptions: {
      outputDir
    }
  });
  const storage = createSqliteStorage({ storagePath });
  const snapshot = await storage.readSnapshot();
  const renderedArtifact = await readFile(secondRun.tailoredResume.outputPath ?? "", "utf8");

  assert.equal(firstRun.storagePath, storagePath);
  assert.equal(secondRun.applicationRecord.id, "application:job-site-manager");
  assert.equal(secondRun.applicationRecord.status, "ats-passed");
  assert.ok(firstRun.tailoredResume.outputPath);
  assert.ok(secondRun.tailoredResume.outputPath);
  assert.equal(Object.keys(snapshot.jobs).length, 1);
  assert.equal(Object.keys(snapshot.tailoredResumes).length, 1);
  assert.equal(Object.keys(snapshot.atsAssessments).length, 1);
  assert.equal(Object.keys(snapshot.applicationRecords).length, 1);
  assert.equal(
    snapshot.tailoredResumes[secondRun.tailoredResume.id]?.outputPath,
    secondRun.tailoredResume.outputPath
  );
  assert.deepEqual(
    secondRun.applicationRecord.statusHistory.map((entry) => entry.status),
    ["discovered", "tailored", "ats-passed"]
  );
  assert.match(renderedArtifact, /<h1>Abdullah Fageeh<\/h1>/);
  assert.match(renderedArtifact, /Site Manager \(m\/w\/d\)/);
  assert.match(
    renderedArtifact,
    /Supported venue operations in Formula 1 environments serving 50,000\+ attendees/
  );
});

test("runSingleJobPipeline optionally submits a supervised Greenhouse application after ATS passes", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-pipeline-apply-"));
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

  const result = await runSingleJobPipeline(greenhouseSiteManagerJob, {
    referencePath,
    storagePath,
    renderOptions: {
      outputDir
    },
    applyOptions: {
      mode: "supervised",
      greenhouseJobBoardApiKey: "test-key",
      fetchImpl,
      now: "2026-06-10T08:10:00.000Z"
    }
  });

  assert.equal(getCount, 1);
  assert.equal(postCount, 1);
  assert.equal(result.applicationAttempt?.outcome, "submitted");
  assert.equal(result.applicationRecord.status, "applied");
  assert.equal(result.applicationRecord.submissionAttempts?.length, 1);
});
