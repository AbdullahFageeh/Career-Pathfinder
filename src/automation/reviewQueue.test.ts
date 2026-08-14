import assert from "node:assert/strict";
import test from "node:test";
import { formatAutomationReviewQueueMarkdown } from "./reviewQueue.js";

test("formats queued and review-required roles into an actionable operator report", () => {
  const markdown = formatAutomationReviewQueueMarkdown({
    generatedAt: "2026-08-15T08:00:00.000Z",
    run: {
      id: "run:1",
      idempotencyKey: "daily:2026-08-15:config:1",
      configVersion: 1,
      status: "completed",
      startedAt: "2026-08-15T08:00:00.000Z",
      completedAt: "2026-08-15T08:02:00.000Z",
      counts: {
        discovered: 3,
        qualified: 2,
        queued: 1,
        submitted: 0,
        reviewRequired: 2,
        failed: 0
      }
    },
    queued: [
      {
        job: {
          id: "job:1",
          source: { kind: "job-board", name: "greenhouse" },
          title: "Venue Operations Manager",
          company: "Example Events",
          location: "Riyadh, Saudi Arabia",
          description: "Venue operations.",
          tags: ["official-source"],
          discoveredAt: "2026-08-15T08:00:00.000Z"
        },
        fitScore: 86,
        queueJobId: "queue:1"
      }
    ],
    reviewRequired: [
      {
        job: {
          id: "job:2",
          source: { kind: "company-page", name: "Employer Careers" },
          title: "Event Operations Manager",
          company: "Other Events",
          location: "Jeddah, Saudi Arabia",
          description: "Event operations.",
          tags: ["official-source"],
          discoveredAt: "2026-08-15T08:00:00.000Z"
        },
        reason: "unsupported-platform"
      }
    ]
  });

  assert.match(markdown, /Daily automation desk review queue/);
  assert.match(markdown, /Venue Operations Manager/);
  assert.match(markdown, /86\/100/);
  assert.match(markdown, /unsupported-platform/);
  assert.match(markdown, /Review before applying/);
});
