import type { JobPosting } from "../shared/contracts.js";
import type { AutomationRun } from "./contracts.js";

export type AutomationReviewQueueInput = {
  generatedAt?: string;
  run: AutomationRun;
  sourcesFailed?: Array<{ source: string; reason: string }>;
  queued: Array<{
    job: JobPosting;
    fitScore: number;
    queueJobId: string;
  }>;
  reviewRequired: Array<{
    job: JobPosting;
    reason: string;
  }>;
};

/** Formats one daily run into a small, actionable operator control sheet. */
export function formatAutomationReviewQueueMarkdown(input: AutomationReviewQueueInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const lines = [
    "# Daily automation desk review queue",
    `Generated: ${generatedAt}`,
    "",
    "## Run summary",
    `- Run: ${input.run.id}`,
    `- Status: ${input.run.status}`,
    `- Discovered: ${input.run.counts.discovered}`,
    `- Qualified: ${input.run.counts.qualified}`,
    `- Queued: ${input.run.counts.queued}`,
    `- Auto-submitted: ${input.run.counts.submitted}`,
    `- Review required: ${input.run.counts.reviewRequired}`,
    "",
    "## Queued for preparation",
    "| Role | Employer | Location | Fit | Queue job | Next action |",
    "| --- | --- | --- | ---: | --- | --- |"
  ];

  if (input.queued.length === 0) {
    lines.push("| — | — | — | — | — | No role queued in this run. |");
  } else {
    for (const entry of input.queued) {
      lines.push(
        `| ${escapeCell(entry.job.title)} | ${escapeCell(entry.job.company)} | ${escapeCell(entry.job.location ?? "Unspecified")} | ${entry.fitScore}/100 | ${escapeCell(entry.queueJobId)} | Prepare tailored material and apply only if the adapter passes. |`
      );
    }
  }

  lines.push("", "## Review before applying", "| Role | Employer | Reason | Next action |", "| --- | --- | --- | --- |");

  if (input.reviewRequired.length === 0) {
    lines.push("| — | — | — | No review action is required. |");
  } else {
    for (const entry of input.reviewRequired) {
      lines.push(
        `| ${escapeCell(entry.job.title)} | ${escapeCell(entry.job.company)} | ${escapeCell(entry.reason)} | ${escapeCell(readReviewAction(entry.reason))} |`
      );
    }
  }

  lines.push("", "## Source health", "");
  if (!input.sourcesFailed || input.sourcesFailed.length === 0) {
    lines.push("All configured sources responded successfully.");
  } else {
    lines.push("| Source | Reason |", "| --- | --- |");
    for (const failure of input.sourcesFailed) {
      lines.push(`| ${escapeCell(failure.source)} | ${escapeCell(failure.reason)} |`);
    }
    lines.push("", "A source failure can make the shortlist look empty. Verify it before changing fit thresholds.");
  }

  return `${lines.join("\n")}\n`;
}

function readReviewAction(reason: string): string {
  switch (reason) {
    case "source-not-trusted":
      return "Verify the employer source before considering the role.";
    case "source-stale":
      return "Refresh the listing before applying.";
    case "duplicate":
      return "Keep the newer matching listing only.";
    case "daily-cap-exceeded":
      return "Hold for the next daily run or raise the cap deliberately.";
    case "employer-cooldown-active":
      return "Wait until the employer cooldown has elapsed.";
    case "already-applied":
      return "Track the existing application instead of applying again.";
    default:
      return "Review before applying.";
  }
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
