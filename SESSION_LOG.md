# Session Log
This file is the running record for the full project session and should be updated as work continues.

## Status
- Started: 2026-06-09
- Last updated: 2026-06-29
- Project folder: `/Users/abdullah/Downloads/Job project`
- Current mode: Saudi-only outreach tracking, manual dispatch logging, and automation upkeep
- Local git repository initialized on branch `main`

## Goal
Build a nonstop automated job-application system that:
- continuously discovers relevant jobs
- tailors the CV for each role
- blocks sends until internal ATS readiness is at least 80
- records every targeted or applied job
- gathers public recruiter or hiring contact details when available
- can run in supervised or full-auto mode under policy controls
- explores adjacent fields, remote roles, and other vetted income paths when they offer better compensation or reliability

## Key decisions so far
- The project will be built from scratch in this folder.
- The system will use the user's CV and LinkedIn profile as seed data.
- The product direction changed from a manual helper into an always-on automation system.
- The system will maintain a permanent application tracker with status history and follow-up history.
- The system will gather only public, verifiable recruiter or hiring-contact details.
- The ATS threshold of 80 is treated as an internal readiness score, not a claim about any employer's private ATS.
- Full automation will be policy-controlled with safety rules such as duplicate protection, cooldowns, daily caps, and supported-platform allowlists.
- The scope is widened beyond the original role family to include adjacent higher-pay fields, remote-friendly roles, and other vetted income opportunities.

## Source material collected
- LinkedIn profile: https://www.linkedin.com/in/abdullah-fageeh-34b7b5216/
- Master CV PDF: `/Users/abdullah/Desktop/Abdullah_Fageeh_CV_2026.pdf`

## Candidate profile highlights captured
- Target role families:
  - Installation Manager
  - Production Manager
  - Site Operations
  - Site Manager
  - Venue Operations
- Proof points:
  - 6-venue build delivery
  - 100% AutoCAD layout compliance
  - installation completed 20% ahead of schedule
  - setup accelerated by 30%
  - safety incidents reduced by 25%
  - Formula 1 venue operations supporting 50,000+ attendees
- Certifications:
  - NEBOSH International General Certificate in Occupational Health and Safety (2024)
  - PMP Certification Training Course (2024)
  - Fundamentals of Artificial Intelligence, SDAIA (2025)

## Architecture direction
- Candidate profile store
- Continuous job discovery and ingestion
- Tailoring engine
- ATS readiness engine
- Autonomy and policy engine
- Application tracker
- Contact enrichment
- Background queue and worker pipeline
- Notifications and monitoring

## Files created in this session
- `APPLICATION_REFERENCE.md`
- `SESSION_LOG.md`
- `.gitignore`
- `AGENTS.md`

## Notes about `APPLICATION_REFERENCE.md`
- Created as a reusable source for recurring application fields, document paths, and reusable answers.
- Prefilled with known details from the CV and LinkedIn profile.
- Left blank where confirmation is still needed.

## Open information still needed from user
- Nationality
- Full current address
- Current employer
- Current job title
- Current work location
- Current salary
- Salary expectation
- Notice period
- Work authorization or visa details
- Preferred locations
- Languages spoken
- Document paths beyond the master CV PDF

## Pending implementation foundation
- Create the canonical master profile schema
- Create ATS assessment schema
- Create application tracker schema
- Create contact record schema
- Create queue-state and policy models
- Build the first single-job pipeline:
  - ingest
  - tailor
  - ATS score
  - create application record

