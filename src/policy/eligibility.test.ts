import assert from "node:assert/strict";
import test from "node:test";
import type { JobPosting } from "../shared/contracts.js";
import { assessJobEligibility, partitionEligibleJobs, resolveSaudiCity } from "./index.js";

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
    description: "Deliver venue operations for large scale live events.",
    tags: ["official-source", "saudi-arabia", "jeddah"],
    applicationTarget: {
      url: "https://careers.example.com/job/1/apply"
    },
    discoveredAt: "2026-08-10T09:00:00.000Z",
    ...overrides
  };
}

test("assessJobEligibility accepts an official Saudi posting", () => {
  const assessment = assessJobEligibility(buildJob(), { now: "2026-08-12T09:00:00.000Z" });

  assert.equal(assessment.eligible, true);
  assert.equal(assessment.resolvedCity, "jeddah");
  assert.equal(assessment.blockers.length, 0);
  assert.equal(assessment.requiresSaudiNationality, false);
});

test("assessJobEligibility blocks postings outside Saudi Arabia", () => {
  const assessment = assessJobEligibility(
    buildJob({
      location: "Hannover, Niedersachsen, Deutschland",
      tags: ["official-source"]
    })
  );

  assert.equal(assessment.eligible, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.kind === "outside-target-country"));
});

test("assessJobEligibility blocks Saudi-national-only roles for non-nationals", () => {
  const assessment = assessJobEligibility(
    buildJob({
      tags: ["official-source", "saudi-arabia", "riyadh", "saudi-national-only"]
    })
  );

  assert.equal(assessment.requiresSaudiNationality, true);
  assert.equal(assessment.eligible, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.kind === "nationality-restricted"));
});

test("assessJobEligibility allows Saudi-national-only roles when the candidate qualifies", () => {
  const assessment = assessJobEligibility(
    buildJob({
      tags: ["official-source", "saudi-arabia", "riyadh", "saudi-national-only"]
    }),
    {
      candidate: {
        isSaudiNational: true
      }
    }
  );

  assert.equal(assessment.eligible, true);
});

test("assessJobEligibility blocks low-legitimacy income leads", () => {
  const assessment = assessJobEligibility(
    buildJob({
      description: "Join our team. This is a commission only role with unlimited earning potential.",
      tags: ["saudi-arabia", "jeddah"]
    })
  );

  assert.equal(assessment.eligible, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.kind === "low-legitimacy-signal"));
});

test("assessJobEligibility warns about unofficial sources and Arabic requirements", () => {
  const assessment = assessJobEligibility(
    buildJob({
      source: {
        kind: "job-board",
        name: "community-post"
      },
      description: "Site operations role. Fluent Arabic required for contractor coordination.",
      tags: ["saudi-arabia", "riyadh"]
    })
  );

  assert.ok(assessment.warnings.some((warning) => warning.kind === "unofficial-source"));
  assert.ok(assessment.warnings.some((warning) => warning.kind === "language-requirement"));
});

test("assessJobEligibility can require an application channel", () => {
  const assessment = assessJobEligibility(
    buildJob({
      applicationTarget: undefined,
      source: {
        kind: "company-page",
        name: "Employer Careers"
      }
    }),
    {
      requireApplicationChannel: true
    }
  );

  assert.equal(assessment.eligible, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.kind === "missing-application-channel"));
});

test("partitionEligibleJobs separates workable leads from blocked leads", () => {
  const result = partitionEligibleJobs([
    buildJob({ id: "job-keep" }),
    buildJob({ id: "job-drop", location: "Dubai, United Arab Emirates", tags: ["official-source"] })
  ]);

  assert.deepEqual(
    result.eligible.map((job) => job.id),
    ["job-keep"]
  );
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0]?.job.id, "job-drop");
  assert.equal(result.assessments.size, 2);
});

test("resolveSaudiCity prefers the most specific city term", () => {
  assert.equal(resolveSaudiCity("king abdullah economic city, saudi arabia"), "king abdullah economic city");
  assert.equal(resolveSaudiCity("unknown place", ["riyadh"]), "riyadh");
  assert.equal(resolveSaudiCity("berlin, germany"), undefined);
});
