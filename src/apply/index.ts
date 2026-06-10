import { Buffer } from "node:buffer";
import { access, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import type {
  ApplicationDocumentReference,
  ApplicationPlatform,
  ApplicationRecord,
  ApplicationSubmissionAttempt,
  AutomationMode,
  CandidateProfile,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";
import { applySubmissionAttemptToRecord } from "../tracker/index.js";

const GREENHOUSE_API_BASE_URL = "https://boards-api.greenhouse.io/v1";
const GREENHOUSE_JOB_BOARD_API_KEY_ENV = "GREENHOUSE_JOB_BOARD_API_KEY";
const SUPPORTED_GREENHOUSE_RESUME_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf"]);

type GreenhouseQuestionOption = {
  value: string | number;
  label: string;
};

type GreenhouseQuestionField = {
  name: string;
  type: string;
  values?: GreenhouseQuestionOption[];
};

type GreenhouseQuestion = {
  label: string;
  required: boolean;
  fields: GreenhouseQuestionField[];
};

type GreenhouseDataComplianceRule = {
  type?: string;
  requires_consent?: boolean;
  requires_processing_consent?: boolean;
  requires_retention_consent?: boolean;
};

type GreenhouseJobQuestionsResponse = {
  questions?: GreenhouseQuestion[];
  location_questions?: GreenhouseQuestion[];
  data_compliance?: GreenhouseDataComplianceRule[];
};

type PreparedFileUpload = ApplicationDocumentReference & {
  contentType: string;
};

type PreparedApplicationField = {
  name: string;
  value: string | readonly string[] | PreparedFileUpload;
};

type GreenhouseSubmissionTarget = {
  boardToken: string;
  jobId: string;
  targetUrl: string;
  submissionUrl: string;
};

type ApplicationAdapter = {
  platform: ApplicationPlatform;
  submit: (
    prepared: PreparedJobApplication,
    options: ApplySubmissionOptions
  ) => Promise<ApplicationSubmissionAttempt>;
};

export type GreenhouseDataConsent = {
  gdprConsentGiven?: boolean;
  gdprProcessingConsentGiven?: boolean;
  gdprRetentionConsentGiven?: boolean;
};

export type ApplySubmissionOptions = {
  mode?: AutomationMode;
  greenhouseJobBoardApiKey?: string;
  dataConsent?: GreenhouseDataConsent;
  fetchImpl?: typeof fetch;
  now?: string;
};

export type PreparedJobApplication = {
  job: JobPosting;
  applicationRecord: ApplicationRecord;
  profile: CandidateProfile;
  tailoredResume: TailoredResume;
  mode: AutomationMode;
  platform: ApplicationPlatform;
  targetUrl: string;
  submissionUrl: string;
  uploadedDocuments: ApplicationDocumentReference[];
  fields: PreparedApplicationField[];
};

export type ApplicationPreparationResult =
  | {
      ready: true;
      prepared: PreparedJobApplication;
    }
  | {
      ready: false;
      attempt: ApplicationSubmissionAttempt;
      reason: string;
    };

export type ApplicationSubmissionResult = {
  applicationRecord: ApplicationRecord;
  attempt: ApplicationSubmissionAttempt;
};

export async function prepareJobApplicationSubmission(
  job: JobPosting,
  applicationRecord: ApplicationRecord,
  profile: CandidateProfile,
  tailoredResume: TailoredResume,
  options: ApplySubmissionOptions = {}
): Promise<ApplicationPreparationResult> {
  const attemptedAt = normalizeTimestamp(options.now);
  const mode = options.mode ?? "observe";

  if (applicationRecord.jobId !== job.id) {
    throw new Error(
      `Cannot prepare an application for job "${job.id}" using record "${applicationRecord.id}".`
    );
  }

  if (tailoredResume.jobId !== job.id) {
    throw new Error(
      `Cannot prepare an application for job "${job.id}" using resume "${tailoredResume.id}".`
    );
  }

  if (mode !== "supervised") {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      job.applicationTarget?.url ?? job.source.url ?? "unknown",
      "The first outbound adapter only submits in supervised mode."
    );
  }

  if (hasSubmittedApplication(applicationRecord) || applicationRecord.status === "applied") {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      job.applicationTarget?.url ?? job.source.url ?? "unknown",
      "This job is already recorded as submitted."
    );
  }

  if (applicationRecord.status !== "ats-passed") {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      job.applicationTarget?.url ?? job.source.url ?? "unknown",
      "The ATS readiness gate must pass before a live application can be submitted."
    );
  }

  const platform = detectApplicationPlatform(job);

  if (platform !== "greenhouse") {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      job.applicationTarget?.url ?? job.source.url ?? "unknown",
      "No supported outbound application adapter was detected for this job."
    );
  }

  if (!readGreenhouseApiKey(options)) {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      job.applicationTarget?.url ?? job.source.url ?? "unknown",
      `Set ${GREENHOUSE_JOB_BOARD_API_KEY_ENV} or pass greenhouseJobBoardApiKey before submitting Greenhouse applications.`
    );
  }

  const target = resolveGreenhouseSubmissionTarget(job);

  if (!target) {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      job.applicationTarget?.url ?? job.source.url ?? "unknown",
      "An official Greenhouse application URL with board token and job id is required before submission."
    );
  }

  let questionnaire: GreenhouseJobQuestionsResponse;

  try {
    questionnaire = await fetchGreenhouseQuestions(target, options.fetchImpl ?? fetch);
  } catch (error) {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      target.targetUrl,
      error instanceof Error ? error.message : String(error),
      "greenhouse",
      target.submissionUrl
    );
  }

  if ((questionnaire.location_questions ?? []).some((question) => question.required)) {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      target.targetUrl,
      "Greenhouse jobs with required location questions are not automated in the first adapter.",
      "greenhouse",
      target.submissionUrl
    );
  }

  const resumeDocument = await resolveResumeUpload(profile, tailoredResume);

  if (!resumeDocument) {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      target.targetUrl,
      "A supported resume file (PDF, DOC, DOCX, TXT, or RTF) is required before submission.",
      "greenhouse",
      target.submissionUrl
    );
  }

  const requestFields = buildGreenhouseRequestFields(
    questionnaire,
    job,
    profile,
    tailoredResume,
    resumeDocument,
    target.targetUrl,
    options.dataConsent
  );

  if ("reason" in requestFields) {
    return createReviewPreparation(
      applicationRecord,
      mode,
      attemptedAt,
      target.targetUrl,
      requestFields.reason,
      "greenhouse",
      target.submissionUrl,
      [resumeDocument]
    );
  }

  return {
    ready: true,
    prepared: {
      job,
      applicationRecord,
      profile,
      tailoredResume,
      mode,
      platform: "greenhouse",
      targetUrl: target.targetUrl,
      submissionUrl: target.submissionUrl,
      uploadedDocuments: [resumeDocument],
      fields: requestFields.fields
    }
  };
}

