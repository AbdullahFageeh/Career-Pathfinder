import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApplicationRecord,
  ApplicationSubmissionAttempt,
  AtsAssessment,
  JobPosting,
  QueueJob,
  TailoredResume
} from "../shared/contracts.js";
import type {
  PipelineQueueRunResult,
  SingleJobPipelineResult
} from "../worker/index.js";
import { runCli } from "./index.js";

const sampleJob: JobPosting = {
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

const sampleResume: TailoredResume = {
  id: "job-greenhouse-site-manager:tailored",
  jobId: sampleJob.id,
  variantName: "Site Manager at Acme Events",
  generatedAt: "2026-06-10T08:05:00.000Z",
  outputPath: "/tmp/job-greenhouse-site-manager.html",
  evidenceUsed: ["Delivered installation and build execution across 6 venues"],
  matchedKeywords: ["site", "operations"],
  tailoredHeadline: "Installation Manager | Site Operations",
  tailoredSummary:
    "Focused on site delivery, venue readiness, and contractor coordination for complex live environments.",
  selectedRoleFamilies: ["Site Operations"],
  selectedProofPoints: ["Delivered installation and build execution across 6 venues"],
  selectedCertifications: ["NEBOSH International General Certificate in Occupational Health and Safety (2024)"],
  sections: [
    {
      key: "summary",
      title: "Tailored Summary",
      lines: [
        "Focused on site delivery, venue readiness, and contractor coordination for complex live environments."
      ]
    }
  ],
  evidenceTrail: [
    {
      kind: "proof-point",
      value: "Delivered installation and build execution across 6 venues",
      score: 22,
      matchedKeywords: ["site", "operations"]
    }
  ]
};

const sampleAssessment: AtsAssessment = {
  id: "job-greenhouse-site-manager:tailored:ats",
  jobId: sampleJob.id,
  score: 88,
  passed: true,
  blockingIssues: [],
  suggestions: [],
  threshold: 80,
  missingKeywords: [],
  componentScores: [],
  assessedAt: "2026-06-10T08:06:00.000Z"
};

const sampleAttempt: ApplicationSubmissionAttempt = {
  id: "application:job-greenhouse-site-manager:submission:1",
  attemptedAt: "2026-06-10T08:10:00.000Z",
  mode: "supervised",
  platform: "greenhouse",
  outcome: "submitted",
  method: "greenhouse-job-board-api",
  targetUrl: "https://boards.greenhouse.io/acme/jobs/1234567?gh_src=test-source",
  submissionUrl: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1234567",
  uploadedDocuments: [],
  responseStatus: 200,
  confirmationMessage: "Application received."
};

const sampleApplicationRecord: ApplicationRecord = {
  id: "application:job-greenhouse-site-manager",
  jobId: sampleJob.id,
  jobTitle: sampleJob.title,
  company: sampleJob.company,
  sourceName: sampleJob.source.name,
  location: sampleJob.location,
  sourceUrl: sampleJob.source.url,
  applicationUrl: sampleJob.applicationTarget?.url,
  applicationPlatform: "greenhouse",
  status: "applied",
  atsScore: sampleAssessment.score,
  resumeId: sampleResume.id,
  notes: [],
  workerDecisions: [],
  statusHistory: [
    {
      status: "discovered",
      changedAt: "2026-06-10T08:00:00.000Z",
      reason: "Application record created."
    },
    {
      status: "tailored",
      changedAt: "2026-06-10T08:05:00.000Z",
      reason: "Tailored resume attached."
    },
    {
      status: "ats-passed",
      changedAt: "2026-06-10T08:06:00.000Z",
      reason: "ATS threshold met with score 88."
    },
    {
      status: "applied",
      changedAt: "2026-06-10T08:10:00.000Z",
      reason: "Application received."
    }
  ],
  followUps: [],
  submissionAttempts: [sampleAttempt],
  createdAt: "2026-06-10T08:00:00.000Z",
  updatedAt: "2026-06-10T08:10:00.000Z"
};

test("runCli pipeline:single forwards apply options and prints an apply summary", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let capturedInput: unknown;
  let capturedOptions: unknown;
  const result: SingleJobPipelineResult = {
    job: sampleJob,
    profile: {
      id: "abdullah-seed",
      fullName: "Abdullah Fageeh",
      headline: "Installation Manager | Site Operations",
      targetRoleFamilies: ["Site Operations"],
      certifications: [],
      coreProofPoints: [],
      documents: [],
      recurringAnswers: []
    },
    tailoredResume: sampleResume,
    atsAssessment: sampleAssessment,
    applicationRecord: sampleApplicationRecord,
    applicationAttempt: sampleAttempt,
    storagePath: "/tmp/pipeline-store.sqlite"
  };

  const exitCode = await runCli(
    [
      "pipeline:single",
      "--input",
      "fixtures/job.json",
      "--reference-path",
      "APPLICATION_REFERENCE.md",
      "--storage-path",
      "data/pipeline-store.sqlite",
      "--render-output-dir",
      "artifacts/resumes",
      "--profile-id",
      "abdullah",
      "--apply-mode",
      "supervised",
      "--gdpr-consent",
      "--gdpr-processing-consent"
    ],
    {
      readEnv: () => "configured",
      readTextFile: async () => JSON.stringify(sampleJob),
      runSingleJobPipeline: async (input, options) => {
        capturedInput = input;
        capturedOptions = options;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(capturedInput, sampleJob);
  assert.deepEqual(capturedOptions, {
    storagePath: "/Users/abdullah/Downloads/Job project/data/pipeline-store.sqlite",
    referencePath: "/Users/abdullah/Downloads/Job project/APPLICATION_REFERENCE.md",
    profileId: "abdullah",
    renderOptions: {
      outputDir: "/Users/abdullah/Downloads/Job project/artifacts/resumes"
    },
    applyOptions: {
      mode: "supervised",
      dataConsent: {
        gdprConsentGiven: true,
        gdprProcessingConsentGiven: true,
        gdprRetentionConsentGiven: undefined
      }
    }
  });
  assert.equal(stderr.length, 0);
  assert.equal(stdout.length, 1);
  assert.match(stdout[0] ?? "", /Single job pipeline complete\./);
  assert.match(stdout[0] ?? "", /- apply outcome: submitted/);
  assert.match(stdout[0] ?? "", /- apply confirmation: Application received\./);
});

test("runCli queue:single forwards supervised apply settings into the durable queue", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let capturedInput: unknown;
  let capturedOptions: unknown;
  const queueJob: QueueJob = {
    id: "queue:job-greenhouse-site-manager:run-1:ingest",
    runNumber: 1,
    jobId: sampleJob.id,
    applicationId: sampleApplicationRecord.id,
    stage: "ingest",
    state: "pending",
    attempts: 0,
    maxAttempts: 3,
    idempotencyKey: "pipeline:job-greenhouse-site-manager:run-1:ingest",
    payload: {},
    scheduledFor: "2026-06-10T08:00:00.000Z",
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:00:00.000Z"
  };

  const exitCode = await runCli(
    [
      "queue:single",
      "--input",
      "fixtures/job.json",
      "--reference-path",
      "APPLICATION_REFERENCE.md",
      "--storage-path",
      "data/pipeline-store.sqlite",
      "--render-output-dir",
      "artifacts/resumes",
      "--apply-mode",
      "supervised",
      "--gdpr-consent"
    ],
    {
      readTextFile: async () => JSON.stringify(sampleJob),
      enqueueSingleJobPipelineRun: async (input, options) => {
        capturedInput = input;
        capturedOptions = options;
        return queueJob;
      }
    },
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(capturedInput, sampleJob);
  assert.deepEqual(capturedOptions, {
    storagePath: "/Users/abdullah/Downloads/Job project/data/pipeline-store.sqlite",
    referencePath: "/Users/abdullah/Downloads/Job project/APPLICATION_REFERENCE.md",
    profileId: undefined,
    renderOutputDir: "/Users/abdullah/Downloads/Job project/artifacts/resumes",
    applyMode: "supervised",
    dataConsent: {
      gdprConsentGiven: true,
      gdprProcessingConsentGiven: undefined,
      gdprRetentionConsentGiven: undefined
    }
  });
  assert.equal(stderr.length, 0);
  assert.match(stdout[0] ?? "", /Single job queued\./);
  assert.match(stdout[0] ?? "", /set GREENHOUSE_JOB_BOARD_API_KEY before running worker:once/);
});

test("runCli worker:once forwards numeric worker options and prints the worker summary", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let capturedOptions: unknown;
  const workerResult: PipelineQueueRunResult = {
    workerId: "worker:test",
    claimed: 5,
    completed: 5,
    failed: 0,
    deadLettered: 0,
    remaining: 0
  };

  const exitCode = await runCli(
    [
      "worker:once",
      "--storage-path",
      "data/pipeline-store.sqlite",
      "--worker-id",
      "worker:test",
      "--max-jobs",
      "5",
      "--lease-duration-ms",
      "1000",
      "--retry-delay-ms",
      "2500"
    ],
    {
      runPipelineQueueOnce: async (options) => {
        capturedOptions = options;
        return workerResult;
      }
    },
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(capturedOptions, {
    storagePath: "/Users/abdullah/Downloads/Job project/data/pipeline-store.sqlite",
    workerId: "worker:test",
    maxJobs: 5,
    leaseDurationMs: 1000,
    retryDelayMs: 2500
  });
  assert.equal(stderr.length, 0);
  assert.match(stdout[0] ?? "", /Pipeline queue worker run complete\./);
  assert.match(stdout[0] ?? "", /- claimed: 5/);
});
