import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runDailyAutomationOperation } from "./operations.js";
import { createSqliteStorage } from "../storage/index.js";
import type { CandidateProfile } from "../shared/contracts.js";

const profile: CandidateProfile = {
  id: "profile:abdullah",
  fullName: "Abdullah Fageeh",
  country: "Saudi Arabia",
  headline: "Live event operations professional",
  targetRoleFamilies: ["venue operations", "event production"],
  certifications: [],
  coreProofPoints: ["Delivered venue operations and supplier coordination for large live events."],
  documents: [],
  recurringAnswers: []
};

test("runs configured Greenhouse discovery through the safe daily queue and writes a review report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "automation-operation-test-"));
  const configPath = join(dir, "automation.config.json");
  const reportPath = join(dir, "review.md");
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      timeZone: "Asia/Riyadh",
      automationMode: "full-auto",
      autoSubmitEnabled: false,
      caps: { dailyApplications: 2, maxApplicationsPerEmployer: 1, employerCooldownDays: 30 },
      thresholds: { minFitScore: 50, minAtsScore: 80 },
      sources: [
        {
          id: "dmgevents-greenhouse",
          kind: "greenhouse",
          capability: "structured-submit",
          enabled: true,
          boardToken: "dmgevents"
        }
      ],
      answers: [
        {
          key: "nationality",
          value: "Saudi",
          approval: "auto-submit",
          provenance: {
            sourceKind: "candidate-profile",
            sourceRef: "APPLICATION_REFERENCE.md:1",
            verifiedAt: "2026-08-14T00:00:00.000Z"
          }
        }
      ]
    })
  );

  const storage = createSqliteStorage({ storagePath: join(dir, "store.sqlite") });
  const result = await runDailyAutomationOperation(
    {
      configPath,
      storage,
      outputPath: reportPath,
      now: "2026-08-15T08:00:00.000Z"
    },
    {
      loadCandidateProfile: async () => profile,
      discoverSaudiGreenhouseRoles: async (options) => {
        assert.deepEqual(options?.boardTokens, ["dmgevents"]);
        assert.equal(options?.filterByTargetTitles, false);
        return {
          fetchedAt: "2026-08-15T08:00:00.000Z",
          sourceName: "greenhouse-board",
          boardsQueried: ["dmgevents"],
          boardsFailed: [],
          listings: [
            {
              id: "greenhouse:dmgevents:123",
              source: { kind: "job-board", name: "greenhouse-board:dmgevents" },
              title: "Venue Operations Manager",
              company: "DMG Events",
              location: "Riyadh, Saudi Arabia",
              description: "Lead venue operations and supplier coordination for a major event.",
              tags: ["official-source", "saudi-arabia", "board:dmgevents"],
              applicationTarget: {
                platform: "greenhouse",
                boardToken: "dmgevents",
                jobId: "123",
                url: "https://job-boards.greenhouse.io/dmgevents/jobs/123"
              },
              discoveredAt: "2026-08-15T08:00:00.000Z"
            }
          ]
        };
      }
    }
  );

  assert.equal(result.run.skipped, false);
  assert.equal(result.discovery.listings, 1);
  assert.equal(result.run.queued.length, 1);
  assert.equal(result.outputPath, reportPath);
  assert.match(result.markdown, /Daily automation desk review queue/);

  rmSync(dir, { recursive: true });
});


test("combines configured Greenhouse, Lever, and Workable discovery without bypassing review-only routing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "automation-operation-multi-ats-"));
  const configPath = join(dir, "automation.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      timeZone: "Asia/Riyadh",
      automationMode: "full-auto",
      autoSubmitEnabled: false,
      caps: { dailyApplications: 3, maxApplicationsPerEmployer: 1, employerCooldownDays: 30 },
      thresholds: { minFitScore: 50, minAtsScore: 80 },
      sources: [
        { id: "dmg", kind: "greenhouse", capability: "structured-submit", enabled: true, boardToken: "dmgevents" },
        { id: "eventco", kind: "lever", capability: "review-only", enabled: true, siteToken: "eventco" },
        { id: "seven", kind: "workable", capability: "review-only", enabled: true, siteToken: "seven-7" }
      ],
      answers: [
        {
          key: "nationality",
          value: "Saudi",
          approval: "auto-submit",
          provenance: { sourceKind: "candidate-profile", sourceRef: "APPLICATION_REFERENCE.md:1", verifiedAt: "2026-08-14T00:00:00.000Z" }
        }
      ]
    })
  );
  const storage = createSqliteStorage({ storagePath: join(dir, "store.sqlite") });
  const result = await runDailyAutomationOperation(
    { configPath, storage, now: "2026-08-15T08:00:00.000Z" },
    {
      loadCandidateProfile: async () => profile,
      discoverSaudiGreenhouseRoles: async () => ({
        fetchedAt: "2026-08-15T08:00:00.000Z",
        sourceName: "greenhouse-board",
        boardsQueried: ["dmgevents"],
        boardsFailed: [],
        listings: []
      }),
      discoverSaudiLeverRoles: async (options) => {
        assert.deepEqual(options.siteTokens, ["eventco"]);
        return {
          fetchedAt: "2026-08-15T08:00:00.000Z",
          sitesQueried: ["eventco"],
          sitesFailed: [],
          listings: [
            {
              id: "lever:eventco:1",
              source: { kind: "job-board", name: "lever-site:eventco" },
              title: "Venue Operations Manager",
              company: "Eventco",
              location: "Riyadh, Saudi Arabia",
              description: "Lead venue operations and event suppliers.",
              tags: ["official-source", "saudi-arabia", "site:eventco"],
              applicationTarget: { platform: "lever", siteToken: "eventco", jobId: "1", url: "https://jobs.lever.co/eventco/1/apply" },
              discoveredAt: "2026-08-15T08:00:00.000Z"
            }
          ]
        };
      },
      discoverSaudiWorkableRoles: async (options) => {
        assert.deepEqual(options.siteTokens, ["seven-7"]);
        return {
          fetchedAt: "2026-08-15T08:00:00.000Z",
          sitesQueried: ["seven-7"],
          sitesFailed: [],
          listings: [
            {
              id: "workable:seven-7:1",
              source: { kind: "job-board", name: "workable-site:seven-7" },
              title: "Site Operations Manager",
              company: "SEVEN",
              location: "Riyadh, Saudi Arabia",
              description: "Manage site operations and supplier delivery.",
              tags: ["official-source", "saudi-arabia", "site:seven-7"],
              applicationTarget: { platform: "workable", siteToken: "seven-7", jobId: "1", url: "https://apply.workable.com/seven-7/j/1" },
              discoveredAt: "2026-08-15T08:00:00.000Z"
            }
          ]
        };
      }
    }
  );

  assert.equal(result.discovery.sourcesQueried, 3);
  assert.equal(result.discovery.listings, 2);
  assert.equal(result.run.queued.length, 2);

  rmSync(dir, { recursive: true });
});
