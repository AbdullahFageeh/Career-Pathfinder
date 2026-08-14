import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { ingestJobPosting, type RawJobPostingInput } from "../ingest/index.js";
import type { JobPosting } from "../shared/contracts.js";

const DEFAULT_ROLE_CORPUS_DIR = resolve(process.cwd(), "data", "roles");

export type RoleCorpusLoadOptions = {
  /** Directory of saved role JSON files. Defaults to `data/roles`. */
  corpusDir?: string;
  /** Reference timestamp used when a record has no discovery date. */
  now?: string;
};

export type RoleCorpusLoadResult = {
  corpusDir: string;
  jobs: JobPosting[];
  invalidFiles: Array<{ path: string; reason: string }>;
};

export function resolveDefaultRoleCorpusDir(corpusDir?: string): string {
  return corpusDir ? resolve(corpusDir) : DEFAULT_ROLE_CORPUS_DIR;
}

/**
 * Loads manually curated role records from disk so previously saved
 * opportunities keep flowing through scoring, shortlisting, and tracking
 * instead of sitting inert in the repository.
 */
export async function loadRoleCorpus(
  options: RoleCorpusLoadOptions = {}
): Promise<RoleCorpusLoadResult> {
  const corpusDir = resolveDefaultRoleCorpusDir(options.corpusDir);
  const invalidFiles: Array<{ path: string; reason: string }> = [];
  const jobs: JobPosting[] = [];

  let fileNames: string[];
  try {
    fileNames = await readdir(corpusDir);
  } catch (error) {
    throw new Error(
      `Role corpus directory "${corpusDir}" could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const jsonFiles = fileNames
    .filter((fileName) => extname(fileName).toLowerCase() === ".json")
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of jsonFiles) {
    const filePath = join(corpusDir, fileName);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as RawJobPostingInput;
      jobs.push(
        ingestJobPosting(parsed, {
          defaultDiscoveredAt: options.now
        })
      );
    } catch (error) {
      invalidFiles.push({
        path: filePath,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    corpusDir,
    jobs: dedupeJobs(jobs),
    invalidFiles
  };
}

function dedupeJobs(jobs: readonly JobPosting[]): JobPosting[] {
  const seen = new Map<string, JobPosting>();
  for (const job of jobs) {
    const existing = seen.get(job.id);
    if (!existing || Date.parse(job.discoveredAt) > Date.parse(existing.discoveredAt)) {
      seen.set(job.id, job);
    }
  }
  return Array.from(seen.values());
}
