"""No-DB checks for the public API surface after retiring manual law workflows."""

from __future__ import annotations

import unittest
import uuid

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.routers.regulations import router


class RegulationSurfaceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)

    def test_only_publication_and_source_management_can_write(self) -> None:
        writes = {
            (path, method)
            for path, operations in self.app.openapi()["paths"].items()
            for method in operations
            if method in {"post", "patch", "put", "delete"}
            and not path.startswith("/regulations/sync")
        }
        # diff is a read-only comparison carried over from the existing API.
        self.assertEqual(
            writes,
            {
                ("/regulations/{reg_id}/publish", "post"),
                ("/regulations/{reg_id}/diff", "post"),
            },
        )

    async def test_retired_workflow_paths_do_not_accept_writes(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=self.app), base_url="http://test"
        ) as client:
            reg_id = uuid.uuid4()
            for suffix in [
                "submit",
                "schedule",
                "council_approve",
                "president_publish",
                "revise",
                "reject",
                "fork_draft",
                "freeze",
                "unfreeze",
                "repeal",
                "archive",
                "articles",
                "structure-content",
            ]:
                with self.subTest(suffix=suffix):
                    response = await client.post(f"/regulations/{reg_id}/{suffix}", json={})
                    self.assertIn(response.status_code, {404, 405})
            response = await client.post("/regulations", json={})
            self.assertEqual(response.status_code, 405)

    async def test_publication_requires_login(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=self.app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/regulations/{uuid.uuid4()}/publish", json={"change_brief": "公布"}
            )
            self.assertEqual(response.status_code, 401)
