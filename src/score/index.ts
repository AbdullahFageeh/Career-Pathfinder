export {
  formatShortlistMarkdown,
  rankJobOpportunities,
  scoreJobFit,
  type FitDimension,
  type FitDimensionKey,
  type FitScoringOptions,
  type JobFitScore,
  type RankedJobOpportunity
} from "./fitScore.js";

export const scoreModule = {
  key: "score",
  summary: "Rank Saudi opportunities by real fit before any application effort is spent.",
  responsibilities: [
    "Score title alignment, evidence overlap, seniority, travel cost, and channel quality.",
    "Hard-cap ineligible postings so they cannot reach the top of a shortlist.",
    "Produce an ordered daily shortlist with defensible reasons."
  ]
} as const;
