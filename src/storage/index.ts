export const storageModule = {
  key: "storage",
  summary: "Persist jobs, queue state, ATS assessments, and application records.",
  responsibilities: [
    "Define storage boundaries for core entities and logs.",
    "Support durable queue state and artifact references.",
    "Keep the application history as the system source of truth."
  ]
} as const;
