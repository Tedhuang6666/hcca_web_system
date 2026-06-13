"""Structured logging and request correlation helpers."""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime
from logging.config import dictConfig
from typing import Any

from api.core.config import settings

_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
_configured = False


def set_request_id(value: str | None) -> contextvars.Token[str | None]:
    return _request_id.set(value)


def reset_request_id(token: contextvars.Token[str | None]) -> None:
    _request_id.reset(token)


def get_request_id() -> str | None:
    return _request_id.get()


class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or "-"
        record.environment = settings.ENVIRONMENT
        return True


class SingleLineMessageFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = record.getMessage().replace("\r", "\\r").replace("\n", "\\n")
        record.args = ()
        return True


class JsonLogFormatter(logging.Formatter):
    _reserved = frozenset(
        {
            "args",
            "asctime",
            "created",
            "exc_info",
            "exc_text",
            "filename",
            "funcName",
            "levelname",
            "levelno",
            "lineno",
            "module",
            "msecs",
            "message",
            "msg",
            "name",
            "pathname",
            "process",
            "processName",
            "relativeCreated",
            "stack_info",
            "thread",
            "threadName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
            "environment": getattr(record, "environment", settings.ENVIRONMENT),
        }
        for key, value in record.__dict__.items():
            if key.startswith("_") or key in self._reserved or key in payload:
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except TypeError:
                payload[key] = str(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging() -> None:
    """Configure process logging once.

    LOG_FORMAT=json 用於 production（給 Grafana/ELK 食用）。
    LOG_FORMAT=text 用於 dev：短時間戳 + level + path → 一行可讀。
    uvicorn.access 一律靜音；access log 由 _request_timing_middleware 提供
    （內含 db_queries / duration_ms 等附加欄位）。
    """
    global _configured
    if _configured:
        return

    fmt = settings.LOG_FORMAT.lower()
    formatter: dict[str, Any]
    if fmt == "json":
        formatter = {"()": "api.core.structured_logging.JsonLogFormatter"}
    else:
        formatter = {
            "format": "%(asctime)s %(levelname)-5s %(name)s: %(message)s",
            "datefmt": "%H:%M:%S",
        }

    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "single_line": {"()": "api.core.structured_logging.SingleLineMessageFilter"},
                "request_context": {"()": "api.core.structured_logging.RequestContextFilter"},
            },
            "formatters": {"default": formatter},
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "stream": sys.stdout,
                    "formatter": "default",
                    "filters": ["single_line", "request_context"],
                }
            },
            "root": {
                "handlers": ["default"],
                "level": settings.LOG_LEVEL.upper(),
            },
            "loggers": {
                # uvicorn 自帶的 access log 與我們的 middleware 重複，靜音之
                "uvicorn.access": {"handlers": [], "level": "WARNING", "propagate": False},
                # SQLAlchemy ECHO 由 SQL_ECHO 控制，避免被 root INFO 灌爆
                "sqlalchemy.engine": {"level": "WARNING", "propagate": True},
                # PostHog 未設 personal_api_key 的反覆 warning，dev 噪音
                "posthog": {"level": "ERROR", "propagate": True},
            },
        }
    )
    _configured = True


__all__ = [
    "JsonLogFormatter",
    "RequestContextFilter",
    "SingleLineMessageFilter",
    "configure_logging",
    "get_request_id",
    "reset_request_id",
    "set_request_id",
]
