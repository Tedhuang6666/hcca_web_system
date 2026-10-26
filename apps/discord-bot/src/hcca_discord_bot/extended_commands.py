"""Extended Discord command compatibility exports and loader."""

from __future__ import annotations

from discord.ext import commands

from hcca_discord_bot.extended_common import (
    _embed as _embed,
)
from hcca_discord_bot.extended_common import (
    _regulation_autocomplete as _regulation_autocomplete,
)
from hcca_discord_bot.extended_common import (
    _survey_autocomplete as _survey_autocomplete,
)
from hcca_discord_bot.meal_commands import AccountBrowseMealCog as AccountBrowseMealCog
from hcca_discord_bot.regulation_commands import RegulationListenerCog as RegulationListenerCog
from hcca_discord_bot.tools_commands import ToolsCog as ToolsCog


async def load_extended_commands(bot: commands.Bot) -> None:
    await bot.add_cog(AccountBrowseMealCog())
    await bot.add_cog(ToolsCog(bot))
    await bot.add_cog(RegulationListenerCog(bot))
