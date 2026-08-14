import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CandidateProfile, JobPosting, TailoredResume } from "../shared/contracts.js";
import { createApplicationRecord, updateApplicationStatus } from "../tracker/index.js";
import {
  prepareJobApplicationSubmission,
  submitJobApplication
} from "./index.js";

const greenhouseJob: JobPosting = {
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

const tailoredResume: TailoredResume = {
  id: "job-greenhouse-site-manager:tailored",
  jobId: greenhouseJob.id,
  variantName: "Site Manager at Acme Events",
  generatedAt: "2026-06-10T08:05:00.000Z",
  evidenceUsed: ["Delivered installation and build execution across 6 venues"],
  matchedKeywords: ["site", "operations", "delivery"],
  tailoredHeadline: "Installation Manager | Site Operations",
  tailoredSummary:
    "Focused on site delivery, venue readiness, and contractor coordination for complex live environments.",
  selectedRoleFamilies: ["Site Operations", "Venue Operations"],
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
      score: 24,
      matchedKeywords: ["site", "delivery"]
    }
  ]
};

test("prepareJobApplicationSubmission falls back to review when the Greenhouse API key is missing", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-prepare-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const record = createAtsReadyRecord(greenhouseJob);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const result = await prepareJobApplicationSubmission(
    greenhouseJob,
    record,
    profile,
    tailoredResume,
    {
      mode: "supervised",
      now: "2026-06-10T08:10:00.000Z"
    }
  );

  assert.equal(result.ready, false);
  if (result.ready) {
    return;
  }

  assert.equal(result.attempt.outcome, "review-needed");
  assert.match(result.reason, /GREENHOUSE_JOB_BOARD_API_KEY/);
  assert.equal(result.attempt.platform, "unsupported");
});

test("prepareJobApplicationSubmission builds a ready Greenhouse request when required data is available", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-ready-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const record = createAtsReadyRecord(greenhouseJob);
  let getCount = 0;

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async (input) => {
    getCount += 1;
    assert.match(readRequestUrl(input), /questions=true/);

    return jsonResponse({
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
          label: "Phone",
          required: false,
          fields: [{ name: "phone", type: "input_text" }]
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
        },
        {
          label: "Why are you a fit for this role",
          required: false,
          fields: [{ name: "why_fit", type: "textarea" }]
        }
      ],
      data_compliance: [
        {
          requires_consent: true,
          requires_processing_consent: true
        }
      ]
    });
  };

  const result = await prepareJobApplicationSubmission(
    greenhouseJob,
    record,
    profile,
    tailoredResume,
    {
      mode: "supervised",
      greenhouseJobBoardApiKey: "test-key",
      dataConsent: {
        gdprConsentGiven: true,
        gdprProcessingConsentGiven: true
      },
      fetchImpl,
      now: "2026-06-10T08:10:00.000Z"
    }
  );

  assert.equal(getCount, 1);
  assert.equal(result.ready, true);
  if (!result.ready) {
    return;
  }

  assert.equal(result.prepared.platform, "greenhouse");
  assert.equal(result.prepared.uploadedDocuments[0]?.path, resumePath);
  assert.equal(readFieldValue(result.prepared.fields, "first_name"), "Abdullah");
  assert.equal(readFieldValue(result.prepared.fields, "last_name"), "Fageeh");
  assert.equal(readFieldValue(result.prepared.fields, "email"), "abdullah@example.com");
  assert.equal(readFieldValue(result.prepared.fields, "work_authorization"), "yes");
  assert.equal(readFieldValue(result.prepared.fields, "why_fit"), tailoredResume.tailoredSummary);
  assert.equal(readFieldValue(result.prepared.fields, "mapped_url_token"), "test-source");
  assert.equal(readFieldValue(result.prepared.fields, "data_compliance[gdpr_consent_given]"), "true");
});

test("prepareJobApplicationSubmission skips an optional multi-field cover letter question", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-cover-letter-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const record = createAtsReadyRecord(greenhouseJob);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
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
          label: "Cover Letter",
          required: false,
          fields: [
            { name: "cover_letter", type: "input_file" },
            { name: "cover_letter_text", type: "textarea" }
          ]
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
    });

  const result = await prepareJobApplicationSubmission(
    greenhouseJob,
    record,
    profile,
    tailoredResume,
    {
      mode: "supervised",
      greenhouseJobBoardApiKey: "test-key",
      fetchImpl,
      now: "2026-06-10T08:10:00.000Z"
    }
  );

  assert.equal(result.ready, true);
  if (!result.ready) {
    return;
  }

  assert.equal(readFieldValue(result.prepared.fields, "cover_letter"), undefined);
  assert.equal(readFieldValue(result.prepared.fields, "cover_letter_text"), undefined);
});

