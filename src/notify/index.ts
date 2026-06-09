export const notifyModule = {
  key: "notify",
  summary: "Send local summaries, alerts, review prompts, and health signals.",
  responsibilities: [
    "Emit worker heartbeat and failure notifications.",
    "Request manual approval when policy rules require it.",
    "Summarize discovery and application progress."
  ]
} as const;
