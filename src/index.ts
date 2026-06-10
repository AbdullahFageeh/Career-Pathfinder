import { architectureSummary } from "./shared/modules.js";
import { runPipelineQueueOnce } from "./worker/index.js";

const command = process.argv[2];

if (command === "worker:once") {
  const result = await runPipelineQueueOnce();
  const output = [
    "Pipeline queue worker run complete.",
    `- worker: ${result.workerId}`,
    `- claimed: ${result.claimed}`,
    `- completed: ${result.completed}`,
    `- failed: ${result.failed}`,
    `- dead-lettered: ${result.deadLettered}`,
    `- remaining: ${result.remaining}`
  ];

  console.log(output.join("\n"));
} else {
  const output = [
    "Job Project scaffold ready.",
    "Implemented architecture modules:",
    ...architectureSummary.map((module) => `- ${module.key}: ${module.summary}`)
  ];

  console.log(output.join("\n"));
}
