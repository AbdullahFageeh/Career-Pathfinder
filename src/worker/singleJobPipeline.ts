import {
  submitJobApplication,
  type ApplySubmissionOptions
} from "../apply/index.js";
import { scoreAtsReadiness, type AtsScoringOptions } from "../ats/index.js";
import {
  ingestJobPosting,
  type IngestJobPostingInput,
  type IngestJobPostingOptions
} from "../ingest/index.js";
import {
  loadCandidateProfile,
  type CandidateProfileLoadOptions
} from "../profile/index.js";
import {
  renderTailoredResumeArtifact,
  type RenderTailoredResumeOptions
} from "../render/index.js";
import {
  createSqliteStorage,
  type PipelineStorage,
  type StorageOptions
} from "../storage/index.js";
import { buildTailoredResume, type TailorResumeOptions } from "../tailor/index.js";
import {
  attachAtsAssessmentToRecord,
  attachTailoredResumeToRecord,
  createApplicationRecord
} from "../tracker/index.js";
import type {
  ApplicationRecord,
  ApplicationSubmissionAttempt,
  AtsAssessment,
  CandidateProfile,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";

export type SingleJobPipelineOptions = CandidateProfileLoadOptions &
  StorageOptions &
  IngestJobPostingOptions & {
    initialApplicationNote?: string;
    tailorOptions?: TailorResumeOptions;
    renderOptions?: RenderTailoredResumeOptions;
    atsScoringOptions?: AtsScoringOptions;
    applyOptions?: ApplySubmissionOptions;
    storage?: PipelineStorage;
  };

export type SingleJobPipelineResult = {
  job: JobPosting;
  profile: CandidateProfile;
  tailoredResume: TailoredResume;
  atsAssessment: AtsAssessment;
  applicationRecord: ApplicationRecord;
  applicationAttempt?: ApplicationSubmissionAttempt;
  storagePath: string;
};

export type SingleJobPipelineStageOptions = CandidateProfileLoadOptions &
  IngestJobPostingOptions & {
    initialApplicationNote?: string;
    tailorOptions?: TailorResumeOptions;
    renderOptions?: RenderTailoredResumeOptions;
    atsScoringOptions?: AtsScoringOptions;
    applyOptions?: ApplySubmissionOptions;
    storage: PipelineStorage;
  };

export async function runSingleJobPipeline(
  input: IngestJobPostingInput,
  options: SingleJobPipelineOptions = {}
): Promise<SingleJobPipelineResult> {
  const storage = resolvePipelineStorage(options);
  const { job } = await persistIngestedJobPosting(input, {
    storage,
    defaultDiscoveredAt: options.defaultDiscoveredAt,
    initialApplicationNote: options.initialApplicationNote
  });
  const { profile, tailoredResume } = await tailorJobPosting(job, {
    storage,
    referencePath: options.referencePath,
    profileId: options.profileId,
    tailorOptions: options.tailorOptions,
    initialApplicationNote: options.initialApplicationNote
  });
  const { tailoredResume: renderedResume } = await renderStoredTailoredResume(job, tailoredResume, {
    storage,
    profile,
    referencePath: options.referencePath,
    profileId: options.profileId,
    renderOptions: options.renderOptions
  });
  const { atsAssessment, applicationRecord } = await scoreStoredTailoredResume(job, renderedResume, {
    storage,
    initialApplicationNote: options.initialApplicationNote,
    atsScoringOptions: options.atsScoringOptions
  });
  const appliedResult = options.applyOptions
    ? await applyToStoredJob(job, renderedResume, {
        storage,
        profile,
        referencePath: options.referencePath,
        profileId: options.profileId,
        initialApplicationNote: options.initialApplicationNote,
        applyOptions: options.applyOptions
      })
    : undefined;

  return {
    job,
    profile: appliedResult?.profile ?? profile,
    tailoredResume: renderedResume,
    atsAssessment,
    applicationRecord: appliedResult?.applicationRecord ?? applicationRecord,
    applicationAttempt: appliedResult?.applicationAttempt,
    storagePath: storage.storagePath
  };
}

export async function persistIngestedJobPosting(
  input: IngestJobPostingInput,
  options: SingleJobPipelineStageOptions
): Promise<{
  job: JobPosting;
  applicationRecord: ApplicationRecord;
}> {
  const job = ingestJobPosting(input, {
    defaultDiscoveredAt: options.defaultDiscoveredAt
  });

  await options.storage.upsertJobPosting(job);

  const applicationRecord = await ensureApplicationRecord(options.storage, job, {
    initialApplicationNote: options.initialApplicationNote
  });

  await options.storage.upsertApplicationRecord(applicationRecord);

  return {
    job,
    applicationRecord
  };
}

export async function tailorJobPosting(
  job: JobPosting,
  options: SingleJobPipelineStageOptions
): Promise<{
  profile: CandidateProfile;
  tailoredResume: TailoredResume;
  applicationRecord: ApplicationRecord;
}> {
  const profile = await loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const tailoredResume = buildTailoredResume(profile, job, options.tailorOptions);

  await options.storage.upsertTailoredResume(tailoredResume);

  const applicationRecord = attachTailoredResumeToRecord(
    await ensureApplicationRecord(options.storage, job, {
      initialApplicationNote: options.initialApplicationNote
    }),
    tailoredResume,
    {
      at: tailoredResume.generatedAt
    }
  );

  await options.storage.upsertApplicationRecord(applicationRecord);

  return {
    profile,
    tailoredResume,
    applicationRecord
  };
}

export async function renderStoredTailoredResume(
  job: JobPosting,
  tailoredResume: TailoredResume,
  options: SingleJobPipelineStageOptions & {
    profile?: CandidateProfile;
  }
): Promise<{
  profile: CandidateProfile;
  tailoredResume: TailoredResume;
}> {
  const profile =
    options.profile ??
    (await loadCandidateProfile({
      referencePath: options.referencePath,
      profileId: options.profileId
    }));
  const renderedArtifact = await renderTailoredResumeArtifact(
    profile,
    job,
    tailoredResume,
    options.renderOptions
  );
  const renderedResume = {
    ...tailoredResume,
    outputPath: renderedArtifact.outputPath
  };

  await options.storage.upsertTailoredResume(renderedResume);

  return {
    profile,
    tailoredResume: renderedResume
  };
}

export async function scoreStoredTailoredResume(
  job: JobPosting,
  tailoredResume: TailoredResume,
  options: SingleJobPipelineStageOptions
): Promise<{
  atsAssessment: AtsAssessment;
  applicationRecord: ApplicationRecord;
}> {
  const atsAssessment = scoreAtsReadiness(job, tailoredResume, options.atsScoringOptions);

  await options.storage.upsertAtsAssessment(atsAssessment);

  const applicationRecord = attachAtsAssessmentToRecord(
    await ensureApplicationRecord(options.storage, job, {
      initialApplicationNote: options.initialApplicationNote
    }),
    atsAssessment,
    {
      at: atsAssessment.assessedAt
    }
  );

  await options.storage.upsertApplicationRecord(applicationRecord);

  return {
    atsAssessment,
    applicationRecord
  };
}

export async function applyToStoredJob(
  job: JobPosting,
  tailoredResume: TailoredResume,
  options: SingleJobPipelineStageOptions & {
    profile?: CandidateProfile;
  }
): Promise<{
  profile: CandidateProfile;
  applicationRecord: ApplicationRecord;
  applicationAttempt: ApplicationSubmissionAttempt;
}> {
  const profile =
    options.profile ??
    (await loadCandidateProfile({
      referencePath: options.referencePath,
      profileId: options.profileId
    }));
  const currentApplicationRecord = await ensureApplicationRecord(options.storage, job, {
    initialApplicationNote: options.initialApplicationNote
  });
  const { applicationRecord, attempt } = await submitJobApplication(
    job,
    currentApplicationRecord,
    profile,
    tailoredResume,
    options.applyOptions
  );

  await options.storage.upsertApplicationRecord(applicationRecord);

  return {
    profile,
    applicationRecord,
    applicationAttempt: attempt
  };
}

function resolvePipelineStorage(options: SingleJobPipelineOptions): PipelineStorage {
  return (
    options.storage ??
    createSqliteStorage({
      storagePath: options.storagePath
    })
  );
}

async function ensureApplicationRecord(
  storage: PipelineStorage,
  job: JobPosting,
  options: {
    initialApplicationNote?: string;
  }
): Promise<ApplicationRecord> {
  const existingRecord = await storage.getApplicationRecordByJobId(job.id);

  return existingRecord
    ? syncApplicationRecordWithJob(existingRecord, job)
    : createApplicationRecord({
        job,
        note: options.initialApplicationNote
      });
}

function syncApplicationRecordWithJob(
  record: ApplicationRecord,
  job: JobPosting
): ApplicationRecord {
  return {
    ...record,
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    sourceName: job.source.name,
    location: job.location,
    sourceUrl: job.source.url,
    applicationUrl: job.applicationTarget?.url ?? record.applicationUrl,
    applicationPlatform: job.applicationTarget?.platform ?? record.applicationPlatform
  };
}
