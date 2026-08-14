# Automated Daily Application Desk — Task Plan

## Goal

Transform `job-project` into a durable automated Saudi job-application desk: trusted role discovery, evidence-only tailoring, controlled structured-channel submissions, follow-ups, and funnel reporting.

## Current Phase

Phase 4 — Trusted discovery and automatic preparation

## Phases

### Phase 1: Audit automation gaps and constraints

- [x] Map current queue, submission, and browser-prefill capabilities.
- [x] Confirm that the only live sender is a restrictive Greenhouse path.
- [x] Confirm that durable background execution cannot rely on the default sandbox.
- **Status:** complete

### Phase 2: Select operating model

- [x] Compare a daily managed automation desk with an always-on browser operator.
- [x] User selected the daily managed automation desk.
- [x] Preserve evidence-only answers and review gates for unsupported forms.
- **Status:** complete

### Phase 3: Plan and persistent task tracking

- [x] Create `findings.md` and `progress.md`.
- [x] Write a test-first implementation plan in `docs/plans/`.
- [x] Define source, submission, safeguard, schedule, and notification boundaries.
- **Status:** complete

### Phase 4: Trusted discovery and automatic preparation

- [ ] Add source registry, freshness checks, duplicate detection, and per-source limits.
- [ ] Add a profile-answer registry with evidence and confidence gates.
- [ ] Add automatic shortlist, tailoring, ATS, document rendering, and queueing.
- **Status:** pending

### Phase 5: Structured-channel submission and safeguards

- [ ] Generalise platform adapters and strengthen Greenhouse structured submission.
- [ ] Add application caps, rate limits, stop rules, duplicate prevention, and audit events.
- [ ] Route unsupported, CAPTCHA, consent, unknown-question, and browser-only jobs to review.
- **Status:** pending

### Phase 6: Daily operation and monitoring

- [ ] Add idempotent daily runner and configuration.
- [ ] Deploy a scheduled managed runner and dashboard/report output.
- [ ] Add application and follow-up notifications.
- **Status:** pending

### Phase 7: End-to-end verification and handoff

- [ ] Run safe fixture-based automation tests.
- [ ] Verify no false claims or unintended submissions.
- [ ] Publish the upgrade and deliver the operating guide.
- **Status:** pending

## Key Questions

1. Which official career sources provide an application interface that can be used reliably and lawfully?
2. Which verified profile answers can be reused automatically, and which must always go to review?
3. How should the daily runner persist its queue, logs, and idempotency records between executions?
4. Which notifications should reach Abdullah without introducing another external integration?

## Decisions Made

| Decision | Rationale |
| --- | --- |
| Automate a focused daily desk, not mass application volume | Protects application quality and reduces duplicate or low-fit applications. |
| Use verified profile facts only | Prevents false claims and unreliable submissions. |
| Auto-send only through supported structured channels | Browser-only forms, CAPTCHAs, and unknown questions are brittle and need review. |
| Keep unsupported applications in an actionable review queue | Preserves momentum without falsely reporting a submission. |
| Use a durable managed scheduled service for recurring work | The default sandbox does not stay online between sessions. |

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Existing form rejected incomplete phone and location fields during the prior manual application | 1 | User completed the form manually; submission was confirmed and recorded. |
| Browser tool could not target the site’s hidden file input | 1 | User uploaded the CV in the browser; avoid treating hidden-input uploads as unattended capability. |

## Notes

- The existing Talent Blueprint application was submitted and is tracked separately.
- Never commit candidate contact details, documents, sessions, or credentials.
- Do not enable an unattended application sender until the adapter and safeguards are tested with fixtures.
