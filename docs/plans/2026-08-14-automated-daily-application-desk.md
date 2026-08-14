# Automated Daily Application Desk Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Upgrade `job-project` into an automated daily Saudi job-application desk that discovers trusted roles, builds evidence-only materials, automatically submits only through tested structured channels, and routes all other cases into an actionable review queue.

**Architecture:** Keep the existing TypeScript CLI and SQLite state store as the workflow engine. Add a versioned local automation configuration, a durable daily-run record, a source registry, answer provenance, eligibility and application caps, and an idempotent daily orchestration command. Retain the existing queue for per-role work; the daily runner will discover, deduplicate, score, enqueue, process, report, and notify in one controlled cycle.

**Tech Stack:** Node.js 22, TypeScript, built-in SQLite, existing CLI, existing Greenhouse Job Board API adapter, existing PDF renderer, existing application tracker, scheduled managed runner.

---

## Non-negotiable rules

| Rule | Enforcement point |
| --- | --- |
| Saudi-only unless explicitly changed | Eligibility policy and source registry. |
| Evidence-only candidate claims | Candidate answer registry and document/ATS gates. |
| No mass applying | Daily cap, company cap, title-fit threshold, duplicate checks, and blocked-state report. |
| Auto-submit only on tested structured channels | Submission adapter capability registry and adapter-level validation. |
| No unsupported site is reported as submitted | Submission outcome must remain `review-needed` until a provider returns a success confirmation. |
| Browser-only, CAPTCHA, consent, unknown question, immigration, payroll, and missing-document paths require review | Hard stop rules in the adapter and queue. |
| Credentials and private profile data stay local | `.gitignore`, environment validation, and example-only committed configuration. |

## Task 1: Define the automation configuration and answer-provenance contracts

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `src/automation/contracts.ts`
- Create: `src/automation/contracts.test.ts`
- Create: `automation.config.example.json`
- Modify: `.gitignore`

**Step 1: Write failing contract and validation tests.** Test a valid daily cap, source allow-list, default review rule, approved recurring answer, salary range, and rejected unverified answer configuration.

**Step 2: Implement minimal contracts.** Add `AutomationDeskConfig`, `ApplicationCapConfig`, `SourceCapability`, `AnswerProvenance`, `AnswerApproval`, `AutomationRun`, and `ReviewReason` types. Keep personal answers in `APPLICATION_REFERENCE.md` or a local configuration file, never the committed example.

**Step 3: Add the configuration template.** Include source tokens, maximum applications per day, maximum per employer per period, minimum fit/ATS scores, supported channels, run time, and review policy. Add `automation.config.json` and private data paths to `.gitignore`.

**Step 4: Run focused tests, then `npm test`.**

**Step 5: Commit.** `feat: add automation desk configuration contracts`

## Task 2: Build a safe source registry and source freshness policy

**Files:**
- Create: `src/sources/sourceRegistry.ts`
- Create: `src/sources/sourceRegistry.test.ts`
- Modify: `src/sources/index.ts`
- Modify: `src/policy/eligibility.ts`
- Modify: `src/policy/eligibility.test.ts`

**Step 1: Write failing tests.** Cover a verified Greenhouse board, a direct ATS URL, an expired role, a duplicate URL, a Saudi-national-only role with no verified national status, and an untrusted aggregator listing.

**Step 2: Implement registry metadata.** Define per-source discovery method, application capability (`structured-submit`, `prefill-only`, `review-only`), minimum freshness, rate limit, and trust level. Start with public Greenhouse boards and direct ATS inputs; do not claim LinkedIn, Workday, Recruiterflow, or generic browser sites are auto-submit capable.

**Step 3: Implement source and freshness gates.** Reject stale, incomplete, outside-Saudi, duplicate, or low-trust postings before queueing.

**Step 4: Run focused tests, then `npm test`.**

**Step 5: Commit.** `feat: add trusted source registry and freshness gates`

## Task 3: Add durable daily-run and idempotency storage

**Files:**
- Modify: `src/storage/types.ts`
- Modify: `src/storage/sqliteStore.ts`
- Modify: `src/storage/fileStore.ts`
- Modify: `src/shared/contracts.ts`
- Create: `src/automation/runStore.test.ts`
- Modify: `src/storage/sqliteStore.test.ts`
- Modify: `src/storage/fileStore.test.ts`

