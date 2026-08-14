export {
  renderTailoredResumeArtifact,
  renderTailoredResumeHtml,
  resolveDefaultRenderOutputDir,
  type RenderTailoredResumeOptions,
  type RenderedTailoredResumeArtifact
} from "./resumeRenderer.js";
export {
  buildDocumentFileStem,
  renderCoverLetterDocumentHtml,
  renderResumeDocument,
  renderResumeDocumentHtml,
  resolveDefaultDocumentOutputDir,
  writeApplicationDocument,
  type ApplicationDocumentFormat,
  type RenderApplicationDocumentOptions,
  type RenderApplicationDocumentResult,
  type RenderedApplicationDocument
} from "./documentRenderer.js";
export const renderModule = {
  key: "render",
  summary: "Render tailored application materials to ATS-safe export formats.",
  responsibilities: [
    "Convert structured tailored resumes into single-column HTML outputs.",
    "Export styled, print-ready PDF CVs and cover letters with recruiter-friendly file names.",
    "Keep rendered artifacts ATS-safe and text-extractable.",
    "Version generated artifacts for later reference."
  ]
} as const;
