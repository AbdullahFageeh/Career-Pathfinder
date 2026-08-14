import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildCoverLetterDraft,
  formatCoverLetterText,
  refineCoverLetterWithLlm,
  type CoverLetterDraft,
  type CoverLetterTone
} from "../letters/index.js";
import {
  ensureFollowUpLadder,
  formatDueFollowUpsMarkdown,
  listDueFollowUps,
  type DueFollowUp
} from "../followup/index.js";
import { loadCandidateProfile } from "../profile/index.js";
import {
  buildDocumentFileStem,
  renderCoverLetterDocumentHtml,
  renderResumeDocument,
  writeApplicationDocument,
  type ApplicationDocumentFormat
} from "../render/index.js";
import { buildFunnelReport, formatFunnelReportMarkdown, type FunnelReport } from "../report/index.js";
import {
  formatShortlistMarkdown,
  rankJobOpportunities,
  type RankedJobOpportunity
} from "../score/index.js";
import {
  discoverSaudiGreenhouseRoles,
  loadRoleCorpus,
  type SaudiBoardDiscoveryResult
} from "../sources/index.js";
import { createSqliteStorage, type PipelineStorage } from "../storage/index.js";
import { buildTailoredResume } from "../tailor/index.js";
import type { ApplicationRecord, CandidateProfile, JobPosting } from "../shared/contracts.js";
import { ingestJobPosting, type IngestJobPostingInput } from "../ingest/index.js";

export type ShortlistOperationOptions = {
  corpusDir?: string;
  storagePath?: string;
  referencePath?: string;
  profileId?: string;
  limit?: number;
  minimumScore?: number;
  includeIneligible?: boolean;
  includeStoredJobs?: boolean;
  outputPath?: string;
  isSaudiNational?: boolean;
  homeCity?: string;
  now?: string;
  storage?: PipelineStorage;
};

export type ShortlistOperationResult = {
  profile: CandidateProfile;
  totalConsidered: number;
  ranked: RankedJobOpportunity[];
  markdown: string;
  outputPath?: string;
  invalidCorpusFiles: number;
};

/**
 * Ranks every known Saudi opportunity and produces the "work these next" list.
 * The corpus of saved roles is combined with anything already persisted so
 * nothing that has been captured previously falls out of view.
 */
export async function runShortlistOperation(
  options: ShortlistOperationOptions = {}
): Promise<ShortlistOperationResult> {
  const profile = await loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });

  const corpus = await loadRoleCorpus({
    corpusDir: options.corpusDir,
    now: options.now
  });

  const jobs = new Map<string, JobPosting>();
  for (const job of corpus.jobs) {
    jobs.set(job.id, job);
  }

  if (options.includeStoredJobs !== false) {
    const storage = options.storage ?? createSqliteStorage({ storagePath: options.storagePath });
    try {
      for (const job of await storage.listJobPostings()) {
        jobs.set(job.id, job);
      }
    } catch {
      // A missing or unreadable store is not fatal for shortlisting.
    }
  }

  const ranked = rankJobOpportunities(profile, Array.from(jobs.values()), {
    limit: options.limit ?? 10,
    ...(options.minimumScore === undefined ? {} : { minimumScore: options.minimumScore }),
    ...(options.includeIneligible === undefined ? {} : { includeIneligible: options.includeIneligible }),
    ...(options.homeCity ? { homeCity: options.homeCity } : {}),
    ...(options.now ? { now: options.now } : {}),
    candidate: {
      ...(options.isSaudiNational === undefined ? {} : { isSaudiNational: options.isSaudiNational })
    }
  });

  const markdown = formatShortlistMarkdown(ranked, {
    ...(options.now ? { generatedAt: options.now } : {})
  });

  const outputPath = options.outputPath ? resolve(options.outputPath) : undefined;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, "utf8");
  }

  return {
    profile,
    totalConsidered: jobs.size,
    ranked,
    markdown,
    ...(outputPath ? { outputPath } : {}),
    invalidCorpusFiles: corpus.invalidFiles.length
  };
}

