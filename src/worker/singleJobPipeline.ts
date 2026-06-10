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
  createFileBackedStorage,
  type FileBackedStorageOptions,
  type PipelineStorage
} from "../storage/index.js";
import { buildTailoredResume, type TailorResumeOptions } from "../tailor/index.js";
import {
  attachAtsAssessmentToRecord,
  attachTailoredResumeToRecord,
  createApplicationRecord
} from "../tracker/index.js";
import type {
  ApplicationRecord,
  AtsAssessment,
  CandidateProfile,
  JobPosting,
  TailoredResume
} from "../shared/contracts.js";

export type SingleJobPipelineOptions = CandidateProfileLoadOptions &
  FileBackedStorageOptions &
  IngestJobPostingOptions & {
    initialApplicationNote?: string;
    tailorOptions?: TailorResumeOptions;
    atsScoringOptions?: AtsScoringOptions;
    storage?: PipelineStorage;
  };

export type SingleJobPipelineResult = {
  job: JobPosting;
  profile: CandidateProfile;
  tailoredResume: TailoredResume;
  atsAssessment: AtsAssessment;
  applicationRecord: ApplicationRecord;
  storagePath: string;
};

export async function runSingleJobPipeline(
  input: IngestJobPostingInput,
  options: SingleJobPipelineOptions = {}
): Promise<SingleJobPipelineResult> {
  const storage =
    options.storage ??
    createFileBackedStorage({
      storagePath: options.storagePath
    });
  const job = ingestJobPosting(input, {
    defaultDiscoveredAt: options.defaultDiscoveredAt
  });

  await storage.upsertJobPosting(job);

  const profile = await loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const tailoredResume = buildTailoredResume(profile, job, options.tailorOptions);

  await storage.upsertTailoredResume(tailoredResume);

  const atsAssessment = scoreAtsReadiness(job, tailoredResume, options.atsScoringOptions);

  await storage.upsertAtsAssessment(atsAssessment);

  const existingRecord = await storage.getApplicationRecordByJobId(job.id);
  const baseRecord = existingRecord
    ? syncApplicationRecordWithJob(existingRecord, job)
    : createApplicationRecord({
        job,
        note: options.initialApplicationNote
      });
  const withResume = attachTailoredResumeToRecord(baseRecord, tailoredResume, {
    at: tailoredResume.generatedAt
  });
  const applicationRecord = attachAtsAssessmentToRecord(withResume, atsAssessment, {
    at: atsAssessment.assessedAt
  });

  await storage.upsertApplicationRecord(applicationRecord);

  return {
    job,
    profile,
    tailoredResume,
    atsAssessment,
    applicationRecord,
    storagePath: storage.storagePath
  };
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
    sourceUrl: job.source.url
  };
}
