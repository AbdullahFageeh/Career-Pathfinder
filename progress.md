# Automation Upgrade Progress

## 2026-08-14

### Completed

- Audited existing submission, queue, tracker, profile, and source behavior.
- Confirmed that queue payloads support `full-auto`, while the outbound application gate permits live submission only in `supervised` mode.
- Confirmed that the only current live sender is the Greenhouse Job Board API adapter, and that hosted browser flows are prefill-only.
- Compared automation operating models; Abdullah selected the scheduled daily managed automation desk.
- Created persistent planning files: `task_plan.md`, `findings.md`, and this log.

### Confirmed user constraints

- Build a fully automated job-application workflow, not a one-off script.
- Target Saudi roles that fit Abdullah’s event production, venue operations, site delivery, installation, logistics, and operations profile.
- Do not invent application answers.
- Keep unsupported or browser-only jobs ready for review instead of claiming they were submitted.

### Next

- Write the test-first implementation plan under `docs/plans/`.
- Inspect the current application adapter, source contracts, configuration, and CLI boundaries needed for the first implementation slice.
- Research and verify eligible structured application-source routes before adapter work.

### Known blockers

- No durable deployment or scheduler is configured yet.
- No configured outbound Greenhouse credential is confirmed.
- No general API submitter exists for Recruiterflow, Workday, LinkedIn, or other browser-only career portals.

## 2026-08-14 — live queue-only retry and scheduling

### Completed

- Created a private ignored `automation.config.json` with `autoSubmitEnabled: false`, a four-role daily cap, one-employer cap, and configured Greenhouse boards for Dmgevents, Tamara, and Careem.
- First live run confirmed the safe queue-only path but the target-title source prefilter returned zero roles. The daily operation now disables that source-side title prefilter so the existing fit engine assesses every Saudi listing from configured boards.
- Fixed daily idempotency so its key fingerprints the effective configuration rather than only the schema version; same-day source or threshold edits now create a fresh run.
- Expanded live retry: 19 Saudi roles discovered, 4 qualified, 1 role queued, 4 held for review, 0 submitted. The queued Tamara engineering role ran through the pipeline with auto-send disabled; it is not an approved application.
- Created active weekday schedule: `Weekday Saudi job application desk`, 09:00 Asia/Riyadh, Monday–Friday. The schedule retains the queue-only / no-invention safeguards in its task detail.

### Next

- Run final full-suite validation, review the staged code, commit/push the feature branch, then verify the scheduled task status.
