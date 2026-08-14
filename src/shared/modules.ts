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
    key: "score",
    summary: "Opportunity fit scoring and daily shortlist ranking for Saudi roles."
  },
  {
    key: "letters",
    summary: "Evidence-only cover letters with an optional, guarded LLM refinement pass."
  },
  {
    key: "policy",
    summary: "Automation rules, guardrails, caps, filters, and escalation logic."
  },
  {
    key: "queue",
    summary: "Durable stage queue, worker retries, leases, and idempotent dispatch."
  },
  {
    key: "worker",
    summary: "Long-running background pipeline for nonstop automation."
  },
  {
    key: "render",
    summary: "ATS-safe HTML and PDF rendering for tailored CVs and cover letters."
  },
  {
    key: "tracker",
    summary: "Application history, follow-ups, outcomes, and analytics."
  },
  {
    key: "followup",
    summary: "Automatic day 3, 7, and 14 follow-up ladder with ready-to-send drafts."
  },
  {
    key: "report",
    summary: "Funnel reporting across discovery, application, follow-up, and outcomes."
  },
  {
    key: "enrich",
    summary: "Public recruiter and company contact enrichment with attribution."
  },
  {
    key: "apply",
    summary: "Supported application adapters and supervised browser-fill helpers for platform-specific automation."
  },
  {
    key: "storage",
    summary: "SQLite-backed persistence for jobs, resumes, ATS scores, queue state, and logs."
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
