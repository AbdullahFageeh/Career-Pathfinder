export {
  buildFunnelReport,
  formatFunnelReportMarkdown,
  type BuildFunnelReportOptions,
  type CompanyActivity,
  type FunnelReport,
  type FunnelStageCount,
  type StaleApplication
} from "./funnelReport.js";

export const reportModule = {
  key: "report",
  summary: "Turn tracked applications into a weekly funnel briefing with clear next actions.",
  responsibilities: [
    "Count records by stage and measure apply and follow-up conversion.",
    "Surface stalled records and follow-ups that are due now.",
    "Render a Markdown briefing that can be reviewed in two minutes."
  ]
} as const;
