import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateProfile, JobPosting, TailoredResume } from "../shared/contracts.js";

import { scoreAtsReadiness } from "./index.js";
import { buildTailoredResume } from "../tailor/index.js";

const sampleProfile: CandidateProfile = {
  id: "candidate-seed",
  fullName: "Avery Morgan",
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

test("scoreAtsReadiness passes a strong tailored resume", () => {
  const tailoredResume = buildTailoredResume(sampleProfile, siteManagerJob);
  const assessment = scoreAtsReadiness(siteManagerJob, tailoredResume);

  assert.equal(assessment.passed, true);
  assert.ok(assessment.score >= assessment.threshold);
  assert.equal(assessment.componentScores.length, 4);
  assert.equal(assessment.blockingIssues.length, 0);
  assert.ok(
    assessment.componentScores.some(
      (component) => component.key === "keyword-coverage" && component.score >= 20
    )
  );
  assert.ok(assessment.missingKeywords.length <= 3);
});

test("scoreAtsReadiness returns blockers for a weak tailored resume", () => {
  const weakResume: TailoredResume = {
    id: "job-site-manager:tailored",
    jobId: siteManagerJob.id,
    variantName: `${siteManagerJob.title} at ${siteManagerJob.company}`,
    generatedAt: "2026-06-09T13:00:00.000Z",
    evidenceUsed: [],
    matchedKeywords: [],
    tailoredHeadline: "Operations professional",
    tailoredSummary: "General operations experience.",
    selectedRoleFamilies: ["Operations"],
    selectedProofPoints: [],
    selectedCertifications: [],
    sections: [
      {
        key: "summary",
        title: "Tailored Summary",
        lines: ["General operations experience."]
      }
    ],
    evidenceTrail: []
  };

  const assessment = scoreAtsReadiness(siteManagerJob, weakResume);

  assert.equal(assessment.passed, false);
  assert.ok(assessment.score < assessment.threshold);
  assert.ok(assessment.blockingIssues.some((issue) => issue.includes("Keyword coverage")));
  assert.ok(assessment.blockingIssues.some((issue) => issue.includes("proof points")));
  assert.ok(assessment.suggestions.some((suggestion) => suggestion.includes("quantified")));
  assert.ok(assessment.missingKeywords.length >= 3);
});
