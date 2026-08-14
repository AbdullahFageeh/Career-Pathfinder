import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  prefillHostedGreenhouseApplication,
  type GreenhouseDataConsent
} from "../apply/index.js";
import type { IngestJobPostingInput } from "../ingest/index.js";
import { loadCandidateProfile } from "../profile/index.js";
import {
  runCoverLetterOperation,
  runDiscoverOperation,
  runFollowUpOperation,
  runReportOperation,
  runResumeOperation,
  runShortlistOperation
} from "./operations.js";
import type { ApplicationDocumentFormat } from "../render/index.js";
import type { CoverLetterTone } from "../letters/index.js";
import { architectureSummary } from "../shared/modules.js";
import type { AutomationMode } from "../shared/contracts.js";
import { runDailyAutomationOperation } from "../automation/operations.js";
import {
  enqueueSingleJobPipelineRun,
  runPipelineQueueOnce,
  runSingleJobPipeline,
  type EnqueueSingleJobPipelineRunOptions,
  type PipelineQueueRunOptions,
  type SingleJobPipelineOptions
} from "../worker/index.js";

type CliOutput = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type CliDependencies = {
  enqueueSingleJobPipelineRun: typeof enqueueSingleJobPipelineRun;
  loadCandidateProfile: typeof loadCandidateProfile;
  prefillHostedGreenhouseApplication: typeof prefillHostedGreenhouseApplication;
  readEnv: (name: string) => string | undefined;
  readTextFile: (path: string) => Promise<string>;
  runPipelineQueueOnce: typeof runPipelineQueueOnce;
  runSingleJobPipeline: typeof runSingleJobPipeline;
  runShortlistOperation: typeof runShortlistOperation;
  runResumeOperation: typeof runResumeOperation;
  runCoverLetterOperation: typeof runCoverLetterOperation;
  runFollowUpOperation: typeof runFollowUpOperation;
  runReportOperation: typeof runReportOperation;
  runDiscoverOperation: typeof runDiscoverOperation;
  runDailyAutomationOperation: typeof runDailyAutomationOperation;
};

type ParsedCliOptions = {
  flags: Set<string>;
  values: Map<string, string>;
};

const DEFAULT_CLI_OUTPUT: CliOutput = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

const DEFAULT_CLI_DEPENDENCIES: CliDependencies = {
  enqueueSingleJobPipelineRun,
  loadCandidateProfile,
  prefillHostedGreenhouseApplication,
  readEnv: (name) => process.env[name],
  readTextFile: (path) => readFile(path, "utf8"),
  runPipelineQueueOnce,
  runSingleJobPipeline,
  runShortlistOperation,
  runResumeOperation,
  runCoverLetterOperation,
  runFollowUpOperation,
  runReportOperation,
  runDiscoverOperation,
  runDailyAutomationOperation
};

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
  output: Partial<CliOutput> = {}
): Promise<number> {
  const deps = {
    ...DEFAULT_CLI_DEPENDENCIES,
    ...dependencies
  };
  const io = {
    ...DEFAULT_CLI_OUTPUT,
    ...output
  };
  const [command, ...args] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      io.stdout(formatHelpText());
      return 0;
    case "pipeline:single":
      return runSinglePipelineCli(args, deps, io);
    case "queue:single":
      return runQueueSingleCli(args, deps, io);
    case "greenhouse:hosted:prefill":
      return runGreenhouseHostedPrefillCli(args, deps, io);
    case "worker:once":
      return runWorkerOnceCli(args, deps, io);
    case "shortlist":
      return runShortlistCli(args, deps, io);
    case "cv":
      return runResumeCli(args, deps, io);
    case "letter":
      return runCoverLetterCli(args, deps, io);
    case "followups":
      return runFollowUpsCli(args, deps, io);
    case "report":
      return runReportCli(args, deps, io);
    case "discover:greenhouse":
      return runDiscoverCli(args, deps, io);
    case "automation:run":
      return runDailyAutomationCli(args, deps, io);
    default:
      io.stderr(`Unknown command "${command}".`);
      io.stderr("");
      io.stderr(formatUsageText());
      return 1;
  }
}

