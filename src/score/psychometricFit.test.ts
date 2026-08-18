import test from "node:test";
import assert from "node:assert/strict";

import { assessPsychometricAlignment } from "./psychometricFit.js";
import { scoreJobFit } from "./fitScore.js";
import type { CandidateProfile, JobPosting } from "../shared/contracts.js";

const profile: CandidateProfile = {
  id: "abdullah",
  fullName: "Abdullah Fageeh",
  headline: "Event Operations & Production Manager with systems and team delivery experience.",
  targetRoleFamilies: ["Event Operations Manager", "Site Operations Manager", "Production Manager"],
  coreProofPoints: [
    "Led site logistics and vendor coordination across live events.",
    "Built structured workflows and delivery plans across multiple venues."
  ],
  certifications: ["NEBOSH IGC"],
  documents: [],
  recurringAnswers: []
};

function job(overrides: Partial<JobPosting>): JobPosting {
  return {
    id: overrides.id ?? "role-1",
    title: overrides.title ?? "Operations Project Manager",
    company: overrides.company ?? "Example Saudi Employer",
    location: overrides.location ?? "Riyadh, Saudi Arabia",
    description: overrides.description ?? "",
    tags: overrides.tags ?? [],
    source: overrides.source ?? { kind: "manual", name: "Manual test source", url: "https://careers.example.com/jobs/1" },
    discoveredAt: overrides.discoveredAt ?? "2026-08-15T00:00:00.000Z",
    ...overrides
  };
}

test("rewards structured, human-centred, site-based systems roles using explicit posting evidence", () => {
  const assessment = assessPsychometricAlignment(
    job({
      title: "Human-Centric Operations Project Manager",
      description:
        "Lead structured project delivery, site implementation, workflow improvement, stakeholder coaching, team development and operational systems design."
    })
  );

  assert.ok(assessment.score >= 75);
  assert.equal(assessment.band, "strong");
  assert.ok(assessment.matchedSignals.some((signal) => signal.includes("structured project")));
  assert.ok(assessment.matchedSignals.some((signal) => signal.includes("human-centred")));
});

test("holds roles centered on competitive sales, repetitive work, or pure administration", () => {
  const assessment = assessPsychometricAlignment(
    job({
      title: "Sales Director",
      description: "Own cold calling, sales quota, competitive negotiation and commission targets for a high-volume call centre."
    })
  );

  assert.ok(assessment.score <= 30);
  assert.equal(assessment.band, "hold");
  assert.ok(assessment.cautions.some((caution) => caution.includes("competitive-sales")));
});

test("makes psychometric alignment primary only when the policy is explicitly enabled", () => {
  const aligned = job({
    id: "aligned",
    title: "Operations Project Manager",
    description: "Structured project delivery, venue implementation, operational systems design, stakeholder coaching and workflow improvement."
  });
  const misaligned = job({
    id: "misaligned",
    title: "Operations Manager",
    description: "High-volume cold calling, sales quota ownership, commission targets and repetitive call-centre administration."
  });

  const standardAligned = scoreJobFit(profile, aligned, { now: "2026-08-15T00:00:00.000Z" });
  const standardMisaligned = scoreJobFit(profile, misaligned, { now: "2026-08-15T00:00:00.000Z" });
  const psychAligned = scoreJobFit(profile, aligned, {
    now: "2026-08-15T00:00:00.000Z",
    selectionProfile: "psychometric-first"
  });
  const psychMisaligned = scoreJobFit(profile, misaligned, {
    now: "2026-08-15T00:00:00.000Z",
    selectionProfile: "psychometric-first"
  });

  assert.equal(standardAligned.selectionProfile, "standard");
  assert.equal(standardMisaligned.selectionProfile, "standard");
  assert.equal(psychAligned.selectionProfile, "psychometric-first");
  assert.equal(psychMisaligned.selectionProfile, "psychometric-first");
  assert.ok(psychAligned.score > psychMisaligned.score);
  assert.ok((psychAligned.psychometricScore ?? 0) > (psychMisaligned.psychometricScore ?? 0));
  assert.ok((psychAligned.ikigaiScore ?? 0) > (psychMisaligned.ikigaiScore ?? 0));
});

