export { lane1ExactJobTitles, lane1TargetTitleGroups } from "./targetTitles.js";
export const policyModule = {
  key: "policy",
  summary: "Apply automation rules, caps, filters, and escalation behavior.",
  responsibilities: [
    "Maintain target-title shortlists and policy targeting defaults.",
    "Enforce platform allowlists and blocked-company rules.",
    "Evaluate daily caps, cooldowns, and review triggers.",
    "Control observe, supervised, and full-auto behavior."
  ]
} as const;
