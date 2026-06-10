export {
  PIPELINE_QUEUE_STAGES,
  createNextPipelineStageJob,
  enqueueSingleJobPipeline,
  getNextPipelineStage,
  markQueueJobCompleted,
  markQueueJobFailed,
  type EnqueueSingleJobPipelineOptions,
  type SingleJobPipelineQueuePayload
} from "./pipelineQueue.js";
export const queueModule = {
  key: "queue",
  summary: "Own the durable pipeline state machine and retry workflow.",
  responsibilities: [
    "Track stage transitions for each queued application task.",
    "Support worker leases, retries, and dead-letter handling.",
    "Provide idempotent dispatch boundaries for nonstop execution."
  ]
} as const;