**Step 1: Write failing persistence tests.** Verify a daily run can be created, resumed safely, completed, failed, and queried by date/configuration key.

**Step 2: Implement storage.** Add an `automation_runs` SQLite table and equivalent file-store snapshot record. Persist start/end timestamps, source counts, queued/apply/review counts, error summaries, and idempotency key.

**Step 3: Add safe migration behavior.** Existing databases must open without data loss. Schema initialization must be repeatable.

**Step 4: Run storage tests and `npm test`.**

**Step 5: Commit.** `feat: persist daily automation runs and idempotency`

## Task 4: Create the evidence-only recurring-answer registry

**Files:**
- Create: `src/profile/answerRegistry.ts`
- Create: `src/profile/answerRegistry.test.ts`
- Modify: `src/profile/referenceProfile.ts`
- Modify: `src/apply/index.ts`
- Modify: `src/apply/index.test.ts`

**Step 1: Write failing tests.** Cover answer retrieval with provenance, automatic reuse of approved recurring answers, salary-band selection, and hard blocks for missing evidence, novel material questions, consent questions, nationality ambiguity, and work-authorisation uncertainty.

**Step 2: Implement the registry.** Convert profile facts into field mappings that include source location, approval class, and allowed application platform. Do not use language generation to fabricate answers.

**Step 3: Wire it into the submission preparation flow.** A required field must return a named review reason rather than silently falling back to a plausible answer.

**Step 4: Run focused tests and `npm test`.**

**Step 5: Commit.** `feat: add evidence-bound recurring answer registry`

## Task 5: Generalise submission capabilities while retaining strict safety gates

**Files:**
- Modify: `src/apply/index.ts`
- Modify: `src/apply/index.test.ts`
- Create: `src/apply/capabilities.ts`
- Create: `src/apply/capabilities.test.ts`
- Modify: `src/worker/queueWorker.ts`
- Modify: `src/worker/queueWorker.test.ts`

**Step 1: Write failing tests.** Demonstrate that `full-auto` is allowed only when source capability is `structured-submit`, the role is ATS-passed, the daily cap is available, confirmed consent exists, and every required field is evidence-backed. Demonstrate that unsupported platforms always produce `review-needed`.

**Step 2: Replace the hard-coded mode check.** Permit configured `full-auto` for tested adapters only. Preserve `supervised` and `observe` behavior.

**Step 3: Add submission audit events.** Record attempt, provider response, provider confirmation, response status, uploaded document hashes, and exact review reason. Keep submission idempotent by job, source URL, and role content fingerprint.

**Step 4: Run focused tests and `npm test`.**

**Step 5: Commit.** `feat: gate structured auto-submit by capability and evidence`

## Task 6: Strengthen the Greenhouse structured adapter

**Files:**
- Modify: `src/apply/index.ts`
- Modify: `src/apply/greenhouseHosted.ts`
- Modify: `src/apply/greenhouseHosted.test.ts`
- Create: `src/apply/greenhouseQuestionMapper.ts`
- Create: `src/apply/greenhouseQuestionMapper.test.ts`

**Step 1: Write failing fixtures.** Cover required text, yes/no, single-select, multi-select, location, file, demographic, consent, and custom questions.

**Step 2: Map only supported safe questions.** Answer fields whose profile provenance and approval class match. Stop on any unmapped required question, location ambiguity, demographic/EEO question, consent, or unsupported file requirement.

**Step 3: Add API retry, backoff, provider-rate-limit, and failure classification.** Retries must never duplicate a successful submission.

**Step 4: Run adapter fixtures and `npm test`.**

**Step 5: Commit.** `feat: harden greenhouse auto-submit question mapping`

## Task 7: Add daily orchestration, application caps, and review-queue output

**Files:**
- Create: `src/automation/dailyRunner.ts`
- Create: `src/automation/dailyRunner.test.ts`
- Create: `src/automation/reviewQueue.ts`
- Create: `src/automation/reviewQueue.test.ts`
- Modify: `src/queue/pipelineQueue.ts`
- Modify: `src/queue/pipelineQueue.test.ts`
- Modify: `src/worker/queueWorker.ts`

