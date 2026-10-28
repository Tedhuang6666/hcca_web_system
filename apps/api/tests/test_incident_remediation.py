"""Regression coverage for failures identified in the October incident report."""

import asyncio
import contextlib
import os
from types import SimpleNamespace
from uuid import uuid4

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.core import celery_app as celery_module
from api.core.database import Base, advisory_xact_lock
from api.models.observability import PageSpeedRun
from api.models.school_class import ClassRosterEntry, ClassStudentRange, SchoolClass
from api.models.shop import Product, ProductCategory
from api.models.system_incident import SystemIncidentEvent
from api.models.user import User
from api.services import incident_tasks, observability
from api.services.audit_chain import AUDIT_CHAIN_LOCK_KEY
from api.services.school_class import prepare_roster_order_recipient


def test_celery_failure_persists_formatted_traceback(monkeypatch):
    received = []
    monkeypatch.setattr("api.core.error_audit.record_background_error", lambda **kw: None)
    monkeypatch.setattr(celery_module, "_push_dead_letter", lambda payload: None)
    monkeypatch.setattr(
        "api.services.incident_tasks.persist_background_incident.delay",
        lambda **kw: received.append(kw),
    )
    try:
        raise RuntimeError("specific failing operation")
    except RuntimeError as exc:
        celery_module._record_task_failure(
            sender=SimpleNamespace(name="test.task", request=None),
            task_id="task-1",
            exception=exc,
            traceback=exc.__traceback__,
        )
    assert "test_celery_failure_persists_formatted_traceback" in received[0]["traceback_text"]
    assert "RuntimeError: specific failing operation" in received[0]["traceback_text"]
    assert "<traceback object" not in received[0]["traceback_text"]


async def test_background_traceback_survives_database_persistence(db_session, monkeypatch):
    @contextlib.asynccontextmanager
    async def task_session():
        yield db_session

    monkeypatch.setattr(incident_tasks, "task_session", task_session)
    await incident_tasks._persist_background_incident(
        task_name="test.long_traceback",
        task_id="long-traceback-1",
        exception_type="RuntimeError",
        message="specific root cause",
        traceback_text="middleware frame\n" * 1000 + "RuntimeError: specific root cause",
        trace_id=None,
    )
    event = await db_session.scalar(select(SystemIncidentEvent))
    assert len(event.details["traceback_head"]) == 6000
    assert event.details["traceback_head"].endswith("RuntimeError: specific root cause")


async def test_pagespeed_deadline_preserves_finished_results(db_session, monkeypatch):
    monkeypatch.setattr(observability.settings, "GOOGLE_PAGESPEED_API_KEY", "test-key")

    async def discover():
        return ["https://example.test/"], {"routes": []}

    async def provider(request):
        if request.url.params["strategy"] == "desktop":
            await asyncio.Event().wait()
        return httpx.Response(
            200,
            json={
                "lighthouseResult": {
                    "categories": {"performance": {"score": 0.9}},
                    "audits": {},
                }
            },
        )

    client_class = httpx.AsyncClient
    monkeypatch.setattr(observability, "discover_observability_urls", discover)
    monkeypatch.setattr(
        observability.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(provider)),
    )
    result = await observability.collect_pagespeed(db_session, collection_timeout=0.05)
    assert result["created"] == 1
    assert result["failed"] == 1
    rows = list(await db_session.scalars(select(PageSpeedRun)))
    assert len(rows) == 2
    assert next(row for row in rows if row.strategy == "mobile").status == "ok"
    assert next(row for row in rows if row.strategy == "desktop").error_message == (
        "collection_deadline_exceeded"
    )


async def test_roster_pre_registration_cannot_deadlock_product_and_audit_locks():
    """Use two real PostgreSQL transactions to reproduce the reported lock inversion."""
    schema = f"incident_lock_{uuid4().hex}"
    database_url = os.environ["TEST_DATABASE_URL"]
    control = create_async_engine(database_url)
    engine = create_async_engine(
        database_url,
        connect_args={
            "server_settings": {"search_path": schema},
        },
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    roster_task = None
    try:
        async with control.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as seed:
            actor = User(email="cadre@example.test", display_name="幹部", is_superuser=True)
            seed.add(actor)
            await seed.flush()
            school_class = SchoolClass(academic_year=115, class_code="115", created_by=actor.id)
            category = ProductCategory(name="test category", created_by=actor.id)
            seed.add_all([school_class, category])
            await seed.flush()
            product = Product(name="test product", category_id=category.id, created_by=actor.id)
            entry = ClassRosterEntry(class_id=school_class.id, seat_number=20, student_id="11520")
            seed.add_all(
                [
                    product,
                    entry,
                    ClassStudentRange(
                        class_id=school_class.id,
                        student_id_start="11501",
                        student_id_end="11540",
                    ),
                ]
            )
            await seed.commit()
            actor_id, product_id, entry_id = actor.id, product.id, entry.id

        roster_pid = asyncio.get_running_loop().create_future()

        async def prepare():
            async with factory() as session:
                roster_pid.set_result(await session.scalar(text("SELECT pg_backend_pid()")))
                actor = await session.get(User, actor_id)
                user, _ = await prepare_roster_order_recipient(
                    session,
                    roster_entry_id=entry_id,
                    actor=actor,
                    product_ids=[product_id],
                )
                assert user.student_id == "11520"
                await session.rollback()

        async with factory() as writer:
            await writer.execute(
                select(Product.id).where(Product.id == product_id).with_for_update()
            )
            roster_task = asyncio.create_task(prepare())
            pid = await roster_pid
            # Wait for the actual database lock wait, rather than relying on scheduling sleeps.
            async with control.connect() as observer:
                async with asyncio.timeout(5):
                    while not await observer.scalar(
                        text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
                    ):
                        await asyncio.sleep(0.01)
            await writer.execute(text("SET LOCAL lock_timeout = '1s'"))
            await advisory_xact_lock(writer, AUDIT_CHAIN_LOCK_KEY)
            await writer.commit()
        await asyncio.wait_for(roster_task, timeout=10)
    finally:
        if roster_task is not None and not roster_task.done():
            roster_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await roster_task
        await engine.dispose()
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await control.dispose()
