# Saudi Job Search Operator

A **Saudi-focused job-search operating system** for event production, venue operations, installation, site delivery, supplier coordination, and adjacent operational roles.

It turns the job search into a small daily control loop: collect legitimate Saudi roles, rank them against verified experience, prepare tailored materials, track what has actually been applied to, and surface follow-ups before opportunities go cold. It is built for supervised use: it never silently submits applications and it keeps every generated claim tied to the candidate profile.

## What it does

| Stage | Outcome | Safeguard |
| --- | --- | --- |
| Discovery | Queries curated public Greenhouse boards and accepts configurable employer board tokens. | Keeps only Saudi-based roles; retries temporary network failures; records board failures without stopping the run. |
| Qualification | Ranks saved and discovered roles by title, delivery evidence, location, and recency. | Excludes non-Saudi roles and Saudi-national-only roles unless the candidate profile confirms eligibility. |
| Materials | Produces a tailored CV in ATS-safe HTML/PDF and a cover letter in HTML, text, and optional PDF. | Uses only verified profile facts; optional AI editing is rejected if it adds unsupported claims. |
| Control | Tracks applications, schedules day 3/7/14 follow-ups, and writes a funnel briefing. | No outbound application is sent by default; every action remains reviewable. |

## Start here — 10 minutes

### 1. Create your private profile

Your personal facts stay local and are ignored by Git. Copy the template, then replace every example item with **real, verifiable evidence**. Keep the claim list specific: project names, scope, dates, scale, results, certifications, and contact details.

```bash
cp APPLICATION_REFERENCE.example.md APPLICATION_REFERENCE.md
```

For the Saudi-national eligibility filter, include the real answer under **Identity and contact** as `Nationality status: Saudi national` only if that is accurate. If this field is not confirmed, Saudi-national-only vacancies remain excluded rather than guessed.

### 2. Install and check the project

```bash
npm install
npm test
```

A healthy installation finishes with all tests passing. The repository contains an initial local corpus in `data/roles/`; it is part of the tracked project history even though newly generated local data is ignored.

### 3. Produce today’s shortlist

```bash
npm run shortlist -- \
  --reference-path ./APPLICATION_REFERENCE.md \
  --corpus-dir ./data/roles \
  --corpus-only \
  --limit 10 \
  --output ./artifacts/daily-shortlist.md
```

Open `artifacts/daily-shortlist.md`, then work the first two roles that you genuinely want. A shortlist is a backstage run sheet, not a to-do dump: the goal is a small number of high-quality applications, completed end to end.

## The daily loop

Run this sequence on a workday. It is designed to take **30–45 minutes** once your profile is accurate.

| Order | Command | What to do next |
| --- | --- | --- |
| 1 | `npm run discover:greenhouse -- --save-dir ./data/roles` | Review any new Saudi roles; the command persists them to the local store by default. Add target companies with `--boards token1,token2`. |
| 2 | `npm run shortlist -- --reference-path ./APPLICATION_REFERENCE.md --limit 10 --output ./artifacts/daily-shortlist.md` | Choose one or two roles worth real effort. Use `--saudi-national` only if true. |
| 3 | `npm run pipeline:single -- --input ./data/roles/<role>.json --reference-path ./APPLICATION_REFERENCE.md --storage-path ./data/pipeline-store.sqlite --render-output-dir ./artifacts/resumes` | Create the tracked application record and check ATS readiness. Only proceed when the score and facts look right. |
| 4 | `npm run cv -- --input ./data/roles/<role>.json --reference-path ./APPLICATION_REFERENCE.md --output-dir ./artifacts/cv --formats html,pdf` | Generate the recruiter-ready CV. Attach the PDF only after a quick factual review. |
| 5 | `npm run letter -- --input ./data/roles/<role>.json --reference-path ./APPLICATION_REFERENCE.md --output-dir ./artifacts/letters --formats html,pdf` | Read it as if you were the hiring manager. Add a real employer-specific line with `--company-hook` if useful. |
| 6 | Submit manually or use the supervised Greenhouse prefill command. | Review every field and press the final submit button yourself. |
| 7 | `npm run followups -- --storage-path ./data/pipeline-store.sqlite --reference-path ./APPLICATION_REFERENCE.md --output ./artifacts/followups.md` | Send only the messages that remain relevant after a quick human review. |
| 8 | `npm run report -- --storage-path ./data/pipeline-store.sqlite --output ./artifacts/funnel-report.md` | Use the report to identify stalled applications and decide the next week’s focus. |

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

> This project is an application-assistance tool, not an automatic mass-application bot. The strongest advantage is focused, factual, timely applications — not volume.

## Quality checks

```bash
npm run typecheck
npm test
```

The test suite covers Saudi eligibility, source normalization and transient retry handling, fit scoring, letter invention guards, PDF fallback behavior, follow-up scheduling, funnel reporting, CLI command parsing, and the existing pipeline.

## Current limits

The Greenhouse discovery module cannot discover every Saudi vacancy, and public board APIs may be intermittently unavailable. Use employer career pages, referrals, LinkedIn, and job-board alerts alongside it. The project presently supports supervised Greenhouse browser prefill; other platforms should be reviewed and applied to manually until a reliable, policy-compliant adapter is added.

## Licence

Private project for Abdullah Fageeh.
