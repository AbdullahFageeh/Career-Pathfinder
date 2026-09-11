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

The workflow rejects any other mode. It does not use LinkedIn or Gmail credentials.

## What happens each run

1. The project checks itself and installs its locked dependencies.
2. Public configured sources are fetched.
3. Fit and eligibility rules select roles within the daily cap.
4. The worker creates tailored CVs, letters and ATS assessments.
5. A review packet, follow-up file and funnel report are uploaded as workflow artifacts.

When an official structured employer adapter and its private API key are ready, that path can be designed separately. Browser-only applications remain outside this unattended workflow until their fields and submission confirmation can be verified reliably.
