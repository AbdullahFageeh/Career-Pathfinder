# Saudi Job Search Operator

A **Saudi-first and remote-inclusive job-search operating system** for event production, venue operations, installation, site delivery, supplier coordination, and adjacent operational roles.

It turns the job search into a controlled daily application desk: collect trusted Saudi roles and explicitly enabled remote roles, rank them against verified experience, queue tailored materials, track what has actually been applied to, and surface follow-ups before opportunities go cold. It is intentionally low-volume and evidence-bound: unknown questions, untrusted sources, stale roles, country-restricted remote listings, and unsupported portals are held for review rather than guessed.

## What it does

| Stage | Outcome | Safeguard |
| --- | --- | --- |
| Discovery | Queries configured public Greenhouse, Lever, and Workable employer career sources. | Keeps Saudi roles by default; remote roles require an explicit config opt-in, trusted public source, and a compatible stated jurisdiction. |
| Qualification | Ranks saved and discovered roles by title, delivery evidence, location, and recency. | Excludes country-restricted remote roles, Saudi-national-only roles without confirmed eligibility, and roles requiring unverified specialties. |
| Materials | Produces a tailored CV in ATS-safe HTML/PDF and a cover letter in HTML, text, and optional PDF. | Uses only verified profile facts; optional AI editing is rejected if it adds unsupported claims. |
| Automation desk | Runs configured public-board discovery, applies source/fit/cap rules, persists a daily run record, and writes a review queue. | Default cap: 4/day; stale, duplicate, unsupported, and employer-cooldown roles stop for review. |
| Control | Tracks applications, schedules day 3/7/14 follow-ups, and writes a funnel briefing. | Structured auto-send is disabled until a private config explicitly enables it; browser portals remain review-gated. |

## Start here — 10 minutes

### 1. Create your private profile

Your personal facts stay local and are ignored by Git. Copy the template, then replace every example item with **real, verifiable evidence**. Keep the claim list specific: project names, scope, dates, scale, results, certifications, and contact details.

```bash
cp APPLICATION_REFERENCE.example.md APPLICATION_REFERENCE.md
```

For the Saudi-national eligibility filter, include the real answer under **Identity and contact** as `Nationality status: Saudi national` only if that is accurate. If this field is not confirmed, Saudi-national-only vacancies remain excluded rather than guessed.

### 2. Create the private automation settings

```bash
cp automation.config.example.json automation.config.json
```

Keep `"automationMode": "observe"` and `"autoSubmitEnabled": false` for the one-click review workflow. Add only verified employer identifiers: `boardToken` for Greenhouse and `siteToken` for Lever or Workable. Set `"includeRemote": true` for remote roles; use `"remoteScope": "worldwide"` to search every explicitly remote location. Country- or region-restricted roles stay review-only and are flagged for work-authorization, payroll, and residency confirmation. The file is ignored by Git.

### 3. Install and check the project

```bash
npm install
npm test
```

A healthy installation finishes with all tests passing. The repository contains an initial local corpus in `data/roles/`; it is part of the tracked project history even though newly generated local data is ignored.

### 4. Produce today’s shortlist

```bash
npm run shortlist -- \
  --reference-path ./APPLICATION_REFERENCE.md \
  --corpus-dir ./data/roles \
  --corpus-only \
  --limit 10 \
  --output ./artifacts/daily-shortlist.md
```

Open `artifacts/daily-shortlist.md`, then work the first two roles that you genuinely want. A shortlist is a backstage run sheet, not a to-do dump: the goal is a small number of high-quality applications, completed end to end.

## Automated daily desk

Run the automation command once after creating your private profile and config. It discovers enabled official Greenhouse boards plus configured public Lever and Workable career sites, rejects stale or duplicate roles, applies Saudi eligibility and fit rules, respects daily and employer caps, queues selected roles, and writes a compact review sheet.

```bash
npm run automation:run -- \
  --config ./automation.config.json \
  --reference-path ./APPLICATION_REFERENCE.md \
  --storage-path ./data/pipeline-store.sqlite \
  --output ./artifacts/automation-review.md
```

