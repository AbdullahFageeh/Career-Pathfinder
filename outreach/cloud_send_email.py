#!/usr/bin/env python3
"""Send queued outreach from GitHub Actions through Gmail SMTP."""

from __future__ import annotations

import argparse
import os
import smtplib
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

from email_preflight import validate_recipient
from prepare_outreach import (
    DEFAULT_STATE_PATH,
    TARGETS_PATH,
    build_email_body,
    load_state,
    parse_profile,
    read_targets,
    save_state,
)


def send_email(target: dict[str, str], profile: dict[str, str], resume: Path, username: str, password: str) -> None:
    message = EmailMessage()
    message["From"] = username
    message["To"] = target["contact_email"].strip().lower()
    message["Subject"] = f"Application — {target['role_lane']} — {profile['name']}"
    message.set_content(build_email_body(target, profile))
    message.add_attachment(resume.read_bytes(), maintype="application", subtype="pdf", filename=resume.name)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(username, password)
        smtp.send_message(message)


def main(args: argparse.Namespace) -> int:
    username = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not args.dry_run and (not username or not password):
        raise SystemExit("GMAIL_USER and GMAIL_APP_PASSWORD secrets are required")
    if args.check_credentials:
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
                smtp.login(username, password)
        except (OSError, smtplib.SMTPException) as exc:
            raise SystemExit(f"Gmail authentication failed: {exc}") from exc
        print("Gmail authentication verified. No message was sent.")
        return 0
    profile = parse_profile(Path(args.profile).resolve())
    resume = Path(profile["resume"]).expanduser().resolve()
    if not resume.is_file():
        raise SystemExit(f"CV not found: {resume}")
    targets = {row["id"]: row for row in read_targets(Path(args.targets).resolve())}
    state_path = Path(args.state).resolve()
    state = load_state(state_path)
    today = date.today().isoformat()
    sent_today = sum(1 for item in state.values() if item.get("status") == "sent" and str(item.get("sent_at", "")).startswith(today))
    remaining = max(0, args.daily_cap - sent_today)
    send_limit = min(args.limit, remaining)
    candidates = [item for item in state.values() if item.get("status") == "drafted" and item.get("contact_email") and item.get("id") in targets]
    sent = 0
    for item in candidates:
        if sent >= send_limit:
            break
        validation = validate_recipient(item["contact_email"])
        if validation.status != "valid":
            print(f"Deferred {item['id']}: {validation.reason}")
            if not args.dry_run:
                item.update(validation.state_fields())
                if validation.status == "invalid":
                    item.update({"status": "invalid_email", "followup_due": "", "followup_draft": ""})
                save_state(state_path, state)
            continue
        if args.dry_run:
            print(f"Would send {item['id']} -> {validation.normalized} (domain validated)")
            sent += 1
            continue
        try:
            send_email(targets[item["id"]], profile, resume, username, password)
        except (OSError, smtplib.SMTPException) as exc:
            print(f"Stopped after {sent} message(s); Gmail reported an error for {item['id']}: {exc}")
            break
        sent_at = datetime.now().astimezone()
        item.update(validation.state_fields())
        item.update({"status": "sent", "sent_at": sent_at.isoformat(timespec="seconds"), "followup_due": (sent_at.date() + timedelta(days=args.followup_days)).isoformat(), "followup_draft": "", "send_method": "github-actions-gmail-smtp"})
        save_state(state_path, state)
        sent += 1
        print(f"Sent {item['id']} to {item['contact_email']} from {username}")
    print(f"Completed: {sent} message(s) sent.")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--targets", default=str(TARGETS_PATH))
    p.add_argument("--state", default=str(DEFAULT_STATE_PATH))
    p.add_argument("--profile", required=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--daily-cap", type=int, default=10)
    p.add_argument("--followup-days", type=int, default=5)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--check-credentials", action="store_true", help="Verify Gmail login without sending email")
    return p


if __name__ == "__main__":
    raise SystemExit(main(parser().parse_args()))
