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
```

## Initial implementation target
The first implementation milestone is the single-job pipeline:
1. ingest a job post
2. tailor the resume
3. score ATS readiness
4. create an application record

## Architecture notes
- `src/shared/contracts.ts` defines the current shared domain types.
- `src/policy/targetTitles.ts` stores the first exact Lane 1 target-job-title shortlist for direct-fit searches.
- `src/sources/arbeitsagentur.ts` fetches and normalizes Lane 1 listings from the official Arbeitsagentur jobs API.
- Each module directory currently exposes a focused stub entry point so implementation can grow without changing the top-level layout.
- The runtime entry point is `src/index.ts`.
