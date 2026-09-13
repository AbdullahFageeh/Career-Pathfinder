from __future__ import annotations

import sys
import unittest
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))

from cloud_process_delivery_reports import apply_report, extract_delivery_reports
from email_preflight import validate_recipient


class EmailPreflightTests(unittest.TestCase):
    def test_valid_domain_is_allowed(self) -> None:
        result = validate_recipient(
            "Careers@Example.com",
            validator=lambda *_args, **_kwargs: SimpleNamespace(
                normalized="Careers@example.com",
                mx=[(10, "mx.example.com.")],
                mx_fallback_type=None,
            ),
            resolver=object(),
        )
        self.assertEqual(result.status, "valid")
        self.assertEqual(result.mx_hosts, ("mx.example.com",))

    def test_temporary_dns_result_is_deferred(self) -> None:
        result = validate_recipient(
            "careers@example.com",
            validator=lambda *_args, **_kwargs: SimpleNamespace(
                normalized="careers@example.com",
                mx=None,
                mx_fallback_type=None,
            ),
            resolver=object(),
        )
        self.assertEqual(result.status, "unknown")

    def test_domain_without_explicit_mx_is_deferred(self) -> None:
        result = validate_recipient(
            "careers@example.com",
            validator=lambda *_args, **_kwargs: SimpleNamespace(
                normalized="careers@example.com",
                mx=[(0, "example.com.")],
                mx_fallback_type="A",
            ),
            resolver=object(),
        )
        self.assertEqual(result.status, "unknown")
        self.assertIn("no MX record", result.reason)


class DeliveryReportTests(unittest.TestCase):
    def _message(self, action: str, status: str) -> bytes:
        return (
            "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\n"
            "Subject: Delivery Status Notification\n"
            "Message-ID: <delivery-test@example.com>\n"
            "MIME-Version: 1.0\n"
            "Content-Type: text/plain; charset=utf-8\n\n"
            "Final-Recipient: rfc822; careers@xora.sa\n"
            f"Action: {action}\n"
            f"Status: {status}\n"
            "Diagnostic-Code: smtp; recipient server timed out\n"
        ).encode()

    def test_delay_holds_followup(self) -> None:
        message = BytesParser(policy=policy.default).parsebytes(self._message("delayed", "4.4.1"))
        report = extract_delivery_reports(message)[0]
        state = {
            "xora": {
                "id": "xora",
                "contact_email": "careers@xora.sa",
                "status": "sent",
                "followup_due": "2026-09-18",
            }
        }
        changed = apply_report(state, report, message_id="dsn-1", observed_at="2026-09-13T12:00:00+03:00")
        self.assertEqual(changed, "xora")
        self.assertEqual(state["xora"]["status"], "delivery_delayed")
        self.assertEqual(state["xora"]["followup_due"], "")

    def test_failure_suppresses_future_email(self) -> None:
        message = BytesParser(policy=policy.default).parsebytes(self._message("failed", "5.1.1"))
        report = extract_delivery_reports(message)[0]
        state = {"xora": {"id": "xora", "contact_email": "careers@xora.sa", "status": "sent"}}
        apply_report(state, report, message_id="dsn-2", observed_at="2026-09-13T12:00:00+03:00")
        self.assertEqual(state["xora"]["status"], "bounced")


if __name__ == "__main__":
    unittest.main()
