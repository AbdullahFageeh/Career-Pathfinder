import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateProfile, JobPosting } from "../shared/contracts.js";

import { buildTailoredResume, extractJobKeywords } from "./index.js";

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

const buildManagerJob: JobPosting = {
  id: "job-build-manager",
  source: {
    kind: "job-board",
    name: "arbeitsagentur",
    url: "https://example.com/build-manager"
  },
  title: "Event Build Manager",
  company: "Example Live Projects GmbH",
  location: "Berlin, Deutschland",
  description:
    "Own installation planning, build schedules, AutoCAD layout compliance, temporary structures, and on-site delivery for exhibitions and venue builds.",
  detectedRoleFamily: "installation-build",
  tags: ["lane-1", "source:arbeitsagentur", "family:installation-build", "matched-title:event-build-manager"],
  discoveredAt: "2026-06-09T13:00:00.000Z"
};

test("extractJobKeywords keeps strong role signals and drops generic manager noise", () => {
  const keywords = extractJobKeywords(siteManagerJob, 10);
  const keywordTerms = keywords.map((keyword) => keyword.term);

  assert.ok(keywordTerms.includes("Site Manager (m/w/d)"));
  assert.ok(keywordTerms.includes("Site Venue Operations"));
  assert.ok(keywordTerms.includes("site"));
  assert.ok(keywordTerms.includes("venue"));
  assert.ok(keywordTerms.includes("operation"));
  assert.equal(keywordTerms.includes("manager"), false);

  const detectedRoleFamilyKeyword = keywords.find((keyword) => keyword.term === "Site Venue Operations");
  assert.deepEqual(detectedRoleFamilyKeyword?.sources, ["detected-role-family"]);
});

test("buildTailoredResume prioritizes site-focused evidence for a site manager role", () => {
  const tailored = buildTailoredResume(sampleProfile, siteManagerJob);

  assert.deepEqual(tailored.selectedRoleFamilies, [
    "Site Operations",
    "Site Manager",
    "Venue Operations"
  ]);
  assert.equal(tailored.selectedProofPoints[0], "Formula 1 venue operations supporting 50,000+ attendees");
  assert.ok(tailored.selectedProofPoints.includes("6-venue build delivery"));
  assert.ok(
    tailored.selectedCertifications.includes(
      "NEBOSH International General Certificate in Occupational Health and Safety"
    )
  );
  assert.match(tailored.tailoredSummary, /Focused on Site Manager \(m\/w\/d\) opportunities/);
  assert.match(tailored.tailoredSummary, /Formula 1 venue operations supporting 50,000\+ attendees/);
  assert.ok(tailored.sections.some((section) => section.key === "summary"));
  assert.ok(tailored.evidenceTrail.some((evidence) => evidence.kind === "headline"));
});

test("buildTailoredResume shifts toward installation evidence for a build manager role", () => {
  const tailored = buildTailoredResume(sampleProfile, buildManagerJob);

  assert.equal(tailored.selectedRoleFamilies[0], "Installation Manager");
  assert.equal(tailored.selectedProofPoints[0], "6-venue build delivery");
  assert.ok(tailored.selectedProofPoints.includes("100% AutoCAD layout compliance"));
  assert.ok(tailored.selectedProofPoints.includes("installations completed 20% ahead of schedule"));
  assert.match(tailored.tailoredSummary, /Focused on Event Build Manager opportunities/);
  assert.ok(tailored.matchedKeywords.includes("installation"));
  assert.ok(tailored.matchedKeywords.includes("build"));
});
