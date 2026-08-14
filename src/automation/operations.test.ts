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
