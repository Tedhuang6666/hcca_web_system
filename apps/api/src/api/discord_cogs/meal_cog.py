"""學餐 cog：互動瀏覽 ＋ 一鍵下單 ＋ 複雜訂購深連結。

指令：
- /meal_today  今日學餐與互動下單
- /meal_week   未來七天菜單總覽
- /meal_orders 我的近期學餐訂單（含取餐碼）
- /meal_cancel 取消未結單的訂單

設計：
- 一鍵下單走 service.create_meal_order 的「schedule_id + menu_item_id、數量 1」舊版路徑。
- 多品項 / 多數量 / 取餐時段 / 付款等複雜情境一律給「在網頁完成」深連結（create_open_url），
  避免在 Discord 重寫整套學餐邏輯。所有商業規則仍由 services.meal 把關。
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import reply_embed, reply_error, require_bound_user
from api.models.meal import (
    MealOrder,
    MealOrderStatus,
    MealVendor,
    MenuItem,
    MenuSchedule,
)
from api.schemas.meal import MealOrderCreate, MealOrderItemCreate
from api.services import meal as meal_svc
from api.services.discord_bot import create_open_url
from api.services.discord_embeds import Domain, Severity, build_embed

logger = logging.getLogger(__name__)

_ORDER_STATUS_LABEL = {
    MealOrderStatus.PENDING: "🕒 待確認",
    MealOrderStatus.CONFIRMED: "✅ 已確認",
    MealOrderStatus.CANCELLED: "❌ 已取消",
    MealOrderStatus.COMPLETED: "🍽 已取餐",
}


async def _today_schedules(db) -> list[tuple[MenuSchedule, MealVendor]]:
    today: date = local_today()
    rows = (
        await db.execute(
            select(MenuSchedule, MealVendor)
            .join(MealVendor, MealVendor.id == MenuSchedule.vendor_id)
            .where(MenuSchedule.date == today)
            .options(selectinload(MenuSchedule.items))
            .order_by(MenuSchedule.order_deadline.asc().nullslast())
            .limit(25)
        )
    ).all()
    return [(s, v) for s, v in rows]


def _orderable(schedule: MenuSchedule) -> bool:
    if schedule.is_closed:
        return False
    now = datetime.now(UTC)
    if schedule.order_deadline and now > schedule.order_deadline:
        return False
    return not (schedule.order_open_time and now < schedule.order_open_time)


# ── 互動下單流程 ───────────────────────────────────────────────────────────────


class _MealOrderView(discord.ui.View):
    """先選排程，再選單品；複雜訂購給網頁深連結。整個 view 綁定單一使用者。"""

    def __init__(
        self,
        *,
        user_id,
        schedules: list[tuple[MenuSchedule, MealVendor]],
    ) -> None:
        super().__init__(timeout=180)
        self.user_id = user_id
        self.schedules = {str(s.id): (s, v) for s, v in schedules}
        self.add_item(_ScheduleSelect(self))

    async def deep_link(self, schedule: MenuSchedule) -> str:
        return await create_open_url(self.user_id, f"/meal/schedules/{schedule.id}")


class _ScheduleSelect(discord.ui.Select):
    def __init__(self, parent: _MealOrderView) -> None:
        self.parent_view = parent
        options = []
        for sid, (schedule, vendor) in parent.schedules.items():
            deadline = schedule.order_deadline.strftime("%H:%M") if schedule.order_deadline else "—"
            closed = not _orderable(schedule)
            options.append(
                discord.SelectOption(
                    label=vendor.name[:90],
                    value=sid,
                    description=("已結單 / 已截止" if closed else f"結單 {deadline}")[:90],
                    emoji="🔒" if closed else "🍱",
                )
            )
        super().__init__(placeholder="選擇要訂購的商家", options=options[:25], row=0)

    async def callback(self, interaction: discord.Interaction) -> None:
        schedule, vendor = self.parent_view.schedules[self.values[0]]
        if not _orderable(schedule):
            await interaction.response.send_message(
                "這個排程已結單或超過截止時間，無法在此下單。", ephemeral=True
            )
            return
        available = [i for i in schedule.items if i.is_available]
        if not available:
            # 平台型排程（取餐時段 / 商品上架）→ 直接給網頁完成
            url = await self.parent_view.deep_link(schedule)
            await interaction.response.edit_message(
                content=f"**{vendor.name}** 採進階訂購（取餐時段 / 多商品），請在網頁完成：\n{url}",
                view=None,
                embed=None,
            )
            return
        view = discord.ui.View(timeout=180)
        view.add_item(_ItemSelect(self.parent_view, schedule, vendor, available))
        await interaction.response.edit_message(
            content=f"**{vendor.name}**：選擇單品即可一鍵下單（數量 1）。多份 / 多品項請用網頁。",
            view=view,
            embed=None,
        )


class _ItemSelect(discord.ui.Select):
    def __init__(
        self,
        parent: _MealOrderView,
        schedule: MenuSchedule,
        vendor: MealVendor,
        items: list[MenuItem],
    ) -> None:
        self.parent_view = parent
        self.schedule = schedule
        self.vendor = vendor
        self.items = {str(i.id): i for i in items}
        options = [
            discord.SelectOption(
                label=f"{item.name[:80]}",
                value=str(item.id),
                description=f"${item.price}"
                + (f"｜{item.description[:60]}" if item.description else ""),
                emoji="🍙",
            )
            for item in items[:25]
        ]
        super().__init__(placeholder="選擇單品（一鍵下單）", options=options, row=0)

    async def callback(self, interaction: discord.Interaction) -> None:
        item = self.items[self.values[0]]
        await interaction.response.defer()
        async with AsyncSessionLocal() as db:
            try:
                order = await meal_svc.create_meal_order(
                    db,
                    user_id=self.parent_view.user_id,
                    data=MealOrderCreate(
                        schedule_id=self.schedule.id,
                        items=[MealOrderItemCreate(menu_item_id=item.id, quantity=1)],
                    ),
                )
                await db.commit()
            except (ValueError, PermissionError) as exc:
                await interaction.edit_original_response(
                    content=f"⚠️ 下單失敗：{exc}", view=None, embed=None
                )
                return
            url = await create_open_url(self.parent_view.user_id, f"/meal/orders/{order.id}")
        embed = discord.Embed.from_dict(
            build_embed(
                Domain.MEAL,
                Severity.SUCCESS,
                title="✅ 已下單",
                body=f"{self.vendor.name}｜{item.name}",
                fields=[
                    {"name": "取餐碼", "value": f"`{order.pickup_code}`", "inline": True},
                    {"name": "字號", "value": order.serial_number, "inline": True},
                    {"name": "金額", "value": f"${order.total_price}", "inline": True},
                ],
            )
        )
        button = discord.ui.Button(style=discord.ButtonStyle.link, label="查看訂單", url=url)
        result_view = discord.ui.View()
        result_view.add_item(button)
        await interaction.edit_original_response(content=None, embed=embed, view=result_view)


class _CancelOrderView(discord.ui.View):
    def __init__(self, *, user_id, orders: list[MealOrder]) -> None:
        super().__init__(timeout=120)
        self.user_id = user_id
        self.add_item(_CancelSelect(user_id, orders))


class _CancelSelect(discord.ui.Select):
    def __init__(self, user_id, orders: list[MealOrder]) -> None:
        self.user_id = user_id
        options = [
            discord.SelectOption(
                label=f"{o.serial_number}"[:90],
                value=str(o.id),
                description=f"取餐碼 {o.pickup_code}｜${o.total_price}"[:90],
            )
            for o in orders[:25]
        ]
        super().__init__(placeholder="選擇要取消的訂單", options=options)

    async def callback(self, interaction: discord.Interaction) -> None:
        import uuid as _uuid

        await interaction.response.defer()
        async with AsyncSessionLocal() as db:
            order = await meal_svc.get_meal_order(db, _uuid.UUID(self.values[0]))
            if order is None:
                await interaction.edit_original_response(content="找不到此訂單。", view=None)
                return
            try:
                await meal_svc.cancel_meal_order(db, order, requested_by=self.user_id)
                await db.commit()
            except (ValueError, PermissionError) as exc:
                await interaction.edit_original_response(content=f"⚠️ 取消失敗：{exc}", view=None)
                return
        await interaction.edit_original_response(
            content=f"✅ 已取消訂單 {order.serial_number}", view=None
        )


# ── Cog ────────────────────────────────────────────────────────────────────────


class MealCog(commands.Cog):
    """學餐瀏覽與互動下單。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="meal_today", description="今天的學餐供應，可直接互動下單")
    async def meal_today(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            schedules = await _today_schedules(db)
        if not schedules:
            await reply_embed(
                interaction,
                domain=Domain.MEAL,
                severity=Severity.NEUTRAL,
                title="今天沒有學餐排程",
            )
            return
        fields = []
        for schedule, vendor in schedules:
            deadline = schedule.order_deadline.strftime("%H:%M") if schedule.order_deadline else "—"
            status = "🔒 已結單" if not _orderable(schedule) else f"🟢 結單 {deadline}"
            items = [i for i in schedule.items if i.is_available]
            menu = "、".join(f"{i.name}(${i.price})" for i in items[:5]) or "（進階訂購，請看網頁）"
            fields.append(
                {"name": f"🍱 {vendor.name}", "value": f"{status}\n{menu}", "inline": False}
            )
        view = _MealOrderView(user_id=user.id, schedules=schedules)
        embed = discord.Embed.from_dict(
            build_embed(
                Domain.MEAL,
                Severity.INFO,
                title=f"今日學餐（{local_today().isoformat()}）",
                body="從下方選單選商家即可一鍵下單。",
                fields=fields,
            )
        )
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="meal_week", description="未來七天的學餐菜單總覽")
    async def meal_week(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        today = local_today()
        async with AsyncSessionLocal() as db:
            schedules = await meal_svc.list_schedules(
                db, date_from=today, date_to=today + timedelta(days=7), limit=40
            )
            vendor_names = {
                v.id: v.name for v in (await db.execute(select(MealVendor))).scalars().all()
            }
        if not schedules:
            await reply_embed(
                interaction,
                domain=Domain.MEAL,
                severity=Severity.NEUTRAL,
                title="未來七天沒有學餐排程",
            )
            return
        by_day: dict[date, list[str]] = {}
        for s in sorted(schedules, key=lambda x: x.date):
            by_day.setdefault(s.date, []).append(vendor_names.get(s.vendor_id, "商家"))
        fields = [
            {"name": day.isoformat(), "value": "、".join(names)[:300], "inline": False}
            for day, names in by_day.items()
        ]
        await reply_embed(
            interaction,
            domain=Domain.MEAL,
            severity=Severity.INFO,
            title="未來七天學餐",
            fields=fields,
            open_url="/meal",
        )

    @app_commands.command(name="meal_orders", description="我的近期學餐訂單與取餐碼")
    async def meal_orders(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            orders = await meal_svc.list_meal_orders(db, user_id=user.id, limit=10)
        if not orders:
            await reply_embed(
                interaction,
                domain=Domain.MEAL,
                severity=Severity.NEUTRAL,
                title="你還沒有學餐訂單",
            )
            return
        fields = []
        for o in orders:
            label = _ORDER_STATUS_LABEL.get(o.status, str(o.status))
            created = o.created_at.strftime("%m-%d %H:%M") if o.created_at else "—"
            fields.append(
                {
                    "name": f"{label}｜{o.serial_number}",
                    "value": f"取餐碼 `{o.pickup_code}`｜${o.total_price}｜{created}",
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.MEAL,
            severity=Severity.INFO,
            title=f"我的學餐訂單（{len(orders)}）",
            fields=fields,
            open_url="/meal/orders",
        )

    @app_commands.command(name="meal_cancel", description="取消未結單的學餐訂單")
    async def meal_cancel(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            pending = await meal_svc.list_meal_orders(
                db, user_id=user.id, status=MealOrderStatus.PENDING, limit=25
            )
            confirmed = await meal_svc.list_meal_orders(
                db, user_id=user.id, status=MealOrderStatus.CONFIRMED, limit=25
            )
        orders = (pending + confirmed)[:25]
        if not orders:
            await reply_error(
                interaction, title="沒有可取消的訂單", body="目前沒有待確認/已確認的訂單。"
            )
            return
        view = _CancelOrderView(user_id=user.id, orders=orders)
        await interaction.followup.send(
            "選擇要取消的訂單（結單後無法取消）：", view=view, ephemeral=True
        )
