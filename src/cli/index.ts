export const cliModule = {
  key: "cli",
  summary: "Provide the local control surface for configuration and monitoring.",
  responsibilities: [
    "Configure sources, policies, and automation mode.",
    "Inspect ATS assessments, queue state, and application history.",
    "Support supervised operations during the rollout to full automation."
  ]
} as const;
