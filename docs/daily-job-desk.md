# Daily job desk

The scheduled workflow runs at 09:00 Asia/Riyadh on weekdays. It discovers configured public employer sources, scores roles against the private profile, prepares queued documents, and uploads a review packet. It does not submit applications.

## One-time setup

Create two repository secrets in GitHub:

- `APPLICATION_REFERENCE_MD`: the complete contents of your private `APPLICATION_REFERENCE.md`.
- `AUTOMATION_CONFIG_JSON`: the complete contents of your private `automation.config.json`.

The configuration must keep:

```json
{
  "automationMode": "observe",
  "autoSubmitEnabled": false
}
```

`sourceFreshnessDays` controls how long a listing can remain eligible after its source timestamp. Keep it between 1 and 90 days; the default is 21.

The workflow rejects any other mode. It does not use LinkedIn or Gmail credentials.

## What happens each run

1. The project checks itself and installs its locked dependencies.
2. Public configured sources are fetched and any source failures are listed.
3. Fit and eligibility rules select roles within the daily cap.
4. The worker creates tailored CVs, letters and ATS assessments.
5. A safe review summary, follow-up file and funnel report are uploaded as workflow artifacts.

Generated CVs, cover letters, and review packets contain personal information. They are intentionally kept on the runner and are not uploaded to the public repository's workflow artifacts. Generate the packets locally when you are ready to review a role.

When an official structured employer adapter and its private API key are ready, place the key in a protected GitHub environment such as `production-submit` with a required reviewer. Keep the daily discovery workflow in observe mode. Browser-only applications remain outside this unattended workflow until their fields and submission confirmation can be verified reliably.

## Answer bank

The `answers` array in `automation.config.json` is the approval list for reusable screening answers. Each answer must include a source and verification date. Use `review-only` for answers that depend on the specific employer or role. An unknown required question stops submission instead of being guessed.

Example:

```json
{
  "key": "notice-period",
  "value": "Available immediately",
  "approval": "auto-submit",
  "provenance": {
    "sourceKind": "candidate-profile",
    "sourceRef": "APPLICATION_REFERENCE.md#common-screening-answers",
    "verifiedAt": "2026-09-11T00:00:00.000Z"
  }
}
```

After an employer responds, use the outcome command to keep the feedback loop useful:

```bash
node dist/index.js outcome --job-id <job-id> --outcome interview --note "First interview booked"
```
