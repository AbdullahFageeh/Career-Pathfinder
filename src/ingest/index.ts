export const ingestModule = {
  key: "ingest",
  summary: "Transform raw listing data into structured job posting records.",
  responsibilities: [
    "Parse listing metadata and job descriptions.",
    "Detect target role family and candidate-fit signals.",
    "Capture raw hints for recruiter and company contact enrichment."
  ]
} as const;
