export {
  addApplicationNote,
  addWorkerDecision,
  attachAtsAssessmentToRecord,
  attachTailoredResumeToRecord,
  completeFollowUp,
  createApplicationRecord,
  getOutstandingFollowUps,
  scheduleFollowUp,
  updateApplicationStatus,
  type CreateApplicationRecordInput,
  type FollowUpInput,
  type TrackerMutationOptions
} from "./applicationTracker.js";
export const trackerModule = {
  key: "tracker",
  summary: "Track job targets, applications, follow-ups, and outcomes over time.",
  responsibilities: [
    "Create and update application records with status history.",
    "Store follow-up timing, notes, worker decisions, and outcomes.",
    "Expose reporting hooks for dashboards and summaries."
  ]
} as const;
