export {
  runSingleJobPipeline,
  type SingleJobPipelineOptions,
  type SingleJobPipelineResult
} from "./singleJobPipeline.js";
export const workerModule = {
  key: "worker",
  summary: "Run the always-on discovery, tailoring, scoring, and apply pipeline.",
  responsibilities: [
    "Process queued discovery and application stages.",
    "Recover cleanly from failures and restarts.",
    "Emit health and progress signals for local monitoring."
  ]
} as const;
