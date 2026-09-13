#!/usr/bin/env python3
"""Read Gmail delivery reports and stop unsafe outreach follow-ups."""

from __future__ import annotations

import argparse
import imaplib
import os
import re
from datetime import date, datetime, timedelta
from email import policy
from email.message import Message
from email.parser import BytesParser
from pathlib import Path

from prepare_outreach import DEFAULT_STATE_PATH, load_state, save_state


FINAL_RECIPIENT_RE = re.compile(r"^Final-Recipient:\s*[^;]+;\s*(\S+)", re.IGNORECASE | re.MULTILINE)
ACTION_RE = re.compile(r"^Action:\s*(\S+)", re.IGNORECASE | re.MULTILINE)
STATUS_RE = re.compile(r"^Status:\s*([245]\.\d+\.\d+)", re.IGNORECASE | re.MULTILINE)
DIAGNOSTIC_RE = re.compile(r"^Diagnostic-Code:\s*(.+(?:\n[ \t].+)*)", re.IGNORECASE | re.MULTILINE)
WILL_RETRY_RE = re.compile(r"^Will-Retry-Until:\s*(.+)$", re.IGNORECASE | re.MULTILINE)


def _recipient(value: str) -> str:
    return value.split(";", 1)[-1].strip().strip("<>").lower()


def _report_from_headers(headers: Message) -> dict[str, str] | None:
    recipient = headers.get("Final-Recipient", "")
    if not recipient:
        return None
    return {
        "recipient": _recipient(recipient),
        "action": headers.get("Action", "").strip().lower(),
        "status": headers.get("Status", "").strip(),
        "diagnostic": " ".join(headers.get("Diagnostic-Code", "").split())[:500],
        "will_retry_until": headers.get("Will-Retry-Until", "").strip(),
    }


def _plain_text(message: Message) -> str:
    chunks: list[str] = []
    for part in message.walk():
        if part.get_content_type() != "text/plain":
            continue
        try:
            chunks.append(part.get_content())
        except (LookupError, UnicodeError):
            payload = part.get_payload(decode=True) or b""
            chunks.append(payload.decode("utf-8", errors="replace"))
    return "\n".join(chunks)


def extract_delivery_reports(message: Message) -> list[dict[str, str]]:
    reports: list[dict[str, str]] = []
    for part in message.walk():
        if part.get_content_type() != "message/delivery-status":
            continue
        payload = part.get_payload()
        if isinstance(payload, list):
            for block in payload:
                report = _report_from_headers(block)
                if report:
                    reports.append(report)
    if reports:
        return reports

    text = _plain_text(message)
    recipient = FINAL_RECIPIENT_RE.search(text)
    action = ACTION_RE.search(text)
    status = STATUS_RE.search(text)
    if not recipient or not (action or status):
        return []
    diagnostic = DIAGNOSTIC_RE.search(text)
    will_retry = WILL_RETRY_RE.search(text)
    return [
        {
            "recipient": recipient.group(1).strip().strip("<>").lower(),
            "action": action.group(1).lower() if action else "",
            "status": status.group(1) if status else "",
            "diagnostic": " ".join(diagnostic.group(1).split())[:500] if diagnostic else "",
            "will_retry_until": will_retry.group(1).strip() if will_retry else "",
        }
    ]


def apply_report(
    state: dict[str, dict],
    report: dict[str, str],
    *,
    message_id: str,
    observed_at: str,
) -> str | None:
    recipient = report["recipient"].lower()
    entry = next(
        (item for item in state.values() if item.get("contact_email", "").strip().lower() == recipient),
        None,
    )
    if entry is None:
        return None

    processed = list(entry.get("delivery_report_ids", []))
    if message_id and message_id in processed:
        return None
    if message_id:
        processed.append(message_id)
        processed = processed[-20:]

    action = report.get("action", "").lower()
    code = report.get("status", "")
    delayed = action == "delayed" or code.startswith("4.")
    failed = action == "failed" or code.startswith("5.")
    if not delayed and not failed:
        return None

    if entry.get("followup_due"):
        entry.setdefault("followup_due_before_delivery_hold", entry["followup_due"])
    entry.update(
        {
            "status": "delivery_delayed" if delayed else "bounced",
            "delivery_status": "delayed" if delayed else "failed",
            "delivery_status_code": code,
            "delivery_diagnostic": report.get("diagnostic", ""),
            "delivery_reported_at": observed_at,
            "delivery_report_ids": processed,
            "followup_due": "",
            "followup_draft": "",
        }
    )
    if report.get("will_retry_until"):
        entry["delivery_retry_until"] = report["will_retry_until"]
    return entry.get("id", recipient)


def fetch_delivery_messages(client: imaplib.IMAP4_SSL, days: int) -> list[bytes]:
    since = (date.today() - timedelta(days=days)).strftime("%d-%b-%Y")
    ids: set[bytes] = set()
    for subject in ("Delivery Status Notification", "Undeliverable"):
        status, data = client.search(None, "SINCE", since, "SUBJECT", f'"{subject}"')
        if status == "OK" and data:
            ids.update(data[0].split())
    messages: list[bytes] = []
    for message_id in sorted(ids, key=lambda value: int(value)):
        status, data = client.fetch(message_id, "(BODY.PEEK[])")
        if status != "OK":
            continue
        messages.extend(part[1] for part in data if isinstance(part, tuple))
    return messages


def main(args: argparse.Namespace) -> int:
    username = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not username or not password:
        raise SystemExit("GMAIL_USER and GMAIL_APP_PASSWORD secrets are required")

    state_path = Path(args.state).resolve()
    state = load_state(state_path)
    with imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=30) as client:
        client.login(username, password)
        client.select("INBOX", readonly=True)
        raw_messages = fetch_delivery_messages(client, args.days)

    changed: list[str] = []
    observed_at = datetime.now().astimezone().isoformat(timespec="seconds")
    for raw in raw_messages:
        message = BytesParser(policy=policy.default).parsebytes(raw)
        message_id = message.get("Message-ID", "").strip()
        for report in extract_delivery_reports(message):
            target_id = apply_report(
                state,
                report,
                message_id=message_id,
                observed_at=observed_at,
            )
            if target_id:
                changed.append(target_id)
    if changed:
        save_state(state_path, state)
    print(f"Delivery reports checked: {len(raw_messages)}; outreach records updated: {len(set(changed))}.")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", default=str(DEFAULT_STATE_PATH))
    p.add_argument("--days", type=int, default=14)
    return p


if __name__ == "__main__":
    raise SystemExit(main(parser().parse_args()))
