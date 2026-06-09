import { architectureSummary } from "./shared/modules.js";

const output = [
  "Job Project scaffold ready.",
  "Implemented architecture modules:",
  ...architectureSummary.map((module) => `- ${module.key}: ${module.summary}`)
];

console.log(output.join("\n"));
