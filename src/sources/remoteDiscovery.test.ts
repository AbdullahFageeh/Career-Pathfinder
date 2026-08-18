import assert from "node:assert/strict";
import test from "node:test";

import { assessJobEligibility } from "../policy/eligibility.js";
import type { JobPosting } from "../shared/contracts.js";
import { discoverSaudiLeverRoles } from "./saudiLeverBoards.js";
import { discoverSaudiWorkableRoles } from "./saudiWorkableBoards.js";

function remoteJob(): JobPosting {
  return {
    id: "remote:venue-ops",
    source: { kind: "job-board", name: "official-remote", url: "https://jobs.example.com/venue-ops" },
    title: "Remote Venue Operations Manager",
    company: "Example Events",
    location: "Remote",
    description: "Remote role coordinating venue operations, suppliers, and live-event delivery.",
    tags: ["official-source", "remote"],
    applicationTarget: {
      url: "https://jobs.example.com/venue-ops/apply",
      platform: "lever",
      siteToken: "example",
      jobId: "venue-ops"
    },
    discoveredAt: "2026-08-18T08:00:00.000Z"
  };
}

test("allows a trusted remote role only when remote scope is explicitly enabled", () => {
  const job = remoteJob();
  assert.equal(assessJobEligibility(job, { allowRemote: false }).eligible, false);
  assert.equal(assessJobEligibility(job, { allowRemote: true }).eligible, true);
});

test("accepts Workable telecommuting roles in explicit remote mode and tags them as remote", async () => {
  const result = await discoverSaudiWorkableRoles({
    siteTokens: ["remote-events"],
    includeRemote: true,
    now: "2026-08-18T08:00:00.000Z",
    fetchImpl: async () => new Response(JSON.stringify({
      name: "Remote Events Co",
      jobs: [{
        id: "remote-123",
        title: "Remote Event Operations Manager",
        url: "https://apply.workable.com/remote-events/j/remote-123",
        location: { telecommuting: true, location_str: "Remote" },
        full_description: "Coordinate suppliers and live-event delivery from a remote operating model."
      }]
    }), { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.listings.length, 1);
  assert.ok(result.listings[0]?.tags?.includes("remote"));
  assert.ok(!result.listings[0]?.tags?.includes("saudi-arabia"));
});

test("accepts explicitly marked Lever remote roles only in explicit remote mode", async () => {
  const result = await discoverSaudiLeverRoles({
    siteTokens: ["remote-events"],
    includeRemote: true,
    now: "2026-08-18T08:00:00.000Z",
    fetchImpl: async () => new Response(JSON.stringify([{
      id: "remote-lever-1",
      text: "Remote Event Operations Manager",
      categories: { location: "Remote" },
      descriptionPlain: "Coordinate event operations and suppliers remotely.",
      applyUrl: "https://jobs.lever.co/remote-events/remote-lever-1/apply"
    }]), { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.listings.length, 1);
  assert.ok(result.listings[0]?.tags?.includes("remote"));
});


test("holds country-restricted remote roles even when remote search is enabled", () => {
  const job = {
    ...remoteJob(),
    id: "remote:us-only",
    location: "Remote - United States only",
    tags: ["official-source", "remote"]
  };
  const assessment = assessJobEligibility(job, { allowRemote: true });

  assert.equal(assessment.eligible, false);
  assert.ok(assessment.blockers.some((blocker) => blocker.kind === "remote-jurisdiction-restricted"));
});


test("allows country-restricted remote roles in worldwide mode but flags the jurisdiction for review", () => {
  const job = {
    ...remoteJob(),
    id: "remote:us-only-review",
    location: "Remote - United States only",
    tags: ["official-source", "remote"]
  };
  const assessment = assessJobEligibility(job, { allowRemote: true, remoteScope: "worldwide" });

  assert.equal(assessment.eligible, true);
  assert.ok(assessment.warnings.some((warning) => warning.kind === "remote-jurisdiction-review"));
});
