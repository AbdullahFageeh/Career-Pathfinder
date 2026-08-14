export {
  fetchLane1JobListings,
  type Lane1JobSearchOptions,
  type Lane1JobSearchResult,
  type Lane1SearchQuery,
  type Lane1ScrapedJobPosting
} from "./arbeitsagentur.js";
export {
  discoverSaudiGreenhouseRoles,
  normalizeBoardJob,
  DEFAULT_SAUDI_BOARD_TOKENS,
  type SaudiBoardDiscoveryOptions,
  type SaudiBoardDiscoveryResult
} from "./saudiGreenhouseBoards.js";
export {
  loadRoleCorpus,
  resolveDefaultRoleCorpusDir,
  type RoleCorpusLoadOptions,
  type RoleCorpusLoadResult
} from "./roleCorpus.js";
export const sourcesModule = {
  key: "sources",
  summary: "Define scheduled discovery across boards, company pages, and manual feeds.",
  responsibilities: [
    "Register and configure job-source adapters.",
    "Discover Saudi roles from public Greenhouse boards as the primary live lane.",
    "Replay the curated local role corpus so saved leads keep flowing through scoring.",
    "Fetch and normalize Lane 1 listings from supported official sources.",
    "Support polling schedules and deduplication handoff.",
    "Normalize source metadata before ingestion."
  ]
} as const;
