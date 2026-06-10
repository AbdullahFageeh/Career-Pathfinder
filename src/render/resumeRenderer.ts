import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  CandidateProfile,
  JobPosting,
  TailoredResume,
  TailoredResumeSection
} from "../shared/contracts.js";

const DEFAULT_RENDER_OUTPUT_DIR = resolve(process.cwd(), "artifacts", "resumes");

export type RenderTailoredResumeOptions = {
  outputDir?: string;
};

export type RenderedTailoredResumeArtifact = {
  outputPath: string;
  content: string;
};

export function resolveDefaultRenderOutputDir(outputDir?: string): string {
  return outputDir ? resolve(outputDir) : DEFAULT_RENDER_OUTPUT_DIR;
}

export function renderTailoredResumeHtml(
  profile: CandidateProfile,
  job: JobPosting,
  resume: TailoredResume
): string {
  const renderedSections = resume.sections.map(renderSection).join("\n");
  const locationLine = job.location
    ? `\n        <p><strong>Location:</strong> ${escapeHtml(job.location)}</p>`
    : "";

  return [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"utf-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `    <title>${escapeHtml(profile.fullName)} - ${escapeHtml(job.title)} - Tailored Resume</title>`,
    "  </head>",
    "  <body>",
    "    <main>",
    "      <header>",
    `        <h1>${escapeHtml(profile.fullName)}</h1>`,
    `        <p>${escapeHtml(resume.tailoredHeadline)}</p>`,
    `        <p><strong>Target role:</strong> ${escapeHtml(job.title)} at ${escapeHtml(job.company)}</p>${locationLine}`,
    "      </header>",
    "      <section>",
    "        <h2>Resume Variant</h2>",
    `        <p>${escapeHtml(resume.variantName)}</p>`,
    "      </section>",
    renderedSections,
    "    </main>",
    "  </body>",
    "</html>"
  ].join("\n");
}

export async function renderTailoredResumeArtifact(
  profile: CandidateProfile,
  job: JobPosting,
  resume: TailoredResume,
  options: RenderTailoredResumeOptions = {}
): Promise<RenderedTailoredResumeArtifact> {
  const outputDir = resolveDefaultRenderOutputDir(options.outputDir);
  const outputPath = join(
    outputDir,
    `${toFileSafeSegment(job.id)}-${toTimestampSegment(resume.generatedAt)}.html`
  );
  const content = renderTailoredResumeHtml(profile, job, resume);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${content}\n`, "utf8");

  return {
    outputPath,
    content: `${content}\n`
  };
}

function renderSection(section: TailoredResumeSection): string {
  if (section.key === "summary") {
    return [
      "      <section>",
      `        <h2>${escapeHtml(section.title)}</h2>`,
      ...section.lines.map((line) => `        <p>${escapeHtml(line)}</p>`),
      "      </section>"
    ].join("\n");
  }

  return [
    "      <section>",
    `        <h2>${escapeHtml(section.title)}</h2>`,
    "        <ul>",
    ...section.lines.map((line) => `          <li>${escapeHtml(line)}</li>`),
    "        </ul>",
    "      </section>"
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toFileSafeSegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "resume";
}

function toTimestampSegment(value: string): string {
  const timestamp = value.replace(/[^0-9]/g, "");

  return timestamp || Date.now().toString();
}