## External repository list to review
- https://github.com/santifer/career-ops
- https://github.com/AndrewStetsenko/tech-jobs-with-relocation
- https://github.com/speedyapply/JobSpy
- https://github.com/DaKheera47/job-ops
- https://github.com/LinuxSuRen/remote-jobs-in-china
- https://github.com/GodsScion/Auto_job_applier_linkedIn
- https://github.com/PaulMcInnis/JobFunnel
- https://github.com/can4hou6joeng4/boss-agent-cli
- https://github.com/emredurukn/awesome-job-boards
- https://github.com/Gsync/jobsync
- https://github.com/andrew-shwetzer/career-ops-plugin
- https://github.com/lukasz-madon/awesome-remote-job
- https://github.com/kdn251/interviews
- https://github.com/remoteintech/remote-jobs
- https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk
- https://github.com/engineerapart/TheRemoteFreelancer
- https://github.com/BoltzmannEntropy/interviews.ai
- https://github.com/Frrrrrrrrank/auto_job__find__chatgpt__rpa
- https://github.com/Kaustubh-Natuskar/moreThanFAANGM
- https://github.com/tilo/smarter_csv
- https://github.com/Pickle-Pixel/ApplyPilot
- https://github.com/jmopr/job-hunter
- https://github.com/coding-ai/EasyApply-Linkedin
- https://github.com/molyswu/hand_detection

## Repository review shortlist
- Best overall reference for an AI-driven candidate workflow: `santifer/career-ops`
- Best search and ingestion building block: `speedyapply/JobSpy`
- Best tracker/dashboard reference: `DaKheera47/job-ops`
- Best self-hosted tracker and resume-review reference: `Gsync/jobsync`
- Best strong full-auto reference to study carefully: `Pickle-Pixel/ApplyPilot`
- Best low-risk portal-assist reference: `can4hou6joeng4/boss-agent-cli`

## Repository review cautions
- `PaulMcInnis/JobFunnel` is archived and mainly useful as a historical ingestion/tracking idea.
- `feder-cr/Jobs_Applier_AI_Agent_AIHawk` is archived and should be treated as inspiration, not a direct dependency.
- `GodsScion/Auto_job_applier_linkedIn` and `coding-ai/EasyApply-Linkedin` are LinkedIn-specific automation references, but they are narrower and more brittle than the architecture planned for this project.
- `molyswu/hand_detection` is unrelated to the project scope.

## Reddit and community research update
- Direct Reddit extraction is unreliable because Reddit blocks some JSON and search access, so findings were reconstructed from readable subreddit mirrors and indexed public pages.
- Highest-signal communities identified for this project:
  - `r/jobs` and `r/jobsearch` for ATS pain points, application-friction patterns, and employer-platform complaints
  - `r/Resume` for repeated resume and ATS advice
  - `r/recruiting` for ATS, recruitment-tech, and candidate-status workflow insight
  - `r/hiring` for hidden or lightly-distributed openings that should still be verified on official company pages
  - `r/careeradvice` for broader search strategy and recruiter cautionary stories
- Repeated tactical takeaways:
  - prefer simple single-column, ATS-safe resume layouts over visual templates
  - tailor summary, skills, and top bullets per job while keeping a stable base resume
  - quantify outcomes and delivery signals instead of listing duties
  - treat follow-up emails, cover letters, and referrals as secondary boosts rather than the main conversion mechanism
  - verify community leads on an official employer page before applying or storing them as canonical jobs

## Tool and source shortlist from web research
- Workflow reference tools:
  - `Teal` — multi-board bookmarking, job tracker, resume-job matching, contacts, and follow-up workflow
  - `Huntr` — job tracker, per-job tailored resumes, keyword/responsibility/qualification matching, and autofill
  - `Simplify Copilot` — autofill across major ATS portals, application tracking, resume scoring, and multi-page form handling
  - `Hunter` — public-source email finding with verification/confidence and source URL provenance
- Niche boards worth adding to discovery:
  - `PMI PMJobs` for project management roles
  - `CMAA Career Headquarters` and `AGC Construction Careers` for construction and site-management roles
  - `IFMA Job Board` and `IWFM Jobs` for facilities roles
  - `Giggs`, `IEBA Live Jobs`, and `NIVF`-linked live-entertainment boards for venue and live-events roles

## Plan implications recorded
- Discovery should use a layered source stack: official ATS pages, broad aggregators, niche boards, and readable community leads.
- Community-sourced opportunities must resolve to an official employer URL before autonomous apply or outreach.
- The system should model tracker and autofill behavior similar to Teal, Huntr, and Simplify while keeping human-review controls.
- Contact enrichment should store provenance plus verification/confidence metadata and stay limited to public professional contact data.

