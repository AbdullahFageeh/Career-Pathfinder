import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  prefillHostedGreenhouseApplication,
  type GreenhouseDataConsent
} from "../apply/index.js";
import type { IngestJobPostingInput } from "../ingest/index.js";
import { loadCandidateProfile } from "../profile/index.js";
import { architectureSummary } from "../shared/modules.js";
import type { AutomationMode } from "../shared/contracts.js";
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
  runSingleJobPipeline
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
    "- Set GREENHOUSE_JOB_BOARD_API_KEY in your environment for live Greenhouse submissions.",
    "- For public hosted Greenhouse pages, use greenhouse:hosted:prefill to open a supervised browser-fill path without the API key.",
    "- The first outbound adapter only submits in supervised mode; other modes fall back to review-needed.",
    "",
    "Implemented architecture modules:",
    ...architectureSummary.map((module) => `- ${module.key}: ${module.summary}`)
  ].join("\n");
}

function formatUsageText(): string {
  return [
    "  node dist/index.js worker:once [--storage-path <path>] [--worker-id <id>] [--max-jobs <n>]",
    "  node dist/index.js queue:single --input <job.json> [--reference-path <path>] [--storage-path <path>] [--render-output-dir <dir>] [--profile-id <id>] [--apply-mode supervised] [--gdpr-consent] [--gdpr-processing-consent] [--gdpr-retention-consent]",
    "  node dist/index.js pipeline:single --input <job.json> [--reference-path <path>] [--storage-path <path>] [--render-output-dir <dir>] [--profile-id <id>] [--apply-mode supervised] [--gdpr-consent] [--gdpr-processing-consent] [--gdpr-retention-consent]",
    "  node dist/index.js greenhouse:hosted:prefill --url <hosted-greenhouse-job-url> [--reference-path <path>] [--resume-path <path>] [--browser-executable-path <path>] [--profile-id <id>] [--headless] [--keep-open] [--timeout-ms <ms>]"
  ].join("\n");
}

export const cliModule = {
  key: "cli",
  summary: "Provide the local control surface for queued and supervised apply workflows.",
  responsibilities: [
    "Run a single job pipeline end to end from a local job JSON input.",
    "Queue durable single-job runs, including the optional supervised apply stage.",
    "Launch supervised hosted Greenhouse prefills and report queue progress for local monitoring."
  ]
} as const;