export type ResumeOperationOptions = {
  job: IngestJobPostingInput;
  referencePath?: string;
  profileId?: string;
  outputDir?: string;
  formats?: readonly ApplicationDocumentFormat[];
  browserExecutablePath?: string;
  now?: string;
};

export type ResumeOperationResult = {
  outputPaths: string[];
  pdfSkippedReason?: string;
};

/**
 * Creates a recruiter-ready, single-column CV in PDF and/or HTML. It uses the
 * exact same evidence-only tailoring engine as the pipeline, but is intentionally
 * available as a fast standalone command after the operator has chosen a role.
 */
export async function runResumeOperation(
  options: ResumeOperationOptions
): Promise<ResumeOperationResult> {
  const profile = await loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const job = ingestJobPosting(options.job, {
    ...(options.now ? { defaultDiscoveredAt: options.now } : {})
  });
  const resume = buildTailoredResume(profile, job);
  const rendered = await renderResumeDocument(profile, job, resume, {
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.formats ? { formats: options.formats } : {}),
    ...(options.browserExecutablePath ? { browserExecutablePath: options.browserExecutablePath } : {})
  });

  return {
    outputPaths: rendered.documents.map((document) => document.outputPath),
    ...(rendered.pdfSkippedReason ? { pdfSkippedReason: rendered.pdfSkippedReason } : {})
  };
}

export type CoverLetterOperationOptions = {
  job: IngestJobPostingInput;
  referencePath?: string;
  profileId?: string;
  tone?: CoverLetterTone;
  recipientName?: string;
  companyHook?: string;
  outputDir?: string;
  formats?: readonly ApplicationDocumentFormat[];
  browserExecutablePath?: string;
  useLlm?: boolean;
  llmModel?: string;
  now?: string;
};

export type CoverLetterOperationResult = {
  draft: CoverLetterDraft;
  text: string;
  textPath?: string;
  documentPaths: string[];
  refined: boolean;
  refinementNote?: string;
  pdfSkippedReason?: string;
};

/** Generates a tailored cover letter with optional guarded LLM refinement. */
export async function runCoverLetterOperation(
  options: CoverLetterOperationOptions
): Promise<CoverLetterOperationResult> {
  const profile = await loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const job = ingestJobPosting(options.job, {
    ...(options.now ? { defaultDiscoveredAt: options.now } : {})
  });
  const resume = buildTailoredResume(profile, job);

  let draft = buildCoverLetterDraft(profile, job, resume, {
    ...(options.tone ? { tone: options.tone } : {}),
    ...(options.recipientName ? { recipientName: options.recipientName } : {}),
    ...(options.companyHook ? { companyHook: options.companyHook } : {}),
    ...(options.now ? { now: options.now } : {})
  });

  let refined = false;
  let refinementNote: string | undefined;

  if (options.useLlm) {
    const refinement = await refineCoverLetterWithLlm(draft, profile, job, {
      ...(options.llmModel ? { model: options.llmModel } : {})
    });
    draft = refinement.draft;
    refined = refinement.refined;
    refinementNote = refinement.rejectedReason ?? refinement.skippedReason;
  }

  const fileStem = buildDocumentFileStem(profile, job, "Cover-Letter");
  const html = renderCoverLetterDocumentHtml(profile, job, {
    salutation: draft.salutation,
    paragraphs: draft.paragraphs,
    signOff: draft.signOff
  });

  const written = await writeApplicationDocument(html, fileStem, {
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    ...(options.formats ? { formats: options.formats } : {}),
    ...(options.browserExecutablePath ? { browserExecutablePath: options.browserExecutablePath } : {})
  });

  const text = formatCoverLetterText(draft, profile);
  const textPath = join(written.outputDir, `${fileStem}.txt`);
  await writeFile(textPath, text, "utf8");

  return {
    draft,
    text,
    textPath,
    documentPaths: written.documents.map((document) => document.outputPath),
    refined,
    ...(refinementNote ? { refinementNote } : {}),
    ...(written.pdfSkippedReason ? { pdfSkippedReason: written.pdfSkippedReason } : {})
  };
}

