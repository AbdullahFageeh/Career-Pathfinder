import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "./index.js";
import type {
  CoverLetterOperationResult,
  DiscoverOperationResult,
  FollowUpOperationResult,
  ReportOperationResult,
  ResumeOperationResult,
  ShortlistOperationResult
} from "./operations.js";
import { buildFunnelReport } from "../report/index.js";
import type { DailyAutomationOperationResult } from "../automation/operations.js";
import type { CandidateProfile } from "../shared/contracts.js";

const profile: CandidateProfile = {
  id: "abdullah-seed",
  fullName: "Abdullah Fageeh",
  headline: "Event operations and installation manager.",
  targetRoleFamilies: ["Venue Operations Manager"],
  certifications: [],
  coreProofPoints: [],
  documents: [],
  recurringAnswers: []
};

test("runCli shortlist forwards options and prints the ranked list", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let captured: unknown;

  const result: ShortlistOperationResult = {
    profile,
    totalConsidered: 62,
    ranked: [
      {
        rank: 1,
        job: {
          id: "job-a",
          source: { kind: "company-page", name: "Employer Careers" },
          title: "Venue Operations Manager",
          company: "Example Events",
          location: "Jeddah, Saudi Arabia",
          description: "Lead venue operations.",
          tags: ["saudi-arabia"],
          discoveredAt: "2026-08-11T09:00:00.000Z"
        },
        fit: {
          jobId: "job-a",
          score: 88,
          band: "strong",
          dimensions: [],
          matchedTitleTerms: [],
          matchedEvidenceTerms: [],
          reasons: ["Direct target title match."],
          eligibility: {
            jobId: "job-a",
            eligible: true,
            blockers: [],
            warnings: [],
            resolvedCity: "jeddah",
            requiresSaudiNationality: false,
            remoteFriendly: false,
            assessedAt: "2026-08-12T09:00:00.000Z"
          },
          scoredAt: "2026-08-12T09:00:00.000Z"
        }
      }
    ],
    markdown: "# Daily application shortlist",
    outputPath: "/tmp/shortlist.md",
    invalidCorpusFiles: 1
  };

  const exitCode = await runCli(
    ["shortlist", "--limit", "5", "--min-score", "50", "--home-city", "jeddah", "--corpus-only"],
    {
      runShortlistOperation: async (options) => {
        captured = options;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.deepEqual(
    (captured as Record<string, unknown>).limit,
    5
  );
  assert.equal((captured as Record<string, unknown>).minimumScore, 50);
  assert.equal((captured as Record<string, unknown>).includeStoredJobs, false);
  assert.equal((captured as Record<string, unknown>).homeCity, "jeddah");
  assert.match(stdout[0] ?? "", /Shortlist ready\./);
  assert.match(stdout[0] ?? "", /opportunities considered: 62/);
  assert.match(stdout[0] ?? "", /unreadable corpus files skipped: 1/);
  assert.match(stdout[0] ?? "", /\[ 88\] Venue Operations Manager - Example Events \(jeddah\)/);
});

test("runCli cv forwards output settings and reports document paths", async () => {
  const stdout: string[] = [];
  let captured: Record<string, unknown> | undefined;
  const result: ResumeOperationResult = {
    outputPaths: ["/tmp/Example_Candidate_CV.pdf", "/tmp/Example_Candidate_CV.html"]
  };

  const exitCode = await runCli(
    ["cv", "--input", "data/roles/job.json", "--formats", "pdf,html", "--output-dir", "artifacts/cv"],
    {
      readTextFile: async () => JSON.stringify({ id: "job-a" }),
      runResumeOperation: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(captured?.formats, ["pdf", "html"]);
  assert.match(String(captured?.outputDir), /artifacts\/cv$/);
  assert.match(stdout[0] ?? "", /Tailored CV generated\./);
  assert.match(stdout[0] ?? "", /Example_Candidate_CV\.pdf/);
});

test("runCli letter forwards tone, formats, and LLM flags", async () => {
  const stdout: string[] = [];
  let captured: Record<string, unknown> | undefined;

  const result: CoverLetterOperationResult = {
    draft: {
      jobId: "job-a",
      salutation: "Dear team,",
      paragraphs: ["One."],
      signOff: "Kind regards,",
      body: "One.",
      wordCount: 120,
      keywordsUsed: [],
      evidenceUsed: [],
      refinedByLlm: false,
      generatedAt: "2026-08-12T09:00:00.000Z"
    },
    text: "Dear team,",
    textPath: "/tmp/letter.txt",
    documentPaths: ["/tmp/letter.html"],
    refined: false,
    refinementNote: "No LLM credentials found.",
    pdfSkippedReason: "No browser available."
  };

  const exitCode = await runCli(
    [
      "letter",
      "--input",
      "data/roles/job.json",
      "--tone",
      "formal",
      "--formats",
      "html,pdf",
      "--use-llm",
      "--recipient",
      "Ms Al Harbi"
    ],
    {
      readTextFile: async () => JSON.stringify({ id: "job-a" }),
      runCoverLetterOperation: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(captured?.tone, "formal");
  assert.deepEqual(captured?.formats, ["html", "pdf"]);
  assert.equal(captured?.useLlm, true);
  assert.equal(captured?.recipientName, "Ms Al Harbi");
  assert.match(stdout[0] ?? "", /Cover letter generated\./);
  assert.match(stdout[0] ?? "", /refined by llm: no/);
  assert.match(stdout[0] ?? "", /pdf skipped: No browser available\./);
});

test("runCli letter rejects an unsupported tone", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(
    ["letter", "--input", "job.json", "--tone", "cheerful"],
    {
      readTextFile: async () => JSON.stringify({ id: "job-a" })
    },
    {
      stderr: (message) => stderr.push(message)
    }
  );

  assert.equal(exitCode, 1);
  assert.match(stderr[0] ?? "", /--tone must be one of direct, warm, or formal/);
});

test("runCli followups prints due nudges and honours offsets", async () => {
  const stdout: string[] = [];
  let captured: Record<string, unknown> | undefined;

  const result: FollowUpOperationResult = {
    scheduled: 3,
    due: [
      {
        applicationId: "application:job-a",
        jobTitle: "Venue Operations Manager",
        company: "Example Events",
        followUp: {
          id: "application:job-a:follow-up:1",
          dueAt: "2026-08-04T09:00:00.000Z",
          reason: "Day 3 nudge",
          status: "scheduled",
          createdAt: "2026-08-01T09:00:00.000Z"
        },
        overdueDays: 8
      }
    ],
    markdown: "# Follow-ups due",
    outputPath: "/tmp/followups.md"
  };

  const exitCode = await runCli(
    ["followups", "--offset-days", "2,6,12", "--output", "reports/followups.md"],
    {
      runFollowUpOperation: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(captured?.offsetDays, [2, 6, 12]);
  assert.match(stdout[0] ?? "", /newly scheduled: 3/);
  assert.match(stdout[0] ?? "", /8 day\(s\) overdue/);
});

test("runCli report prints the funnel summary", async () => {
  const stdout: string[] = [];
  const report = buildFunnelReport([], { now: "2026-08-12T09:00:00.000Z" });
  const result: ReportOperationResult = {
    report,
    markdown: "# Application funnel report",
    outputPath: "/tmp/report.md"
  };

  const exitCode = await runCli(
    ["report", "--stale-after-days", "14"],
    {
      runReportOperation: async () => result
    },
    {
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.match(stdout[0] ?? "", /Funnel report ready\./);
  assert.match(stdout[0] ?? "", /tracked opportunities: 0/);
  assert.match(stdout[0] ?? "", /written to: \/tmp\/report\.md/);
});

test("runCli discover:greenhouse parses board tokens and reports failures", async () => {
  const stdout: string[] = [];
  let captured: Record<string, unknown> | undefined;

  const result: DiscoverOperationResult = {
    discovery: {
      fetchedAt: "2026-08-12T09:00:00.000Z",
      sourceName: "greenhouse-board",
      boardsQueried: ["neom", "diriyah"],
      boardsFailed: [{ boardToken: "diriyah", reason: "status 404" }],
      listings: [
        {
          id: "greenhouse:neom:1",
          source: { kind: "job-board", name: "greenhouse-board:neom" },
          title: "Venue Operations Manager",
          company: "Neom",
          location: "NEOM, Saudi Arabia",
          description: "Lead venue operations.",
          tags: ["saudi-arabia"]
        }
      ]
    },
    persisted: 1,
    savedPaths: ["/tmp/greenhouse-neom-1.json"]
  };

  const exitCode = await runCli(
    ["discover:greenhouse", "--boards", "neom, diriyah", "--max-per-board", "10"],
    {
      runDiscoverOperation: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(captured?.boardTokens, ["neom", "diriyah"]);
  assert.equal(captured?.maxListingsPerBoard, 10);
  assert.match(stdout[0] ?? "", /Saudi roles found: 1/);
  assert.match(stdout[0] ?? "", /boards failed: diriyah \(status 404\)/);
});

test("runCli help lists the new daily loop commands", async () => {
  const stdout: string[] = [];

  const exitCode = await runCli(["help"], {}, { stdout: (message) => stdout.push(message) });

  assert.equal(exitCode, 0);
  assert.match(stdout[0] ?? "", /shortlist/);
  assert.match(stdout[0] ?? "", /discover:greenhouse/);
  assert.match(stdout[0] ?? "", /followups/);
  assert.match(stdout[0] ?? "", /report/);
});


test("runCli automation:run forwards private paths and prints the daily queue summary", async () => {
  const stdout: string[] = [];
  let captured: Record<string, unknown> | undefined;
  const result = {
    discovery: {
      boardsQueried: 2,
      boardsFailed: 0,
      listings: 5
    },
    run: {
      skipped: false,
      queued: [{ queueJob: { id: "queue:1" } }],
      reviewRequired: [{ reason: "source-not-trusted" }],
      run: {
        id: "run:daily",
        counts: { submitted: 0 }
      }
    },
    outputPath: "/tmp/review.md"
  } as unknown as DailyAutomationOperationResult;

  const exitCode = await runCli(
    [
      "automation:run",
      "--config",
      "automation.config.json",
      "--storage-path",
      "data/automation.sqlite",
      "--reference-path",
      "APPLICATION_REFERENCE.md",
      "--output",
      "artifacts/review.md"
    ],
    {
      runDailyAutomationOperation: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return result;
      }
    },
    {
      stdout: (message) => stdout.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.match(String(captured?.configPath), /automation\.config\.json$/);
  assert.match(String(captured?.storagePath), /data\/automation\.sqlite$/);
  assert.match(String(captured?.referencePath), /APPLICATION_REFERENCE\.md$/);
  assert.match(String(captured?.outputPath), /artifacts\/review\.md$/);
  assert.match(stdout[0] ?? "", /Daily automation desk complete/);
  assert.match(stdout[0] ?? "", /roles found: 5/);
  assert.match(stdout[0] ?? "", /queued: 1/);
});


test("runCli review:packets forwards selected job and prints the manual handoff", async () => {
  const stdout: string[] = [];
  let captured: Record<string, unknown> | undefined;

  const exitCode = await runCli(
    [
      "review:packets",
      "--job-id",
      "workable:seven-7:123",
      "--storage-path",
      "data/pipeline-store.sqlite",
      "--reference-path",
      "APPLICATION_REFERENCE.md",
      "--output-dir",
      "artifacts/review",
      "--formats",
      "pdf,html"
    ],
    {
      runReviewPacketOperation: async (options) => {
        captured = options as unknown as Record<string, unknown>;
        return {
          packets: [
            {
              jobId: "workable:seven-7:123",
              title: "Venue Operations Manager",
              company: "SEVEN",
              platform: "workable",
              applicationUrl: "https://apply.workable.com/seven-7/j/123",
              reviewPath: "/tmp/review-packet.md",
              resumePaths: ["/tmp/cv.pdf"],
              coverLetterPaths: ["/tmp/cover-letter.pdf"]
            }
          ],
          skippedJobIds: []
        };
      }
    },
    { stdout: (message) => stdout.push(message) }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(captured?.jobIds, ["workable:seven-7:123"]);
  assert.match(String(captured?.storagePath), /data\/pipeline-store\.sqlite$/);
  assert.match(stdout[0] ?? "", /Review packets generated/);
  assert.match(stdout[0] ?? "", /apply\.workable\.com/);
});
