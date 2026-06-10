export {
  renderTailoredResumeArtifact,
  renderTailoredResumeHtml,
  resolveDefaultRenderOutputDir,
  type RenderTailoredResumeOptions,
  type RenderedTailoredResumeArtifact
} from "./resumeRenderer.js";
export const renderModule = {
  key: "render",
  summary: "Render tailored application materials to ATS-safe export formats.",
  responsibilities: [
    "Convert structured tailored resumes into single-column HTML outputs.",
    "Keep rendered artifacts ATS-safe and text-extractable.",
    "Version generated artifacts for later reference."
  ]
} as const;