export type ReviewPacketOperationOptions = {
  storagePath?: string;
  referencePath?: string;
  profileId?: string;
  outputDir?: string;
  jobIds?: readonly string[];
  formats?: readonly ApplicationDocumentFormat[];
  browserExecutablePath?: string;
  now?: string;
  storage?: PipelineStorage;
};

export type ReviewPacket = {
  jobId: string;
  title: string;
  company: string;
  platform: string;
  applicationUrl?: string;
  reviewPath: string;
  resumePaths: string[];
  coverLetterPaths: string[];
  prefillCommand?: string;
};

export type ReviewPacketOperationResult = {
  packets: ReviewPacket[];
  skippedJobIds: string[];
};

/**
 * Creates a compact review packet for each ATS-passed role. It generates a
 * tailored PDF/HTML CV, cover letter, direct application URL, and—where
 * supported—a safe Greenhouse prefill command. It never submits an application.
 */
export async function runReviewPacketOperation(
  options: ReviewPacketOperationOptions = {}
): Promise<ReviewPacketOperationResult> {
  const profile = await loadCandidateProfile({
    referencePath: options.referencePath,
    profileId: options.profileId
  });
  const storage = options.storage ?? createSqliteStorage({ storagePath: options.storagePath });
  const outputDir = resolve(options.outputDir ?? join(process.cwd(), "artifacts", "review"));
  const requestedJobIds = options.jobIds ? new Set(options.jobIds) : undefined;
  const records = await storage.listApplicationRecords();
  const packets: ReviewPacket[] = [];
  const skippedJobIds: string[] = [];

  await mkdir(outputDir, { recursive: true });

  for (const record of records) {
    if (record.status !== "ats-passed" || (requestedJobIds && !requestedJobIds.has(record.jobId))) {
      continue;
    }
    const job = await storage.getJobPosting(record.jobId);
    if (!job) {
      skippedJobIds.push(record.jobId);
      continue;
    }

    const resume = buildTailoredResume(profile, job);
    const renderedResume = await renderResumeDocument(profile, job, resume, {
      outputDir,
      formats: options.formats ?? ["pdf", "html"],
      ...(options.browserExecutablePath ? { browserExecutablePath: options.browserExecutablePath } : {})
    });
    const draft = buildCoverLetterDraft(profile, job, resume, {
      ...(options.now ? { now: options.now } : {})
    });
    const letterStem = buildDocumentFileStem(profile, job, "Cover-Letter");
    const letterHtml = renderCoverLetterDocumentHtml(profile, job, {
      salutation: draft.salutation,
      paragraphs: draft.paragraphs,
      signOff: draft.signOff
    });
    const renderedLetter = await writeApplicationDocument(letterHtml, letterStem, {
      outputDir,
      formats: options.formats ?? ["pdf", "html"],
      ...(options.browserExecutablePath ? { browserExecutablePath: options.browserExecutablePath } : {})
    });
    const letterTextPath = join(renderedLetter.outputDir, `${letterStem}.txt`);
    await writeFile(letterTextPath, formatCoverLetterText(draft, profile), "utf8");

    const applicationUrl = job.applicationTarget?.url ?? job.source.url;
    const resumePaths = renderedResume.documents.map((document) => document.outputPath);
    const coverLetterPaths = [...renderedLetter.documents.map((document) => document.outputPath), letterTextPath];
    const prefillCommand = buildReviewPrefillCommand(job, resumePaths);
    const packetStem = `${buildDocumentFileStem(profile, job, "CV")}-Review-Packet`;
    const reviewPath = join(outputDir, `${packetStem}.md`);
    await writeFile(
      reviewPath,
      formatReviewPacketMarkdown({
        job,
        record,
        applicationUrl,
        resumePaths,
        coverLetterPaths,
        prefillCommand,
        generatedAt: options.now
      }),
      "utf8"
    );

    packets.push({
      jobId: job.id,
      title: job.title,
      company: job.company,
      platform: job.applicationTarget?.platform ?? "manual",
      ...(applicationUrl ? { applicationUrl } : {}),
      reviewPath,
      resumePaths,
      coverLetterPaths,
      ...(prefillCommand ? { prefillCommand } : {})
    });
  }

  return { packets, skippedJobIds };
}

