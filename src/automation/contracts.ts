import type { AutomationMode, JsonValue } from "../shared/contracts.js";

export const MAX_DAILY_APPLICATION_CAP = 5;
export const MAX_EMPLOYER_COOLDOWN_DAYS = 365;

export type SourceCapability = "structured-submit" | "prefill-only" | "review-only";
export type AutomationSourceKind = "greenhouse" | "lever" | "workable" | "company-page" | "job-board" | "manual";
export type AnswerApproval = "auto-submit" | "review-only";
export type AnswerProvenanceSourceKind = "candidate-profile" | "cv" | "manual";
export type ReviewReason =
  | "unsupported-platform"
  | "unverified-answer"
  | "missing-evidence"
  | "consent-required"
  | "daily-cap-exceeded"
  | "employer-cooldown-active"
  | "unknown-required-question"
  | "source-not-trusted"
  | "source-stale";
export type AutomationRunStatus = "running" | "completed" | "failed" | "skipped";

export type ApplicationCapConfig = {
  dailyApplications: number;
  maxApplicationsPerEmployer: number;
  employerCooldownDays: number;
};

export type AutomationThresholdConfig = {
  minFitScore: number;
  minAtsScore: number;
};

export type AutomationSourceConfig = {
  id: string;
  kind: AutomationSourceKind;
  capability: SourceCapability;
  enabled: boolean;
  boardToken?: string;
  siteToken?: string;
};

export type AnswerProvenance = {
  sourceKind: AnswerProvenanceSourceKind;
  sourceRef: string;
  verifiedAt: string;
};

export type ApprovedRecurringAnswer = {
  key: string;
  value: JsonValue;
  approval: AnswerApproval;
  provenance: AnswerProvenance;
};

export type AutomationDeskConfig = {
  version: 1;
  timeZone: string;
  automationMode: AutomationMode;
  /** Disabled by default; enables only configured structured-channel full-auto submissions. */
  autoSubmitEnabled: boolean;
  caps: ApplicationCapConfig;
  thresholds: AutomationThresholdConfig;
  sources: AutomationSourceConfig[];
  answers: ApprovedRecurringAnswer[];
};

export type AutomationRunCounts = {
  discovered: number;
  qualified: number;
  queued: number;
  submitted: number;
  reviewRequired: number;
  failed: number;
};

export type AutomationRun = {
  id: string;
  idempotencyKey: string;
  configVersion: number;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt?: string;
  counts: AutomationRunCounts;
  errorSummary?: string;
};

export function validateAutomationDeskConfig(input: unknown): AutomationDeskConfig {
  const value = asRecord(input, "Automation configuration must be an object.");
  const caps = asRecord(value.caps, "Automation configuration requires caps.");
  const thresholds = asRecord(value.thresholds, "Automation configuration requires thresholds.");
  const rawSources = asArray(value.sources, "Automation configuration requires at least one source.");
  const rawAnswers = asArray(value.answers, "Automation configuration requires an answers array.");

  if (value.version !== 1) {
    throw new Error("Automation configuration version must be 1.");
  }

  const timeZone = requireString(value.timeZone, "timeZone");
  const automationMode = requireAutomationMode(value.automationMode);
  const autoSubmitEnabled = readBooleanWithDefault(value.autoSubmitEnabled, "autoSubmitEnabled", false);
  const parsedCaps: ApplicationCapConfig = {
    dailyApplications: requireIntegerInRange(caps.dailyApplications, "dailyApplications", 0, MAX_DAILY_APPLICATION_CAP),
    maxApplicationsPerEmployer: requireIntegerInRange(caps.maxApplicationsPerEmployer, "maxApplicationsPerEmployer", 0, MAX_DAILY_APPLICATION_CAP),
    employerCooldownDays: requireIntegerInRange(
      caps.employerCooldownDays,
      "employerCooldownDays",
      0,
      MAX_EMPLOYER_COOLDOWN_DAYS
    )
  };
  const parsedThresholds: AutomationThresholdConfig = {
    minFitScore: requireIntegerInRange(thresholds.minFitScore, "minFitScore", 0, 100),
    minAtsScore: requireIntegerInRange(thresholds.minAtsScore, "minAtsScore", 0, 100)
  };

  if (autoSubmitEnabled && automationMode !== "full-auto") {
    throw new Error("autoSubmitEnabled requires automationMode to be full-auto.");
  }

  if (parsedCaps.maxApplicationsPerEmployer > parsedCaps.dailyApplications) {
    throw new Error("maxApplicationsPerEmployer cannot exceed dailyApplications.");
  }

  const sources = rawSources.map(parseSource);
  if (sources.length === 0) {
    throw new Error("Automation configuration requires at least one source.");
  }
  assertUnique(sources.map((source) => source.id), "source id");

  const answers = rawAnswers.map(parseAnswer);
  assertUnique(answers.map((answer) => answer.key), "answer key");

  return {
    version: 1,
    timeZone,
    automationMode,
    autoSubmitEnabled,
    caps: parsedCaps,
    thresholds: parsedThresholds,
    sources,
    answers
  };
}