**Step 1: Write failing orchestration tests.** Fixture sources must prove that duplicate roles, low-fit roles, stale roles, daily-cap excess, employer-cap excess, and unsupported submitters move to the correct state.

**Step 2: Implement `runDailyAutomationDesk`.** Load config and profile, lock idempotency key, discover roles, normalise, eligibility-filter, deduplicate, rank, enqueue, process, and generate a run summary.

**Step 3: Apply caps before enqueueing.** Default to a small, configurable cap and never send more than the configured amount. Use the review queue for remaining qualified roles.

**Step 4: Generate a human-readable review queue.** Include role, source, score, documents, blocker, and exact next action.

**Step 5: Run focused tests and `npm test`.**

**Step 6: Commit.** `feat: add idempotent daily automation desk runner`

## Task 8: Add CLI commands, operational reports, and notification payloads

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/operations.ts`
- Modify: `src/cli/operations.test.ts`
- Modify: `src/report/funnelReport.ts`
- Modify: `src/report/funnelReport.test.ts`
- Create: `src/automation/notification.ts`
- Create: `src/automation/notification.test.ts`
- Modify: `README.md`

**Step 1: Write failing CLI tests.** Cover `automation:daily`, `automation:status`, and `automation:review-queue`, including dry-run behavior.

**Step 2: Implement commands.** Support `--config`, `--storage-path`, `--dry-run`, `--date`, `--max-applications`, and a clear nonzero exit for configuration or source failure.

**Step 3: Extend reports.** Show discovered, qualified, queued, auto-submitted, review-required, skipped, failed, and duplicate counts. Generate a short notification payload with exact blockers.

**Step 4: Document the new operating model.** Explain secrets, source enablement, daily cap, dry runs, reporting, and the meaning of each review status.

**Step 5: Run focused tests and `npm test`.**

**Step 6: Commit.** `feat: add daily automation CLI and review reporting`

## Task 9: Build deployment configuration for a managed daily run

**Files:**
- Create: `deploy/automation.env.example`
- Create: `deploy/daily-run.sh`
- Create: `deploy/README.md`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write a deployment smoke-test script.** Validate missing secret, invalid config, inaccessible storage path, and dry run.

**Step 2: Add a single command wrapper.** The wrapper must run the configured daily command, write structured logs, preserve exit status, and never print secret values.

**Step 3: Prepare scheduled deployment instructions.** Keep the first deployment at one daily run. Use managed scheduled execution with secret storage; do not use the default sandbox as a persistent host.

**Step 4: Run smoke tests and `npm test`.**

**Step 5: Commit.** `feat: add managed daily-run deployment assets`

## Task 10: Verify the full automation desk without live submissions

**Files:**
- Create: `src/automation/e2e.test.ts`
- Create: `fixtures/automation/`
- Modify: `README.md`

**Step 1: Build fixtures.** Include eligible Saudi Greenhouse role, stale role, duplicate, Saudi-national-only role, low-fit role, unsupported browser-only role, required-unmapped question, configured cap overflow, and provider success/failure responses.

**Step 2: Write end-to-end test.** Verify the eligible supported fixture reaches a mocked submitted state; all other fixtures land in a correct review/skip/failure state.

**Step 3: Run `npm test`, typecheck, and CLI dry-run.** Confirm no network request occurs during fixtures and no real profile data appears in tracked files.

**Step 4: Commit.** `test: verify end-to-end daily automation safeguards`

## Task 11: Publish, deploy, and hand off

**Files:**
- Modify: `README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`
- Modify: `findings.md`

**Step 1: Review `git diff --check`, tests, secret exclusions, generated output exclusions, and deployment checklist.**

**Step 2: Commit and push the complete implementation.**

**Step 3: Configure the first daily managed run only after Abdullah supplies required source credentials and explicitly approves the run configuration.**

**Step 4: Deliver an operator guide.** Include daily cap, channels currently auto-submit capable, review queue path, failure behavior, dashboard/report paths, and shutdown controls.