export function detectApplicationPlatform(job: JobPosting): ApplicationPlatform | undefined {
  if (job.applicationTarget?.platform) {
    return job.applicationTarget.platform;
  }

  const possibleUrl = job.applicationTarget?.url ?? job.source.url;
  const parsed = tryParseUrl(possibleUrl);

  if (!parsed) {
    return undefined;
  }

  if (
    parsed.hostname === "boards.greenhouse.io" ||
    parsed.hostname === "job-boards.greenhouse.io" ||
    parsed.hostname === "boards-api.greenhouse.io"
  ) {
    return "greenhouse";
  }

  if (parsed.searchParams.has("gh_jid") && parsed.hostname.includes(".")) {
    return "greenhouse";
  }

  return undefined;
}

export function selectApplicationAdapter(
  prepared: PreparedJobApplication
): ApplicationAdapter | undefined {
  return prepared.platform === "greenhouse" ? greenhouseApplicationAdapter : undefined;
}

export async function submitPreparedJobApplication(
  prepared: PreparedJobApplication,
  options: ApplySubmissionOptions = {}
): Promise<ApplicationSubmissionAttempt> {
  const adapter = selectApplicationAdapter(prepared);

  if (!adapter) {
    return createSubmissionAttempt(prepared.applicationRecord, {
      attemptedAt: normalizeTimestamp(options.now),
      mode: prepared.mode,
      platform: "unsupported",
      outcome: "review-needed",
      method: "manual-review",
      targetUrl: prepared.targetUrl,
      uploadedDocuments: prepared.uploadedDocuments,
      failureReason: "No outbound adapter is available for the prepared job application."
    });
  }

  return adapter.submit(prepared, options);
}