export function findReusableApprovedAnswer(
  answers: ApprovedRecurringAnswer[],
  key: string
): ApprovedRecurringAnswer | undefined {
  return answers.find((answer) => answer.key === key && answer.approval === "auto-submit");
}

function parseSource(input: unknown): AutomationSourceConfig {
  const value = asRecord(input, "Each automation source must be an object.");
  const kind = requireEnum(
    value.kind,
    "source kind",
    ["greenhouse", "lever", "workable", "company-page", "job-board", "manual"] as const
  );
  const capability = requireEnum(
    value.capability,
    "source capability",
    ["structured-submit", "prefill-only", "review-only"] as const
  );
  const source: AutomationSourceConfig = {
    id: requireIdentifier(value.id, "source id"),
    kind,
    capability,
    enabled: requireBoolean(value.enabled, "source enabled")
  };

  if (typeof value.boardToken === "string" && value.boardToken.trim()) {
    source.boardToken = value.boardToken.trim();
  }
  if (typeof value.siteToken === "string" && value.siteToken.trim()) {
    source.siteToken = value.siteToken.trim();
  }

  if ((kind === "lever" || kind === "workable") && !source.siteToken) {
    throw new Error(`${kind} sources require a siteToken.`);
  }

  if (capability === "structured-submit") {
    if (kind !== "greenhouse" || !source.boardToken) {
      throw new Error("structured-submit sources must be configured as a Greenhouse source with a boardToken.");
    }
  }

  return source;
}

function parseAnswer(input: unknown): ApprovedRecurringAnswer {
  const value = asRecord(input, "Each recurring answer must be an object.");
  const approval = requireEnum(value.approval, "answer approval", ["auto-submit", "review-only"] as const);
  const provenance = asRecord(value.provenance, "Each recurring answer requires provenance.");
  const verifiedAt = requireTimestamp(provenance.verifiedAt, "answer provenance verifiedAt");

  return {
    key: requireIdentifier(value.key, "answer key"),
    value: requireJsonValue(value.value, "answer value"),
    approval,
    provenance: {
      sourceKind: requireEnum(
        provenance.sourceKind,
        "answer provenance sourceKind",
        ["candidate-profile", "cv", "manual"] as const
      ),
      sourceRef: requireString(provenance.sourceRef, "answer provenance sourceRef"),
      verifiedAt
    }
  };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireAutomationMode(value: unknown): AutomationMode {
  return requireEnum(value, "automationMode", ["observe", "supervised", "full-auto"] as const);
}

function requireIdentifier(value: unknown, label: string): string {
  const identifier = requireString(value, label);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(identifier)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, and hyphens.`);
  }
  return identifier;
}

function readBooleanWithDefault(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return requireBoolean(value, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }
  return value;
}

function requireIntegerInRange(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requireEnum<T extends readonly string[]>(value: unknown, label: string, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${label} must be one of: ${values.join(", ")}.`);
  }
  return value as T[number];
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp;
}

function requireJsonValue(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => requireJsonValue(entry, label));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, requireJsonValue(entry, label)])
    );
  }
  throw new Error(`${label} must be JSON-compatible.`);
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Each ${label} must be unique.`);
  }
}
