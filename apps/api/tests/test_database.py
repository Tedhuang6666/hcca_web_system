from __future__ import annotations

from api.core.database import _pgbouncer_connect_args


def test_pgbouncer_connect_args_disable_caches_and_use_unique_names() -> None:
    connect_args = _pgbouncer_connect_args()
    name_factory = connect_args["prepared_statement_name_func"]

    assert connect_args["statement_cache_size"] == 0
    assert connect_args["prepared_statement_cache_size"] == 0
    assert callable(name_factory)

    first_name = name_factory()
    second_name = name_factory()
    assert first_name.startswith("__asyncpg_")
    assert first_name.endswith("__")
    assert second_name.startswith("__asyncpg_")
    assert second_name.endswith("__")
    assert first_name != second_name
