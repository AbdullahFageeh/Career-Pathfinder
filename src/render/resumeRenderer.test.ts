import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import type { CandidateProfile, JobPosting } from "../shared/contracts.js";
import { buildTailoredResume } from "../tailor/index.js";
import { renderTailoredResumeArtifact, renderTailoredResumeHtml } from "./index.js";

const sampleProfile: CandidateProfile = {
  id: "abdullah-seed",
  fullName: "Abdullah Fageeh",
  headline:
    "Installation, production, and site operations leader with delivery experience across complex live-event and venue environments.",
  targetRoleFamilies: [
    "Installation Manager",
    "Production Manager",
    "Site Operations",
    "Site Manager",
    "Venue Operations"
  ],
  certifications: [
    "NEBOSH International General Certificate in Occupational Health and Safety",
    "PMP Certification Training Course",
    "Fundamentals of Artificial Intelligence"
  ],
  coreProofPoints: [
    "6-venue build delivery",
    "100% AutoCAD layout compliance",
    "installations completed 20% ahead of schedule",
    "setup accelerated by 30%",
    "safety incidents reduced by 25%",
    "Formula 1 venue operations supporting 50,000+ attendees"
  ],
  documents: [],
  recurringAnswers: []
};

const siteManagerJob: JobPosting = {
  id: "job-site-manager",
  source: {
    kind: "job-board",
    name: "arbeitsagentur",
    url: "https://example.com/site-manager"
  },
  title: "Site Manager (m/w/d)",
  company: "ISS Integrated Facility Serv. GmbH",
  location: "Hannover, Niedersachsen, Deutschland",
  description:
    "Lead site operations, venue readiness, contractor coordination, health and safety, and live event delivery for a high-footfall environment.",
  detectedRoleFamily: "site-venue-operations",
  tags: ["lane-1", "source:arbeitsagentur", "family:site-venue-operations", "matched-title:site-manager"],
  discoveredAt: "2026-06-09T13:00:00.000Z"
};

test("renderTailoredResumeHtml includes headline, role targeting, and key proof points", () => {
  const tailoredResume = buildTailoredResume(sampleProfile, siteManagerJob);
  const renderedHtml = renderTailoredResumeHtml(sampleProfile, siteManagerJob, tailoredResume);

  assert.match(renderedHtml, /<h1>Abdullah Fageeh<\/h1>/);
  assert.match(renderedHtml, /Target role:<\/strong> Site Manager \(m\/w\/d\) at ISS Integrated Facility Serv\. GmbH/);
  assert.match(
    renderedHtml,
    /Installation, production, and site operations leader with delivery experience across complex live-event and venue environments\./
  );
  assert.match(renderedHtml, /Formula 1 venue operations supporting 50,000\+ attendees/);
  assert.match(renderedHtml, /<h2>Relevant Certifications<\/h2>/);
});

test("renderTailoredResumeArtifact writes a versioned HTML artifact", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-render-"));
  const outputDir = join(tempDir, "artifacts", "resumes");
  const tailoredResume = buildTailoredResume(sampleProfile, siteManagerJob);

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const result = await renderTailoredResumeArtifact(sampleProfile, siteManagerJob, tailoredResume, {
    outputDir
  });
  const savedArtifact = await readFile(result.outputPath, "utf8");

  assert.equal(savedArtifact, result.content);
  assert.equal(basename(result.outputPath).endsWith(".html"), true);
  assert.match(savedArtifact, /Tailored Summary/);
  assert.match(savedArtifact, /Target Role Families/);
});
