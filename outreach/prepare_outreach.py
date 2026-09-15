#!/usr/bin/env python3
"""Prepare a supervised Saudi outreach queue from verified public company contacts.

This tool creates drafts and follow-up reminders. It deliberately has no send
command. Email and WhatsApp messages are external actions and stay reviewable.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
TARGETS_PATH = ROOT / "outreach" / "targets.csv"
DEFAULT_STATE_PATH = ROOT / "artifacts" / "outreach" / "state.json"
DEFAULT_OUTPUT_DIR = ROOT / "artifacts" / "outreach"
DEFAULT_EMAIL_DIR = DEFAULT_OUTPUT_DIR / "email_drafts"
DEFAULT_MESSAGE_DIR = DEFAULT_OUTPUT_DIR / "messages"


def parse_profile(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(f"Profile not found: {path}. Create APPLICATION_REFERENCE.md first.")
    text = path.read_text(encoding="utf-8")

    def value(label: str) -> str:
        match = re.search(rf"^- {re.escape(label)}:\s*(.+)$", text, re.MULTILINE)
        return match.group(1).strip() if match else ""

    resume = value("Master CV PDF")
    return {
        "name": value("Full legal name") or value("Preferred display name"),
        "email": value("Email"),
        "phone": value("Phone"),
        "city": value("Current city"),
        "headline": value("Default headline"),
        "resume": resume,
    }


def read_targets(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return [row for row in csv.DictReader(handle) if row.get("enabled", "").lower() == "yes"]


def load_state(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid state file {path}: {exc}") from exc
    return value if isinstance(value, dict) else {}


def save_state(path: Path, state: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean_email(value: str) -> str:
    return value.strip().lower()


def build_email_body(target: dict[str, str], profile: dict[str, str]) -> str:
    company = target["company"]
    location = target["city_or_region"]
    lane = target["role_lane"]
    return f"""Hello {company} team,

I’m {profile['name']}, based in {profile['city']}. I work in event operations and project coordination, and I’m interested in {lane.lower()} opportunities with {company}.

My experience includes coordinating venue builds across six venues, tracking schedules and suppliers, and supporting site updates, paperwork, and change requests. One major delivery finished 20% ahead of schedule.

I have attached my CV in case my background could be useful for a current or upcoming project in {location}. I would appreciate the opportunity to be considered.

Thank you for your time.

Best regards,
{profile['name']}
{profile['phone']} | {profile['email']}
"""


def build_whatsapp_body(target: dict[str, str], profile: dict[str, str]) -> str:
    return (
        f"Hello {target['company']} team, I’m {profile['name']}, an event operations and "
        f"installation manager based in {profile['city']}. I’m available for {target['role_lane'].lower()} "
        "work across Saudi Arabia. My experience includes six-venue overlay builds, supplier coordination, "
        "safety controls, and delivery ahead of schedule. May I send my CV for current or upcoming opportunities? "
        f"Thank you — {profile['phone']}"
    )


def build_followup_body(target: dict[str, str], profile: dict[str, str], sent_at: str) -> str:
    sent_date = sent_at[:10]
    return f"""Hello {target['company']} team,

I’m following up on the CV I sent on {sent_date} regarding {target['role_lane'].lower()} opportunities. I know your team may be busy, but I would be grateful to be considered if a suitable current or upcoming project comes up.