test("prepareJobApplicationSubmission accepts a multi-select option label that contains a comma", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-multi-select-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = {
    ...createCandidateProfile(resumePath),
    recurringAnswers: [
      ...createCandidateProfile(resumePath).recurringAnswers,
      {
        key: "information-on-data-protection",
        question: "Information on data protection",
        answer: "Yes, I acknowledge.",
        source: {
          kind: "manual" as const,
          reference: "APPLICATION_REFERENCE.md"
        }
      }
    ]
  };
  const record = createAtsReadyRecord(greenhouseJob);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
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
          label: "Information on data protection\n",
          required: true,
          fields: [
            {
              name: "question_8710119101[]",
              type: "multi_value_multi_select",
              values: [{ label: "Yes, I acknowledge.", value: 60166509101 }]
            }
          ]
        }
      ]
    });

  const result = await prepareJobApplicationSubmission(
    greenhouseJob,
    record,
    profile,
    tailoredResume,
    {
      mode: "supervised",
      greenhouseJobBoardApiKey: "test-key",
      fetchImpl,
      now: "2026-06-10T08:10:00.000Z"
    }
  );

  assert.equal(result.ready, true);
  if (!result.ready) {
    return;
  }

  assert.deepEqual(readFieldValue(result.prepared.fields, "question_8710119101[]"), ["60166509101"]);
});

test("prepareJobApplicationSubmission allows a retry after a review-needed attempt", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-retry-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const recordWithReviewNeededAttempt = {
    ...createAtsReadyRecord(greenhouseJob),
    submissionAttempts: [
      {
        id: "application:job-greenhouse-site-manager:submission:1",
        attemptedAt: "2026-06-10T08:08:00.000Z",
        mode: "supervised" as const,
        platform: "greenhouse" as const,
        outcome: "review-needed" as const,
        method: "manual-review" as const,
        targetUrl: greenhouseJob.applicationTarget?.url ?? greenhouseJob.source.url ?? "unknown",
        submissionUrl: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1234567",
        uploadedDocuments: [],
        failureReason: "Missing consent."
      }
    ]
  };

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
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
    });

  const result = await prepareJobApplicationSubmission(
    greenhouseJob,
    recordWithReviewNeededAttempt,
    profile,
    tailoredResume,
    {
      mode: "supervised",
      greenhouseJobBoardApiKey: "test-key",
      fetchImpl,
      now: "2026-06-10T08:10:00.000Z"
    }
  );

  assert.equal(result.ready, true);
});

test("submitJobApplication records a submitted Greenhouse attempt and advances the tracker record", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-submit-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const record = createAtsReadyRecord(greenhouseJob);
  let getCount = 0;
  let postCount = 0;

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";

    if (method === "POST") {
      postCount += 1;
      assert.equal(readRequestUrl(input), "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1234567");
      assert.equal(
        init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : (init?.headers as Record<string, string> | undefined)?.Authorization,
        "Basic dGVzdC1rZXk6"
      );

      const body = init?.body;
      assert.ok(body instanceof FormData);
      assert.equal(body.get("first_name"), "Abdullah");
      assert.equal(body.get("work_authorization"), "yes");
      assert.equal(body.get("mapped_url_token"), "test-source");
      assert.ok(body.get("resume") instanceof File);

      return jsonResponse(
        {
          status: "ok",
          message: "Application received."
        },
        200
      );
    }

    getCount += 1;
    assert.match(readRequestUrl(input), /questions=true/);

    return jsonResponse({
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
    });
  };

  const result = await submitJobApplication(greenhouseJob, record, profile, tailoredResume, {
    mode: "supervised",
    greenhouseJobBoardApiKey: "test-key",
    fetchImpl,
    now: "2026-06-10T08:10:00.000Z"
  });

  assert.equal(getCount, 1);
  assert.equal(postCount, 1);
  assert.equal(result.attempt.outcome, "submitted");
  assert.equal(result.attempt.responseStatus, 200);
  assert.equal(result.applicationRecord.status, "applied");
  assert.equal(result.applicationRecord.submissionAttempts?.length, 1);
  assert.equal(
    result.applicationRecord.statusHistory[result.applicationRecord.statusHistory.length - 1]?.status,
    "applied"
  );
});

