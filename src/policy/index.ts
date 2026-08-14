export { lane1ExactJobTitles, lane1TargetTitleGroups } from "./targetTitles.js";
export {
  assessJobEligibility,
  partitionEligibleJobs,
  resolveSaudiCity,
  SAUDI_CITY_TERMS,
  SAUDI_LOCATION_TERMS,
  type CandidateEligibilityContext,
  type EligibilityBlocker,
  type EligibilityBlockerKind,
  type EligibilityWarning,
  type EligibilityWarningKind,
  type JobEligibilityAssessment,
  type JobEligibilityOptions
} from "./eligibility.js";
export const policyModule = {
  key: "policy",
  summary: "Apply automation rules, caps, filters, and escalation behavior.",
  responsibilities: [
    "Maintain target-title shortlists and policy targeting defaults.",
    "Enforce the Saudi-only geographic filter and nationality eligibility rules.",
    "Screen out low-legitimacy income leads before they reach apply or outreach.",
    "Enforce platform allowlists and blocked-company rules.",
    "Evaluate daily caps, cooldowns, and review triggers.",
    "Control observe, supervised, and full-auto behavior."
  ]
} as const;