export async function submitJobApplication(
  job: JobPosting,
  applicationRecord: ApplicationRecord,
  profile: CandidateProfile,
  tailoredResume: TailoredResume,
  options: ApplySubmissionOptions = {}
): Promise<ApplicationSubmissionResult> {
  const preparation = await prepareJobApplicationSubmission(
    job,
    applicationRecord,
    profile,
    tailoredResume,
    options
  );

  if (!preparation.ready) {
    return {
      applicationRecord: applySubmissionAttemptToRecord(applicationRecord, preparation.attempt),
      attempt: preparation.attempt
    };
  }

  const attempt = await submitPreparedJobApplication(preparation.prepared, options);

  return {
    applicationRecord: applySubmissionAttemptToRecord(applicationRecord, attempt),
    attempt
  };
}

const greenhouseApplicationAdapter: ApplicationAdapter = {
  platform: "greenhouse",
  submit: async (prepared, options) => {
    const apiKey = readGreenhouseApiKey(options);

    if (!apiKey) {
      return createSubmissionAttempt(prepared.applicationRecord, {
        attemptedAt: normalizeTimestamp(options.now),
        mode: prepared.mode,
        platform: "greenhouse",
        outcome: "review-needed",
        method: "manual-review",
        targetUrl: prepared.targetUrl,
        submissionUrl: prepared.submissionUrl,
        uploadedDocuments: prepared.uploadedDocuments,
        failureReason: `Set ${GREENHOUSE_JOB_BOARD_API_KEY_ENV} or pass greenhouseJobBoardApiKey before submitting Greenhouse applications.`
      });
    }

    try {
      const response = await (options.fetchImpl ?? fetch)(prepared.submissionUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
        },
        body: await buildMultipartFormData(prepared.fields)
      });
      const responseBody = await readResponseBody(response);

      if (!response.ok) {
        return createSubmissionAttempt(prepared.applicationRecord, {
          attemptedAt: normalizeTimestamp(options.now),
          mode: prepared.mode,
          platform: "greenhouse",
          outcome: "failed",
          method: "greenhouse-job-board-api",
          targetUrl: prepared.targetUrl,
          submissionUrl: prepared.submissionUrl,
          uploadedDocuments: prepared.uploadedDocuments,
          responseStatus: response.status,
          failureReason: readFailureReason(responseBody, response.status)
        });
      }

      return createSubmissionAttempt(prepared.applicationRecord, {
        attemptedAt: normalizeTimestamp(options.now),
        mode: prepared.mode,
        platform: "greenhouse",
        outcome: "submitted",
        method: "greenhouse-job-board-api",
        targetUrl: prepared.targetUrl,
        submissionUrl: prepared.submissionUrl,
        uploadedDocuments: prepared.uploadedDocuments,
        responseStatus: response.status,
        confirmationMessage: readConfirmationMessage(responseBody)
      });
    } catch (error) {
      return createSubmissionAttempt(prepared.applicationRecord, {
        attemptedAt: normalizeTimestamp(options.now),
        mode: prepared.mode,
        platform: "greenhouse",
        outcome: "failed",
        method: "greenhouse-job-board-api",
        targetUrl: prepared.targetUrl,
        submissionUrl: prepared.submissionUrl,
        uploadedDocuments: prepared.uploadedDocuments,
        failureReason: error instanceof Error ? error.message : String(error)
      });
    }
  }
};

function createReviewPreparation(
  applicationRecord: ApplicationRecord,
  mode: AutomationMode,
  attemptedAt: string,
  targetUrl: string,
  reason: string,
  platform: ApplicationPlatform | "unsupported" = "unsupported",
  submissionUrl?: string,
  uploadedDocuments: ApplicationDocumentReference[] = []
): ApplicationPreparationResult {
  return {
    ready: false,
    reason,
    attempt: createSubmissionAttempt(applicationRecord, {
      attemptedAt,
      mode,
      platform,
      outcome: "review-needed",
      method: "manual-review",
      targetUrl,
      submissionUrl,
      uploadedDocuments,
      failureReason: reason
    })
  };
}

