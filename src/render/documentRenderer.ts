import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CandidateProfile, JobPosting, TailoredResume } from "../shared/contracts.js";

const DEFAULT_DOCUMENT_OUTPUT_DIR = resolve(process.cwd(), "artifacts", "applications");

/**
 * Print CSS is intentionally conservative: one column, no tables, no columns,
 * no icons, standard fonts, black text. Anything fancier risks being mangled
 * when an applicant tracking system parses the PDF back into text.
 */
const ATS_SAFE_PRINT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 18mm 16mm;
    background: #ffffff;
    color: #111111;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  h1 {
    margin: 0 0 2mm 0;
    font-size: 19pt;
    letter-spacing: 0.2pt;
  }
  h2 {
    margin: 7mm 0 2mm 0;
    padding-bottom: 1mm;
    border-bottom: 0.6pt solid #999999;
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 0.6pt;
  }
  p { margin: 0 0 2.5mm 0; }
  ul { margin: 0 0 2.5mm 0; padding-left: 5mm; }
  li { margin: 0 0 1.5mm 0; }
  .contact { margin: 0 0 1mm 0; font-size: 9.5pt; color: #333333; }
  .headline { margin: 0 0 3mm 0; font-size: 11pt; font-weight: 600; }
  .target { margin: 0 0 4mm 0; font-size: 9.5pt; color: #444444; }
  .signature { margin-top: 6mm; }
  @page { size: A4; margin: 0; }
  @media print {
    body { padding: 16mm 15mm; }
    h2 { page-break-after: avoid; }
    li { page-break-inside: avoid; }
  }
`;

export type ApplicationDocumentFormat = "html" | "pdf";

export type RenderApplicationDocumentOptions = {
  /** Directory for generated artifacts. Defaults to `artifacts/applications`. */
  outputDir?: string;
  /** Formats to emit. PDF requires a local Chromium or Chrome binary. */
  formats?: readonly ApplicationDocumentFormat[];
  /** Explicit browser binary used for PDF export. */
  browserExecutablePath?: string;
  /** Overrides the generated file stem, without extension. */
  fileStem?: string;
};

export type RenderedApplicationDocument = {
  format: ApplicationDocumentFormat;
  outputPath: string;
};

export type RenderApplicationDocumentResult = {
  outputDir: string;
  fileStem: string;
  html: string;
  documents: RenderedApplicationDocument[];
  /** Populated when a PDF was requested but could not be produced. */
  pdfSkippedReason?: string;
};

export function resolveDefaultDocumentOutputDir(outputDir?: string): string {
  return outputDir ? resolve(outputDir) : DEFAULT_DOCUMENT_OUTPUT_DIR;
}

/**
 * Builds the recruiter-facing CV file name. Recruiters and ATS parsers both
 * behave better with a descriptive, ASCII-only file stem.
 */
export function buildDocumentFileStem(
  profile: CandidateProfile,
  job: JobPosting,
  suffix: "CV" | "Cover-Letter"
): string {
  return [profile.fullName, job.title, job.company, suffix]
    .map((part) => toFileSafeSegment(part))
    .filter((part) => part.length > 0)
    .join("_");
}

/** Renders a styled, ATS-safe single-column CV as printable HTML. */
export function renderResumeDocumentHtml(
  profile: CandidateProfile,
  job: JobPosting,
  resume: TailoredResume
): string {
  const contactLine = [profile.email, profile.phone, profile.country]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => escapeHtml(value))
    .join(" | ");

  const sections = resume.sections
    .map((section) => {
      if (section.lines.length === 0) {
        return "";
      }
      if (section.key === "summary") {
        return [
          `      <h2>${escapeHtml(section.title)}</h2>`,
          ...section.lines.map((line) => `      <p>${escapeHtml(line)}</p>`)
        ].join("\n");
      }
      return [
        `      <h2>${escapeHtml(section.title)}</h2>`,
        "      <ul>",
        ...section.lines.map((line) => `        <li>${escapeHtml(line)}</li>`),
        "      </ul>"
      ].join("\n");
    })
    .filter((block) => block.length > 0)
    .join("\n");

  return buildHtmlDocument(
    `${profile.fullName} - ${job.title} - CV`,
    [
      `      <h1>${escapeHtml(profile.fullName)}</h1>`,
      contactLine.length > 0 ? `      <p class="contact">${contactLine}</p>` : "",
      `      <p class="headline">${escapeHtml(resume.tailoredHeadline)}</p>`,
      `      <p class="target">Applying for ${escapeHtml(job.title)} at ${escapeHtml(job.company)}${
        job.location ? ` - ${escapeHtml(job.location)}` : ""
      }</p>`,
      sections
    ]
      .filter((block) => block.length > 0)
      .join("\n")
  );
}

/** Renders a cover letter body as printable, ATS-safe HTML. */
export function renderCoverLetterDocumentHtml(
  profile: CandidateProfile,
  job: JobPosting,
  letter: {
    salutation: string;
    paragraphs: readonly string[];
    signOff: string;
  }
): string {
  const contactLine = [profile.email, profile.phone, profile.country]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => escapeHtml(value))
    .join(" | ");

  return buildHtmlDocument(
    `${profile.fullName} - ${job.title} - Cover Letter`,
    [
      `      <h1>${escapeHtml(profile.fullName)}</h1>`,
      contactLine.length > 0 ? `      <p class="contact">${contactLine}</p>` : "",
      `      <p class="target">${escapeHtml(job.title)} - ${escapeHtml(job.company)}${
        job.location ? ` - ${escapeHtml(job.location)}` : ""
      }</p>`,
      `      <p>${escapeHtml(letter.salutation)}</p>`,
      ...letter.paragraphs.map((paragraph) => `      <p>${escapeHtml(paragraph)}</p>`),
      `      <p class="signature">${escapeHtml(letter.signOff)}</p>`,
      `      <p>${escapeHtml(profile.fullName)}</p>`
    ]
      .filter((block) => block.length > 0)
      .join("\n")
  );
}

/**
 * Writes the requested artifacts to disk. PDF export is attempted through the
 * already-bundled Chromium driver; when no local browser exists the HTML is
 * still written and the reason is reported instead of failing the run.
 */
export async function writeApplicationDocument(
  html: string,
  fileStem: string,
  options: RenderApplicationDocumentOptions = {}
): Promise<RenderApplicationDocumentResult> {
  const outputDir = resolveDefaultDocumentOutputDir(options.outputDir);
  const formats = normalizeFormats(options.formats);
  const documents: RenderedApplicationDocument[] = [];
  let pdfSkippedReason: string | undefined;

  await mkdir(outputDir, { recursive: true });

  if (formats.includes("html")) {
    const htmlPath = join(outputDir, `${fileStem}.html`);
    await writeFile(htmlPath, `${html}\n`, "utf8");
    documents.push({ format: "html", outputPath: htmlPath });
  }

  if (formats.includes("pdf")) {
    const pdfPath = join(outputDir, `${fileStem}.pdf`);
    try {
      await printHtmlToPdf(html, pdfPath, options.browserExecutablePath);
      documents.push({ format: "pdf", outputPath: pdfPath });
    } catch (error) {
      pdfSkippedReason = error instanceof Error ? error.message : String(error);
      if (!formats.includes("html")) {
        const fallbackPath = join(outputDir, `${fileStem}.html`);
        await writeFile(fallbackPath, `${html}\n`, "utf8");
        documents.push({ format: "html", outputPath: fallbackPath });
      }
    }
  }

  return {
    outputDir,
    fileStem,
    html,
    documents,
    ...(pdfSkippedReason ? { pdfSkippedReason } : {})
  };
}

/** Renders and writes the tailored CV in every requested format. */
export async function renderResumeDocument(
  profile: CandidateProfile,
  job: JobPosting,
  resume: TailoredResume,
  options: RenderApplicationDocumentOptions = {}
): Promise<RenderApplicationDocumentResult> {
  const html = renderResumeDocumentHtml(profile, job, resume);
  const fileStem = options.fileStem ?? buildDocumentFileStem(profile, job, "CV");
  return writeApplicationDocument(html, fileStem, options);
}

async function printHtmlToPdf(
  html: string,
  outputPath: string,
  browserExecutablePath?: string
): Promise<void> {
  const { chromium } = await import("playwright-core");
  const { resolveHostedGreenhouseBrowserExecutablePath } = await import("../apply/index.js");
  const executablePath = await resolveHostedGreenhouseBrowserExecutablePath(browserExecutablePath);

  const browser = await chromium.launch({
    executablePath,
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: false,
      margin: {
        top: "0mm",
        bottom: "0mm",
        left: "0mm",
        right: "0mm"
      }
    });
  } finally {
    await browser.close();
  }
}

function buildHtmlDocument(title: string, body: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${escapeHtml(title)}</title>`,
    "    <style>",
    ATS_SAFE_PRINT_CSS.trim(),
    "    </style>",
    "  </head>",
    "  <body>",
    "    <main>",
    body,
    "    </main>",
    "  </body>",
    "</html>"
  ].join("\n");
}

function normalizeFormats(
  formats: readonly ApplicationDocumentFormat[] | undefined
): ApplicationDocumentFormat[] {
  if (!formats || formats.length === 0) {
    return ["html", "pdf"];
  }
  return Array.from(new Set(formats));
}

function toFileSafeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
