from __future__ import annotations

import logging

from api.core.structured_logging import JsonLogFormatter, SingleLineMessageFilter


def test_single_line_message_filter_escapes_log_forging_characters() -> None:
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="user=%s",
        args=("alice\nlevel=ERROR\rforged",),
        exc_info=None,
    )

    assert SingleLineMessageFilter().filter(record) is True
    assert record.getMessage() == "user=alice\\nlevel=ERROR\\rforged"
    assert "\\nlevel=ERROR" in JsonLogFormatter().format(record)
