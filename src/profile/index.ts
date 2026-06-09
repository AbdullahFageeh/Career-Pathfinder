export {
  loadCandidateProfile,
  parseCandidateProfileReference,
  resolveDefaultCandidateProfilePath,
  type CandidateProfileLoadOptions
} from "./referenceProfile.js";
export const profileModule = {
  key: "profile",
  summary: "Manage the canonical candidate profile and recurring application answers.",
  responsibilities: [
    "Load profile seed data from trusted local sources.",
    "Track source attribution for facts, answers, and document references.",
    "Expose a stable profile contract to downstream modules."
  ]
} as const;
