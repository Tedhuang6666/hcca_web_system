"""Query Performance Monitoring - Track slow database queries and service calls"""

import logging
import time
from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Thresholds (milliseconds)
SLOW_QUERY_THRESHOLD = 100  # Log queries taking >100ms
SLOW_SERVICE_THRESHOLD = 500  # Log service calls taking >500ms


def monitor_query(threshold_ms: int = SLOW_QUERY_THRESHOLD) -> Callable:
    """
    Decorator to monitor async database query performance.
    Logs queries exceeding the threshold.

    Usage:
        @monitor_query()
        async def list_documents(...):
            ...
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            try:
                result = await func(*args, **kwargs)
                return result
            finally:
                elapsed_ms = (time.perf_counter() - start) * 1000
                if elapsed_ms > threshold_ms:
                    logger.warning(
                        f"Slow query: {func.__name__} took {elapsed_ms:.1f}ms",
                        extra={
                            "duration_ms": elapsed_ms,
                            "function": func.__name__,
                        },
                    )

        return wrapper

    return decorator


def monitor_service(threshold_ms: int = SLOW_SERVICE_THRESHOLD) -> Callable:
    """
    Decorator to monitor async service method performance.
    Logs methods exceeding the threshold.

    Usage:
        @monitor_service()
        async def create_document(...):
            ...
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            try:
                result = await func(*args, **kwargs)
                return result
            finally:
                elapsed_ms = (time.perf_counter() - start) * 1000
                if elapsed_ms > threshold_ms:
                    logger.info(
                        f"Slow service call: {func.__name__} took {elapsed_ms:.1f}ms",
                        extra={
                            "duration_ms": elapsed_ms,
                            "function": func.__name__,
                        },
                    )

        return wrapper

    return decorator
