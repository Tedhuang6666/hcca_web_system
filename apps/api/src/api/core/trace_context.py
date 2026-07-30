"""Request trace context helpers.

The platform accepts a W3C ``traceparent`` trace id when one is supplied by an
upstream proxy or OpenTelemetry.  Otherwise it creates a safe, opaque id for
the lifetime of the request.  This module deliberately stores correlation
data only; it is never used for authentication or authorization.
"""

from __future__ import annotations

import re
import secrets
from contextvars import ContextVar, Token

TRACE_ID_HEADER = "X-Trace-ID"
TRACEPARENT_HEADER = "traceparent"
_TRACE_ID_RE = re.compile(r"^[0-9a-fA-F]{32}$")
_TRACEPARENT_RE = re.compile(r"^[0-9a-fA-F]{2}-([0-9a-fA-F]{32})-[0-9a-fA-F]{16}-[0-9a-fA-F]{2}$")
_trace_id: ContextVar[str | None] = ContextVar("trace_id", default=None)


def normalize_trace_id(value: str | None) -> str:
    """Return a valid W3C trace id, or create a new opaque one."""
    if value:
        candidate = value.strip()
        traceparent = _TRACEPARENT_RE.fullmatch(candidate)
        if traceparent:
            candidate = traceparent.group(1)
        if _TRACE_ID_RE.fullmatch(candidate) and set(candidate) != {"0"}:
            return candidate.lower()
    return secrets.token_hex(16)


def set_trace_id(value: str | None) -> Token[str | None]:
    return _trace_id.set(value)


def reset_trace_id(token: Token[str | None]) -> None:
    _trace_id.reset(token)


def get_trace_id() -> str | None:
    return _trace_id.get()


__all__ = [
    "TRACE_ID_HEADER",
    "TRACEPARENT_HEADER",
    "get_trace_id",
    "normalize_trace_id",
    "reset_trace_id",
    "set_trace_id",
]
