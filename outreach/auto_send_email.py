#!/usr/bin/env python3
"""Send outreach with the CV attached from the configured Gmail account.

This is intentionally limited to public company email addresses. It sends no
the CV attached to every email, observes the Riyadh send window, caps daily
volume, and records every successful handoff in the local outreach state.
"""

from __future__ import annotations

import argparse
import subprocess
from datetime import date, datetime, timedelta
from pathlib import Path

from prepare_outreach import (
    DEFAULT_STATE_PATH,
    DEFAULT_OUTPUT_DIR,
    TARGETS_PATH,
    build_email_body,
    load_state,
    parse_profile,
    read_targets,
    save_state,
)


ALLOWED_WEEKDAYS = {6, 0, 1, 2, 3}  # Sunday through Thursday
WINDOW_START_HOUR = 10
WINDOW_END_HOUR = 11
DEFAULT_DAILY_CAP = 10


def within_window(now: datetime) -> bool:
    return now.weekday() in ALLOWED_WEEKDAYS and WINDOW_START_HOUR <= now.hour < WINDOW_END_HOUR


def send_via_mail(target: dict[str, str], profile: dict[str, str]) -> None:
    recipient = target["contact_email"].strip().lower()
    subject = f"Application — {target['role_lane']} — {profile['name']}"
    body = build_email_body(target, profile)
    resume_path = str(Path(profile["resume"]).expanduser().resolve())
    script = r'''on run argv
    set recipientAddress to item 1 of argv
    set subjectLine to item 2 of argv
    set messageContent to item 3 of argv
    set resumePath to item 4 of argv
    tell application "Mail"
        set newMessage to make new outgoing message with properties {subject:subjectLine, content:messageContent, visible:false, sender:"AbdullahFageeh@gmail.com"}
        tell newMessage
            make new to recipient at end of to recipients with properties {address:recipientAddress}
            make new attachment with properties {file name:(POSIX file resumePath as alias)} at after the last paragraph
        end tell
        send newMessage
    end tell
end run'''
    subprocess.run(["osascript", "-e", script, "--", recipient, subject, body, resume_path], check=True)


def send_batch(args: argparse.Namespace) -> int:
    now = datetime.now().astimezone()
    if not within_window(now) and not args.force:
        print("Deferred: outside the allowed Sunday–Thursday 10:00–11:00 Riyadh send window.")
        return 0

    profile = parse_profile(Path(args.profile).expanduser().resolve())
    targets = {row["id"]: row for row in read_targets(Path(args.targets).expanduser().resolve())}
    state_path = Path(args.state).expanduser().resolve()
    state = load_state(state_path)
    today = date.today().isoformat()
    sent_today = sum(1 for item in state.values() if item.get("status") == "sent" and str(item.get("sent_at", "")).startswith(today))
    remaining = max(0, args.daily_cap - sent_today)
    if remaining == 0:
        print(f"Daily cap reached ({args.daily_cap}); no messages sent.")
        return 0

    candidates = [
        item
        for item in state.values()
        if item.get("status") == "drafted" and item.get("contact_email") and item.get("id") in targets
    ][: min(args.limit, remaining)]
    if args.dry_run:
        print("Would send:")
        for item in candidates:
            print(f"- {item['id']} -> {item['contact_email']}")
        return 0

    sent = 0
    for item in candidates:
        target = targets[item["id"]]
        try:
            send_via_mail(target, profile)
        except subprocess.CalledProcessError as exc:
            print(f"Stopped after {sent} message(s); Mail reported an error for {item['id']}: {exc}")
            break
        now_sent = datetime.now().astimezone()
        item.update(
            {
                "status": "sent",
                "sent_at": now_sent.isoformat(timespec="seconds"),
                "followup_due": (now_sent.date() + timedelta(days=args.followup_days)).isoformat(),
                "followup_draft": "",
                "send_method": "mail-automation",
            }
        )
        sent += 1
        save_state(state_path, state)
        print(f"Sent {item['id']} to {item['contact_email']} from AbdullahFageeh@gmail.com")
    print(f"Completed: {sent} message(s) sent.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", default=str(TARGETS_PATH))
    parser.add_argument("--state", default=str(DEFAULT_STATE_PATH))
    parser.add_argument("--profile", default=str(Path(__file__).resolve().parents[1] / "APPLICATION_REFERENCE.md"))
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--daily-cap", type=int, default=DEFAULT_DAILY_CAP)
    parser.add_argument("--followup-days", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Bypass the time window for a deliberate manual run")
    return parser


if __name__ == "__main__":
    raise SystemExit(send_batch(build_parser().parse_args()))
