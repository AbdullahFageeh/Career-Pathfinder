export {
  applyFollowUpPlan,
  buildFollowUpPlan,
  ensureFollowUpLadder,
  formatDueFollowUpsMarkdown,
  listDueFollowUps,
  type BuildFollowUpPlanOptions,
  type DueFollowUp,
  type FollowUpPlan,
  type FollowUpStep
} from "./followUpPlan.js";

export const followUpModule = {
  key: "followup",
  summary: "Schedule and surface the follow-up ladder that recovers stalled applications.",
  responsibilities: [
    "Generate day 3, 7, and 14 follow-ups from the real application date.",
    "Attach ready-to-review message drafts to every scheduled follow-up.",
    "Surface everything due now so nothing depends on memory."
  ]
} as const;