Thank you,
{profile['name']} | {profile['phone']} | {profile['email']}
"""


def write_email_draft(path: Path, target: dict[str, str], profile: dict[str, str], body: str) -> None:
    message = EmailMessage()
    message["Date"] = formatdate(localtime=True)
    message["To"] = clean_email(target["contact_email"])
    message["Subject"] = f"Application — {target['role_lane']} — {profile['name']}"
    message.set_content(body)
    resume = Path(profile.get("resume", "")).expanduser()
    if resume.is_file():
        message.add_attachment(resume.read_bytes(), maintype="application", subtype="pdf", filename=resume.name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(message.as_bytes())


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def prepare(args: argparse.Namespace) -> int:
    profile = parse_profile(Path(args.profile).expanduser().resolve())
    targets = read_targets(Path(args.targets).expanduser().resolve())
    state = load_state(Path(args.state).expanduser().resolve())
    email_dir = Path(args.email_dir).expanduser().resolve()
    message_dir = Path(args.message_dir).expanduser().resolve()
    selected = targets[: args.limit]
    generated: list[dict[str, str]] = []

    for target in selected:
        key = target["id"]
        previous = state.get(key, {})
        entry = {**target, **previous}
        body = build_email_body(target, profile)
        email_path = ""
        if target.get("contact_email"):
            email_path_obj = email_dir / f"{key}.eml"
            write_email_draft(email_path_obj, target, profile, body)
            email_path = str(email_path_obj)
        message_path_obj = message_dir / f"{key}.txt"
        whatsapp_body = build_whatsapp_body(target, profile)
        career_note = f"\nApply/contact page: {target['source_url']}\n" if not target.get("contact_email") else ""
        write_text(message_path_obj, whatsapp_body + career_note)
        wa_link = ""
        if target.get("whatsapp"):
            wa_link = f"https://wa.me/{re.sub(r'[^0-9]', '', target['whatsapp'])}?text={quote(whatsapp_body)}"
        entry.update(
            {
                "status": previous.get("status", "drafted"),
                "email_draft": email_path,
                "message_draft": str(message_path_obj),
                "whatsapp_link": wa_link,
                "prepared_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
        )
        state[key] = entry
        generated.append(entry)

    state_path = Path(args.state).expanduser().resolve()
    save_state(state_path, state)
    dashboard = Path(args.dashboard).expanduser().resolve()
    dashboard.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Outreach review queue",
        "",
        f"Prepared: {datetime.now().astimezone().isoformat(timespec='minutes')}",
        "",
        "Each email draft includes the CV attachment. The tool does not send email or WhatsApp messages.",
        "",
        "| Priority | Company | Lane | Email / page | WhatsApp | Status |",
        "|---|---|---|---|---|---|",
    ]
    for item in generated:
        email_or_page = item.get("contact_email") or item.get("source_url", "")
        whatsapp = f"[open]({item['whatsapp_link']})" if item.get("whatsapp_link") else "—"
        lines.append(
            f"| {item['priority']} | {item['company']} | {item['role_lane']} | "
            f"[{email_or_page}]({item.get('email_draft') or item.get('source_url')}) | {whatsapp} | {item.get('status', 'drafted')} |"
        )
    dashboard.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Prepared {len(generated)} target(s).")
    print(f"Review queue: {dashboard}")
    print(f"State: {state_path}")
    print("No messages were sent.")
    return 0


def followups(args: argparse.Namespace) -> int:
    profile = parse_profile(Path(args.profile).expanduser().resolve())
    targets = {row["id"]: row for row in read_targets(Path(args.targets).expanduser().resolve())}
    state_path = Path(args.state).expanduser().resolve()
    state = load_state(state_path)
    today = date.today()
    created = 0
    for key, entry in state.items():
        if entry.get("status") != "sent" or not entry.get("followup_due"):
            continue
        try:
            due = date.fromisoformat(entry["followup_due"])
        except ValueError:
            continue
        if due > today or entry.get("followup_draft"):
            continue
        target = targets.get(key, entry)
        path = Path(args.followup_dir).expanduser().resolve() / f"{key}-followup.txt"
        write_text(path, build_followup_body(target, profile, entry.get("sent_at", "")))
        entry["followup_draft"] = str(path)
        entry["status"] = "followup_due"
        created += 1
    save_state(state_path, state)
    print(f"Created {created} follow-up draft(s). No messages were sent.")
    return 0


def mark_sent(args: argparse.Namespace) -> int:
    state_path = Path(args.state).expanduser().resolve()
    state = load_state(state_path)
    if args.id not in state:
        raise SystemExit(f"Unknown target id: {args.id}")
    now = datetime.now().astimezone()
    entry = state[args.id]
    entry.update(
        {
            "status": "sent",
            "sent_at": now.isoformat(timespec="seconds"),
            "followup_due": (now.date() + timedelta(days=args.followup_days)).isoformat(),
            "followup_draft": "",
        }
    )
    save_state(state_path, state)
    print(f"Recorded {args.id} as sent on {now.date().isoformat()}. No message was sent by this command.")
    return 0


def mark_skipped(args: argparse.Namespace) -> int:
    state_path = Path(args.state).expanduser().resolve()
    state = load_state(state_path)
    if args.id not in state:
        raise SystemExit(f"Unknown target id: {args.id}")
    state[args.id].update({"status": "skipped", "skipped_at": datetime.now().astimezone().isoformat(timespec="seconds")})
    save_state(state_path, state)
    print(f"Marked {args.id} as skipped.")
    return 0


def show_status(args: argparse.Namespace) -> int:
    state = load_state(Path(args.state).expanduser().resolve())
    counts: dict[str, int] = {}
    for entry in state.values():
        status = entry.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({"total": len(state), "by_status": counts}, indent=2))
    return 0


def open_drafts(args: argparse.Namespace) -> int:
    state = load_state(Path(args.state).expanduser().resolve())
    profile = parse_profile(Path(args.profile).expanduser().resolve()) if args.mail else None
    targets = {row["id"]: row for row in read_targets(Path(args.targets).expanduser().resolve())} if args.mail else {}
    entries = [
        entry
        for entry in state.values()
        if entry.get("email_draft") and entry.get("status", "drafted") == "drafted"
    ][: args.limit]
    if not entries:
        print("No email drafts found.")
        return 0
    if not args.mail:
        print("Drafts ready for review:")
        print("\n".join(entry["email_draft"] for entry in entries))
        print("Use --mail to open them in Apple Mail. Opening does not send.")
        return 0
    opened = 0
    for entry in entries:
        target = targets.get(entry["id"], entry)
        if compose_in_mail(target, profile):
            opened += 1
    print(f"Opened {opened} compose window(s) in Apple Mail. Nothing was sent.")
    return 0


def compose_in_mail(target: dict[str, str], profile: dict[str, str]) -> bool:
    """Create a visible Mail compose window without sending it."""
    recipient = clean_email(target.get("contact_email", ""))
    if not recipient:
        return False
    subject = f"Application — {target['role_lane']} — {profile['name']}"
    body = build_email_body(target, profile)
    resume_path = str(Path(profile.get("resume", "")).expanduser().resolve())
    script = r'''on run argv
    set recipientAddress to item 1 of argv
    set subjectLine to item 2 of argv
    set messageContent to item 3 of argv
    set resumePath to item 4 of argv
    tell application "Mail"
        set newMessage to make new outgoing message with properties {subject:subjectLine, content:messageContent, visible:true, sender:"AbdullahFageeh@gmail.com"}
        tell newMessage
            make new to recipient at end of to recipients with properties {address:recipientAddress}
            make new attachment with properties {file name:(POSIX file resumePath as alias)} at after the last paragraph
        end tell
    end tell
end run'''
    subprocess.run(["osascript", "-e", script, "--", recipient, subject, body, resume_path], check=True)
    return True


def run_all(args: argparse.Namespace) -> int:
    """Run the unattended local preparation pass: new drafts, then due follow-ups."""
    prepare(args)
    followups(args)
    return 0


def parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--targets", default=str(TARGETS_PATH))
    common.add_argument("--state", default=str(DEFAULT_STATE_PATH))
    common.add_argument("--profile", default=str(ROOT / "APPLICATION_REFERENCE.md"))
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    prepare_parser = sub.add_parser("prepare", parents=[common])
    prepare_parser.add_argument("--limit", type=int, default=20)
    prepare_parser.add_argument("--email-dir", default=str(DEFAULT_EMAIL_DIR))
    prepare_parser.add_argument("--message-dir", default=str(DEFAULT_MESSAGE_DIR))
    prepare_parser.add_argument("--dashboard", default=str(DEFAULT_OUTPUT_DIR / "review_queue.md"))
    prepare_parser.set_defaults(func=prepare)

    run_parser = sub.add_parser("run", parents=[common])
    run_parser.add_argument("--limit", type=int, default=20)
    run_parser.add_argument("--email-dir", default=str(DEFAULT_EMAIL_DIR))
    run_parser.add_argument("--message-dir", default=str(DEFAULT_MESSAGE_DIR))
    run_parser.add_argument("--dashboard", default=str(DEFAULT_OUTPUT_DIR / "review_queue.md"))
    run_parser.add_argument("--followup-dir", default=str(DEFAULT_MESSAGE_DIR))
    run_parser.set_defaults(func=run_all)

    follow_parser = sub.add_parser("followups", parents=[common])
    follow_parser.add_argument("--followup-dir", default=str(DEFAULT_MESSAGE_DIR))
    follow_parser.set_defaults(func=followups)

    sent_parser = sub.add_parser("mark-sent", parents=[common])
    sent_parser.add_argument("--id", required=True)
    sent_parser.add_argument("--followup-days", type=int, default=5)
    sent_parser.set_defaults(func=mark_sent)

    skipped_parser = sub.add_parser("mark-skipped", parents=[common])
    skipped_parser.add_argument("--id", required=True)
    skipped_parser.set_defaults(func=mark_skipped)

    status_parser = sub.add_parser("status", parents=[common])
    status_parser.set_defaults(func=show_status)

    open_parser = sub.add_parser("open-drafts", parents=[common])
    open_parser.add_argument("--limit", type=int, default=5)
    open_parser.add_argument("--mail", action="store_true")
    open_parser.set_defaults(func=open_drafts)
    return p


if __name__ == "__main__":
    args = parser().parse_args()
    raise SystemExit(args.func(args))