## Repository state
- Initialized a local git repository on `main`.
- Added `.gitignore` so personal reference files, secrets, and local runtime artifacts stay out of version control by default.
- Scaffolded the initial TypeScript project structure under `src/` based on the approved architecture.
- Added root project files: `README.md`, `package.json`, `package-lock.json`, and `tsconfig.json`.
- Added root project rules in `AGENTS.md` so this repo keeps the widened opportunity scope and safety filters as project-only instructions.
- Validated the scaffold with `npm run typecheck` and `npm run build`.
- Created the first commit: `8246c08` — `chore: scaffold initial project structure`

## First shortlist of target job fields
### Lane 1 — Direct-fit priority
- Installation, site, and build-delivery roles for events, exhibitions, temporary structures, fit-out, and venue builds
- Venue operations and event operations roles with ownership of site readiness, logistics, and live execution
- Production and installation management roles where schedule control, vendor coordination, and onsite delivery are core

### Lane 2 — Adjacent strong-fit priority
- Project coordination and project-management-support roles in construction-adjacent, events, fit-out, and facilities environments
- Facilities and workplace operations roles that value site readiness, vendor management, compliance, and operational planning
- HSE, logistics, vendor-coordination, and operations-support roles where NEBOSH-backed safety ownership is a differentiator

### Lane 3 — Remote-friendly bridge lanes
- Remote project coordinator or PMO support roles
- Remote operations coordinator, client-operations, or service-delivery coordination roles
- Remote scheduling, workflow, reporting, vendor-management, or support roles tied to physical-operations industries

## Shortlist rules and rationale
- Start with Lane 1 and Lane 2 before widening aggressively into Lane 3.
- Prefer roles that reuse truthful proof points already present in the CV and LinkedIn profile: multi-site delivery, schedule acceleration, AutoCAD/layout compliance, safety improvement, vendor coordination, and large-event operations.
- Optimize for compensation, stability, and legitimacy over raw volume.
- Avoid fields that would require invented technical depth, unsupported software credentials, or unrelated experience claims.

## Immediate next targeting direction
- Prioritize Lane 1 searches first.
- Use Lane 2 as the main expansion set for higher-value adjacent roles.
- Use Lane 3 as a controlled bridge lane for remote-friendly opportunities that still fit the same evidence base.

## Outreach execution update — 2026-06-29
- Applied the Saudi-only filter to the latest manual outreach work and used only official company routes.
- Created a separate manual outreach workspace for Monks and Kidana at `/Users/abdullah/Library/Application Support/saudi-outreach-send/manual-outreach-2026-06-28-monks-kidana`.

## Monks and Kidana results
- Kidana:
  - Official route confirmed from the company site and contact pages.
  - Prepared a Kidana-specific email draft plus CV artifacts in `cv_html/`, `cv_pdf/`, and `email_drafts/`.
  - Sent the outreach email to `communication@kidana.com.sa` with subject `Application — Operations / Site Delivery — Abdullah Fageeh`.
- Monks:
  - No public careers email was used because the official public flow pointed back to the Monks website.
  - Prepared a Monks-specific contact note focused on Riyadh project delivery, experience operations, production coordination, and technical project support.
  - Submitted the note through the official Monks embedded contact-form route from `https://www.monks.com/lets-connect`, and the submission returned HTTP 200.

## Saved records for the manual outreach slice
- Status summary: `/Users/abdullah/Library/Application Support/saudi-outreach-send/manual-outreach-2026-06-28-monks-kidana/dispatch-status.txt`
- Monks submission payload: `/Users/abdullah/Library/Application Support/saudi-outreach-send/manual-outreach-2026-06-28-monks-kidana/monks-contact-submit.json`
- Monks submission response: `/Users/abdullah/Library/Application Support/saudi-outreach-send/manual-outreach-2026-06-28-monks-kidana/monks-submission-response.json`
- The active scheduled-send batch remains separate under `/Users/abdullah/Library/Application Support/saudi-outreach-send/saudi-tailored-outreach-2026-06-26-batch-03`, with the convenience link at `Abdullah/active-batch`.

## Update rule for future work
- Keep this file updated when major decisions, files, schemas, architecture changes, blockers, or confirmed personal/application details change.