function buildReviewPrefillCommand(job: JobPosting, resumePaths: string[]): string | undefined {
  if (job.applicationTarget?.platform !== "greenhouse" || !job.applicationTarget.url) {
    return undefined;
  }
  const resumePath = resumePaths.find((path) => path.toLowerCase().endsWith(".pdf"));
  return [
    "npm run greenhouse:hosted:prefill --",
    `--url ${quoteShellValue(job.applicationTarget.url)}`,
    ...(resumePath ? [`--resume-path ${quoteShellValue(resumePath)}`] : []),
    "--keep-open"
  ].join(" ");
}

function formatReviewPacketMarkdown(input: {
  job: JobPosting;
  record: ApplicationRecord;
  applicationUrl?: string;
  resumePaths: string[];
  coverLetterPaths: string[];
  prefillCommand?: string;
  generatedAt?: string;
}): string {
  const lines = [
    `# Review packet — ${input.job.title} at ${input.job.company}`,
    `Generated: ${input.generatedAt ?? new Date().toISOString()}`,
    "",
    "## Final review",
    `- **ATS score:** ${input.record.atsScore ?? "Not recorded"}/100`,
    `- **Location:** ${input.job.location ?? "Not specified"}`,
    `- **Platform:** ${input.job.applicationTarget?.platform ?? "manual"}`,
    `- **Application:** ${input.applicationUrl ? `[Open the employer form](${input.applicationUrl})` : "No application URL recorded."}`,
    "",
    "## Attach before your final click",
    ...input.resumePaths.map((path) => `- CV file: ${path}`),
    ...input.coverLetterPaths.map((path) => `- Cover letter file: ${path}`),
    "",
    "## Submission handoff",
    input.prefillCommand
      ? [
          "Run this to open and prefill the supported Greenhouse form, then review every field and submit yourself:",
          "",
          "```bash",
          input.prefillCommand,
          "```"
        ].join("\n")
      : "Open the employer form, upload the tailored CV, attach the cover letter if requested, verify each answer, then submit yourself.",
    "",
    "> Do not add claims, numbers, qualifications, or eligibility answers that are not in your verified profile."
  ];
  return `${lines.join("\n")}\n`;
}

function quoteShellValue(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

export type FollowUpOperationOptions = {
  storagePath?: string;
  referencePath?: string;
  profileId?: string;
  offsetDays?: readonly number[];
  schedule?: boolean;
  outputPath?: string;
  now?: string;
  storage?: PipelineStorage;
};

export type FollowUpOperationResult = {
  scheduled: number;
  due: DueFollowUp[];
  markdown: string;
  outputPath?: string;
};

/**
 * Ensures every applied record has a follow-up ladder, then reports what is due
 * now so the operator can send nudges without tracking dates manually.
 */
export async function runFollowUpOperation(
  options: FollowUpOperationOptions = {}
): Promise<FollowUpOperationResult> {
  const storage = options.storage ?? createSqliteStorage({ storagePath: options.storagePath });
  const now = options.now ?? new Date().toISOString();

  let profile: CandidateProfile | undefined;
  try {
    profile = await loadCandidateProfile({
      referencePath: options.referencePath,
      profileId: options.profileId
    });
  } catch {
    profile = undefined;
  }

  const records = await storage.listApplicationRecords();
  let scheduled = 0;
  const updatedRecords: ApplicationRecord[] = [];

  for (const record of records) {
    if (options.schedule === false) {
      updatedRecords.push(record);
      continue;
    }
    const { record: nextRecord, plan } = ensureFollowUpLadder(record, {
      ...(profile ? { profile } : {}),
      ...(options.offsetDays ? { offsetDays: options.offsetDays } : {}),
      now
    });
    if (plan.steps.length > 0) {
      scheduled += plan.steps.length;
      await storage.upsertApplicationRecord(nextRecord);
    }
    updatedRecords.push(nextRecord);
  }

  const due = listDueFollowUps(updatedRecords, now);
  const markdown = formatDueFollowUpsMarkdown(due, { generatedAt: now });

  const outputPath = options.outputPath ? resolve(options.outputPath) : undefined;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, "utf8");
  }

  return {
    scheduled,
    due,
    markdown,
    ...(outputPath ? { outputPath } : {})
  };
}

