import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateProfile, JobPosting } from "../shared/contracts.js";
import { formatShortlistMarkdown, rankJobOpportunities, scoreJobFit } from "./index.js";

const profile: CandidateProfile = {
  id: "abdullah-seed",
  fullName: "Abdullah Fageeh",
  headline:
    "Event operations and installation manager delivering venue builds, site management, and supplier coordination across Saudi Arabia.",
  targetRoleFamilies: ["Installation Manager", "Site Operations Manager", "Venue Operations Manager"],
  certifications: ["NEBOSH International General Certificate", "PMP Certification Training Course"],
  coreProofPoints: [
    "Delivered venue overlay builds across six venues",
    "Reduced safety incidents by 25 percent through site inductions",
    "Coordinated suppliers and load-out for Formula 1 venue operations"
  ],
  documents: [],
  recurringAnswers: []
};

const now = "2026-08-12T09:00:00.000Z";

function buildJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-test",
    source: {
      kind: "company-page",
      name: "Employer Careers",
      url: "https://careers.example.com/job/1"
    },
    title: "Venue Operations Manager",
    company: "Example Events",
    location: "Jeddah, Saudi Arabia",
    description:
      "Lead venue operations, site management, supplier coordination, overlay builds, and load-out for live events.",
    tags: ["official-source", "saudi-arabia", "jeddah"],
    applicationTarget: {
      url: "https://boards.greenhouse.io/example/jobs/1",
      platform: "greenhouse"
    },
    discoveredAt: "2026-08-11T09:00:00.000Z",
    ...overrides
  };
}

test("scoreJobFit rewards a direct-fit Jeddah venue operations role", () => {
  const fit = scoreJobFit(profile, buildJob(), { now });

  assert.equal(fit.band, "strong");
  assert.ok(fit.score >= 75, `expected a strong score, received ${fit.score}`);
  assert.equal(fit.eligibility.eligible, true);
  assert.ok(fit.reasons.length > 0);
});

test("scoreJobFit caps ineligible postings so they cannot outrank workable leads", () => {
  const fit = scoreJobFit(
    profile,
    buildJob({
      id: "job-blocked",
      tags: ["official-source", "saudi-arabia", "riyadh", "saudi-national-only"]
    }),
    { now }
  );

  assert.equal(fit.band, "skip");
  assert.ok(fit.score <= 20, `expected a capped score, received ${fit.score}`);
  assert.ok(fit.reasons[0]?.startsWith("Blocked:"));
});

test("scoreJobFit penalises entry-level roles and weak application channels", () => {
  const fit = scoreJobFit(
    profile,
    buildJob({
      id: "job-entry",
      title: "Warehouse Operator",
      description: "Move stock in the warehouse.",
      applicationTarget: {
        url: "https://wa.me/123456789"
      }
    }),
    { now }
  );

  const seniority = fit.dimensions.find((dimension) => dimension.key === "seniority");
  const channel = fit.dimensions.find((dimension) => dimension.key === "application-channel");

  assert.equal(seniority?.score, 3);
  assert.equal(channel?.score, 2);
  assert.ok(fit.score < 55);
});

test("scoreJobFit scores remote roles as zero travel cost", () => {
  const fit = scoreJobFit(
    profile,
    buildJob({
      id: "job-remote",
      location: "Remote, Saudi Arabia"
    }),
    { now }
  );

  const location = fit.dimensions.find((dimension) => dimension.key === "location");
  assert.equal(location?.score, 15);
  assert.equal(fit.eligibility.remoteFriendly, true);
});

test("rankJobOpportunities orders eligible roles and drops blocked ones by default", () => {
  const ranked = rankJobOpportunities(
    profile,
    [
      buildJob({ id: "job-strong" }),
      buildJob({
        id: "job-weak",
        title: "Reservation Agent",
        location: "Abha, Saudi Arabia",
        description: "Handle guest reservations by phone.",
        applicationTarget: { url: "https://careers.example.com/apply" }
      }),
      buildJob({
        id: "job-blocked",
        location: "Doha, Qatar",
        tags: ["official-source"]
      })
    ],
    { now }
  );

  assert.deepEqual(
    ranked.map((entry) => entry.job.id),
    ["job-strong", "job-weak"]
  );
  assert.equal(ranked[0]?.rank, 1);
});

test("rankJobOpportunities honours limit and minimum score", () => {
  const ranked = rankJobOpportunities(
    profile,
    [buildJob({ id: "job-a" }), buildJob({ id: "job-b" }), buildJob({ id: "job-c" })],
    { now, limit: 2, minimumScore: 50 }
  );

  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((entry) => entry.fit.score >= 50));
});

test("formatShortlistMarkdown renders an actionable table", () => {
  const ranked = rankJobOpportunities(profile, [buildJob()], { now });
  const markdown = formatShortlistMarkdown(ranked, { generatedAt: now });

  assert.match(markdown, /# Daily application shortlist/);
  assert.match(markdown, /Venue Operations Manager/);
  assert.match(markdown, /\[apply\]\(https:\/\/boards\.greenhouse\.io\/example\/jobs\/1\)/);
});

test("formatShortlistMarkdown handles an empty shortlist", () => {
  const markdown = formatShortlistMarkdown([], { generatedAt: now });
  assert.match(markdown, /No eligible opportunities were found\./);
});
