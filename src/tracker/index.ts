export const trackerModule = {
  key: "tracker",
  summary: "Track job targets, applications, follow-ups, and outcomes over time.",
  responsibilities: [
    "Persist application status history and worker decisions.",
    "Store follow-up timing, notes, and outcomes.",
    "Expose reporting hooks for dashboards and summaries."
  ]
} as const;
