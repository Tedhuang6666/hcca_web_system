"""工具 cog：/search /quote /poll /survey_share /remind /shortlink。

把平台常用查詢與互動工具搬進 Discord，省一次切換。
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from datetime import UTC, datetime, timedelta

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import func, or_, select

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.discord_cogs._autocomplete import due_at_autocomplete, parse_due_at
from api.discord_cogs._helpers import (
    reply_embed,
    reply_error,
    reply_success,
    require_bound_user,
)
from api.models.announcement import Announcement
from api.models.document import Document
from api.models.regulation import Regulation, RegulationArticle
from api.models.survey import Survey, SurveyStatus
from api.services.discord_bot import create_open_url, emit_user_dm
from api.services.discord_embeds import Domain, Severity, build_embed, default_action_row

_POLL_NUMBER_EMOJIS = [
    "1️⃣",
    "2️⃣",
    "3️⃣",
    "4️⃣",
    "5️⃣",
    "6️⃣",
    "7️⃣",
    "8️⃣",
    "9️⃣",
    "🔟",
]


async def _regulation_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    needle = (current or "").lower()
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Regulation.id, Regulation.title)
            .where(Regulation.is_active.is_(True))
            .order_by(Regulation.updated_at.desc())
            .limit(25)
        )
        if needle:
            stmt = stmt.where(func.lower(Regulation.title).contains(needle))
        rows = (await db.execute(stmt)).all()
    return [app_commands.Choice(name=title[:100], value=str(rid)) for rid, title in rows][:25]


async def _survey_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    needle = (current or "").lower()
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Survey.id, Survey.title)
            .where(Survey.status == SurveyStatus.OPEN)
            .order_by(Survey.closes_at.asc().nullslast())
            .limit(25)
        )
        if needle:
            stmt = stmt.where(func.lower(Survey.title).contains(needle))
        rows = (await db.execute(stmt)).all()
    return [app_commands.Choice(name=title[:100], value=str(sid)) for sid, title in rows][:25]


class ToolsCog(commands.Cog):
    """跨領域搜尋、引用法規、原生投票、個人提醒、短網址。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    # ── /search ────────────────────────────────────────────────────────────
    @app_commands.command(name="search", description="跨領域搜尋：公告 / 公文 / 法規")
    @app_commands.describe(
        query="關鍵字（搜尋 title）",
        scope="搜尋範圍",
    )
    @app_commands.choices(
        scope=[
            app_commands.Choice(name="全部", value="all"),
            app_commands.Choice(name="公告", value="announcement"),
            app_commands.Choice(name="公文", value="document"),
            app_commands.Choice(name="法規", value="regulation"),
        ]
    )
    async def search(
        self,
        interaction: discord.Interaction,
        query: str,
        scope: app_commands.Choice[str] | None = None,
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        if len(query) < 2:
            await reply_error(interaction, body="關鍵字至少 2 個字。")
            return
        await interaction.response.defer(ephemeral=True)
        scope_value = scope.value if scope else "all"
        needle = f"%{query}%"

        async with AsyncSessionLocal() as db:
            anns: list = []
            docs: list = []
            regs: list = []
            if scope_value in {"all", "announcement"}:
                anns = list(
                    (
                        await db.execute(
                            select(Announcement)
                            .where(Announcement.title.ilike(needle))
                            .where(Announcement.is_published.is_(True))
                            .order_by(Announcement.published_at.desc().nullslast())
                            .limit(5)
                        )
                    )
                    .scalars()
                    .all()
                )
            if scope_value in {"all", "document"}:
                docs = list(
                    (
                        await db.execute(
                            select(Document)
                            .where(
                                or_(
                                    Document.title.ilike(needle),
                                    Document.subject.ilike(needle),
                                    Document.serial_number.ilike(needle),
                                )
                            )
                            .order_by(Document.updated_at.desc())
                            .limit(5)
                        )
                    )
                    .scalars()
                    .all()
                )
            if scope_value in {"all", "regulation"}:
                regs = list(
                    (
                        await db.execute(
                            select(Regulation)
                            .where(Regulation.title.ilike(needle))
                            .where(Regulation.is_active.is_(True))
                            .order_by(Regulation.updated_at.desc())
                            .limit(5)
                        )
                    )
                    .scalars()
                    .all()
                )

        total = len(anns) + len(docs) + len(regs)
        if total == 0:
            await reply_embed(
                interaction,
                domain=Domain.SYSTEM,
                severity=Severity.NEUTRAL,
                title=f"找不到「{query}」",
            )
            return
        fields: list[dict] = []
        for ann in anns:
            url = await create_open_url(user.id, f"/announcements/{ann.id}")
            fields.append(
                {
                    "name": f"📢 {ann.title[:200]}",
                    "value": f"[打開]({url})",
                    "inline": False,
                }
            )
        for doc in docs:
            url = await create_open_url(user.id, f"/documents/{doc.id}")
            serial = doc.serial_number or "（無字號）"
            fields.append(
                {
                    "name": f"📄 {doc.title[:200]}",
                    "value": f"{serial}\n[打開]({url})",
                    "inline": False,
                }
            )
        for reg in regs:
            url = await create_open_url(user.id, f"/regulations/{reg.id}")
            fields.append(
                {
                    "name": f"⚖️ {reg.title[:200]} v{reg.version}",
                    "value": f"流程：{reg.workflow_status}\n[打開]({url})",
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.SYSTEM,
            severity=Severity.INFO,
            title=f"搜尋「{query}」共 {total} 筆",
            fields=fields,
        )

    # ── /quote ─────────────────────────────────────────────────────────────
    @app_commands.command(name="quote", description="在頻道引用一條法規")
    @app_commands.autocomplete(regulation=_regulation_autocomplete)
    @app_commands.describe(
        regulation="選擇法規",
        article_no="法律條號（例 5、5-1），留空則顯示首條",
    )
    async def quote(
        self,
        interaction: discord.Interaction,
        regulation: str,
        article_no: str | None = None,
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        try:
            reg_uuid = uuid.UUID(regulation)
        except ValueError:
            await reply_error(interaction, body="regulation 不是合法 UUID。")
            return
        await interaction.response.defer()
        async with AsyncSessionLocal() as db:
            reg = await db.scalar(select(Regulation).where(Regulation.id == reg_uuid))
            if reg is None:
                await reply_error(interaction, body="找不到這條法規。")
                return
            article_stmt = (
                select(RegulationArticle)
                .where(RegulationArticle.regulation_id == reg_uuid)
                .where(RegulationArticle.is_deleted.is_(False))
                .where(RegulationArticle.content.is_not(None))
                .order_by(RegulationArticle.sort_index)
            )
            if article_no:
                article = await db.scalar(
                    article_stmt.where(RegulationArticle.legal_number == article_no.strip())
                )
            else:
                article = await db.scalar(article_stmt.limit(1))
            if article is None:
                await reply_error(
                    interaction,
                    body=f"找不到{'第 ' + article_no + ' 條' if article_no else '可顯示的條文'}。",
                )
                return
            url = await create_open_url(user.id, f"/regulations/{reg.id}")
        legal = f"第 {article.legal_number} 條" if article.legal_number else "首條"
        title = f"{reg.title}：{legal}"
        if article.subtitle:
            title += f"（{article.subtitle}）"
        embed = build_embed(
            Domain.REGULATION,
            Severity.INFO,
            title=title,
            body=(article.content or "")[:3500],
            link=f"/regulations/{reg.id}",
        )
        components = default_action_row(open_url=url, domain=Domain.REGULATION)
        view = discord.ui.View()
        if components:
            for c in components["components"]:
                view.add_item(
                    discord.ui.Button(
                        style=discord.ButtonStyle.link, label=c["label"], url=c["url"]
                    )
                )
        # 公開訊息（非 ephemeral）— 引用用途本就為公開分享
        await interaction.followup.send(
            content=f"<@{interaction.user.id}> 引用了一條法規",
            embed=discord.Embed.from_dict(embed),
            view=view,
        )

    # ── /poll ──────────────────────────────────────────────────────────────
    @app_commands.command(
        name="poll", description="發起投票並分享到頻道（Discord 原生投票，可複選/設時長）"
    )
    @app_commands.describe(
        question="題目",
        options="選項，用「|」分隔，例：要 | 不要 | 還沒想好",
        multiple="是否開放複選",
        hours="開放時數（1-168 小時，預設 24）",
    )
    async def poll(
        self,
        interaction: discord.Interaction,
        question: str,
        options: str = "要 | 不要",
        multiple: bool = False,
        hours: app_commands.Range[int, 1, 168] = 24,
    ) -> None:
        opts = [o.strip() for o in options.split("|") if o.strip()]
        if len(opts) < 2:
            await reply_error(interaction, body="至少 2 個選項。用「|」分隔。")
            return
        if len(opts) > 10:
            await reply_error(interaction, body="最多 10 個選項。")
            return

        # discord.py >= 2.4 原生投票：Discord 端自動計票、到期自動結束，可複選
        if hasattr(discord, "Poll"):
            poll = discord.Poll(
                question=question[:300],
                duration=timedelta(hours=hours),
                multiple=multiple,
            )
            for i, opt in enumerate(opts):
                poll.add_answer(text=opt[:55], emoji=_POLL_NUMBER_EMOJIS[i])
            await interaction.response.send_message(poll=poll)
            return

        # 後備：reaction 計票（舊版 discord.py）
        fields = [
            {"name": f"{_POLL_NUMBER_EMOJIS[i]} {opt[:200]}", "value": "—", "inline": False}
            for i, opt in enumerate(opts)
        ]
        embed = build_embed(
            Domain.SYSTEM,
            Severity.INFO,
            title=f"📊 投票：{question}",
            body=f"由 <@{interaction.user.id}> 發起，按下方表情符號投票。",
            fields=fields,
        )
        await interaction.response.send_message(embed=discord.Embed.from_dict(embed))
        msg = await interaction.original_response()
        for i in range(len(opts)):
            with contextlib.suppress(discord.HTTPException):
                await msg.add_reaction(_POLL_NUMBER_EMOJIS[i])

    # ── /survey_share ────────────────────────────────────────────────────────
    @app_commands.command(name="survey_share", description="把開放中的平台問卷分享到此頻道")
    @app_commands.autocomplete(survey=_survey_autocomplete)
    @app_commands.describe(survey="選擇開放中的問卷")
    async def survey_share(self, interaction: discord.Interaction, survey: str) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        try:
            survey_uuid = uuid.UUID(survey)
        except ValueError:
            await reply_error(interaction, body="survey 不是合法 UUID，請從 autocomplete 選擇。")
            return
        await interaction.response.defer()
        async with AsyncSessionLocal() as db:
            obj = await db.scalar(select(Survey).where(Survey.id == survey_uuid))
        if obj is None or obj.status != SurveyStatus.OPEN:
            await reply_error(interaction, body="找不到這份問卷，或問卷未開放。")
            return
        close_str = obj.closes_at.strftime("%Y-%m-%d %H:%M") if obj.closes_at else "無截止"
        anon = "🙈 匿名" if obj.is_anonymous else "📝 具名"
        # 公開分享：用平台公開路徑（非個人短效登入連結），讓每個人各自登入填寫
        public_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/surveys/{obj.id}"
        embed = build_embed(
            Domain.SURVEY,
            Severity.INFO,
            title=f"📝 問卷：{obj.title}",
            body=f"{anon}｜截止：{close_str}\n由 <@{interaction.user.id}> 分享，歡迎填寫。",
        )
        view = discord.ui.View()
        view.add_item(
            discord.ui.Button(style=discord.ButtonStyle.link, label="前往填寫", url=public_url)
        )
        await interaction.followup.send(embed=discord.Embed.from_dict(embed), view=view)

    # ── /remind ────────────────────────────────────────────────────────────
    @app_commands.command(name="remind", description="個人提醒（DM 你一次）")
    @app_commands.autocomplete(when=due_at_autocomplete)
    @app_commands.describe(
        text="提醒內容",
        when="什麼時候提醒（用 autocomplete 預設或 ISO 時間）",
    )
    async def remind(
        self,
        interaction: discord.Interaction,
        text: str,
        when: str,
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        target = parse_due_at(when)
        if target is None:
            await reply_error(interaction, body="時間格式不接受，請從 autocomplete 預設選一個。")
            return
        delay = (target - datetime.now(UTC)).total_seconds()
        if delay < 30:
            await reply_error(interaction, body="提醒時間太近（< 30 秒）。")
            return
        if delay > 30 * 24 * 3600:
            await reply_error(interaction, body="提醒時間最長 30 天。")
            return

        async def _later() -> None:
            await asyncio.sleep(delay)
            embed = build_embed(
                Domain.TASK,
                Severity.WARNING,
                title="⏰ 你的提醒到了",
                body=text,
            )
            async with AsyncSessionLocal() as db:
                await emit_user_dm(
                    db,
                    user_id=user.id,
                    embed=embed,
                    category=None,
                )
                await db.commit()

        self.bot.loop.create_task(_later())
        await reply_success(
            interaction,
            domain=Domain.TASK,
            title="已排定提醒",
            body=f"⏰ {target.strftime('%Y-%m-%d %H:%M UTC')}\n📝 {text[:300]}",
        )

    # ── /shortlink ─────────────────────────────────────────────────────────
    @app_commands.command(name="shortlink", description="把平台路徑包成 5 分鐘短效登入連結")
    @app_commands.describe(path="平台路徑，例 /documents/abc-123")
    async def shortlink(self, interaction: discord.Interaction, path: str) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        if not path.startswith("/"):
            await reply_error(interaction, body="path 必須以 / 開頭。")
            return
        url = await create_open_url(user.id, path)
        await reply_success(
            interaction,
            domain=Domain.SYSTEM,
            title="短效登入連結（5 分鐘）",
            body=f"[{path}]({url})\n打開後免登入直達。",
        )
