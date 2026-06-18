# Job Project
Always-on job discovery, CV tailoring, ATS readiness scoring, application tracking, and autonomous apply workflows for Abdullah Fageeh's job search.

## Current scope
This repository starts with the agreed architecture and core contracts for:
- continuous job discovery and ingestion
- CV tailoring against a job post
- internal ATS-readiness scoring with an 80+ gate
- policy-driven automation modes
- application tracking, contact enrichment, and notifications

## Local-only files
The following files are intentionally kept out of Git because they contain personal references or live session notes:
- `APPLICATION_REFERENCE.md`
- `SESSION_LOG.md`
- `APPLICATION_REFERENCE.md` now serves as the runtime profile seed source for the first end-to-end pipeline.

## Project structure
```text path=null start=null
src/
  apply/
  ats/
  cli/
  enrich/
  ingest/
  notify/
  policy/
  profile/
  queue/
  render/
  shared/
  sources/
  storage/
  tailor/
  tracker/
  worker/
```

## Getting started
```bash path=null start=null
npm install
npm run typecheck
npm run build
npm test
npm run pipeline:single -- --input ./job.json
npm run queue:single -- --input ./job.json
npm run greenhouse:hosted:prefill -- --url https://job-boards.eu.greenhouse.io/moia/jobs/4881160101 --reference-path ./APPLICATION_REFERENCE.md --keep-open
npm run worker:once
```
The current runtime foundation reads the candidate profile from local `APPLICATION_REFERENCE.md`, writes durable state under ignored `data/pipeline-store.sqlite`, and saves rendered resume artifacts under ignored `artifacts/`.
For the first supervised outbound apply slice, set `GREENHOUSE_JOB_BOARD_API_KEY` before running a flow that includes the optional `apply` stage.
For public hosted Greenhouse pages, the supervised browser prefill helper does not require the API key and can pause in a real browser for manual review and final submission.

## CLI usage
- Immediate single-job run:
  - `npm run pipeline:single -- --input ./job.json --reference-path ./APPLICATION_REFERENCE.md --render-output-dir ./artifacts/resumes`
- Queue a single job with supervised apply enabled:
  - `npm run queue:single -- --input ./job.json --apply-mode supervised --gdpr-consent --gdpr-processing-consent`
- Prefill a hosted Greenhouse form for manual review:
  - `npm run greenhouse:hosted:prefill -- --url https://job-boards.eu.greenhouse.io/moia/jobs/4881160101 --reference-path ./APPLICATION_REFERENCE.md --keep-open`
- Process queued jobs once:
  - `npm run worker:once`

## Initial implementation target
The first implementation milestone is the single-job pipeline:
1. ingest a job post
2. tailor the resume
3. render an ATS-safe resume artifact
4. score ATS readiness
5. create an application record
6. optionally submit a supported Greenhouse application in supervised mode

## Architecture notes
- `src/profile/referenceProfile.ts` loads a runtime candidate profile from the local application reference markdown file.
- `src/ingest/ingestJobPosting.ts` canonicalizes source output into a stable `JobPosting`.
- `src/apply/index.ts` prepares and submits the first supported supervised Greenhouse Job Board applications, and can prefill public hosted Greenhouse forms in a supervised browser session when API submission is unavailable.
- `src/storage/sqliteStore.ts` is the default durable runtime store for jobs, resumes, ATS assessments, application records, and queue jobs.
- `src/storage/fileStore.ts` remains available as a simple JSON-backed fallback store for narrow local flows and tests.
- `src/queue/pipelineQueue.ts` creates idempotent stage jobs for `ingest -> tailor -> render -> score-ats`, with an optional trailing `apply` stage when supervised outbound submission is enabled.
- `src/render/resumeRenderer.ts` renders ATS-safe single-column HTML resume artifacts under ignored local artifact storage.
- `src/shared/contracts.ts` defines the current shared domain types.
- `src/policy/targetTitles.ts` stores the first exact Lane 1 target-job-title shortlist for direct-fit searches.
- `src/sources/arbeitsagentur.ts` fetches and normalizes Lane 1 listings from the official Arbeitsagentur jobs API.
- `src/tailor/resumeTailor.ts` builds the first structured tailored resume draft from a candidate profile and job post.
- `src/ats/scoreResume.ts` scores ATS readiness for a tailored resume and returns blockers plus suggested fixes.
- `src/tracker/applicationTracker.ts` creates application records, stores status history, and manages notes plus follow-ups.
- `src/worker/singleJobPipeline.ts` runs the persisted `ingest -> tailor -> render -> ATS -> tracker` flow for one job and can optionally execute the supervised apply step.
- `src/worker/queueWorker.ts` runs the one-shot queued worker path and processes pending stage jobs once per invocation, including the optional `apply` stage.
- Each module directory currently exposes a focused stub entry point so implementation can grow without changing the top-level layout.
- The runtime entry point is `src/index.ts`.
