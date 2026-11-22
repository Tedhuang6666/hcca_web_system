"""Discord command compatibility exports and cog loader."""

from __future__ import annotations

from discord.ext import commands

from hcca_discord_bot.command_common import (
    _CATEGORY_LABEL as _CATEGORY_LABEL,
)
from hcca_discord_bot.command_common import (
    _QUIET_PATTERN as _QUIET_PATTERN,
)
from hcca_discord_bot.command_common import (
    _TIMEOUT_PRESETS as _TIMEOUT_PRESETS,
)
from hcca_discord_bot.command_common import (
    _client as _client,
)
from hcca_discord_bot.command_common import (
    _command as _command,
)
from hcca_discord_bot.command_common import (
    _due_autocomplete as _due_autocomplete,
)
from hcca_discord_bot.command_common import (
    _moderation_audit as _moderation_audit,
)
from hcca_discord_bot.command_common import (
    _parse_datetime as _parse_datetime,
)
from hcca_discord_bot.command_common import (
    _petition_autocomplete as _petition_autocomplete,
)
from hcca_discord_bot.command_common import (
    _timeout_autocomplete as _timeout_autocomplete,
)
from hcca_discord_bot.command_common import (
    _work_item_autocomplete as _work_item_autocomplete,
)
from hcca_discord_bot.moderation_commands import ModerationCog as ModerationCog
from hcca_discord_bot.platform_commands import PlatformCog as PlatformCog
from hcca_discord_bot.system_commands import SystemCog as SystemCog


async def load_commands(bot: commands.Bot) -> None:
    await bot.add_cog(PlatformCog(bot))
    await bot.add_cog(SystemCog(bot))
    await bot.add_cog(ModerationCog())
