from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from api.core.celery_app import celery_app
from api.services import privacy
from api.services.data_lifecycle_tasks import purge_expired_privacy_exports


class PrivacyExportPurgeTests(unittest.TestCase):
    def test_purge_covers_shared_and_legacy_export_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            shared_root = base / "private-volume"
            legacy_root = base / "privacy_exports"
            shared_root.mkdir()
            legacy_root.mkdir()
            expired_shared = shared_root / "export_shared.zip"
            expired_legacy = legacy_root / "export_legacy.zip"
            expired_shared.write_bytes(b"shared")
            expired_legacy.write_bytes(b"legacy")
            expired_at = time.time() - 3600
            os.utime(expired_shared, (expired_at, expired_at))
            os.utime(expired_legacy, (expired_at, expired_at))

            with (
                patch.object(privacy.settings, "DB_BACKUP_DIR", str(base / "backups")),
                patch.object(privacy.settings, "PRIVACY_EXPORT_DIR", str(shared_root)),
            ):
                removed = privacy.purge_expired_exports(max_age_seconds=1800)

            self.assertEqual(removed, 2)
            self.assertFalse(expired_shared.exists())
            self.assertFalse(expired_legacy.exists())

    def test_list_and_download_can_read_legacy_exports_until_expiry(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            shared_root = base / "private-volume"
            legacy_root = base / "privacy_exports"
            legacy_root.mkdir()
            legacy_export = legacy_root / "export_legacy.zip"
            legacy_export.write_bytes(b"legacy export")

            with (
                patch.object(privacy.settings, "DB_BACKUP_DIR", str(base / "backups")),
                patch.object(privacy.settings, "PRIVACY_EXPORT_DIR", str(shared_root)),
            ):
                filenames = {entry["filename"] for entry in privacy.list_exports()}
                downloaded = privacy.read_export_bytes(legacy_export.name)

            self.assertIn(legacy_export.name, filenames)
            self.assertEqual(downloaded, b"legacy export")

    def test_hourly_purge_task_uses_privacy_cleanup(self) -> None:
        with patch("api.services.privacy.purge_expired_exports", return_value=3) as purge:
            result = purge_expired_privacy_exports()

        self.assertEqual(result, {"purged": 3})
        purge.assert_called_once_with()

    def test_purge_task_is_scheduled_hourly_on_backup_queue(self) -> None:
        scheduled = celery_app.conf.beat_schedule["privacy-export-purge-hourly"]

        self.assertEqual(
            scheduled["task"], "api.services.data_lifecycle_tasks.purge_expired_privacy_exports"
        )
        self.assertEqual(scheduled["schedule"], 3600.0)
        self.assertEqual(
            celery_app.conf.task_routes["api.services.data_lifecycle_tasks.*"],
            {"queue": "backup"},
        )
