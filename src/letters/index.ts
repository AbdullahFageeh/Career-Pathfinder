export {
  buildCoverLetterDraft,
  findInventedClaims,
  formatCoverLetterText,
  refineCoverLetterWithLlm,
  type BuildCoverLetterOptions,
  type CoverLetterDraft,
  type CoverLetterTone,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmClient,
  type RefineCoverLetterOptions,
  type RefineCoverLetterResult
} from "./coverLetter.js";

export const lettersModule = {
  key: "letters",
  summary: "Draft tailored cover letters and outreach messages from verified evidence only.",
  responsibilities: [
    "Build a factual cover letter from candidate evidence and posting keywords.",
    "Optionally refine wording with an LLM while rejecting any invented claim.",
    "Emit plain-text and print-ready letter outputs for supervised sending."
  ]
} as const;
