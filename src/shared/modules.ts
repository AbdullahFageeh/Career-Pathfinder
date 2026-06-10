export type ModuleSummary = {
  key: string;
  summary: string;
};

export const architectureSummary: ModuleSummary[] = [
  {
    key: "profile",
    summary: "Canonical candidate profile, recurring answers, and document references."
  },
  {
    key: "sources",
    summary: "Scheduled discovery across job boards, company pages, and manual feeds."
  },
  {
    key: "ingest",
    summary: "Normalization of raw listings into structured job posting records."
  },
  {
    key: "tailor",
    summary: "Job-specific CV tailoring using only verified candidate facts."
  },
  {
    key: "ats",
    summary: "Internal ATS-readiness scoring with an 80+ application gate."
  },
  {
    key: "policy",
    summary: "Automation rules, guardrails, caps, filters, and escalation logic."
  },
  {
    key: "queue",
    summary: "Durable state-machine queue, retries, and idempotent work dispatch."
  },
  {
    key: "worker",
    summary: "Long-running background pipeline for nonstop automation."
  },
  {
    key: "render",
    summary: "ATS-safe HTML rendering for tailored application materials."
  },
  {
    key: "tracker",
    summary: "Application history, follow-ups, outcomes, and analytics."
  },
  {
    key: "enrich",
    summary: "Public recruiter and company contact enrichment with attribution."
  },
  {
    key: "apply",
    summary: "Supported application adapters for platform-specific automation."
  },
  {
    key: "storage",
    summary: "Persistence for jobs, resumes, ATS scores, queue state, and logs."
  },
  {
    key: "notify",
    summary: "Summaries, alerts, approvals, and worker heartbeat notifications."
  },
  {
    key: "cli",
    summary: "Local control surface for setup, monitoring, and supervised operations."
  }
];
