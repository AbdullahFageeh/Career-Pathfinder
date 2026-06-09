export {
  fetchLane1JobListings,
  type Lane1JobSearchOptions,
  type Lane1JobSearchResult,
  type Lane1SearchQuery,
  type Lane1ScrapedJobPosting
} from "./arbeitsagentur.js";
export const sourcesModule = {
  key: "sources",
  summary: "Define scheduled discovery across boards, company pages, and manual feeds.",
  responsibilities: [
    "Register and configure job-source adapters.",
    "Fetch and normalize Lane 1 listings from supported official sources.",
    "Support polling schedules and deduplication handoff.",
    "Normalize source metadata before ingestion."
  ]
} as const;
