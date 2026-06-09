export {
  buildTailoredResume,
  extractJobKeywords,
  type ExtractedJobKeyword,
  type JobKeywordSource,
  type TailorResumeOptions
} from "./resumeTailor.js";
export const tailorModule = {
  key: "tailor",
  summary: "Tailor resumes using verified profile facts and job requirements.",
  responsibilities: [
    "Extract job keywords and role signals from the target posting.",
    "Select the most relevant proof points for a role.",
    "Generate structured tailored variants without fabricating facts.",
    "Maintain an evidence trail for every tailored output."
  ]
} as const;
