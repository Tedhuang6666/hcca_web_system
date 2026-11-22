#!/usr/bin/env bash
# GitNexus 1.6.12 在此主機的增量更新曾造成符號錯置，暫用完整重建。
set -euo pipefail
cd "$(dirname "$0")/.."
exec node .gitnexus/run.cjs analyze --index-only --force --no-parse-cache