export type ReportOperationOptions = {
  storagePath?: string;
  staleAfterDays?: number;
  outputPath?: string;
  now?: string;
  storage?: PipelineStorage;
};

export type ReportOperationResult = {
  report: FunnelReport;
  markdown: string;
  outputPath?: string;
};

/** Builds the funnel briefing from persisted application records. */
export async function runReportOperation(
  options: ReportOperationOptions = {}
): Promise<ReportOperationResult> {
  const storage = options.storage ?? createSqliteStorage({ storagePath: options.storagePath });
  const records = await storage.listApplicationRecords();

  const report = buildFunnelReport(records, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.staleAfterDays === undefined ? {} : { staleAfterDays: options.staleAfterDays })
  });
  const markdown = formatFunnelReportMarkdown(report);

  const outputPath = options.outputPath ? resolve(options.outputPath) : undefined;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, "utf8");
  }

  return {
    report,
    markdown,
    ...(outputPath ? { outputPath } : {})
  };
}

export type DiscoverOperationOptions = {
  boardTokens?: readonly string[];
  maxListingsPerBoard?: number;
  includeAllTitles?: boolean;
  storagePath?: string;
  persist?: boolean;
  outputDir?: string;
  now?: string;
  storage?: PipelineStorage;
  discover?: typeof discoverSaudiGreenhouseRoles;
};

export type DiscoverOperationResult = {
  discovery: SaudiBoardDiscoveryResult;
  persisted: number;
  savedPaths: string[];
};

/**
 * Pulls Saudi roles from public Greenhouse boards, then optionally persists them
 * so they immediately become shortlist candidates.
 */
export async function runDiscoverOperation(
  options: DiscoverOperationOptions = {}
): Promise<DiscoverOperationResult> {
  const discover = options.discover ?? discoverSaudiGreenhouseRoles;
  const discovery = await discover({
    ...(options.boardTokens ? { boardTokens: options.boardTokens } : {}),
    ...(options.maxListingsPerBoard === undefined
      ? {}
      : { maxListingsPerBoard: options.maxListingsPerBoard }),
    ...(options.includeAllTitles ? { filterByTargetTitles: false } : {}),
    ...(options.now ? { now: options.now } : {})
  });

  const savedPaths: string[] = [];
  if (options.outputDir) {
    const outputDir = resolve(options.outputDir);
    await mkdir(outputDir, { recursive: true });
    for (const listing of discovery.listings) {
      const filePath = join(outputDir, `${toFileSafeSegment(listing.id)}.json`);
      await writeFile(filePath, `${JSON.stringify(listing, null, 2)}\n`, "utf8");
      savedPaths.push(filePath);
    }
  }

  let persisted = 0;
  if (options.persist !== false && discovery.listings.length > 0) {
    const storage = options.storage ?? createSqliteStorage({ storagePath: options.storagePath });
    for (const listing of discovery.listings) {
      await storage.upsertJobPosting(
        ingestJobPosting(listing, {
          ...(options.now ? { defaultDiscoveredAt: options.now } : {})
        })
      );
      persisted += 1;
    }
  }

  return {
    discovery,
    persisted,
    savedPaths
  };
}

function toFileSafeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}
