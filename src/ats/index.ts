export const atsModule = {
  key: "ats",
  summary: "Calculate the internal ATS-readiness score and block weak submissions.",
  responsibilities: [
    "Score parseability, job-match coverage, structure, and evidence.",
    "Return blocking issues and actionable fixes when the score is below threshold.",
    "Attach ATS assessments to application records before apply actions run."
  ]
} as const;
