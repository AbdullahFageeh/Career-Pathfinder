import type { ApplicationRecord, ApplicationStatus } from "../shared/contracts.js";
import { listDueFollowUps, type DueFollowUp } from "../followup/index.js";

const DAY_IN_MS = 86_400_000;
const DEFAULT_STALE_AFTER_DAYS = 10;

const FUNNEL_ORDER: readonly ApplicationStatus[] = [
  "discovered",
  "screened",
  "tailored",
  "ats-passed",
  "contact-enriched",
  "applied",
  "followed-up",
  "closed"
];

export type FunnelStageCount = {
  status: ApplicationStatus;
  /** Records currently sitting at this status. */
  current: number;
  /** Records that have ever reached this status. */
  reached: number;
};

export type StaleApplication = {
  applicationId: string;
  jobTitle: string;
  company: string;
  status: ApplicationStatus;
  idleDays: number;
};

export type CompanyActivity = {
  company: string;
  applications: number;
  applied: number;
};

export type FunnelReport = {
  generatedAt: string;
  totalRecords: number;
  stages: FunnelStageCount[];
  appliedCount: number;
  atsPassedCount: number;
  followedUpCount: number;
  closedCount: number;
  /** Applied divided by total tracked opportunities. */
  applyRate: number;
  /** Followed-up divided by applied. */
  followUpRate: number;
  averageAtsScore?: number;
  dueFollowUps: DueFollowUp[];
  staleApplications: StaleApplication[];
  topCompanies: CompanyActivity[];
  weeklyApplied: number;
};

export type BuildFunnelReportOptions = {
  now?: string;
  staleAfterDays?: number;
  topCompanyLimit?: number;
};

/**
 * Summarises the pipeline so effort can be redirected based on evidence rather
 * than feeling: where records pile up, what has gone stale, and whether
 * follow-up is actually happening.
 */
export function buildFunnelReport(
  records: readonly ApplicationRecord[],
  options: BuildFunnelReportOptions = {}
): FunnelReport {
  const generatedAt = options.now ?? new Date().toISOString();
  const reference = Date.parse(generatedAt);
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;

  const stages = FUNNEL_ORDER.map((status) => ({
    status,
    current: records.filter((record) => record.status === status).length,
    reached: records.filter((record) =>
      record.statusHistory.some((entry) => entry.status === status)
    ).length
  }));

  const appliedCount = countReached(records, "applied");
  const atsPassedCount = countReached(records, "ats-passed");
  const followedUpCount = countReached(records, "followed-up");
  const closedCount = countReached(records, "closed");

  const atsScores = records
    .map((record) => record.atsScore)
    .filter((score): score is number => typeof score === "number");

  const staleApplications = records
    .filter((record) => record.status !== "closed")
    .map((record) => {
      const updated = Date.parse(record.updatedAt);
      const idleDays =
        Number.isFinite(reference) && Number.isFinite(updated)
          ? Math.max(0, Math.floor((reference - updated) / DAY_IN_MS))
          : 0;
      return {
        applicationId: record.id,
        jobTitle: record.jobTitle,
        company: record.company,
        status: record.status,
        idleDays
      };
    })
    .filter((entry) => entry.idleDays >= staleAfterDays)
    .sort((left, right) => right.idleDays - left.idleDays);

  const companyCounts = new Map<string, CompanyActivity>();
  for (const record of records) {
    const existing = companyCounts.get(record.company) ?? {
      company: record.company,
      applications: 0,
      applied: 0
    };
    existing.applications += 1;
    if (record.statusHistory.some((entry) => entry.status === "applied")) {
      existing.applied += 1;
    }
    companyCounts.set(record.company, existing);
  }

  const topCompanies = Array.from(companyCounts.values())
    .sort((left, right) =>
      right.applications !== left.applications
        ? right.applications - left.applications
        : left.company.localeCompare(right.company)
    )
    .slice(0, options.topCompanyLimit ?? 5);

  const weeklyApplied = records.filter((record) => {
    const appliedEntry = record.statusHistory.find((entry) => entry.status === "applied");
    if (!appliedEntry) {
      return false;
    }
    const appliedAt = Date.parse(appliedEntry.changedAt);
    return (
      Number.isFinite(reference) &&
      Number.isFinite(appliedAt) &&
      reference - appliedAt <= 7 * DAY_IN_MS
    );
  }).length;

  return {
    generatedAt,
    totalRecords: records.length,
    stages,
    appliedCount,
    atsPassedCount,
    followedUpCount,
    closedCount,
    applyRate: records.length === 0 ? 0 : round(appliedCount / records.length, 3),
    followUpRate: appliedCount === 0 ? 0 : round(followedUpCount / appliedCount, 3),
    ...(atsScores.length > 0
      ? { averageAtsScore: round(atsScores.reduce((sum, score) => sum + score, 0) / atsScores.length, 1) }
      : {}),
    dueFollowUps: listDueFollowUps(records, generatedAt),
    staleApplications,
    topCompanies,
    weeklyApplied
  };
}

/** Renders the funnel report as a readable Markdown briefing. */
export function formatFunnelReportMarkdown(report: FunnelReport): string {
  const stageRows = report.stages.map(
    (stage) => `| ${stage.status} | ${stage.current} | ${stage.reached} |`
  );

  const lines = [
    "# Application funnel report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Headline",
    "",
    `- Tracked opportunities: ${report.totalRecords}`,
    `- Applied: ${report.appliedCount} (${formatPercent(report.applyRate)} of tracked)`,
    `- Applied in the last 7 days: ${report.weeklyApplied}`,
    `- Followed up: ${report.followedUpCount} (${formatPercent(report.followUpRate)} of applied)`,
    report.averageAtsScore === undefined
      ? "- Average ATS readiness: not scored yet"
      : `- Average ATS readiness: ${report.averageAtsScore}`,
    "",
    "## Stage breakdown",
    "",
    "| Stage | Currently here | Ever reached |",
    "| --- | --- | --- |",
    ...stageRows,
    "",
    "## Follow-ups due now",
    ""
  ];

  if (report.dueFollowUps.length === 0) {
    lines.push("Nothing is due.");
  } else {
    lines.push("| Role | Company | Due | Overdue days |", "| --- | --- | --- | --- |");
    lines.push(
      ...report.dueFollowUps.map(
        (entry) =>
          `| ${escapeCell(entry.jobTitle)} | ${escapeCell(entry.company)} | ${entry.followUp.dueAt} | ${entry.overdueDays} |`
      )
    );
  }

  lines.push("", "## Stalled records", "");

  if (report.staleApplications.length === 0) {
    lines.push("No record has been idle past the threshold.");
  } else {
    lines.push("| Role | Company | Status | Idle days |", "| --- | --- | --- | --- |");
    lines.push(
      ...report.staleApplications
        .slice(0, 10)
        .map(
          (entry) =>
            `| ${escapeCell(entry.jobTitle)} | ${escapeCell(entry.company)} | ${entry.status} | ${entry.idleDays} |`
        )
    );
  }

  if (report.topCompanies.length > 0) {
    lines.push("", "## Most-worked employers", "", "| Company | Tracked | Applied |", "| --- | --- | --- |");
    lines.push(
      ...report.topCompanies.map(
        (entry) => `| ${escapeCell(entry.company)} | ${entry.applications} | ${entry.applied} |`
      )
    );
  }

  lines.push("");
  return lines.join("\n");
}

function countReached(records: readonly ApplicationRecord[], status: ApplicationStatus): number {
  return records.filter((record) => record.statusHistory.some((entry) => entry.status === status)).length;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
