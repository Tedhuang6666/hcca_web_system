#!/usr/bin/env bash
# 從任一工作樹目錄執行；只移除 Git 判定已失效的 worktree 管理紀錄。
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
exec git -C "$repo_root" worktree prune --verbose "$@"
