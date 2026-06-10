import type {
  ApplicationFollowUp,
  ApplicationRecord,
  ApplicationSubmissionAttempt,
  ApplicationStatus,
  AtsAssessment,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";

const APPLICATION_STATUS_ORDER: ApplicationStatus[] = [
  "discovered",
  "screened",
  "tailored",
  "ats-passed",
  "contact-enriched",
  "applied",
  "followed-up",
  "closed"
];

const STATUS_RANK = new Map(APPLICATION_STATUS_ORDER.map((status, index) => [status, index]));

function assertArtifactMatchesApplicationJob(
  record: ApplicationRecord,
  artifactJobId: string,
  artifactLabel: "tailored resume" | "ATS assessment"
): void {
  if (record.jobId === artifactJobId) {
    return;
  }

  throw new Error(
    `Cannot attach ${artifactLabel} for job "${artifactJobId}" to application "${record.id}" for job "${record.jobId}".`
  );
}

function readSubmissionAttempts(record: ApplicationRecord): ApplicationSubmissionAttempt[] {
  return record.submissionAttempts ?? [];
}

function createSubmittedReason(attempt: ApplicationSubmissionAttempt): string {
  if (attempt.platform === "greenhouse") {
    return "Application submitted via Greenhouse Job Board API.";
  }

  return "Application submitted.";
}

export type TrackerMutationOptions = {
  at?: string;
};

export type CreateApplicationRecordInput = {
  job: JobPosting;
  createdAt?: string;
  note?: string;
  initialStatus?: ApplicationStatus;
};

export type FollowUpInput = {
  dueAt: string;
  reason: string;
  note?: string;
  createdAt?: string;
};

export function createApplicationRecord(
  input: CreateApplicationRecordInput
): ApplicationRecord {
  const createdAt = input.createdAt ?? input.job.discoveredAt ?? new Date().toISOString();
  const initialStatus = input.initialStatus ?? "discovered";

  return {
    id: `application:${input.job.id}`,
    jobId: input.job.id,
    jobTitle: input.job.title,
    company: input.job.company,
    sourceName: input.job.source.name,
    location: input.job.location,
    sourceUrl: input.job.source.url,
    applicationUrl: input.job.applicationTarget?.url,
    applicationPlatform: input.job.applicationTarget?.platform,
    status: initialStatus,
    notes: input.note
      ? [
          {
            message: input.note,
            createdAt
          }
        ]
      : [],
    workerDecisions: [],
    statusHistory: [
      {
        status: initialStatus,
        changedAt: createdAt,
        reason: "Application record created."
      }
    ],
    followUps: [],
    submissionAttempts: [],
    createdAt,
    updatedAt: createdAt
  };
}

export function updateApplicationStatus(
  record: ApplicationRecord,
  nextStatus: ApplicationStatus,
  options: TrackerMutationOptions & {
    reason?: string;
    allowRegression?: boolean;
  } = {}
): ApplicationRecord {
  if (record.status === nextStatus) {
    return record;
  }

  const currentRank = STATUS_RANK.get(record.status) ?? 0;
  const nextRank = STATUS_RANK.get(nextStatus) ?? 0;

  if (!options.allowRegression && nextRank < currentRank) {
    throw new Error(
      `Cannot move application status backward from "${record.status}" to "${nextStatus}" without allowRegression.`
    );
  }

  const changedAt = options.at ?? new Date().toISOString();

  return {
    ...record,
    status: nextStatus,
    statusHistory: [
      ...record.statusHistory,
      {
        status: nextStatus,
        changedAt,
        reason: options.reason
      }
    ],
    updatedAt: changedAt
  };
}

export function attachTailoredResumeToRecord(
  record: ApplicationRecord,
  resume: TailoredResume,
  options: TrackerMutationOptions = {}
): ApplicationRecord {
  assertArtifactMatchesApplicationJob(record, resume.jobId, "tailored resume");
  const updatedAt = options.at ?? resume.generatedAt ?? new Date().toISOString();
  const withResume = {
    ...record,
    resumeId: resume.id,
    updatedAt
  };

  if ((STATUS_RANK.get(record.status) ?? 0) >= (STATUS_RANK.get("tailored") ?? 0)) {
    return withResume;
  }

  return updateApplicationStatus(withResume, "tailored", {
    at: updatedAt,
    reason: "Tailored resume attached."
  });
}

export function attachAtsAssessmentToRecord(
  record: ApplicationRecord,
  assessment: AtsAssessment,
  options: TrackerMutationOptions = {}
): ApplicationRecord {
  assertArtifactMatchesApplicationJob(record, assessment.jobId, "ATS assessment");
  const updatedAt = options.at ?? assessment.assessedAt ?? new Date().toISOString();
  const withAssessment = {
    ...record,
    atsScore: assessment.score,
    updatedAt
  };

  if (!assessment.passed) {
    return withAssessment;
  }

  if ((STATUS_RANK.get(record.status) ?? 0) >= (STATUS_RANK.get("ats-passed") ?? 0)) {
    return withAssessment;
  }

  return updateApplicationStatus(withAssessment, "ats-passed", {
    at: updatedAt,
    reason: `ATS threshold met with score ${assessment.score}.`
  });
}

export function applySubmissionAttemptToRecord(
  record: ApplicationRecord,
  attempt: ApplicationSubmissionAttempt
): ApplicationRecord {
  const withAttempt = {
    ...record,
    submissionAttempts: [...readSubmissionAttempts(record), attempt],
    updatedAt: attempt.attemptedAt
  };

  if (attempt.outcome !== "submitted") {
    return withAttempt;
  }

  if ((STATUS_RANK.get(record.status) ?? 0) >= (STATUS_RANK.get("applied") ?? 0)) {
    return withAttempt;
  }

  return updateApplicationStatus(withAttempt, "applied", {
    at: attempt.attemptedAt,
    reason: attempt.confirmationMessage ?? createSubmittedReason(attempt)
  });
}

export function addApplicationNote(
  record: ApplicationRecord,
  message: string,
  options: TrackerMutationOptions = {}
): ApplicationRecord {
  const createdAt = options.at ?? new Date().toISOString();

  return {
    ...record,
    notes: [
      ...record.notes,
      {
        message,
        createdAt
      }
    ],
    updatedAt: createdAt
  };
}

export function addWorkerDecision(
  record: ApplicationRecord,
  decision: string,
  options: TrackerMutationOptions = {}
): ApplicationRecord {
  const createdAt = options.at ?? new Date().toISOString();

  return {
    ...record,
    workerDecisions: [
      ...record.workerDecisions,
      {
        decision,
        createdAt
      }
    ],
    updatedAt: createdAt
  };
}

export function scheduleFollowUp(
  record: ApplicationRecord,
  input: FollowUpInput
): ApplicationRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const followUp: ApplicationFollowUp = {
    id: `${record.id}:follow-up:${record.followUps.length + 1}`,
    dueAt: input.dueAt,
    reason: input.reason,
    status: "scheduled",
    createdAt,
    note: input.note
  };

  return {
    ...record,
    followUps: [...record.followUps, followUp],
    updatedAt: createdAt
  };
}

