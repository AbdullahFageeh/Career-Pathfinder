import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DAILY_APPLICATION_CAP,
  findReusableApprovedAnswer,
  validateAutomationDeskConfig
} from "./contracts.js";

const validConfig = {
  version: 1,
  timeZone: "Asia/Riyadh",
  automationMode: "full-auto",
  caps: {
    dailyApplications: 4,
    maxApplicationsPerEmployer: 1,
    employerCooldownDays: 30
  },
  thresholds: {
    minFitScore: 70,
    minAtsScore: 80
  },
  sources: [
    {
      id: "saudi-events-greenhouse",
      kind: "greenhouse",
      capability: "structured-submit",
      enabled: true,
      boardToken: "example-events"
    },
    {
      id: "official-careers-review",
      kind: "company-page",
      capability: "review-only",
      enabled: true
    }
  ],
  answers: [
    {
      key: "nationality",
      value: "Saudi",
      approval: "auto-submit",
      provenance: {
        sourceKind: "candidate-profile",
        sourceRef: "APPLICATION_REFERENCE.md:14",
        verifiedAt: "2026-08-14T00:00:00.000Z"
      }
    },
    {
      key: "travel_commitment",
      value: true,
      approval: "review-only",
      provenance: {
        sourceKind: "manual",
        sourceRef: "manual confirmation 2026-08-14",
        verifiedAt: "2026-08-14T00:00:00.000Z"
      }
    }
  ]
};

test("validates a constrained automation desk configuration", () => {
  const config = validateAutomationDeskConfig(validConfig);

  assert.equal(config.timeZone, "Asia/Riyadh");
  assert.equal(config.caps.dailyApplications, 4);
  assert.equal(config.sources[0]?.capability, "structured-submit");
  assert.equal(config.answers[0]?.approval, "auto-submit");
});

test("rejects a daily application cap above the safe maximum", () => {
  assert.throws(
    () =>
      validateAutomationDeskConfig({
        ...validConfig,
        caps: {
          ...validConfig.caps,
          dailyApplications: MAX_DAILY_APPLICATION_CAP + 1
        }
      }),
    /dailyApplications/i
  );
});

test("rejects a structured sender without an approved official source configuration", () => {
  assert.throws(
    () =>
      validateAutomationDeskConfig({
        ...validConfig,
        sources: [
          {
            id: "unverified-board",
            kind: "job-board",
            capability: "structured-submit",
            enabled: true
          }
        ]
      }),
    /structured-submit/i
  );
});

test("rejects automatic answers without traceable verified provenance", () => {
  assert.throws(
    () =>
      validateAutomationDeskConfig({
        ...validConfig,
        answers: [
          {
            key: "salary",
            value: "25000",
            approval: "auto-submit"
          }
        ]
      }),
    /provenance/i
  );
});

test("returns only evidence-backed answers explicitly approved for automatic submission", () => {
  const config = validateAutomationDeskConfig(validConfig);

  assert.equal(findReusableApprovedAnswer(config.answers, "nationality")?.value, "Saudi");
  assert.equal(findReusableApprovedAnswer(config.answers, "travel_commitment"), undefined);
  assert.equal(findReusableApprovedAnswer(config.answers, "unknown"), undefined);
});


test("allows a paused automation desk with zero daily and employer application caps", () => {
  const config = validateAutomationDeskConfig({
    ...validConfig,
    caps: {
      ...validConfig.caps,
      dailyApplications: 0,
      maxApplicationsPerEmployer: 0
    }
  });

  assert.equal(config.caps.dailyApplications, 0);
  assert.equal(config.caps.maxApplicationsPerEmployer, 0);
});

test("accepts a psychometric-first selection profile and defaults older configs to standard", () => {
  const psychometricFirst = validateAutomationDeskConfig({
    ...validConfig,
    selectionProfile: "psychometric-first"
  });
  const defaulted = validateAutomationDeskConfig(validConfig);

  assert.equal(psychometricFirst.selectionProfile, "psychometric-first");
  assert.equal(defaulted.selectionProfile, "standard");
});

test("rejects an unknown selection profile", () => {
  assert.throws(
    () => validateAutomationDeskConfig({ ...validConfig, selectionProfile: "invented-profile" }),
    /selectionProfile/i
  );
});


test("accepts explicit remote discovery and defaults older configs to Saudi-only discovery", () => {
  const remoteEnabled = validateAutomationDeskConfig({ ...validConfig, includeRemote: true });
  const defaulted = validateAutomationDeskConfig(validConfig);

  assert.equal(remoteEnabled.includeRemote, true);
  assert.equal(defaulted.includeRemote, false);
});
