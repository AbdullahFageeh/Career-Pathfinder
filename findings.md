# Automation Upgrade Findings

## Current repository capability

| Area | Existing capability | Limitation to resolve |
| --- | --- | --- |
| Queue | Durable SQLite-backed stages: ingest, tailor, render, score ATS, apply. | No durable hosted runner; the queue is manually invoked. |
| Automation mode | Queue payload accepts `full-auto`. | The outbound submission gate rejects every mode except `supervised`. |
| Submission | Greenhouse Job Board API can submit a supported structured application. | It requires an API key and rejects required location questions or unsupported questionnaire fields. |
| Browser flow | Hosted Greenhouse helper can prefill forms. | It deliberately stops before submit and cannot reliably handle hidden uploads, CAPTCHAs, or arbitrary site controls. |
| Discovery | Local role corpus, public Greenhouse boards, and scoring. | No source registry, freshness policy, durable daily orchestration, or general official-career ingest adapters. |
| Profile | Candidate profile, ATS tailoring, PDF CV, cover letter, and recurring answers. | No answer provenance and confidence model for safe automatic field completion. |
| Tracking | SQLite application records, follow-up planning, and funnel report. | No delivery notifications and no distinction between automated, manual, and blocked source capability in the operating dashboard. |

## Prior verified workflow result

- Talent Blueprint Accommodation Manager application was submitted through the Recruiterflow portal on 2026-08-14.
- The portal displayed the confirmation: `Thank you for applying. We will contact you shortly.`
- The repository tracker records the result as applied, with day 3, 7, and 14 follow-up steps.

## Automation guardrails

1. Treat Saudi Arabia as a hard location constraint unless Abdullah changes it.
2. Apply only to roles that pass eligibility, freshness, source legitimacy, ATS threshold, duplicate, and daily-cap rules.
3. Use only answers whose source is the private candidate profile and whose approval state supports automatic reuse.
4. Record a durable attempt event before and after any remote request; repeat-safe idempotency is mandatory.
5. Do not make claims, choose an answer, upload a document, or submit when the form asks a new material question, a consent, a CAPTCHA, immigration/work-authorisation proof, compensation detail outside the configured band, or an unsupported attachment.
6. Keep browser-only and unsupported sites in a review queue with generated materials and a clear blocker.

## Chosen operating model

Abdullah selected the daily managed automation desk. It will run scheduled discovery and preparation, attempt only tested structured-channel submission, and report blockers for unsupported or review-required applications.

## External research still required

- Verify current official source/API terms and technical routes before enabling each new platform adapter.
- Verify the hosting scheduler and secure secret-management path before deploying recurring runs.
