# OpenClaw Installation Notes

This file records the working OpenClaw install and the final configuration on this machine.

## Current status

- OpenClaw CLI version: `2026.6.8`
- Service manager: macOS LaunchAgent
- Service state: loaded and running
- Dashboard URL: `http://127.0.0.1:18789/`
- Network exposure: localhost only

## Key paths

- CLI binary: `/opt/homebrew/bin/openclaw`
- Config file: `/Users/abdullah/.openclaw/openclaw.json`
- Workspace: `/Users/abdullah/.openclaw/workspace`
- LaunchAgent file: `/Users/abdullah/Library/LaunchAgents/ai.openclaw.gateway.plist`
- Gateway log: `/tmp/openclaw/openclaw-2026-06-20.log`

## Installation steps used

### 1) Confirm prerequisites

```bash
node --version
npm --version
```

Node and npm were already installed, so the CLI was installed with npm instead of the full bootstrap script.

### 2) Install the OpenClaw CLI

First attempt:

```bash
npm install -g openclaw@latest
```

That failed once with `ECONNRESET` while downloading packages, so the successful retry used safer npm network settings:

```bash
npm install -g openclaw@latest --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --maxsockets=1
```

### 3) Attempt onboarding

```bash
openclaw onboard --install-daemon
```

The onboarding flow started and applied migrations, but it ended with setup cancelled before the daemon install completed.

### 4) Install and load the daemon manually

```bash
openclaw gateway install
```

This installed the LaunchAgent and loaded the gateway service.

### 5) Change the gateway from LAN to localhost-only

The original config had:

```json
"bind": "lan"
```

The final working setting is:

```json
"bind": "loopback"
```

Important: `localhost` is not a valid OpenClaw bind mode. The correct localhost-only value is `loopback`.

### 6) Validate and restart the service

```bash
openclaw config validate
openclaw gateway restart
```

### 7) Verify the install

```bash
openclaw --version
openclaw gateway status
openclaw dashboard
curl -I http://127.0.0.1:18789/
```

The dashboard root and local UI assets returned `HTTP 200`, which confirmed that the Control UI was serving correctly.

## Current configuration summary

Sensitive values such as tokens and API keys are intentionally omitted from this document.

### Gateway

- `gateway.mode`: `local`
- `gateway.bind`: `loopback`
- `gateway.port`: `18789`
- `gateway.auth.mode`: `token`
- `gateway.tailscale.mode`: `off`
- Control UI allowed origins:
  - `http://localhost:18789`
  - `http://127.0.0.1:18789`

### Agent defaults

- Primary model: `anthropic/claude-opus-4-7`
- Fallback model: `anthropic/claude-sonnet-4-5-20250929`
- Workspace: `/Users/abdullah/.openclaw/workspace`
- Sandbox mode: `off`
- Max concurrent agents: `4`
- Max concurrent subagents: `8`

### Current channel settings

- WhatsApp enabled: `true`
- WhatsApp DM policy: `pairing`
- WhatsApp group policy: `allowlist`
- WhatsApp media max size: `50 MB`

## Expected healthy service state

When the install is healthy, `openclaw gateway status` should show:

- Service: LaunchAgent loaded
- Runtime: running
- Connectivity probe: ok
- Listening on:
  - `127.0.0.1:18789`
  - `[::1]:18789`

## Useful maintenance commands

```bash
openclaw gateway status
openclaw gateway restart
openclaw config validate
openclaw doctor --fix
openclaw dashboard
```

## Notes

- The gateway is now loopback-only, so only local clients on this machine can connect.
- If the config is edited manually and OpenClaw refuses to start, run `openclaw config validate` first.
- If OpenClaw reports a legacy or invalid config issue, run `openclaw doctor --fix`.
