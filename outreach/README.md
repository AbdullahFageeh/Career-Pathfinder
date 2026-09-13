# Supervised outreach desk

This folder contains a Saudi-first outreach queue for event operations, production, venue, staffing, and logistics roles.

The workflow automates the repetitive work:

1. Keep a shortlist of companies and public contact channels in `targets.csv`.
2. Prepare a tailored email draft, a WhatsApp message, and a review queue.
3. Record messages that you actually sent.
4. Generate follow-up drafts when they become due.

Every email includes your CV as a PDF attachment and says so clearly. WhatsApp messages remain short and ask permission before you send the CV there. Email and WhatsApp are external communications, so each draft stays reviewable and the final send remains yours.

## Run it

From the repository root:

```bash
python3 outreach/prepare_outreach.py run --limit 20
python3 outreach/prepare_outreach.py prepare --limit 20
python3 outreach/prepare_outreach.py status
python3 outreach/prepare_outreach.py open-drafts --limit 5
python3 outreach/prepare_outreach.py followups
```

The Gmail sender is scheduled for Sunday–Thursday, 10:00–11:00 Riyadh time, with a ten-message daily cap. It sends from `AbdullahFageeh@gmail.com`, attaches the CV to every email, and records each handoff:

```bash
python3 outreach/auto_send_email.py --dry-run
```

## GitHub cloud runner

The `Automated Gmail outreach` workflow runs at 10:00 Riyadh time (Sunday–Thursday) on GitHub-hosted infrastructure. It uses Gmail SMTP, so add these repository secrets before enabling sends:

- `GMAIL_USER` — `AbdullahFageeh@gmail.com`
- `GMAIL_APP_PASSWORD` — a 16-character Google App Password
- `APPLICATION_REFERENCE_MD` — the private profile file
- `CV_PDF_BASE64` — the CV encoded as base64

The profile and CV secrets are already installed for this repository. Create the App Password at <https://myaccount.google.com/apppasswords>, then add it under the repository's **Settings → Secrets and variables → Actions** as `GMAIL_APP_PASSWORD`.

After an initial email is recorded as sent, the cloud workflow creates a follow-up after five days and sends it automatically when a later run is within the daily limit. Follow-ups include the CV again and are marked separately in the saved state.

Before each first email and follow-up, `email-validator` checks the address syntax and confirms that the domain has working DNS mail routing. Invalid domains are marked `invalid_email`; an inconclusive DNS check is deferred and tried again on the next run.

The workflow also reads Gmail delivery-status reports without marking them as read. A temporary `4.x` report changes the target to `delivery_delayed`, and a permanent `5.x` report changes it to `bounced`. Both states suppress follow-ups so the automation does not send duplicates to an address already having delivery problems.

This preflight cannot prove that an individual mailbox exists. Catch-all and privacy-protected mail servers deliberately make SMTP mailbox probing unreliable, so the workflow uses actual Gmail delivery reports as the final signal.

`open-drafts --mail` opens the prepared `.eml` files in Apple Mail. It does not send them. After you send one, record it:

```bash
python3 outreach/prepare_outreach.py mark-sent --id eventful-group
python3 outreach/prepare_outreach.py mark-skipped --id eveforceksa
```

The default profile and CV paths come from the private `APPLICATION_REFERENCE.md`. Generated files are written under `artifacts/outreach/`, which is ignored by Git.

## Contact rules

- Use company emails, careers pages, or official business WhatsApp numbers.
- The source URL and date in `targets.csv` show where each contact was checked.
- Rows without an email produce a careers-page/message draft instead of a fake address.
- Keep outreach low-volume and personalized. Stop contacting a company when it asks you to stop or when a conversation begins.