test("submitJobApplication falls back to review-needed when the questionnaire requires unsupported location data", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-location-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const record = createAtsReadyRecord(greenhouseJob);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      questions: [
        {
          label: "Resume/CV",
          required: true,
          fields: [{ name: "resume", type: "input_file" }]
        }
      ],
      location_questions: [
        {
          label: "Country",
          required: true,
          fields: [{ name: "country", type: "input_text" }]
        }
      ]
    });

  const result = await submitJobApplication(greenhouseJob, record, profile, tailoredResume, {
    mode: "supervised",
    greenhouseJobBoardApiKey: "test-key",
    fetchImpl,
    now: "2026-06-10T08:10:00.000Z"
  });

  assert.equal(result.attempt.outcome, "review-needed");
  assert.equal(result.applicationRecord.status, "ats-passed");
  assert.equal(result.applicationRecord.submissionAttempts?.length, 1);
  assert.match(result.attempt.failureReason ?? "", /required location questions/);
});

function createCandidateProfile(resumePath: string): CandidateProfile {
  return {
    id: "abdullah-seed",
    fullName: "Abdullah Fageeh",
    preferredName: "Abdullah",
    email: "abdullah@example.com",
    phone: "+49 123 4567",
    headline: "Installation Manager | Production Manager | Site Operations",
    targetRoleFamilies: ["Installation Manager", "Production Manager", "Site Operations"],
    certifications: ["NEBOSH International General Certificate in Occupational Health and Safety (2024)"],
    coreProofPoints: ["Delivered installation and build execution across 6 venues"],
    documents: [
      {
        key: "master-cv",
        path: resumePath,
        description: "Master CV PDF",
        source: {
          kind: "cv",
          reference: resumePath
        }
      }
    ],
    recurringAnswers: [
      {
        key: "work-authorization",
        question: "Work authorization",
        answer: "Yes",
        source: {
          kind: "manual",
          reference: "APPLICATION_REFERENCE.md"
        }
      }
    ]
  };
}

function createAtsReadyRecord(job: JobPosting) {
  const discoveredRecord = createApplicationRecord({
    job,
    createdAt: "2026-06-10T08:00:00.000Z"
  });
  const tailoredRecord = updateApplicationStatus(discoveredRecord, "tailored", {
    at: "2026-06-10T08:05:00.000Z",
    reason: "Tailored resume attached."
  });

  return updateApplicationStatus(tailoredRecord, "ats-passed", {
    at: "2026-06-10T08:06:00.000Z",
    reason: "ATS threshold met with score 88."
  });
}

function readFieldValue(
  fields: {
    name: string;
    value: unknown;
  }[],
  name: string
): unknown {
  return fields.find((field) => field.name === name)?.value;
}

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}


test("full-auto Greenhouse preparation requires an explicit structured-channel opt-in", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-full-auto-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);
  const record = createAtsReadyRecord(greenhouseJob);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  const blocked = await prepareJobApplicationSubmission(greenhouseJob, record, profile, tailoredResume, {
    mode: "full-auto",
    greenhouseJobBoardApiKey: "test-key"
  });

  assert.equal(blocked.ready, false);
  if (!blocked.ready) {
    assert.match(blocked.reason, /explicit/i);
  }

  const allowed = await prepareJobApplicationSubmission(greenhouseJob, record, profile, tailoredResume, {
    mode: "full-auto",
    allowFullAutoSubmission: true,
    greenhouseJobBoardApiKey: "test-key",
    fetchImpl: async () =>
      jsonResponse({
        questions: [
          {
            label: "Resume/CV",
            required: true,
            fields: [{ name: "resume", type: "input_file" }]
          }
        ]
      })
  });

  assert.equal(allowed.ready, true);
});


test("prepareJobApplicationSubmission keeps Workable and Lever roles in review-only mode", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-apply-review-only-"));
  const resumePath = join(tempDir, "abdullah-resume.pdf");
  const profile = createCandidateProfile(resumePath);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  await writeFile(resumePath, "resume-pdf-placeholder", "utf8");

  for (const platform of ["lever", "workable"] as const) {
    const job: JobPosting = {
      ...greenhouseJob,
      id: `job-${platform}-venue-operations`,
      source: {
        kind: "job-board",
        name: `${platform}-site:eventco`,
        url: `https://${platform}.example.test/jobs/1`
      },
      applicationTarget: {
        platform,
        siteToken: "eventco",
        jobId: "1",
        url: `https://${platform}.example.test/jobs/1/apply`
      }
    };
    const resume = { ...tailoredResume, id: `${job.id}:tailored`, jobId: job.id };
    const result = await prepareJobApplicationSubmission(
      job,
      createAtsReadyRecord(job),
      profile,
      resume,
      { mode: "full-auto", allowFullAutoSubmission: true, now: "2026-06-10T08:10:00.000Z" }
    );

    assert.equal(result.ready, false);
    if (!result.ready) {
      assert.match(result.reason, /No supported outbound application adapter/);
      assert.equal(result.attempt.outcome, "review-needed");
    }
  }
});