function createSubmissionAttempt(
  applicationRecord: ApplicationRecord,
  input: Omit<ApplicationSubmissionAttempt, "id">
): ApplicationSubmissionAttempt {
  return {
    id: `${applicationRecord.id}:submission:${(applicationRecord.submissionAttempts?.length ?? 0) + 1}`,
    ...input
  };
}

function hasSubmittedApplication(applicationRecord: ApplicationRecord): boolean {
  return (applicationRecord.submissionAttempts ?? []).some(
    (submissionAttempt) => submissionAttempt.outcome === "submitted"
  );
}

async function fetchGreenhouseQuestions(
  target: GreenhouseSubmissionTarget,
  fetchImpl: typeof fetch
): Promise<GreenhouseJobQuestionsResponse> {
  const questionsUrl = new URL(target.submissionUrl);
  questionsUrl.searchParams.set("questions", "true");
  const response = await fetchImpl(questionsUrl);

  if (!response.ok) {
    throw new Error(
      `Greenhouse question schema lookup failed with status ${response.status}.`
    );
  }

  return (await response.json()) as GreenhouseJobQuestionsResponse;
}

function resolveGreenhouseSubmissionTarget(
  job: JobPosting
): GreenhouseSubmissionTarget | undefined {
  const targetUrl = job.applicationTarget?.url ?? job.source.url;
  const explicitBoardToken = job.applicationTarget?.boardToken;
  const explicitJobId = job.applicationTarget?.jobId;
  const parsedUrlTarget = targetUrl ? parseGreenhouseTargetFromUrl(targetUrl) : undefined;
  const boardToken = explicitBoardToken ?? parsedUrlTarget?.boardToken;
  const jobId = explicitJobId ?? parsedUrlTarget?.jobId;

  if (!targetUrl || !boardToken || !jobId) {
    return undefined;
  }

  return {
    boardToken,
    jobId,
    targetUrl,
    submissionUrl:
      job.applicationTarget?.submissionUrl ??
      `${GREENHOUSE_API_BASE_URL}/boards/${boardToken}/jobs/${jobId}`
  };
}

function parseGreenhouseTargetFromUrl(
  value: string
): Partial<Pick<GreenhouseSubmissionTarget, "boardToken" | "jobId">> | undefined {
  const parsed = tryParseUrl(value);

  if (!parsed) {
    return undefined;
  }

  if (parsed.pathname === "/embed/job_app") {
    const boardToken = parsed.searchParams.get("for") ?? undefined;
    const jobId = parsed.searchParams.get("token") ?? undefined;

    return boardToken && jobId ? { boardToken, jobId } : undefined;
  }

  const directMatch = parsed.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);

  if (directMatch) {
    return {
      boardToken: directMatch[1],
      jobId: directMatch[2]
    };
  }

  const jobId = parsed.searchParams.get("gh_jid") ?? undefined;

  return jobId ? { jobId } : undefined;
}

