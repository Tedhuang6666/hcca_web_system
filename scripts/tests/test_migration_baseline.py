"""Compare the immutable baseline with the archived chain on disposable PostgreSQL DBs."""

from __future__ import annotations

import io
import os
import re
import unittest
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Uuid, create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.schema import MetaData

API_ROOT = Path(__file__).resolve().parents[2] / "apps/api"


class MigrationBaselineTests(unittest.TestCase):
    def test_empty_baseline_matches_history_and_old_revision_can_upgrade(self) -> None:
        url = os.environ.get("TEST_DATABASE_URL", "")
        parsed = urlsplit(url)
        if not url:
            self.skipTest("Requires explicit local TEST_DATABASE_URL")
        self.assertEqual(parsed.scheme, "postgresql+asyncpg")
        self.assertIn(parsed.hostname, {"localhost", "127.0.0.1", "::1"})
        self.assertTrue(parsed.path.endswith("_test"))
        self.assertFalse(parsed.query or parsed.fragment)
        sync_url = make_url(url).set(drivername="postgresql+psycopg2")
        admin = create_engine(sync_url, isolation_level="AUTOCOMMIT")
        names = [f"{kind}_{uuid.uuid4().hex}_test" for kind in ("baseline", "history", "offline")]
        created = []
        engines = []
        try:
            with admin.connect() as connection:
                for name in names:
                    connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
                    created.append(name)
            for name in names:
                engines.append(create_engine(sync_url.set(database=name)))

            def migrate(engine, revision="head", *, baseline=False):
                config = Config(str(API_ROOT / "alembic.ini"))
                config.set_main_option("script_location", str(API_ROOT / "alembic"))
                config.attributes["bootstrap_baseline"] = baseline
                # 歷史 migration 含 CREATE INDEX CONCURRENTLY 的 autocommit_block，
                # 交易必須由 Alembic 管理，不能再包外部 engine.begin()。
                with engine.connect() as connection:
                    config.attributes["connection"] = connection
                    command.upgrade(config, revision)

            migrate(engines[0], baseline=True)
            migrate(engines[1], "20261115160000")
            with engines[1].begin() as connection:
                connection.exec_driver_sql(
                    "CREATE TABLE baseline_probe (value integer PRIMARY KEY)"
                )
                connection.exec_driver_sql("INSERT INTO baseline_probe VALUES (42)")
            migrate(engines[1])
            with engines[1].begin() as connection:
                self.assertEqual(connection.scalar(text("SELECT value FROM baseline_probe")), 42)
                connection.exec_driver_sql("DROP TABLE baseline_probe")

            output = io.StringIO()
            offline_config = Config(str(API_ROOT / "alembic.ini"), output_buffer=output)
            offline_config.set_main_option("script_location", str(API_ROOT / "alembic"))
            offline_config.attributes["bootstrap_baseline"] = True
            command.upgrade(offline_config, "head", sql=True)
            with engines[2].connect() as connection:
                connection.execution_options(no_parameters=True).exec_driver_sql(output.getvalue())

            def snapshot(engine):
                with engine.connect() as connection:
                    inspector = inspect(connection)
                    result = {}
                    for table in sorted(inspector.get_table_names()):
                        columns = inspector.get_columns(table)
                        result[table] = {
                            "columns": [
                                (
                                    c["name"],
                                    str(c["type"]),
                                    getattr(c["type"], "enums", None),
                                    c["nullable"],
                                    c["default"],
                                )
                                for c in columns
                            ],
                            "pk": inspector.get_pk_constraint(table),
                            "fk": sorted(
                                inspector.get_foreign_keys(table), key=lambda c: c["name"]
                            ),
                            "indexes": sorted(
                                inspector.get_indexes(table), key=lambda c: c["name"]
                            ),
                            "checks": sorted(
                                [
                                    {
                                        **check,
                                        "sqltext": re.sub(
                                            r"::(?:character varying|text)\b(?:\[\])?",
                                            "",
                                            check["sqltext"],
                                        ),
                                    }
                                    for check in inspector.get_check_constraints(table)
                                ],
                                key=lambda c: c["name"],
                            ),
                            "unique": sorted(
                                inspector.get_unique_constraints(table), key=lambda c: c["name"]
                            ),
                        }
                        metadata = MetaData()
                        metadata.reflect(connection, only=[table])
                        definition = metadata.tables[table]
                        stable = [
                            column
                            for column in definition.columns
                            if not isinstance(column.type, (Uuid, DateTime))
                        ]
                        rows = connection.execute(select(*stable)).all() if stable else []
                        result[table]["seed_rows"] = sorted(repr(tuple(row)) for row in rows)
                    result["sequences"] = sorted(inspector.get_sequence_names())
                    result["triggers"] = (
                        connection.execute(
                            text(
                                "SELECT pg_get_triggerdef(oid) FROM pg_trigger "
                                "WHERE NOT tgisinternal ORDER BY pg_get_triggerdef(oid)"
                            )
                        )
                        .scalars()
                        .all()
                    )
                    return result

            baseline, history = snapshot(engines[0]), snapshot(engines[1])
            differences = []
            for table in sorted(set(baseline) | set(history)):
                if table not in baseline or table not in history:
                    differences.append(f"Missing object: {table}")
                elif baseline[table] != history[table]:
                    if isinstance(baseline[table], dict):
                        for key in baseline[table]:
                            if baseline[table][key] != history[table][key]:
                                differences.append(
                                    f"{table}.{key}: {baseline[table][key]!r} != {history[table][key]!r}"
                                )
                    else:
                        differences.append(f"{table}: {baseline[table]!r} != {history[table]!r}")
            self.assertFalse(differences, "\n".join(differences)[:8000])
            self.assertTrue(
                baseline == snapshot(engines[2]), "Offline SQL differs from online baseline"
            )
            self.assertFalse(
                any(
                    name.startswith(("meal_", "menu_"))
                    for name in inspect(engines[0]).get_table_names()
                )
            )
        finally:
            for engine in engines:
                engine.dispose()
            with admin.connect() as connection:
                for name in created:
                    connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
            admin.dispose()


if __name__ == "__main__":
    unittest.main()
