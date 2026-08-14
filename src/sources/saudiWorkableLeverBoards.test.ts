import assert from "node:assert/strict";
import test from "node:test";

import { discoverSaudiLeverRoles, normalizeLeverPosting } from "./saudiLeverBoards.js";
import { discoverSaudiWorkableRoles, normalizeWorkableJob } from "./saudiWorkableBoards.js";

test("discovers and normalizes a configured Saudi Lever posting as review-only routing", async () => {
  const result = await discoverSaudiLeverRoles({
    siteTokens: ["eventco"],
    now: "2026-08-15T09:00:00.000Z",
    fetchImpl: async (input) => {
      assert.match(String(input), /api\.lever\.co\/v0\/postings\/eventco\?mode=json/);
      return new Response(
        JSON.stringify([
          {
            id: "lever-123",
            text: "Venue Operations Manager",
            categories: { location: "Riyadh, Saudi Arabia" },
            descriptionPlain: "Lead venue operations, suppliers, and event delivery.",
            applyUrl: "https://jobs.lever.co/eventco/lever-123/apply",
            updatedAt: 1786784400000
          },
          {
            id: "non-saudi",
            text: "Venue Operations Manager",
            categories: { location: "London, United Kingdom" }
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  assert.equal(result.sitesFailed.length, 0);
  assert.equal(result.listings.length, 1);
  assert.deepEqual(result.listings[0]?.applicationTarget, {
    url: "https://jobs.lever.co/eventco/lever-123/apply",
    platform: "lever",
    siteToken: "eventco",
    jobId: "lever-123"
  });
  const listing = result.listings[0];
  assert.ok(listing);
  assert.ok(listing.tags?.includes("official-source"));
});

test("records failed Lever sites without aborting the discovery batch", async () => {
  const result = await discoverSaudiLeverRoles({
    siteTokens: ["missing"],
    fetchImpl: async () => new Response("not found", { status: 404 })
  });

  assert.equal(result.listings.length, 0);
  assert.match(result.sitesFailed[0]?.reason ?? "", /status 404/);
});

test("normalizes a public Saudi Workable widget job with its public application URL", async () => {
  const result = await discoverSaudiWorkableRoles({
    siteTokens: ["seven-7"],
    now: "2026-08-15T09:00:00.000Z",
    fetchImpl: async (input) => {
      assert.match(String(input), /apply\.workable\.com\/api\/v1\/widget\/accounts\/seven-7\?details=true/);
      return new Response(
        JSON.stringify({
          name: "Saudi Entertainment Ventures",
          jobs: [
            {
              id: 221,
              title: "Venue Operations Manager",
              url: "https://apply.workable.com/seven-7/j/221",
              location: { location_str: "Riyadh, Saudi Arabia" },
              full_description: "<p>Own venue operations and supplier delivery.</p>",
              published_on: "2026-08-14T10:00:00.000Z"
            },
            {
              id: 222,
              title: "Venue Operations Manager",
              location: { location_str: "Paris, France" }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  assert.equal(result.sitesFailed.length, 0);
  assert.equal(result.listings.length, 1);
  assert.deepEqual(result.listings[0]?.applicationTarget, {
    url: "https://apply.workable.com/seven-7/j/221",
    platform: "workable",
    siteToken: "seven-7",
    jobId: "221"
  });
  assert.match(result.listings[0]?.description ?? "", /Own venue operations/);
});

test("normalizers reject records without an id or title", () => {
  assert.equal(
    normalizeLeverPosting("eventco", { id: "only-id" }, "2026-08-15T09:00:00.000Z"),
    undefined
  );
  assert.equal(
    normalizeWorkableJob("seven-7", { name: "SEVEN" }, { id: 1 }, "2026-08-15T09:00:00.000Z"),
    undefined
  );
});
