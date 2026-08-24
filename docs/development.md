# Development setup

Career Pathfinder is a TypeScript project that builds to ESM JavaScript and uses Node's built-in test runner.

## Prerequisites

- Git
- Node.js 22 for parity with CI; Node 22 through 24 is accepted by `package.json`
- npm with lockfile v3 support

The repository includes `.nvmrc` and `.node-version`, both pinned to Node 22.

## Install

From the repository root:

```powershell
npm ci --ignore-scripts
npm run check
```

`npm ci` reproduces `package-lock.json` exactly. `--ignore-scripts` avoids running dependency lifecycle scripts; this project does not require one during installation.

## Create private local inputs

PowerShell:

```powershell
Copy-Item APPLICATION_REFERENCE.example.md APPLICATION_REFERENCE.md
Copy-Item automation.config.example.json automation.config.json
```

macOS or Linux:

```bash
cp APPLICATION_REFERENCE.example.md APPLICATION_REFERENCE.md
cp automation.config.example.json automation.config.json
```

Both destination files are ignored by Git. Replace examples only with verified facts. Keep `automationMode` set to `observe` and `autoSubmitEnabled` set to `false` during development.

## Optional environment variables

The application reads variables from the process environment; it does not automatically load `.env`.

- `LLM_API_KEY`: enables optional OpenAI-compatible cover-letter refinement.
- `LLM_API_BASE`: overrides the compatible chat-completions base URL.
- `OPENAI_API_KEY` and `OPENAI_API_BASE`: compatibility alternatives when the `LLM_*` variables are not set.
- `GREENHOUSE_JOB_BOARD_API_KEY`: enables the supervised Greenhouse API path when the command and private configuration also allow it.

Copy `.env.example` to `.env` only if your shell or launch tool loads environment files. Never commit `.env`.

PowerShell session example:

```powershell
$env:LLM_API_KEY = "<secret>"
```

macOS or Linux session example:

```bash
export LLM_API_KEY="<secret>"
```

Tests, typechecking, builds, deterministic letters, local scoring, and review-queue generation do not require credentials.

## GitHub Actions deployment on merge

The repository includes `.github/workflows/deploy.yml`, which runs on pushes to `main` (including merged pull requests) and triggers a production deployment.

Configure these repository settings in GitHub:

- `DEPLOY_WEBHOOK_URL` secret: required. The workflow sends a `POST` request to this URL after checks pass.
- `PRODUCTION_URL` variable: optional. If set, it is attached to the deployment environment URL in the workflow run and used for a post-deploy readiness check against `${PRODUCTION_URL}/health`.

## Render runtime contract

- `npm start` now runs `node dist/server.js`.
- The server binds to `0.0.0.0` and `PORT` (default `10000`).
- Health endpoint: `GET /health` returns `200` with JSON status.
- Version endpoint: `GET /version` returns service name and version metadata.
- CLI entrypoint is preserved as `npm run start:cli -- <command>`.

## Commands

- `npm run check`: typecheck, build, and run the complete test suite.
- `npm run typecheck`: validate TypeScript without emitting files.
- `npm test`: build and execute `dist/**/*.test.js`.
- `npm run build`: compile `src/` into `dist/`.
- `npm run clean`: remove generated `dist/` output.
- `npm start`: start the HTTP service used by Render.
- `npm run start:cli -- --help`: print the compiled CLI help after a build.

The project does not currently define a formatter or linter. Follow the existing two-space TypeScript style and rely on strict TypeScript plus tests until a formatter or linter is deliberately adopted.

## Local-only data

The following are intentionally excluded from new commits:

- `APPLICATION_REFERENCE.md`
- `automation.config.json` and `automation.local.json`
- `.env` and other local environment files
- `artifacts/`, runtime `data/`, logs, browser sessions, and SQLite databases
- personal CV exports and outreach working folders listed in `.gitignore`

Some fixture or historical files may already be tracked even when their path now appears in `.gitignore`. Before every commit, inspect `git status` and `git diff --cached`.

## Validation before review

Run:

```powershell
npm ci --ignore-scripts
npm run check
git status --short
```

CI repeats the locked install and checks on Windows and Ubuntu with Node 22.
