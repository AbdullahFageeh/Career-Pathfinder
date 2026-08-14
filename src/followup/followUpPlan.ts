import type {
  ApplicationFollowUp,
  ApplicationRecord,
  CandidateProfile
} from "../shared/contracts.js";
import { getOutstandingFollowUps, scheduleFollowUp } from "../tracker/index.js";

const DEFAULT_FOLLOW_UP_OFFSET_DAYS: readonly number[] = [3, 7, 14];
const DAY_IN_MS = 86_400_000;

export type FollowUpStep = {
  offsetDays: number;
  dueAt: string;
  reason: string;
  /** Draft message the operator can send after a quick review. */
  message: string;
};

export type FollowUpPlan = {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  appliedAt?: string;
  steps: FollowUpStep[];
  alreadyScheduled: number;
  skippedReason?: string;
};

export type BuildFollowUpPlanOptions = {
  /** Days after the application date for each nudge. Defaults to 3, 7, and 14. */
  offsetDays?: readonly number[];
  profile?: CandidateProfile;
  now?: string;
};

export type DueFollowUp = {
  applicationId: string;
  jobTitle: string;
  company: string;
  followUp: ApplicationFollowUp;
  overdueDays: number;
};

/**
 * Builds the follow-up ladder for one application. Follow-up is the cheapest
 * lever in a job search, so the plan is generated automatically from the date
 * the application actually went out rather than left to memory.
 */
export function buildFollowUpPlan(
  record: ApplicationRecord,
  options: BuildFollowUpPlanOptions = {}
): FollowUpPlan {
  const offsetDays = normalizeOffsets(options.offsetDays ?? DEFAULT_FOLLOW_UP_OFFSET_DAYS);
  const appliedAt = resolveAppliedAt(record);

  const base: FollowUpPlan = {
    applicationId: record.id,
    jobId: record.jobId,
    jobTitle: record.jobTitle,
    company: record.company,
    ...(appliedAt ? { appliedAt } : {}),
    steps: [],
    alreadyScheduled: record.followUps.filter((followUp) => followUp.status === "scheduled").length
  };

  if (!appliedAt) {
    return {
      ...base,
      skippedReason: "Application has not reached the applied status yet, so no follow-up is scheduled."
    };
  }

  const appliedTimestamp = Date.parse(appliedAt);
  if (!Number.isFinite(appliedTimestamp)) {
    return {
      ...base,
      skippedReason: "Applied timestamp could not be parsed."
    };
  }

  const existingDueDates = new Set(
    record.followUps.map((followUp) => followUp.dueAt.slice(0, 10))
  );

  const steps = offsetDays
    .map((offset) => {
      const dueAt = new Date(appliedTimestamp + offset * DAY_IN_MS).toISOString();
      return {
        offsetDays: offset,
        dueAt,
        reason: buildReason(offset),
        message: buildMessage(record, offset, options.profile)
      };
    })
    .filter((step) => !existingDueDates.has(step.dueAt.slice(0, 10)));

  return {
    ...base,
    steps
  };
}

/**
 * Applies a follow-up plan to the record, returning the updated record so it can
 * be persisted by the caller.
 */
export function applyFollowUpPlan(
  record: ApplicationRecord,
  plan: FollowUpPlan,
  options: { createdAt?: string } = {}
): ApplicationRecord {
  return plan.steps.reduce(
    (current, step) =>
      scheduleFollowUp(current, {
        dueAt: step.dueAt,
        reason: step.reason,
        note: step.message,
        ...(options.createdAt ? { createdAt: options.createdAt } : {})
      }),
    record
  );
}

/** Schedules the standard ladder for an applied record in one call. */
export function ensureFollowUpLadder(
  record: ApplicationRecord,
  options: BuildFollowUpPlanOptions = {}
): {
  record: ApplicationRecord;
  plan: FollowUpPlan;
} {
  const plan = buildFollowUpPlan(record, options);
  return {
    record: applyFollowUpPlan(record, plan, { createdAt: options.now }),
    plan
  };
}

