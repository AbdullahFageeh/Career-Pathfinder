import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateProfile } from "../shared/contracts.js";
import {
  createHostedGreenhouseAnswerMap,
  resolveHostedGreenhouseFieldValue,
  shouldCheckHostedGreenhouseOption
} from "./greenhouseHosted.js";

const sampleProfile: CandidateProfile = {
  id: "candidate-seed",
  fullName: "Avery Morgan",
  preferredName: "Avery",
  email: "avery.morgan@example.test",
  phone: "+966500000000",
  country: "Saudi Arabia",
  headline: "Installation Manager | Production Manager | Site Operations",
  targetRoleFamilies: ["Installation Manager", "Production Manager", "Site Operations"],
  certifications: [],
  coreProofPoints: [],
  documents: [],
  recurringAnswers: [
    {
      key: "how-did-you-find-out-about-this-job",
      question: "How did you find out about this job?",
      answer: "Greenhouse job board",
      source: {
        kind: "manual",
        reference: "APPLICATION_REFERENCE.md#common-screening-answers"
      }
    },
    {
      key: "information-on-data-protection",
      question: "Information on data protection",
      answer: "Yes, I acknowledge.",
      source: {
        kind: "manual",
        reference: "APPLICATION_REFERENCE.md#common-screening-answers"
      }
    }
  ]
};

test("resolveHostedGreenhouseFieldValue fills built-in identity fields from the candidate profile", () => {
  const answerMap = createHostedGreenhouseAnswerMap(sampleProfile);

  assert.equal(
    resolveHostedGreenhouseFieldValue(
      {
        id: "first_name",
        label: "First Name*",
        type: "text"
      },
      sampleProfile,
      answerMap
    ),
    "Avery"
  );
  assert.equal(
    resolveHostedGreenhouseFieldValue(
      {
        id: "country",
        label: "Country*",
        type: "text"
      },
      sampleProfile,
      answerMap
    ),
    "Saudi Arabia"
  );
});

test("resolveHostedGreenhouseFieldValue matches recurring answers by hosted form label", () => {
  const answerMap = createHostedGreenhouseAnswerMap(sampleProfile);

  assert.equal(
    resolveHostedGreenhouseFieldValue(
      {
        id: "question_8972729101",
        label: "How did you find out about this job?*",
        type: "text"
      },
      sampleProfile,
      answerMap
    ),
    "Greenhouse job board"
  );
});

test("shouldCheckHostedGreenhouseOption matches a checkbox option from recurring answer values", () => {
  const answerMap = createHostedGreenhouseAnswerMap(sampleProfile);

  assert.equal(shouldCheckHostedGreenhouseOption(answerMap, "Yes, I acknowledge."), true);
  assert.equal(shouldCheckHostedGreenhouseOption(answerMap, "No"), false);
});