export function completeFollowUp(
  record: ApplicationRecord,
  followUpId: string,
  options: {
    completedAt?: string;
    note?: string;
  } = {}
): ApplicationRecord {
  const completedAt = options.completedAt ?? new Date().toISOString();
  let found = false;

  const followUps = record.followUps.map((followUp) => {
    if (followUp.id !== followUpId) {
      return followUp;
    }

    found = true;

    return {
      ...followUp,
      status: "completed" as const,
      completedAt,
      note: options.note ?? followUp.note
    };
  });

  if (!found) {
    throw new Error(`Follow-up "${followUpId}" was not found on application "${record.id}".`);
  }

  return {
    ...record,
    followUps,
    updatedAt: completedAt
  };
}

export function getOutstandingFollowUps(
  record: ApplicationRecord,
  asOf = new Date().toISOString()
): ApplicationFollowUp[] {
  return record.followUps
    .filter((followUp) => followUp.status === "scheduled")
    .sort((left, right) => {
      const leftIsOverdue = left.dueAt < asOf;
      const rightIsOverdue = right.dueAt < asOf;

      if (leftIsOverdue !== rightIsOverdue) {
        return leftIsOverdue ? -1 : 1;
      }

      return left.dueAt.localeCompare(right.dueAt);
    });
}
