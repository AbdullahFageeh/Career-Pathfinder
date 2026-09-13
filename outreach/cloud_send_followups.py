#!/usr/bin/env python3
"""Send due outreach follow-ups through Gmail SMTP."""

from __future__ import annotations

import argparse
import os
import smtplib
from datetime import date, datetime
from email.message import EmailMessage
from pathlib import Path

from email_preflight import validate_recipient
from prepare_outreach import build_followup_body, load_state, parse_profile, read_targets, save_state


def main(args: argparse.Namespace) -> int:
    username = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not args.dry_run and (not username or not password):
        raise SystemExit("GMAIL_USER and GMAIL_APP_PASSWORD secrets are required")
    profile = parse_profile(Path(args.profile).resolve())
    resume = Path(profile["resume"]).resolve()
    targets = {row["id"]: row for row in read_targets(Path(args.targets).resolve())}
    state_path = Path(args.state).resolve()
    state = load_state(state_path)
    today = date.today().isoformat()
    sent_today = sum(1 for item in state.values() if item.get("status") == "sent" and str(item.get("sent_at", "")).startswith(today))
    remaining = max(0, args.daily_cap - sent_today)
    send_limit = min(args.limit, remaining)
    due = [item for item in state.values() if item.get("status") == "followup_due" and item.get("id") in targets and item.get("contact_email")]
    sent = 0
    for item in due:
        if sent >= send_limit:
            break
        validation = validate_recipient(item["contact_email"])
        if validation.status != "valid":
            print(f"Deferred follow-up {item['id']}: {validation.reason}")
            if not args.dry_run:
                item.update(validation.state_fields())
                if validation.status == "invalid":
                    item.update({"status": "invalid_email", "followup_due": "", "followup_draft": ""})
                save_state(state_path, state)
            continue
        if args.dry_run:
            print(f"Would send follow-up {item['id']} -> {validation.normalized} (domain validated)")
            sent += 1
            continue
        target = targets[item["id"]]
        message = EmailMessage()
        message["From"] = username
        message["To"] = target["contact_email"].strip().lower()
        message["Subject"] = f"Following up — {target['role_lane']} — {profile['name']}"
        message.set_content(build_followup_body(target, profile, item.get("sent_at", "")))
        if resume.is_file():
            message.add_attachment(resume.read_bytes(), maintype="application", subtype="pdf", filename=resume.name)
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
                smtp.login(username, password)
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException) as exc:
            print(f"Stopped after {sent} follow-up(s); Gmail reported an error for {item['id']}: {exc}")
            break
        item.update(validation.state_fields())
        item.update({"status": "followup_sent", "followup_sent_at": datetime.now().astimezone().isoformat(timespec="seconds"), "send_method": "github-actions-gmail-smtp"})
        save_state(state_path, state)
        sent += 1
        print(f"Sent follow-up to {item['contact_email']}")
    print(f"Completed: {sent} follow-up(s) sent.")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--targets", required=True)
    p.add_argument("--state", required=True)
    p.add_argument("--profile", required=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--daily-cap", type=int, default=10)
    p.add_argument("--dry-run", action="store_true")
    return p


if __name__ == "__main__":
    raise SystemExit(main(parser().parse_args()))
