"""移除議事與行事曆系統及其持久化資料。

此 migration 不提供可逆 downgrade：被刪除模組的資料表與資料已不再有對應的
應用程式模型，無法安全地自動還原。執行前應依部署流程完成資料庫備份。
"""

from __future__ import annotations

from alembic import op

revision = "20260930100000"
down_revision = "20260929150000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 先移除仍由議會提案表指向 meetings 的欄位與外鍵。
    op.execute(
        "ALTER TABLE council_proposals "
        "DROP CONSTRAINT IF EXISTS council_proposals_scheduled_meeting_id_fkey"
    )
    op.execute("ALTER TABLE council_proposals DROP COLUMN IF EXISTS scheduled_meeting_id")
    op.execute("ALTER TABLE council_proposals DROP COLUMN IF EXISTS scheduled_at")
    op.execute("ALTER TABLE orgs DROP COLUMN IF EXISTS bill_stage")

    # 清除兩個系統的所有資料表；順序按子表到主表，避免跨模組外鍵阻擋。
    for table in (
        "calendar_event_links",
        "calendar_event_checklist_items",
        "calendar_event_participants",
        "calendar_events",
        "org_google_calendar_configs",
        "meeting_events",
        "meeting_screen_states",
        "meeting_decisions",
        "meeting_motions",
        "meeting_timer_states",
        "meeting_speech_queue_items",
        "meeting_ballots",
        "meeting_votes",
        "meeting_agenda_recusals",
        "meeting_artifact_links",
        "meeting_attendance_sources",
        "meeting_attendance",
        "meeting_agenda_attachments",
        "meeting_requests",
        "meeting_agenda_items",
        "meetings",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    # 移除不再存在的權限與 feature flag。
    op.execute(
        "DELETE FROM permissions WHERE code IN ("
        "'meeting:create', 'meeting:manage', 'meeting:chair', 'meeting:vote', "
        "'meeting:view_all', 'meeting:export', 'calendar:create', 'calendar:manage', "
        "'calendar:view_all', 'calendar:admin'"
        ")"
    )
    op.execute("DELETE FROM feature_flags WHERE key = 'feature:meeting_vote'")

    # 清理已刪除模組留下的個人通知偏好鍵。
    op.execute(
        "UPDATE users SET notification_preferences = "
        "COALESCE(notification_preferences, '{}'::jsonb) - "
        "ARRAY['meeting_invited', 'meeting_today', 'meeting_minutes_ready', "
        "'calendar_event_invited', 'calendar_event_updated']::text[]"
    )
    op.execute(
        "UPDATE discord_notification_preferences SET preferences = "
        "COALESCE(preferences, '{}'::jsonb) - "
        "ARRAY['meeting_invited', 'calendar_reminder']::text[]"
    )

    # 導覽視角會持久化模組 key，避免既有自訂視角重新顯示已刪除入口。
    op.execute(
        """
        UPDATE navigation_profiles
        SET desktop_sections = COALESCE((
            SELECT jsonb_agg(
                section || jsonb_build_object(
                    'items', COALESCE((
                        SELECT jsonb_agg(item)
                        FROM jsonb_array_elements(COALESCE(section->'items', '[]'::jsonb)) AS item
                        WHERE item::text NOT IN ('\"calendar\"', '\"meetings\"')
                    ), '[]'::jsonb)
                ) ORDER BY section_order
            )
            FROM jsonb_array_elements(COALESCE(desktop_sections, '[]'::jsonb))
                WITH ORDINALITY AS sections(section, section_order)
        ), '[]'::jsonb),
            mobile_order = COALESCE((
                SELECT jsonb_agg(item)
                FROM jsonb_array_elements(COALESCE(mobile_order, '[]'::jsonb)) AS item
                WHERE item::text NOT IN ('\"calendar\"', '\"meetings\"')
            ), '[]'::jsonb)
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "議事與行事曆系統的資料表及資料已永久移除，無法安全自動還原；請由備份復原。"
    )
