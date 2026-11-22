import argparse
import asyncio

from hcca_discord_bot.main import check_api, run


def main() -> None:
    parser = argparse.ArgumentParser(description="HCCA Discord Bot")
    parser.add_argument(
        "--check-api",
        action="store_true",
        help="只檢查 HCCA API 設定與連線，不啟動 Discord Gateway",
    )
    args = parser.parse_args()
    if args.check_api:
        asyncio.run(check_api())
    else:
        run()


main()
