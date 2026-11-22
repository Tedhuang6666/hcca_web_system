"""Slash-command surface checks without signing in or sending Discord messages."""

import unittest

from hcca_discord_bot.account_commands import AccountBrowseCog
from hcca_discord_bot.extended_commands import load_extended_commands


class AccountCommandsTests(unittest.IsolatedAsyncioTestCase):
    def test_account_and_browsing_commands_remain_available(self):
        names = {command.name for command in AccountBrowseCog().get_app_commands()}
        self.assertEqual(
            names, {"link", "unlink", "announcements", "surveys_open", "regulations_recent"}
        )

    async def test_extended_loader_registers_only_supported_commands(self):
        class LocalBot:
            def __init__(self):
                self.cogs = []

            async def add_cog(self, cog):
                self.cogs.append(cog)

        bot = LocalBot()
        await load_extended_commands(bot)
        names = {command.name for cog in bot.cogs for command in cog.get_app_commands()}
        self.assertTrue({"link", "unlink", "announcements", "search", "quote"}.issubset(names))
        self.assertFalse(any(name.startswith("meal_") for name in names))


if __name__ == "__main__":
    unittest.main()
