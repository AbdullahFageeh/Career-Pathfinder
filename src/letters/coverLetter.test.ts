import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateProfile, JobPosting } from "../shared/contracts.js";
import { buildTailoredResume } from "../tailor/index.js";
import {
  buildCoverLetterDraft,
  findInventedClaims,
  formatCoverLetterText,
  refineCoverLetterWithLlm,
  type LlmClient
} from "./index.js";

const now = "2026-08-12T09:00:00.000Z";

const profile: CandidateProfile = {
  id: "candidate-seed",
  fullName: "Avery Morgan",
  email: "avery@example.test",
  phone: "+966500000000",
  country: "Saudi Arabia",
  headline: "Event operations and installation manager delivering venue builds across Saudi Arabia.",
  targetRoleFamilies: ["Installation Manager", "Venue Operations Manager"],
  certifications: ["NEBOSH International General Certificate", "PMP Certification Training Course"],
  coreProofPoints: [
    "Delivered venue overlay builds across six venues",
    "Reduced safety incidents by 25 percent through site inductions",
    "Coordinated suppliers and load-out for live event programmes"
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
  company: "Example Events",
  location: "Jeddah, Saudi Arabia",
  description:
    "Lead venue operations, overlay builds, supplier coordination, site inductions, and load-out for live events.",
  tags: ["official-source", "saudi-arabia", "jeddah"],
  discoveredAt: "2026-08-11T09:00:00.000Z"
};

test("buildCoverLetterDraft builds a factual letter from profile evidence", () => {
  const draft = buildCoverLetterDraft(profile, job, buildTailoredResume(profile, job), { now });

  assert.equal(draft.jobId, job.id);
  assert.equal(draft.salutation, "Dear Example Events hiring team,");
  assert.equal(draft.refinedByLlm, false);
  assert.ok(draft.paragraphs.length >= 3);
  assert.match(draft.body, /Venue Operations Manager/);
  assert.match(draft.body, /avery@example\.test/);
  assert.ok(draft.wordCount > 40);
  assert.equal(
    findInventedClaims(draft.body, [
      profile.headline,
      profile.email ?? "",
      profile.phone ?? "",
      ...profile.coreProofPoints,
      ...profile.certifications,
      job.title,
      job.company,
      job.description
    ]),
    undefined
  );
});

test("buildCoverLetterDraft addresses a verified contact and honours tone", () => {
  const draft = buildCoverLetterDraft(profile, job, undefined, {
    now,
    recipientName: "Ms Al Harbi",
    tone: "formal"
  });

  assert.equal(draft.salutation, "Dear Ms Al Harbi,");
  assert.match(draft.body, /I write to express my interest/);
});

test("formatCoverLetterText produces a paste-ready email body", () => {
  const draft = buildCoverLetterDraft(profile, job, undefined, { now });
  const text = formatCoverLetterText(draft, profile);

  assert.ok(text.startsWith("Dear Example Events hiring team,"));
  assert.ok(text.trimEnd().endsWith("Avery Morgan"));
});

test("refineCoverLetterWithLlm skips cleanly when no credentials are configured", async () => {
  const draft = buildCoverLetterDraft(profile, job, undefined, { now });
  const result = await refineCoverLetterWithLlm(draft, profile, job, {
    apiKey: undefined,
    client: undefined
  });

  if (result.refined) {
    assert.ok(result.draft.refinedByLlm);
    return;
  }

  assert.equal(result.refined, false);
  assert.ok(result.skippedReason);
});

test("refineCoverLetterWithLlm accepts a rewrite that stays inside the evidence", async () => {
  const draft = buildCoverLetterDraft(profile, job, undefined, { now });
  const client: LlmClient = async () => ({
    content: [
      "I am applying for the Venue Operations Manager role at Example Events in Jeddah, Saudi Arabia.",
      "",
      "I have delivered venue overlay builds across six venues and reduced safety incidents by 25 percent through site inductions."
    ].join("\n")
  });

  const result = await refineCoverLetterWithLlm(draft, profile, job, { client });

  assert.equal(result.refined, true);
  assert.equal(result.draft.refinedByLlm, true);
  assert.equal(result.draft.paragraphs.length, 2);
});

test("refineCoverLetterWithLlm rejects a rewrite that invents metrics", async () => {
  const draft = buildCoverLetterDraft(profile, job, undefined, { now });
  const client: LlmClient = async () => ({
    content: "I have delivered 47 stadium builds and managed budgets of 900 million riyals."
  });

  const result = await refineCoverLetterWithLlm(draft, profile, job, { client });

  assert.equal(result.refined, false);
  assert.match(result.rejectedReason ?? "", /unsupported number 47/);
  assert.equal(result.draft.refinedByLlm, false);
});

test("refineCoverLetterWithLlm reports transport failures without losing the draft", async () => {
  const draft = buildCoverLetterDraft(profile, job, undefined, { now });
  const client: LlmClient = async () => {
    throw new Error("connection reset");
  };

  const result = await refineCoverLetterWithLlm(draft, profile, job, { client });

  assert.equal(result.refined, false);
  assert.match(result.skippedReason ?? "", /connection reset/);
  assert.equal(result.draft.body, draft.body);
});

test("findInventedClaims flags unsupported acronyms and passes supported ones", () => {
  const allowed = ["NEBOSH International General Certificate", "delivered 6 venues"];

  assert.equal(findInventedClaims("I hold NEBOSH and delivered 6 venues.", allowed), undefined);
  assert.match(findInventedClaims("I hold OSHA certification.", allowed) ?? "", /unsupported acronym OSHA/);
});