async function resolveResumeUpload(
  profile: CandidateProfile,
  tailoredResume: TailoredResume
): Promise<PreparedFileUpload | undefined> {
  const candidatePaths: ApplicationDocumentReference[] = [];

  if (tailoredResume.outputPath && isSupportedResumeExtension(tailoredResume.outputPath)) {
    candidatePaths.push({
      kind: "resume",
      label: "Tailored resume artifact",
      path: tailoredResume.outputPath,
      source: "tailored-resume"
    });
  }

  candidatePaths.push(
    ...profile.documents
      .filter((document) => isSupportedResumeExtension(document.path))
      .sort((left, right) => rankResumeDocument(left) - rankResumeDocument(right))
      .map((document) => ({
        kind: "resume" as const,
        label: document.description,
        path: document.path,
        source: "candidate-profile" as const
      }))
  );

  for (const document of candidatePaths) {
    try {
      await access(document.path);
      return {
        ...document,
        contentType: readContentType(document.path)
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function buildGreenhouseRequestFields(
  questionnaire: GreenhouseJobQuestionsResponse,
  job: JobPosting,
  profile: CandidateProfile,
  tailoredResume: TailoredResume,
  resumeDocument: PreparedFileUpload,
  targetUrl: string,
  dataConsent: GreenhouseDataConsent | undefined
): { fields: PreparedApplicationField[] } | { reason: string } {
  const fields: PreparedApplicationField[] = [];
  const answerMap = createRecurringAnswerMap(profile);
  const nameParts = splitCandidateName(profile);

  for (const question of questionnaire.questions ?? []) {
    const questionFields = resolveGreenhouseQuestionFields(
      question,
      job,
      profile,
      tailoredResume,
      answerMap,
      nameParts,
      resumeDocument
    );

    if ("reason" in questionFields) {
      return questionFields;
    }

    fields.push(...questionFields.fields);
  }

  const complianceFields = buildGreenhouseComplianceFields(questionnaire.data_compliance, dataConsent);

  if ("reason" in complianceFields) {
    return complianceFields;
  }

  fields.push(...complianceFields.fields);

  const mappedUrlToken = readMappedUrlToken(targetUrl);

  if (mappedUrlToken) {
    fields.push({
      name: "mapped_url_token",
      value: mappedUrlToken
    });
  }

  if (!fields.some((field) => field.name === "resume")) {
    return {
      reason: "Greenhouse did not expose a supported resume upload field for this job."
    };
  }

  return { fields };
}

function resolveGreenhouseQuestionFields(
  question: GreenhouseQuestion,
  job: JobPosting,
  profile: CandidateProfile,
  tailoredResume: TailoredResume,
  answerMap: Map<string, string>,
  nameParts: { firstName?: string; lastName?: string },
  resumeDocument: PreparedFileUpload
): { fields: PreparedApplicationField[] } | { reason: string } {
  if (isResumeQuestion(question)) {
    return {
      fields: [
        {
          name: "resume",
          value: resumeDocument
        }
      ]
    };
  }

  if (question.fields.length > 1) {
    return {
      reason: `Question "${question.label}" has multiple fields and needs a manual review in the first adapter.`
    };
  }

  const [field] = question.fields;

  if (!field) {
    return question.required
      ? { reason: `Question "${question.label}" did not expose a usable field.` }
      : { fields: [] };
  }

  switch (field.name) {
    case "first_name":
      return readRequiredTextField(question.label, field.name, nameParts.firstName, question.required);
    case "last_name":
      return readRequiredTextField(question.label, field.name, nameParts.lastName, question.required);
    case "email":
      return readRequiredTextField(question.label, field.name, profile.email, question.required);
    case "phone":
      return readRequiredTextField(question.label, field.name, profile.phone, question.required);
    default:
      return readCustomQuestionField(question, field, answerMap, job, tailoredResume);
  }
}

function readRequiredTextField(
  label: string,
  fieldName: string,
  value: string | undefined,
  required: boolean
): { fields: PreparedApplicationField[] } | { reason: string } {
  if (!value) {
    return required
      ? { reason: `Question "${label}" is required before submission.` }
      : { fields: [] };
  }

  return {
    fields: [
      {
        name: fieldName,
        value
      }
    ]
  };
}

function readCustomQuestionField(
  question: GreenhouseQuestion,
  field: GreenhouseQuestionField,
  answerMap: Map<string, string>,
  job: JobPosting,
  tailoredResume: TailoredResume
): { fields: PreparedApplicationField[] } | { reason: string } {
  const answer =
    answerMap.get(normalizeAnswerKey(question.label)) ??
    answerMap.get(normalizeAnswerKey(field.name)) ??
    readBuiltInQuestionAnswer(question.label, job, tailoredResume);

  switch (field.type) {
    case "input_text":
    case "textarea": {
      if (!answer) {
        return question.required
          ? { reason: `Question "${question.label}" is required before submission.` }
          : { fields: [] };
      }

      return {
        fields: [
          {
            name: field.name,
            value: answer
          }
        ]
      };
    }
    case "multi_value_single_select": {
      if (!answer) {
        return question.required
          ? { reason: `Question "${question.label}" is required before submission.` }
          : { fields: [] };
      }

      const selectedValue = readSelectValue(answer, field.values ?? []);

      return selectedValue
        ? {
            fields: [
              {
                name: field.name,
                value: selectedValue
              }
            ]
          }
        : {
            reason: `Question "${question.label}" needs a supported answer before submission.`
          };
    }
    case "multi_value_multi_select": {
      if (!answer) {
        return question.required
          ? { reason: `Question "${question.label}" is required before submission.` }
          : { fields: [] };
      }

      const selectedValues = splitMultiValueAnswer(answer)
        .map((value) => readSelectValue(value, field.values ?? []))
        .filter((value): value is string => typeof value === "string");

      if (selectedValues.length === 0) {
        return {
          reason: `Question "${question.label}" needs one or more supported answers before submission.`
        };
      }

      return {
        fields: [
          {
            name: field.name,
            value: selectedValues
          }
        ]
      };
    }
    case "input_hidden":
      return question.required
        ? { reason: `Question "${question.label}" requires hidden data that the first adapter does not infer automatically.` }
        : { fields: [] };
    case "input_file":
      return {
        reason: `Question "${question.label}" expects a file upload that the first adapter does not map automatically.`
      };
    default:
      return question.required
        ? { reason: `Question "${question.label}" uses unsupported field type "${field.type}".` }
        : { fields: [] };
  }
}

function buildGreenhouseComplianceFields(
  rules: GreenhouseDataComplianceRule[] | undefined,
  dataConsent: GreenhouseDataConsent | undefined
): { fields: PreparedApplicationField[] } | { reason: string } {
  const fields: PreparedApplicationField[] = [];

  for (const rule of rules ?? []) {
    if (rule.requires_consent) {
      if (dataConsent?.gdprConsentGiven !== true) {
        return {
          reason: "Greenhouse GDPR consent must be provided before submission."
        };
      }

      fields.push({
        name: "data_compliance[gdpr_consent_given]",
        value: "true"
      });
    }

    if (rule.requires_processing_consent) {
      if (dataConsent?.gdprProcessingConsentGiven !== true) {
        return {
          reason: "Greenhouse processing consent must be provided before submission."
        };
      }

      fields.push({
        name: "data_compliance[gdpr_processing_consent_given]",
        value: "true"
      });
    }

    if (rule.requires_retention_consent) {
      if (dataConsent?.gdprRetentionConsentGiven !== true) {
        return {
          reason: "Greenhouse retention consent must be provided before submission."
        };
      }

      fields.push({
        name: "data_compliance[gdpr_retention_consent_given]",
        value: "true"
      });
    }
  }

  return { fields };
}

function readBuiltInQuestionAnswer(
  label: string,
  job: JobPosting,
  tailoredResume: TailoredResume
): string | undefined {
  const normalizedLabel = normalizeAnswerKey(label);

  if (normalizedLabel === "why-are-you-a-fit-for-this-role") {
    return tailoredResume.tailoredSummary;
  }

  if (normalizedLabel === "why-do-you-want-this-role") {
    return `I am applying for ${job.title} because it matches my background in ${job.detectedRoleFamily ?? "operations delivery"}.`;
  }

  return undefined;
}

function createRecurringAnswerMap(profile: CandidateProfile): Map<string, string> {
  return new Map(
    profile.recurringAnswers.flatMap((answer) => [
      [normalizeAnswerKey(answer.question), answer.answer] as const,
      [normalizeAnswerKey(answer.key), answer.answer] as const
    ])
  );
}

function splitCandidateName(profile: CandidateProfile): {
  firstName?: string;
  lastName?: string;
} {
  const preferredNameParts = splitNameParts(profile.preferredName);
  const fullNameParts = splitNameParts(profile.fullName);

  return {
    firstName: preferredNameParts[0] ?? fullNameParts[0],
    lastName:
      (preferredNameParts.length > 1 ? preferredNameParts.slice(1).join(" ") : undefined) ??
      (fullNameParts.length > 1 ? fullNameParts.slice(1).join(" ") : undefined)
  };
}

function splitNameParts(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function splitMultiValueAnswer(answer: string): string[] {
  return answer
    .split(/[,\n;]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readSelectValue(answer: string, values: GreenhouseQuestionOption[]): string | undefined {
  const normalizedAnswer = normalizeAnswerKey(answer);
  const matchingValue = values.find((value) => {
    return (
      normalizeAnswerKey(value.label) === normalizedAnswer ||
      normalizeAnswerKey(String(value.value)) === normalizedAnswer
    );
  });

  return matchingValue ? String(matchingValue.value) : undefined;
}

function normalizeAnswerKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isResumeQuestion(question: GreenhouseQuestion): boolean {
  return (
    /resume|cv/i.test(question.label) ||
    question.fields.some((field) => field.name === "resume" || field.name === "resume_text")
  );
}

function readMappedUrlToken(targetUrl: string): string | undefined {
  const parsed = tryParseUrl(targetUrl);
  return parsed?.searchParams.get("gh_src") ?? undefined;
}

function readGreenhouseApiKey(options: ApplySubmissionOptions): string | undefined {
  const configuredKey = options.greenhouseJobBoardApiKey?.trim();

  if (configuredKey) {
    return configuredKey;
  }

  const envKey = process.env[GREENHOUSE_JOB_BOARD_API_KEY_ENV]?.trim();
  return envKey && envKey.length > 0 ? envKey : undefined;
}

async function buildMultipartFormData(
  fields: PreparedApplicationField[]
): Promise<FormData> {
  const formData = new FormData();

  for (const field of fields) {
    if (Array.isArray(field.value)) {
      field.value.forEach((value) => formData.append(field.name, value));
      continue;
    }

    if (isPreparedFileUpload(field.value)) {
      const file = await createUploadFile(field.value);
      formData.append(field.name, file);
      continue;
    }

    if (typeof field.value === "string") {
      formData.append(field.name, field.value);
    }
  }

  return formData;
}

function isPreparedFileUpload(value: PreparedApplicationField["value"]): value is PreparedFileUpload {
  return typeof value === "object" && value !== null && "contentType" in value;
}

async function createUploadFile(fileUpload: PreparedFileUpload): Promise<File> {
  const fileBuffer = await readFile(fileUpload.path);

  return new File([fileBuffer], basename(fileUpload.path), {
    type: fileUpload.contentType
  });
}

function readContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".rtf":
      return "application/rtf";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function isSupportedResumeExtension(path: string): boolean {
  return SUPPORTED_GREENHOUSE_RESUME_EXTENSIONS.has(extname(path).toLowerCase());
}

function rankResumeDocument(document: { key?: string; label?: string; description?: string }): number {
  const haystack = `${document.key ?? ""} ${document.label ?? ""} ${document.description ?? ""}`.toLowerCase();

  if (haystack.includes("cv") || haystack.includes("resume")) {
    return 0;
  }

  return 1;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function readConfirmationMessage(responseBody: unknown): string {
  if (typeof responseBody === "string" && responseBody.trim().length > 0) {
    return responseBody.trim();
  }

  if (isRecord(responseBody)) {
    if (typeof responseBody.message === "string" && responseBody.message.trim().length > 0) {
      return responseBody.message.trim();
    }

    if (typeof responseBody.status === "string" && responseBody.status.trim().length > 0) {
      return `Greenhouse application submitted (${responseBody.status.trim()}).`;
    }
  }

  return "Application submitted via Greenhouse Job Board API.";
}

function readFailureReason(responseBody: unknown, statusCode: number): string {
  if (typeof responseBody === "string" && responseBody.trim().length > 0) {
    return responseBody.trim();
  }

  if (isRecord(responseBody)) {
    if (typeof responseBody.error === "string" && responseBody.error.trim().length > 0) {
      return responseBody.error.trim();
    }

    if (typeof responseBody.message === "string" && responseBody.message.trim().length > 0) {
      return responseBody.message.trim();
    }
  }

  return `Greenhouse submission failed with status ${statusCode}.`;
}

function tryParseUrl(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export const applyModule = {
  key: "apply",
  summary: "Prepare and submit supported outbound applications with auditable fallbacks.",
  responsibilities: [
    "Validate outbound submission prerequisites before a live apply attempt.",
    "Submit supported Greenhouse applications with tracked evidence and outcomes.",
    "Fallback to review when a job, answer set, or credential is unsupported."
  ]
} as const;