The first run remains **queue-only**. Read `artifacts/automation-review.md`, then process queued work and generate the review packets:

```bash
npm run worker:once -- --storage-path ./data/pipeline-store.sqlite
npm run review:packets -- \
  --storage-path ./data/pipeline-store.sqlite \
  --reference-path ./APPLICATION_REFERENCE.md \
  --output-dir ./artifacts/review
```

Each packet includes a tailored PDF/HTML CV, cover letter, exact employer application URL, and a Greenhouse prefill command where that hosted form supports it. You review the facts and submit the employer form yourself. Greenhouse, Lever, Workable, LinkedIn, and other employer portals remain manual-final-click channels; no employer API key is needed for this workflow.

### Add Lever and Workable sources

Add only career-site slugs you have verified from the employer URL. Both channels are intentionally review-only:

```json
{
  "id": "example-lever-site",
  "kind": "lever",
  "capability": "review-only",
  "enabled": true,
  "siteToken": "employer-lever-slug"
}
```

```json
{
  "id": "example-workable-site",
  "kind": "workable",
  "capability": "review-only",
  "enabled": true,
  "siteToken": "employer-workable-slug"
}
```

The daily run fetches their public listings, scores Saudi roles and any explicitly enabled compatible remote roles, creates tailored material for qualified roles, and stops at a review-ready application link. Never set either channel to `structured-submit`.

## The daily loop

Run this sequence on a workday. It is designed to take **15–25 minutes** once your profile and configuration are accurate.

| Order | Command | What to do next |
| --- | --- | --- |
| 1 | `npm run automation:run -- --config ./automation.config.json --reference-path ./APPLICATION_REFERENCE.md --storage-path ./data/pipeline-store.sqlite --output ./artifacts/automation-review.md` | Review only the held items; trusted, high-fit roles are queued automatically. |
| 2 | `npm run worker:once -- --storage-path ./data/pipeline-store.sqlite` | Generate tailored materials and assess ATS fit without submitting. |
| 3 | `npm run review:packets -- --storage-path ./data/pipeline-store.sqlite --reference-path ./APPLICATION_REFERENCE.md --output-dir ./artifacts/review` | Open each packet, attach its tailored CV, check every answer, and make the final click yourself. |
| 4 | `npm run followups -- --storage-path ./data/pipeline-store.sqlite --reference-path ./APPLICATION_REFERENCE.md --output ./artifacts/followups.md` | Send only the messages that remain relevant after a quick human review. |
| 5 | `npm run report -- --storage-path ./data/pipeline-store.sqlite --output ./artifacts/funnel-report.md` | Use the report to identify stalled applications and decide the next week’s focus. |

## Core commands

### Discover Saudi roles from public Greenhouse boards

```bash
npm run discover:greenhouse -- \
  --boards dmgevents,tamara,careem \
  --max-per-board 50 \
  --save-dir ./data/roles \
  --storage-path ./data/pipeline-store.sqlite
```

The default boards are deliberately small and verified as public Greenhouse boards with Saudi vacancies. This is a **lead source**, not a complete market scan. Supply additional public Greenhouse board tokens with `--boards`; dead or unavailable boards are reported separately so a temporary source problem does not look like zero jobs.

Add `--all-titles` to retain every Saudi role from the chosen boards. By default, discovery focuses on operational target titles such as venue, site, production, installation, operations, logistics, facilities, and delivery roles.

### Rank jobs by fit

```bash
npm run shortlist -- \
  --reference-path ./APPLICATION_REFERENCE.md \
  --limit 10 \
  --min-score 60 \
  --home-city jeddah \
  --output ./artifacts/daily-shortlist.md
```

The score rewards direct title relevance and verified delivery evidence. It subtracts for weak source signals, stale records, location friction, missing application channels, and eligibility blockers. Use `--include-ineligible` only to inspect why a role was withheld; it does not make that role a good application target.

### Generate a tailored CV

```bash
npm run cv -- \
  --input ./data/roles/<role>.json \
  --reference-path ./APPLICATION_REFERENCE.md \
  --output-dir ./artifacts/cv \
  --formats html,pdf
```