async function runSinglePipelineCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const inputPath = requireOption(options, "input");
    const jobInput = await readJobInput(inputPath, deps);
    const applyMode = readApplyModeOption(options);
    const dataConsent = buildDataConsent(options);

    if (applyMode === "supervised" && !deps.readEnv("GREENHOUSE_JOB_BOARD_API_KEY")) {
      io.stderr(
        "Warning: GREENHOUSE_JOB_BOARD_API_KEY is not set. Greenhouse apply will fall back to review-needed."
      );
    }

    const result = await deps.runSingleJobPipeline(jobInput, {
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      renderOptions: readOptionalOption(options, "render-output-dir")
        ? {
            outputDir: resolve(readOptionalOption(options, "render-output-dir") ?? "")
          }
        : undefined,
      applyOptions: applyMode
        ? {
            mode: applyMode,
            ...(options.flags.has("allow-full-auto") ? { allowFullAutoSubmission: true } : {}),
            dataConsent
          }
        : undefined
    });

    const outputLines = [
      "Single job pipeline complete.",
      `- job: ${result.job.id}`,
      `- title: ${result.job.title}`,
      `- company: ${result.job.company}`,
      `- storage: ${result.storagePath}`,
      `- status: ${result.applicationRecord.status}`,
      `- ats score: ${result.atsAssessment.score}`,
      result.tailoredResume.outputPath
        ? `- resume artifact: ${result.tailoredResume.outputPath}`
        : undefined,
      result.applicationAttempt
        ? `- apply outcome: ${result.applicationAttempt.outcome}`
        : "- apply outcome: not requested",
      result.applicationAttempt?.confirmationMessage
        ? `- apply confirmation: ${result.applicationAttempt.confirmationMessage}`
        : undefined,
      result.applicationAttempt?.failureReason
        ? `- apply reason: ${result.applicationAttempt.failureReason}`
        : undefined
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runQueueSingleCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const inputPath = requireOption(options, "input");
    const jobInput = await readJobInput(inputPath, deps);
    const applyMode = readApplyModeOption(options);
    const dataConsent = buildDataConsent(options);
    const enqueueOptions: EnqueueSingleJobPipelineRunOptions = {
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      renderOutputDir: resolveOptionalPath(readOptionalOption(options, "render-output-dir")),
      applyMode,
      ...(options.flags.has("allow-full-auto") ? { allowFullAutoSubmission: true } : {}),
      dataConsent
    };
    const queueJob = await deps.enqueueSingleJobPipelineRun(jobInput, enqueueOptions);

    const outputLines = [
      "Single job queued.",
      `- queue job: ${queueJob.id}`,
      `- stage: ${queueJob.stage}`,
      `- run: ${queueJob.runNumber}`,
      `- scheduled for: ${queueJob.scheduledFor}`,
      applyMode ? `- apply mode: ${applyMode}` : "- apply mode: not requested",
      applyMode
        ? "- note: set GREENHOUSE_JOB_BOARD_API_KEY before running worker:once for live Greenhouse submissions."
        : undefined
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runGreenhouseHostedPrefillCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const targetUrl = requireOption(options, "url");
    const headless = options.flags.has("headless");
    const keepOpen = options.flags.has("keep-open");
    const profile = await deps.loadCandidateProfile({
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id")
    });
    const result = await deps.prefillHostedGreenhouseApplication(targetUrl, profile, {
      browserExecutablePath: resolveOptionalPath(readOptionalOption(options, "browser-executable-path")),
      headless,
      keepOpen,
      resumePath: resolveOptionalPath(readOptionalOption(options, "resume-path")),
      timeoutMs: readOptionalNumberOption(options, "timeout-ms")
    });

    const outputLines = [
      "Hosted Greenhouse prefill complete.",
      `- target: ${result.targetUrl}`,
      `- browser: ${result.browserExecutablePath}`,
      result.resumePath ? `- resume: ${result.resumePath}` : undefined,
      `- filled fields: ${result.filledFields.length}`,
      `- missing required fields: ${result.missingRequiredFields.length}`,
      result.readyForManualReview
        ? "- ready for manual review: yes"
        : `- missing: ${result.missingRequiredFields.join(" | ")}`,
      result.keptBrowserOpen ? "- browser kept open: yes" : undefined,
      !headless && !result.keptBrowserOpen
        ? "- note: rerun with --keep-open to review and submit manually in the browser."
        : undefined
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runWorkerOnceCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const workerOptions: PipelineQueueRunOptions = {
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      workerId: readOptionalOption(options, "worker-id"),
      maxJobs: readOptionalNumberOption(options, "max-jobs"),
      leaseDurationMs: readOptionalNumberOption(options, "lease-duration-ms"),
      retryDelayMs: readOptionalNumberOption(options, "retry-delay-ms")
    };
    const result = await deps.runPipelineQueueOnce(workerOptions);
    const outputLines = [
      "Pipeline queue worker run complete.",
      `- worker: ${result.workerId}`,
      `- claimed: ${result.claimed}`,
      `- completed: ${result.completed}`,
      `- failed: ${result.failed}`,
      `- dead-lettered: ${result.deadLettered}`,
      `- remaining: ${result.remaining}`
    ];

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runShortlistCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const result = await deps.runShortlistOperation({
      corpusDir: resolveOptionalPath(readOptionalOption(options, "corpus-dir")),
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      limit: readOptionalNumberOption(options, "limit"),
      minimumScore: readOptionalNumberOption(options, "min-score"),
      includeIneligible: options.flags.has("include-ineligible") ? true : undefined,
      includeStoredJobs: options.flags.has("corpus-only") ? false : undefined,
      outputPath: resolveOptionalPath(readOptionalOption(options, "output")),
      isSaudiNational: options.flags.has("saudi-national") ? true : undefined,
      homeCity: readOptionalOption(options, "home-city")
    });

    const rows = result.ranked.map(
      (entry) =>
        `  ${String(entry.rank).padStart(2, " ")}. [${String(entry.fit.score).padStart(3, " ")}] ${entry.job.title} - ${entry.job.company} (${
          entry.fit.eligibility.resolvedCity ?? entry.job.location ?? "unknown city"
        })`
    );

    const outputLines = [
      "Shortlist ready.",
      `- opportunities considered: ${result.totalConsidered}`,
      `- shortlisted: ${result.ranked.length}`,
      result.invalidCorpusFiles > 0
        ? `- unreadable corpus files skipped: ${result.invalidCorpusFiles}`
        : undefined,
      result.outputPath ? `- written to: ${result.outputPath}` : undefined,
      result.ranked.length > 0 ? "" : undefined,
      ...rows
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runResumeCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const inputPath = requireOption(options, "input");
    const jobInput = await readJobInput(inputPath, deps);
    const result = await deps.runResumeOperation({
      job: jobInput,
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      outputDir: resolveOptionalPath(readOptionalOption(options, "output-dir")),
      formats: readFormatsOption(options),
      browserExecutablePath: resolveOptionalPath(
        readOptionalOption(options, "browser-executable-path")
      )
    });

    const outputLines = [
      "Tailored CV generated.",
      ...result.outputPaths.map((path) => `- document: ${path}`),
      result.pdfSkippedReason ? `- pdf skipped: ${result.pdfSkippedReason}` : undefined
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runCoverLetterCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const inputPath = requireOption(options, "input");
    const jobInput = await readJobInput(inputPath, deps);

    const result = await deps.runCoverLetterOperation({
      job: jobInput,
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      tone: readToneOption(options),
      recipientName: readOptionalOption(options, "recipient"),
      companyHook: readOptionalOption(options, "company-hook"),
      outputDir: resolveOptionalPath(readOptionalOption(options, "output-dir")),
      formats: readFormatsOption(options),
      browserExecutablePath: resolveOptionalPath(
        readOptionalOption(options, "browser-executable-path")
      ),
      useLlm: options.flags.has("use-llm") ? true : undefined,
      llmModel: readOptionalOption(options, "llm-model")
    });

    const outputLines = [
      "Cover letter generated.",
      `- words: ${result.draft.wordCount}`,
      `- refined by llm: ${result.refined ? "yes" : "no"}`,
      result.refinementNote ? `- refinement note: ${result.refinementNote}` : undefined,
      result.textPath ? `- text: ${result.textPath}` : undefined,
      ...result.documentPaths.map((path) => `- document: ${path}`),
      result.pdfSkippedReason ? `- pdf skipped: ${result.pdfSkippedReason}` : undefined
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runFollowUpsCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const result = await deps.runFollowUpOperation({
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      offsetDays: readOffsetDaysOption(options),
      schedule: options.flags.has("no-schedule") ? false : undefined,
      outputPath: resolveOptionalPath(readOptionalOption(options, "output"))
    });

    const outputLines = [
      "Follow-up review complete.",
      `- newly scheduled: ${result.scheduled}`,
      `- due now: ${result.due.length}`,
      result.outputPath ? `- written to: ${result.outputPath}` : undefined,
      ...result.due.map(
        (entry) =>
          `  - ${entry.jobTitle} - ${entry.company} (due ${entry.followUp.dueAt}${
            entry.overdueDays > 0 ? `, ${entry.overdueDays} day(s) overdue` : ""
          })`
      )
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runReportCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const result = await deps.runReportOperation({
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      staleAfterDays: readOptionalNumberOption(options, "stale-after-days"),
      outputPath: resolveOptionalPath(readOptionalOption(options, "output"))
    });

    const outputLines = [
      "Funnel report ready.",
      `- tracked opportunities: ${result.report.totalRecords}`,
      `- applied: ${result.report.appliedCount}`,
      `- applied in the last 7 days: ${result.report.weeklyApplied}`,
      `- follow-ups due now: ${result.report.dueFollowUps.length}`,
      `- stalled records: ${result.report.staleApplications.length}`,
      result.outputPath ? `- written to: ${result.outputPath}` : undefined
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runDailyAutomationCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const result = await deps.runDailyAutomationOperation({
      configPath: resolveOptionalPath(readOptionalOption(options, "config")),
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      referencePath: resolveOptionalPath(readOptionalOption(options, "reference-path")),
      profileId: readOptionalOption(options, "profile-id"),
      outputPath: resolveOptionalPath(readOptionalOption(options, "output"))
    });

    io.stdout(
      [
        "Daily automation desk complete.",
        `- run: ${result.run.run.id}`,
        `- skipped: ${result.run.skipped ? "yes" : "no"}`,
        `- boards queried: ${result.discovery.boardsQueried}`,
        `- roles found: ${result.discovery.listings}`,
        `- queued: ${result.run.queued.length}`,
        `- review required: ${result.run.reviewRequired.length}`,
        `- auto-submitted: ${result.run.run.counts.submitted}`,
        result.outputPath ? `- review queue: ${result.outputPath}` : undefined
      ]
        .filter((line): line is string => typeof line === "string")
        .join("\n")
    );
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function runDiscoverCli(
  args: string[],
  deps: CliDependencies,
  io: CliOutput
): Promise<number> {
  try {
    const options = parseCliOptions(args);
    const boards = readOptionalOption(options, "boards");
    const result = await deps.runDiscoverOperation({
      boardTokens: boards
        ? boards
            .split(",")
            .map((token) => token.trim())
            .filter((token) => token.length > 0)
        : undefined,
      maxListingsPerBoard: readOptionalNumberOption(options, "max-per-board"),
      includeAllTitles: options.flags.has("all-titles") ? true : undefined,
      storagePath: resolveOptionalPath(readOptionalOption(options, "storage-path")),
      persist: options.flags.has("no-persist") ? false : undefined,
      outputDir: resolveOptionalPath(readOptionalOption(options, "save-dir"))
    });

    const outputLines = [
      "Greenhouse discovery complete.",
      `- boards queried: ${result.discovery.boardsQueried.length}`,
      `- Saudi roles found: ${result.discovery.listings.length}`,
      `- persisted: ${result.persisted}`,
      result.savedPaths.length > 0 ? `- saved files: ${result.savedPaths.length}` : undefined,
      result.discovery.boardsFailed.length > 0
        ? `- boards failed: ${result.discovery.boardsFailed
            .map((entry) => `${entry.boardToken} (${entry.reason})`)
            .join(" | ")}`
        : undefined,
      ...result.discovery.listings
        .slice(0, 10)
        .map((listing) => `  - ${listing.title} - ${listing.company} (${listing.location ?? "unknown"})`)
    ].filter((line): line is string => typeof line === "string");

    io.stdout(outputLines.join("\n"));
    return 0;
  } catch (error) {
    io.stderr(readCliErrorMessage(error));
    return 1;
  }
}

async function readJobInput(
  inputPath: string,
  deps: CliDependencies
): Promise<IngestJobPostingInput> {
  const resolvedInputPath = resolve(inputPath);
  const fileContents = await deps.readTextFile(resolvedInputPath);

  try {
    return JSON.parse(fileContents) as IngestJobPostingInput;
  } catch (error) {
    throw new Error(
      `Unable to parse JSON from "${resolvedInputPath}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseCliOptions(args: string[]): ParsedCliOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }

    const optionName = token.slice(2).trim();

    if (optionName.length === 0) {
      throw new Error("Encountered an empty option name.");
    }

    const nextToken = args[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      flags.add(optionName);
      continue;
    }

    values.set(optionName, nextToken);
    index += 1;
  }

  return {
    flags,
    values
  };
}

function requireOption(options: ParsedCliOptions, name: string): string {
  const value = options.values.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function readOptionalOption(options: ParsedCliOptions, name: string): string | undefined {
  const value = options.values.get(name)?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readOptionalNumberOption(
  options: ParsedCliOptions,
  name: string
): number | undefined {
  const value = readOptionalOption(options, name);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Option --${name} must be a non-negative number.`);
  }

  return parsed;
}

function readApplyModeOption(options: ParsedCliOptions): AutomationMode | undefined {
  const value = readOptionalOption(options, "apply-mode");

  if (!value) {
    return undefined;
  }

  if (value === "observe" || value === "supervised" || value === "full-auto") {
    return value;
  }

  throw new Error("Option --apply-mode must be one of observe, supervised, or full-auto.");
}

function readToneOption(options: ParsedCliOptions): CoverLetterTone | undefined {
  const value = readOptionalOption(options, "tone");
  if (!value) {
    return undefined;
  }
  if (value === "direct" || value === "warm" || value === "formal") {
    return value;
  }
  throw new Error("Option --tone must be one of direct, warm, or formal.");
}

function readFormatsOption(
  options: ParsedCliOptions
): ApplicationDocumentFormat[] | undefined {
  const value = readOptionalOption(options, "formats");
  if (!value) {
    return undefined;
  }
  const formats = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  for (const format of formats) {
    if (format !== "html" && format !== "pdf") {
      throw new Error("Option --formats accepts html and pdf only.");
    }
  }

  return formats as ApplicationDocumentFormat[];
}

function readOffsetDaysOption(options: ParsedCliOptions): number[] | undefined {
  const value = readOptionalOption(options, "offset-days");
  if (!value) {
    return undefined;
  }
  const offsets = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));

  if (offsets.length === 0 || offsets.some((offset) => offset <= 0)) {
    throw new Error("Option --offset-days must be a comma separated list of positive day counts.");
  }

  return offsets;
}

function buildDataConsent(
  options: ParsedCliOptions
): GreenhouseDataConsent | undefined {
  const dataConsent: GreenhouseDataConsent = {
    gdprConsentGiven: options.flags.has("gdpr-consent") ? true : undefined,
    gdprProcessingConsentGiven: options.flags.has("gdpr-processing-consent")
      ? true
      : undefined,
    gdprRetentionConsentGiven: options.flags.has("gdpr-retention-consent")
      ? true
      : undefined
  };

  return Object.values(dataConsent).some((value) => value === true)
    ? dataConsent
    : undefined;
}

function resolveOptionalPath(path: string | undefined): string | undefined {
  return path ? resolve(path) : undefined;
}

function readCliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatHelpText(): string {
  return [
    "Job Project scaffold ready.",
    "",
    "Usage:",
    formatUsageText(),
    "",
    "Notes:",
    "- Daily loop: discover:greenhouse, then shortlist, then pipeline:single on the top roles, then followups and report.",
    "- Set GREENHOUSE_JOB_BOARD_API_KEY in your environment for live Greenhouse submissions.",
    "- Set LLM_API_KEY (or OPENAI_API_KEY) to enable optional cover letter refinement; without it the deterministic draft is used.",
    "- For public hosted Greenhouse pages, use greenhouse:hosted:prefill to open a supervised browser-fill path without the API key.",
    "- automation:run discovers configured trusted Greenhouse boards, queues only eligible high-fit roles, and writes a review queue.",
    "- Full-auto structured submission remains disabled until autoSubmitEnabled is explicitly set in your private automation config.",
    "",
    "Implemented architecture modules:",
    ...architectureSummary.map((module) => `- ${module.key}: ${module.summary}`)
  ].join("\n");
}

function formatUsageText(): string {
  return [
    "  node dist/index.js shortlist [--limit <n>] [--min-score <n>] [--corpus-dir <dir>] [--storage-path <path>] [--reference-path <path>] [--home-city <city>] [--output <file.md>] [--corpus-only] [--include-ineligible] [--saudi-national]",
    "  node dist/index.js discover:greenhouse [--boards <token,token>] [--max-per-board <n>] [--save-dir <dir>] [--storage-path <path>] [--all-titles] [--no-persist]",
    "  node dist/index.js automation:run [--config <automation.config.json>] [--storage-path <path>] [--reference-path <path>] [--profile-id <id>] [--output <review.md>]",
    "  node dist/index.js cv --input <job.json> [--reference-path <path>] [--profile-id <id>] [--output-dir <dir>] [--formats html,pdf] [--browser-executable-path <path>]",
    "  node dist/index.js letter --input <job.json> [--tone direct|warm|formal] [--recipient <name>] [--company-hook <text>] [--output-dir <dir>] [--formats html,pdf] [--use-llm] [--llm-model <model>]",
    "  node dist/index.js followups [--storage-path <path>] [--offset-days 3,7,14] [--output <file.md>] [--no-schedule]",
    "  node dist/index.js report [--storage-path <path>] [--stale-after-days <n>] [--output <file.md>]",
    "  node dist/index.js worker:once [--storage-path <path>] [--worker-id <id>] [--max-jobs <n>]",
    "  node dist/index.js queue:single --input <job.json> [--reference-path <path>] [--storage-path <path>] [--render-output-dir <dir>] [--profile-id <id>] [--apply-mode observe|supervised|full-auto] [--allow-full-auto] [--gdpr-consent] [--gdpr-processing-consent] [--gdpr-retention-consent]",
    "  node dist/index.js pipeline:single --input <job.json> [--reference-path <path>] [--storage-path <path>] [--render-output-dir <dir>] [--profile-id <id>] [--apply-mode observe|supervised|full-auto] [--allow-full-auto] [--gdpr-consent] [--gdpr-processing-consent] [--gdpr-retention-consent]",
    "  node dist/index.js greenhouse:hosted:prefill --url <hosted-greenhouse-job-url> [--reference-path <path>] [--resume-path <path>] [--browser-executable-path <path>] [--profile-id <id>] [--headless] [--keep-open] [--timeout-ms <ms>]"
  ].join("\n");
}

export const cliModule = {
  key: "cli",
  summary: "Provide the local control surface for queued and supervised apply workflows.",
  responsibilities: [
    "Rank the daily shortlist and generate tailored CVs and letters on demand.",
    "Surface follow-ups that are due and print the funnel report.",
    "Run a single job pipeline end to end from a local job JSON input.",
    "Queue durable single-job runs, including the optional supervised apply stage.",
    "Launch supervised hosted Greenhouse prefills and report queue progress for local monitoring."
  ]
} as const;
