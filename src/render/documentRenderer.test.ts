import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CandidateProfile, JobPosting, TailoredResume } from "../shared/contracts.js";
import { buildTailoredResume } from "../tailor/index.js";
import {
  buildDocumentFileStem,
  renderCoverLetterDocumentHtml,
  renderResumeDocumentHtml,
  writeApplicationDocument
} from "./index.js";

const profile: CandidateProfile = {
  id: "abdullah-seed",
  fullName: "Abdullah Fageeh",
  email: "abdullah@example.com",
  phone: "+966500000000",
  country: "Saudi Arabia",
  headline: "Event operations and installation manager delivering venue builds across Saudi Arabia.",
  targetRoleFamilies: ["Installation Manager", "Venue Operations Manager"],
  certifications: ["NEBOSH International General Certificate"],
  coreProofPoints: [
    "Delivered venue overlay builds across six venues",
    "Reduced safety incidents by 25 percent through site inductions"
  ],
  documents: [],
  recurringAnswers: []
};

const job: JobPosting = {
  id: "job-venue-ops",
  source: {
    kind: "company-page",
    name: "Employer Careers",
    url: "https://careers.example.com/job/1"
  },
  title: "Venue Operations Manager",
  company: "Example Events & Co",
  location: "Jeddah, Saudi Arabia",
  description: "Lead venue operations, overlay builds, supplier coordination, and load-out.",
  tags: ["official-source", "saudi-arabia", "jeddah"],
  discoveredAt: "2026-08-11T09:00:00.000Z"
};

function buildResume(): TailoredResume {
  return buildTailoredResume(profile, job);
}

test("buildDocumentFileStem produces a recruiter-friendly ASCII file name", () => {
  const stem = buildDocumentFileStem(profile, job, "CV");

  assert.equal(stem, "Abdullah-Fageeh_Venue-Operations-Manager_Example-Events-Co_CV");
  assert.doesNotMatch(stem, /[^A-Za-z0-9_-]/);
});

test("renderResumeDocumentHtml renders an ATS-safe single-column document", () => {
  const html = renderResumeDocumentHtml(profile, job, buildResume());

  assert.match(html, /<h1>Abdullah Fageeh<\/h1>/);
  assert.match(html, /abdullah@example\.com/);
  assert.match(html, /Venue Operations Manager/);
  assert.match(html, /@page \{ size: A4/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /column-count/);
});

test("renderResumeDocumentHtml escapes employer names containing markup characters", () => {
  const html = renderResumeDocumentHtml(
    profile,
    { ...job, company: 'Events <b>"Group"</b> & Co' },
    buildResume()
  );

  assert.match(html, /Events &lt;b&gt;&quot;Group&quot;&lt;\/b&gt; &amp; Co/);
});

test("renderCoverLetterDocumentHtml renders salutation, paragraphs, and sign-off", () => {
  const html = renderCoverLetterDocumentHtml(profile, job, {
    salutation: "Dear Example Events hiring team,",
    paragraphs: ["First paragraph.", "Second paragraph."],
    signOff: "Kind regards,"
  });

  assert.match(html, /Dear Example Events hiring team,/);
  assert.match(html, /First paragraph\./);
  assert.match(html, /Second paragraph\./);
  assert.match(html, /Kind regards,/);
});

test("writeApplicationDocument writes HTML and reports a clear reason when PDF export is unavailable", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "application-docs-"));

  try {
    const html = renderResumeDocumentHtml(profile, job, buildResume());
    const result = await writeApplicationDocument(html, "Test_CV", {
      outputDir,
      formats: ["html", "pdf"],
      browserExecutablePath: join(outputDir, "no-such-browser")
    });

    const htmlDocument = result.documents.find((document) => document.format === "html");
    assert.ok(htmlDocument, "expected an HTML artifact");
    assert.equal(htmlDocument?.outputPath, join(outputDir, "Test_CV.html"));

    const written = await readFile(htmlDocument?.outputPath ?? "", "utf8");
    assert.match(written, /Abdullah Fageeh/);

    if (result.documents.some((document) => document.format === "pdf")) {
      assert.equal(result.pdfSkippedReason, undefined);
      return;
    }

    assert.ok(result.pdfSkippedReason, "expected a PDF skip reason when no browser is available");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("writeApplicationDocument writes HTML only when PDF is not requested", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "application-docs-"));

  try {
    const result = await writeApplicationDocument("<html></html>", "Html_Only", {
      outputDir,
      formats: ["html"]
    });

    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0]?.format, "html");
    assert.equal(result.pdfSkippedReason, undefined);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
