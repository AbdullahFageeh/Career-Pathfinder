#!/usr/bin/env python3
from __future__ import annotations
import argparse
import glob
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PATTERN = str(ROOT / 'exported_eml_drafts' / '*.eml')
ALLOWED_WEEKDAYS = {6, 0, 1, 2, 3}  # Sunday through Thursday; Python Monday=0
WINDOW_START_HOUR = 10
WINDOW_END_HOUR = 11  # exclusive


def within_window(dt: datetime) -> bool:
    return dt.weekday() in ALLOWED_WEEKDAYS and WINDOW_START_HOUR <= dt.hour < WINDOW_END_HOUR


def next_window_start(dt: datetime) -> datetime:
    local = dt.replace(second=0, microsecond=0)
    for offset in range(0, 14):
        candidate_day = (local + timedelta(days=offset)).replace(hour=WINDOW_START_HOUR, minute=0)
        if candidate_day.weekday() not in ALLOWED_WEEKDAYS:
            continue
        if offset == 0 and local < candidate_day:
            return candidate_day
        if offset > 0:
            return candidate_day
    raise RuntimeError('Could not calculate the next allowed send window.')


def main() -> int:
    parser = argparse.ArgumentParser(description='Open Mail drafts only during the allowed send window.')
    parser.add_argument('--check-only', action='store_true', help='Only report whether sending is allowed right now.')
    parser.add_argument('paths', nargs='*', help='Optional .eml files to open. Defaults to the outreach draft folder.')
    args = parser.parse_args()

    now = datetime.now().astimezone()
    if not within_window(now):
        nxt = next_window_start(now)
        print('Blocked: outside the allowed send window.')
        print(f'Allowed days: Sunday to Thursday')
        print(f'Allowed time: 10:00-11:00 local time')
        print(f'Next allowed window starts: {nxt.strftime("%A %Y-%m-%d %H:%M %Z")}')
        return 1

    print(f'Allowed now: {now.strftime("%A %Y-%m-%d %H:%M %Z")}')
    if args.check_only:
        return 0

    files = args.paths or sorted(glob.glob(DEFAULT_PATTERN))
    if not files:
        print('No .eml drafts found to open.')
        return 0

    subprocess.run(['open', '-a', 'Mail', *files], check=True)
    print(f'Opened {len(files)} draft(s) in Mail.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