/** Lists every follow-up that is due now, most overdue first. */
export function listDueFollowUps(
  records: readonly ApplicationRecord[],
  asOf = new Date().toISOString()
): DueFollowUp[] {
  const reference = Date.parse(asOf);

  return records
    .flatMap((record) =>
      getOutstandingFollowUps(record, asOf)
        .filter((followUp) => followUp.dueAt <= asOf)
        .map((followUp) => {
          const dueTimestamp = Date.parse(followUp.dueAt);
          const overdueDays =
            Number.isFinite(reference) && Number.isFinite(dueTimestamp)
              ? Math.max(0, Math.floor((reference - dueTimestamp) / DAY_IN_MS))
              : 0;
          return {
            applicationId: record.id,
            jobTitle: record.jobTitle,
            company: record.company,
            followUp,
            overdueDays
          };
        })
    )
    .sort((left, right) => {
      if (right.overdueDays !== left.overdueDays) {
        return right.overdueDays - left.overdueDays;
      }
      return left.followUp.dueAt.localeCompare(right.followUp.dueAt);
    });
}

/** Renders due follow-ups as a Markdown work list with ready-to-send drafts. */
export function formatDueFollowUpsMarkdown(
  dueFollowUps: readonly DueFollowUp[],
  options: { generatedAt?: string } = {}
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  if (dueFollowUps.length === 0) {
    return ["# Follow-ups due", "", `Generated: ${generatedAt}`, "", "Nothing is due right now."].join("\n");
  }

  const blocks = dueFollowUps.map((entry, index) => {
    const lines = [
      `### ${index + 1}. ${entry.jobTitle} - ${entry.company}`,
      "",
      `- Due: ${entry.followUp.dueAt}${entry.overdueDays > 0 ? ` (${entry.overdueDays} day(s) overdue)` : ""}`,
      `- Reason: ${entry.followUp.reason}`
    ];
    if (entry.followUp.note) {
      lines.push("", "```text", entry.followUp.note, "```");
    }
    return lines.join("\n");
  });

  return [
    "# Follow-ups due",
    "",
    `Generated: ${generatedAt}`,
    "",
    `${dueFollowUps.length} follow-up(s) are due.`,
    "",
    ...blocks,
    ""
  ].join("\n");
}

function resolveAppliedAt(record: ApplicationRecord): string | undefined {
  const submitted = record.submissionAttempts?.find((attempt) => attempt.outcome === "submitted");
  if (submitted) {
    return submitted.attemptedAt;
  }

  const appliedEntry = record.statusHistory.find((entry) => entry.status === "applied");
  if (appliedEntry) {
    return appliedEntry.changedAt;
  }

  return record.status === "applied" || record.status === "followed-up" ? record.updatedAt : undefined;
}

function normalizeOffsets(offsets: readonly number[]): number[] {
  return Array.from(
    new Set(
      offsets
        .map((offset) => Math.trunc(offset))
        .filter((offset) => Number.isFinite(offset) && offset > 0)
    )
  ).sort((left, right) => left - right);
}

function buildReason(offsetDays: number): string {
  if (offsetDays <= 3) {
    return `Day ${offsetDays} nudge: confirm the application landed with the hiring team.`;
  }
  if (offsetDays <= 7) {
    return `Day ${offsetDays} follow-up: restate fit and offer a short call.`;
  }
  return `Day ${offsetDays} close-out: ask for a decision or a referral to another opening.`;
}

function buildMessage(
  record: ApplicationRecord,
  offsetDays: number,
  profile?: CandidateProfile
): string {
  const signature = profile?.fullName ?? "";
  const contact = [profile?.email, profile?.phone]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ");

  const opener = `Subject: ${record.jobTitle} application - ${signature || "follow-up"}`;

  const bodyByStage =
    offsetDays <= 3
      ? `I applied for the ${record.jobTitle} role at ${record.company} and wanted to confirm it reached the right person. Happy to send anything else that helps the review.`
      : offsetDays <= 7
        ? `Following up on my application for the ${record.jobTitle} role at ${record.company}. I can walk through how I would run delivery for this scope in a fifteen minute call this week.`
        : `Closing the loop on my application for the ${record.jobTitle} role at ${record.company}. If the role is filled, I would appreciate being considered for similar delivery openings.`;

  return [opener, "", bodyByStage, "", signature, contact].filter((line) => line !== undefined).join("\n");
}