test("uses role-text evidence only and does not claim unknown culture attributes", () => {
  const assessment = assessPsychometricAlignment(
    job({
      title: "Project Manager",
      description: "Coordinate project delivery and schedules."
    })
  );

  assert.ok(!assessment.matchedSignals.some((signal) => /safe culture|inclusive employer|fair leadership/i.test(signal)));
  assert.ok(assessment.cautions.some((caution) => caution.includes("cannot be verified")));
});

test("holds an unrelated finance specialty even when it contains operations keywords", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Finance Manager - Operations",
      description: "Own finance operations, accounting controls, project planning and process improvement."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.careerDomainCompatible, false);
  assert.ok(fit.score <= 34);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.startsWith("Career-domain hold:")));
});

test("holds a generic governance role when the posting lacks target event, delivery, or human-systems scope", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Governance Manager",
      description: "Maintain policy controls, corporate governance frameworks, compliance reporting and audit documentation."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.careerDomainCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.includes("does not show an explicit target career-domain signal")));
});

test("holds an event-adjacent role when it explicitly requires an unverified specialized discipline", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Senior Manager - Theming",
      description:
        "Lead thematic concepts, 3D models and renderings for entertainment theme parks. Requires a Fine Arts degree and 3D Animations experience."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.verifiedSpecialtyCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.startsWith("Verified-specialty hold:")));
});

test("holds an attraction-maintenance role that requires unverified technical credentials", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Senior Technician - Maintenance",
      description:
        "Maintain attraction rides and devices. Requires an Engineering Certificate in an Electrical, Mechanical, or Electromechanical field and major ride rehabilitation experience."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.verifiedSpecialtyCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.includes("attraction-ride maintenance")));
});

test("holds a senior commercial project-controls role without verified project-controls evidence", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Director Portfolio Controls & Change Management",
      description:
        "Lead commercial controls, Aconex Connected Cost, portfolio cost data, quantity surveying and PgMP-level programme management across projects."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.verifiedSpecialtyCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.includes("commercial project-controls")));
});

test("holds an entertainment-operations role when maintenance competency systems are not evidenced", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Senior Manager - Supply Chain & Workforce Competency - Entertainment Operations",
      description:
        "Lead workforce competency for maintenance operations. Requires SAP, Maximo, enterprise asset management systems and maintenance competency frameworks."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.verifiedSpecialtyCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.includes("maintenance-competency")));
});

test("holds a hospitality role when the required food-and-beverage background is not evidenced", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "Senior Operation Specialist",
      description:
        "Lead daily dining-hall operations. Requires 6–8 years in hospitality or food and beverage operations, including high-volume restaurants or food halls."
    }),
    { now: "2026-08-15T00:00:00.000Z", selectionProfile: "psychometric-first" }
  );

  assert.equal(fit.verifiedSpecialtyCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.includes("hospitality and food-and-beverage")));
});


test("holds a GTM strategy role without verified GTM, demand-generation, or revenue-operations evidence", () => {
  const fit = scoreJobFit(
    profile,
    job({
      title: "GTM Strategy Principal",
      location: "Remote-EMEA",
      description:
        "Own go-to-market strategy and operations, demand generation, top-of-funnel execution, Sales, Partnerships, and RevOps initiatives."
    }),
    { now: "2026-08-18T00:00:00.000Z", selectionProfile: "psychometric-first", allowRemote: true }
  );

  assert.equal(fit.verifiedSpecialtyCompatible, false);
  assert.equal(fit.band, "skip");
  assert.ok(fit.reasons.some((reason) => reason.includes("go-to-market")));
});
