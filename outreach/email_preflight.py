#!/usr/bin/env python3
"""Conservative email checks for the outreach workflow.

The check confirms address syntax and that the domain is configured to receive
mail. It intentionally does not probe a recipient mailbox over SMTP because
many mail servers hide or misreport mailbox existence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Callable

try:
    from email_validator import (
        EmailNotValidError,
        EmailSyntaxError,
        EmailUndeliverableError,
        caching_resolver,
        validate_email,
    )
except ImportError:  # The GitHub workflow installs outreach/requirements.txt.
    EmailNotValidError = ValueError
    EmailSyntaxError = ValueError
    EmailUndeliverableError = ValueError
    caching_resolver = None
    validate_email = None


@dataclass(frozen=True)
class EmailPreflightResult:
    status: str
    normalized: str
    reason: str
    mx_hosts: tuple[str, ...] = ()

    def state_fields(self) -> dict[str, Any]:
        fields = asdict(self)
        fields["mx_hosts"] = list(self.mx_hosts)
        return {
            "email_validation_status": fields["status"],
            "email_validation_reason": fields["reason"],
            "email_validation_mx_hosts": fields["mx_hosts"],
            "email_validated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }


def _default_resolver() -> Any:
    return caching_resolver(timeout=6) if caching_resolver else None


def validate_recipient(
    address: str,
    *,
    validator: Callable[..., Any] | None = None,
    resolver: Any = None,
) -> EmailPreflightResult:
    """Return valid, invalid, or unknown without sending an email."""
    candidate = address.strip().lower()
    if not candidate:
        return EmailPreflightResult("invalid", "", "Email address is empty.")

    validator = validator or validate_email
    if validator is None:
        return EmailPreflightResult(
            "unknown",
            candidate,
            "email-validator is not installed; install outreach/requirements.txt.",
        )

    try:
        result = validator(
            candidate,
            check_deliverability=True,
            dns_resolver=resolver if resolver is not None else _default_resolver(),
        )
    except EmailSyntaxError as exc:
        return EmailPreflightResult("invalid", candidate, f"Invalid address syntax: {exc}")
    except EmailUndeliverableError as exc:
        return EmailPreflightResult("invalid", candidate, f"Domain cannot receive email: {exc}")
    except EmailNotValidError as exc:
        return EmailPreflightResult("invalid", candidate, str(exc))
    except Exception as exc:  # DNS timeouts and temporary resolver failures retry later.
        return EmailPreflightResult("unknown", candidate, f"Validation could not finish: {exc}")

    normalized = getattr(result, "normalized", candidate)
    mx_records = getattr(result, "mx", None)
    fallback = getattr(result, "mx_fallback_type", None)
    if mx_records is None and fallback is None:
        return EmailPreflightResult(
            "unknown",
            normalized,
            "The domain check was inconclusive; retry on the next workflow run.",
        )

    if fallback:
        return EmailPreflightResult(
            "unknown",
            normalized,
            f"The domain has no MX record and only uses {fallback} fallback; manual review is required.",
        )

    mx_hosts = tuple(str(record[1]).rstrip(".") for record in (mx_records or ()))
    return EmailPreflightResult("valid", normalized, "Domain has explicit MX mail routing.", mx_hosts)
