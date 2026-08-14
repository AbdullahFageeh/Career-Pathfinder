import assert from "node:assert/strict";
import test from "node:test";
import { discoverSaudiGreenhouseRoles } from "./index.js";

const now = "2026-08-12T09:00:00.000Z";

function buildFetchStub(
  responses: Record<string, unknown>,
  failures: Record<string, number> = {}
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);

    const failingToken = Object.keys(failures).find((token) => url.includes(`/boards/${token}/`));
    if (failingToken) {
      return {
        ok: false,
        status: failures[failingToken] ?? 500,
        json: async () => ({})
      } as unknown as Response;
    }

    const matchedToken = Object.keys(responses).find((token) => url.includes(`/boards/${token}/`));
    return {
      ok: true,
      status: 200,
      json: async () => responses[matchedToken ?? ""] ?? { jobs: [] }
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

test("discoverSaudiGreenhouseRoles keeps Saudi roles and drops other countries", async () => {
  const { fetchImpl, calls } = buildFetchStub({
    neom: {
      jobs: [
        {
          id: 101,
          title: "Venue Operations Manager",
          absolute_url: "https://boards.greenhouse.io/neom/jobs/101",
          updated_at: "2026-08-11T10:00:00.000Z",
          content: "<p>Lead <b>venue operations</b> for major events.</p><ul><li>Overlay builds</li></ul>",
          location: { name: "NEOM, Saudi Arabia" }
        },
        {
          id: 102,
          title: "Site Operations Manager",
          absolute_url: "https://boards.greenhouse.io/neom/jobs/102",
          content: "Site delivery role",
          location: { name: "London, United Kingdom" }
        }
      ]
    }
  });

  const result = await discoverSaudiGreenhouseRoles({
    boardTokens: ["neom"],
    fetchImpl,
    now
  });

  assert.equal(calls.length, 1);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0]?.id, "greenhouse:neom:101");
  assert.equal(result.listings[0]?.company, "Neom");
  assert.equal(result.listings[0]?.applicationTarget?.platform, "greenhouse");
  assert.equal(result.listings[0]?.applicationTarget?.boardToken, "neom");
  assert.match(result.listings[0]?.description ?? "", /Lead venue operations for major events/);
  assert.ok(result.listings[0]?.tags?.includes("saudi-arabia"));
  assert.ok(result.listings[0]?.tags?.includes("neom"));
});

test("discoverSaudiGreenhouseRoles filters by target titles unless disabled", async () => {
  const responses = {
    diriyah: {
      jobs: [
        {
          id: 201,
          title: "Chef de Partie",
          absolute_url: "https://boards.greenhouse.io/diriyah/jobs/201",
          content: "Kitchen role",
          location: { name: "Riyadh, Saudi Arabia" }
        }
      ]
    }
  };

  const filtered = await discoverSaudiGreenhouseRoles({
    boardTokens: ["diriyah"],
    fetchImpl: buildFetchStub(responses).fetchImpl,
    now
  });
  assert.equal(filtered.listings.length, 0);

  const unfiltered = await discoverSaudiGreenhouseRoles({
    boardTokens: ["diriyah"],
    filterByTargetTitles: false,
    fetchImpl: buildFetchStub(responses).fetchImpl,
    now
  });
  assert.equal(unfiltered.listings.length, 1);
});

test("discoverSaudiGreenhouseRoles records failed boards without aborting the run", async () => {
  const { fetchImpl } = buildFetchStub(
    {
      neom: {
        jobs: [
          {
            id: 301,
            title: "Event Operations Manager",
            absolute_url: "https://boards.greenhouse.io/neom/jobs/301",
            content: "Event operations",
            offices: [{ name: "Jeddah, Saudi Arabia" }]
          }
        ]
      }
    },
    { missingboard: 404 }
  );

  const result = await discoverSaudiGreenhouseRoles({
    boardTokens: ["neom", "missingboard"],
    fetchImpl,
    now
  });

  assert.equal(result.listings.length, 1);
  assert.equal(result.boardsFailed.length, 1);
  assert.equal(result.boardsFailed[0]?.boardToken, "missingboard");
  assert.match(result.boardsFailed[0]?.reason ?? "", /404/);
});

test("discoverSaudiGreenhouseRoles honours the per-board listing cap", async () => {
  const { fetchImpl } = buildFetchStub({
    qiddiya: {
      jobs: Array.from({ length: 5 }, (_value, index) => ({
        id: 400 + index,
        title: `Site Operations Manager ${index}`,
        absolute_url: `https://boards.greenhouse.io/qiddiya/jobs/${400 + index}`,
        content: "Site operations",
        location: { name: "Qiddiya, Saudi Arabia" }
      }))
    }
  });

  const result = await discoverSaudiGreenhouseRoles({
    boardTokens: ["qiddiya"],
    maxListingsPerBoard: 2,
    fetchImpl,
    now
  });

  assert.equal(result.listings.length, 2);
});


test("discoverSaudiGreenhouseRoles retries transient failures but not a permanent 404", async () => {
  let transientCalls = 0;
  const retryDelays: number[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/boards/transient/")) {
      transientCalls += 1;
      if (transientCalls === 1) {
        throw new Error("fetch failed");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            {
              id: 601,
              title: "Event Operations Manager",
              absolute_url: "https://boards.greenhouse.io/transient/jobs/601",
              content: "Event operations delivery.",
              location: { name: "Jeddah, Saudi Arabia" }
            }
          ]
        })
      } as unknown as Response;
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({})
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await discoverSaudiGreenhouseRoles({
    boardTokens: ["transient", "missing"],
    fetchImpl,
    requestRetries: 2,
    retryDelayMs: 10,
    sleepImpl: async (milliseconds) => {
      retryDelays.push(milliseconds);
    },
    now
  });

  assert.equal(transientCalls, 2);
  assert.deepEqual(retryDelays, [10]);
  assert.equal(result.listings.length, 1);
  assert.equal(result.boardsFailed.length, 1);
  assert.match(result.boardsFailed[0]?.reason ?? "", /404/);
});

test("discoverSaudiGreenhouseRoles uses the verified default Saudi board set", async () => {
  const { fetchImpl, calls } = buildFetchStub({
    dmgevents: { jobs: [] },
    tamara: { jobs: [] },
    careem: { jobs: [] }
  });

  const result = await discoverSaudiGreenhouseRoles({
    fetchImpl,
    now
  });

  assert.deepEqual(result.boardsQueried, ["dmgevents", "tamara", "careem"]);
  assert.equal(calls.length, 3);
});


test("Saudi-national title wording is blocked unless candidate nationality is confirmed", async () => {
  const { assessJobEligibility } = await import("../policy/eligibility.js");
  const job = {
    id: "job-saudi-national",
    source: { kind: "job-board" as const, name: "Official board" },
    title: "Conference Producer (Saudi National)",
    company: "Example Events",
    location: "Riyadh, KSA",
    description: "Produce conferences in Riyadh.",
    tags: ["official-source", "saudi-arabia"],
    discoveredAt: now
  };

  assert.equal(assessJobEligibility(job).eligible, false);
  assert.equal(assessJobEligibility(job).requiresSaudiNationality, true);
  assert.equal(assessJobEligibility(job, { candidate: { isSaudiNational: true } }).eligible, true);
});