The PDF is deliberately single-column, readable, and ATS-safe. If local Chromium is unavailable, the command always retains an HTML fallback and reports the reason the PDF was skipped.

### Generate a cover letter

```bash
npm run letter -- \
  --input ./data/roles/<role>.json \
  --reference-path ./APPLICATION_REFERENCE.md \
  --recipient "Ms Al Harbi" \
  --company-hook "I am particularly interested in the scale of your upcoming venue programme." \
  --tone direct \
  --output-dir ./artifacts/letters \
  --formats html,pdf
```

The default letter is deterministic and works without internet access. If an OpenAI-compatible key is available, add `--use-llm` to refine the wording:

```bash
export OPENAI_API_KEY="..."
npm run letter -- --input ./data/roles/<role>.json --reference-path ./APPLICATION_REFERENCE.md --use-llm
```

The optional rewrite is accepted only when it introduces no unsupported numbers, employers, or certifications. If the check fails, the original evidence-only draft is retained.

### Run the supervised application path

```bash
npm run greenhouse:hosted:prefill -- \
  --url "https://job-boards.eu.greenhouse.io/<company>/jobs/<id>" \
  --reference-path ./APPLICATION_REFERENCE.md \
  --resume-path ./artifacts/resumes/<resume>.pdf \
  --keep-open
```

This fills supported fields and leaves the browser open for review. It does not perform an unreviewed final submission. For API-backed Greenhouse applications, set `GREENHOUSE_JOB_BOARD_API_KEY` and use `--apply-mode supervised`; the supervised gate still remains in place.

### Schedule and action follow-ups

```bash
npm run followups -- \
  --storage-path ./data/pipeline-store.sqlite \
  --reference-path ./APPLICATION_REFERENCE.md \
  --offset-days 3,7,14 \
  --output ./artifacts/followups.md
```

The command schedules follow-ups from the actual `applied` date and writes ready-to-review messages. A record that has not reached `applied` is not given an artificial follow-up date.

### Read the funnel

```bash
npm run report -- \
  --storage-path ./data/pipeline-store.sqlite \
  --stale-after-days 10 \
  --output ./artifacts/funnel-report.md
```

The report shows where work is accumulating, how many opportunities have reached each stage, applications in the last seven days, due follow-ups, and records that have stalled.

## Project layout

```text
src/
  policy/       Saudi location, legitimacy, and eligibility filters
  sources/      Public-board discovery plus the local role corpus
  score/        Fit scoring and shortlist ranking
  tailor/       Evidence-only CV tailoring
  render/       ATS-safe HTML/PDF document rendering
  letters/      Deterministic and guarded AI-refined cover letters
  tracker/      Application history and status transitions
  followup/     Day 3, 7, and 14 follow-up ladder
  report/       Funnel and stalled-record briefing
  cli/          Local control surface
  storage/      SQLite and lightweight file persistence
  worker/       Durable queued pipeline stages
```

## Privacy and safety

`APPLICATION_REFERENCE.md`, generated `artifacts/`, runtime `data/`, SQLite files, `.env*`, browser state, and local session files are ignored. Do not place private CVs, phone numbers, employer contact exports, or credentials in a tracked file.

> This project is a low-volume automation desk, not a mass-application bot. Its advantage is focused, factual, timely applications — not volume. A safe configuration limits application volume, uses only explicit verified answers, and sends unsupported or ambiguous cases to review.

## Quality checks

```bash
npm run typecheck
npm test
```

The test suite covers Saudi eligibility, source normalization and transient retry handling, fit scoring, letter invention guards, PDF fallback behavior, follow-up scheduling, funnel reporting, CLI command parsing, and the existing pipeline.

## Current limits

Greenhouse, Lever, and Workable discovery cannot cover every Saudi vacancy, and public career data may be intermittently unavailable. Use employer career pages, referrals, LinkedIn, and job-board alerts alongside it. The review queue deliberately prepares documents and form handoffs but never makes the final employer submission. Greenhouse, Lever, Workable, company pages, LinkedIn, and other portals remain final-click review channels unless the hiring employer authorizes a dedicated structured adapter.

## Licence

Private project for Abdullah Fageeh.
