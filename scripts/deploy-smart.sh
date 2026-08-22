#!/usr/bin/env bash
# 本機智慧部署入口：推送指定 commit，等待遠端同步後執行 immutable GHCR blue-green 部署。
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

usage() {
  cat <<'EOF'
用法：scripts/deploy-smart.sh [選項]

選項：
  --release <sha>  部署指定的完整 40 字元 commit SHA（預設 HEAD）
  --no-push        不推送 Git，只部署遠端已存在的 commit
  --allow-dirty    允許本機未提交變更；只會部署指定的 commit
  --dry-run        只做本機驗證與顯示決策，不連線、不推送、不部署
  -h, --help       顯示說明

可用 .env.local 覆寫：
  DEPLOY_HOST / DEPLOY_SSH_USER / DEPLOY_KEY_PATH / DEPLOY_DIR
  DEPLOY_BRANCH=main DEPLOY_REMOTE=origin DEPLOY_PUSH=1
  DEPLOY_WITH_WORKERS=1 DEPLOY_KEEP_OLD=false DEPLOY_DRAIN_SECONDS=10
  DEPLOY_HEALTH_WAIT_SECONDS=300 DEPLOY_IMAGE_WAIT_SECONDS=1200
  DEPLOY_MIGRATION_MODE=auto（auto / always / skip）
  DEPLOY_REQUIRE_GPG_VERIFY=0 DEPLOY_HEALTH_REPORT_REQUIRED=1
  DEPLOY_CI_WORKFLOW='CI — Lint, Types & Test'
  DEPLOY_CI_WAIT_SECONDS=3600 DEPLOY_CI_POLL_SECONDS=15
EOF
}

release_sha=""
push_enabled="${DEPLOY_PUSH:-1}"
allow_dirty="${DEPLOY_ALLOW_DIRTY:-0}"
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      [[ $# -ge 2 ]] || { echo "❌ --release 需要 SHA" >&2; exit 2; }
      release_sha="$2"
      shift 2
      ;;
    --no-push)
      push_enabled=0
      shift
      ;;
    --allow-dirty)
      allow_dirty=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "❌ 未知選項：$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

env_local="$repo_root/.env.local"
if [[ ! -f "$env_local" ]]; then
  echo "❌ 找不到 $env_local，請從 .env.local.example 複製並填寫部署設定" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$env_local"

# CLI 選項優先於 .env.local；未由 CLI 指定時才採用檔案設定。
if [[ "$push_enabled" == "1" ]]; then
  push_enabled="${DEPLOY_PUSH:-1}"
fi
if [[ "$allow_dirty" == "0" ]]; then
  allow_dirty="${DEPLOY_ALLOW_DIRTY:-0}"
fi

host="${DEPLOY_HOST:?請在 .env.local 設定 DEPLOY_HOST}"
ssh_user="${DEPLOY_SSH_USER:-root}"
ssh_key="${DEPLOY_KEY_PATH:-$HOME/.ssh/hcca_deploy}"
deploy_dir="${DEPLOY_DIR:-/srv/hcca}"
branch="${DEPLOY_BRANCH:-main}"
remote_name="${DEPLOY_REMOTE:-origin}"
with_workers="${DEPLOY_WITH_WORKERS:-1}"
keep_old="${DEPLOY_KEEP_OLD:-false}"
drain_seconds="${DEPLOY_DRAIN_SECONDS:-10}"
health_wait_seconds="${DEPLOY_HEALTH_WAIT_SECONDS:-300}"
image_wait_seconds="${DEPLOY_IMAGE_WAIT_SECONDS:-1200}"
migration_mode="${DEPLOY_MIGRATION_MODE:-auto}"
require_gpg_verify="${DEPLOY_REQUIRE_GPG_VERIFY:-0}"
health_report_required="${DEPLOY_HEALTH_REPORT_REQUIRED:-1}"
ci_workflow="${DEPLOY_CI_WORKFLOW:-CI — Lint, Types & Test}"
ci_wait_seconds="${DEPLOY_CI_WAIT_SECONDS:-3600}"
ci_poll_seconds="${DEPLOY_CI_POLL_SECONDS:-15}"

for command in git ssh; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "❌ 找不到必要指令：$command" >&2
    exit 1
  }
done
[[ -r "$ssh_key" ]] || { echo "❌ SSH key 不可讀取：$ssh_key" >&2; exit 1; }

current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
[[ "$current_branch" == "$branch" ]] || {
  echo "❌ 目前分支是 '$current_branch'，部署分支應為 '$branch'" >&2
  exit 1
}

release_sha="${release_sha:-${DEPLOY_RELEASE_SHA:-$(git rev-parse HEAD)}}"
if ! [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ release SHA 必須是完整 40 字元小寫 commit SHA" >&2
  exit 1
fi
if ! git cat-file -e "$release_sha^{commit}" 2>/dev/null; then
  echo "❌ 本機找不到 release commit：$release_sha" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$release_sha" HEAD; then
  echo "❌ release commit 不是目前 HEAD 的祖先，拒絕部署" >&2
  exit 1
fi

dirty="$(git status --porcelain --untracked-files=all)"
if [[ -n "$dirty" && "$allow_dirty" != "1" ]]; then
  echo "❌ 工作樹不是乾淨狀態，為避免把未提交內容誤認成正式版本而中止：" >&2
  echo "$dirty" >&2
  echo "如確認只部署已提交 commit，使用 --allow-dirty；建議先處理變更。" >&2
  exit 1
fi
if [[ -n "$dirty" ]]; then
  echo "⚠️  本機工作樹有未提交變更；本次只部署 $release_sha，不會推送未提交內容。" >&2
fi

git fetch --quiet "$remote_name" "$branch"
base_ref="$remote_name/$branch"
if ! git cat-file -e "$base_ref^{commit}" 2>/dev/null; then
  echo "❌ 找不到遠端分支：$base_ref" >&2
  exit 1
fi
base_sha="$(git rev-parse "$base_ref")"

wait_for_ci() {
  local repo_slug start deadline runs run_id run_status run_conclusion run_url

  command -v gh >/dev/null 2>&1 || {
    echo "❌ 找不到 GitHub CLI（gh）；部署前無法確認 CI。" >&2
    exit 1
  }
  if ! [[ "$ci_wait_seconds" =~ ^[1-9][0-9]*$ ]] || ! [[ "$ci_poll_seconds" =~ ^[1-9][0-9]*$ ]]; then
    echo "❌ DEPLOY_CI_WAIT_SECONDS 與 DEPLOY_CI_POLL_SECONDS 必須是正整數" >&2
    exit 2
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "❌ 未登入 GitHub CLI；部署前無法確認 CI。請先執行 gh auth login。" >&2
    exit 1
  fi
  if ! repo_slug="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"; then
    echo "❌ 無法判定 GitHub repository，無法確認 CI。" >&2
    exit 1
  fi

  echo "▶ 等待 CI 通過後才部署：$ci_workflow（commit: $release_sha）"
  start="$(date +%s)"
  deadline=$((start + ci_wait_seconds))
  while :; do
    if ! runs="$(gh run list \
      --repo "$repo_slug" \
      --workflow "$ci_workflow" \
      --commit "$release_sha" \
      --event push \
      --limit 1 \
      --json databaseId,status,conclusion,url \
      --jq '.[] | [.databaseId, .status, (.conclusion // ""), .url] | @tsv')"; then
      echo "❌ 無法查詢 GitHub Actions CI 狀態。" >&2
      exit 1
    fi

    if [[ -n "$runs" ]]; then
      IFS=$'\t' read -r run_id run_status run_conclusion run_url <<< "$runs"
      case "$run_status:$run_conclusion" in
        completed:success)
          echo "✓ CI 已全部通過：$run_url"
          return 0
          ;;
        completed:*)
          echo "❌ CI 未通過，取消部署：$run_url" >&2
          echo "失敗或未完成的 job：" >&2
          gh run view "$run_id" --repo "$repo_slug" --json jobs --jq \
            '.jobs[] | select(.conclusion != "success") | .name' >&2 || true
          echo "失敗步驟：" >&2
          gh run view "$run_id" --repo "$repo_slug" --json jobs --jq '
            .jobs[] | select(.conclusion != "success") as $job |
            $job.steps[]? | select(.conclusion != "success") |
            "\($job.name) / \(.name): \(.conclusion)"
          ' >&2 || true
          exit 1
          ;;
        *)
          echo "CI 尚在執行（${run_status}），${ci_poll_seconds}s 後再確認：$run_url"
          ;;
      esac
    else
      echo "尚未找到此 commit 的 CI workflow，${ci_poll_seconds}s 後再確認。"
    fi

    if [[ "$(date +%s)" -ge "$deadline" ]]; then
      echo "❌ 等待 CI 超過 ${ci_wait_seconds}s，取消部署。" >&2
      exit 1
    fi
    sleep "$ci_poll_seconds"
  done
}

if [[ "$dry_run" == "1" ]]; then
  if [[ "$push_enabled" == "1" ]]; then
    echo "▶ dry-run：會推送 $branch → $remote_name（目標 $release_sha）"
  else
    echo "▶ dry-run：不推送 Git，確認遠端是否已有 $release_sha"
  fi
elif [[ "$push_enabled" == "1" ]]; then
  echo "▶ 推送 $branch → $remote_name（目標 $release_sha）"
  git push "$remote_name" "HEAD:$branch"
  git fetch --quiet "$remote_name" "$branch"
else
  if ! git merge-base --is-ancestor "$release_sha" "$base_ref"; then
    echo "❌ --no-push 時，遠端尚未包含 $release_sha" >&2
    exit 1
  fi
  echo "▶ 跳過 Git push，使用遠端已有的 $release_sha"
fi

# Docker image 可在 push 後立即平行建置，但正式環境切流只能使用通過完整 CI 的 commit。
if [[ "$dry_run" != "1" ]]; then
  wait_for_ci
fi

if [[ "$migration_mode" != "auto" && "$migration_mode" != "always" && "$migration_mode" != "skip" ]]; then
  echo "❌ DEPLOY_MIGRATION_MODE 必須是 auto、always 或 skip" >&2
  exit 2
fi

migration_changed=0
if git diff --name-only "$base_sha...$release_sha" -- apps/api/alembic/versions/ | grep -q .; then
  migration_changed=1
fi
model_changed=0
if git diff --name-only "$base_sha...$release_sha" -- apps/api/src/api/models/ | grep -q .; then
  model_changed=1
fi

case "$migration_mode" in
  always)
    maintenance_mode=1
    skip_migrate=0
    ;;
  skip)
    if [[ "$migration_changed" == "1" ]]; then
      echo "❌ 這次包含 Alembic migration，不允許 DEPLOY_MIGRATION_MODE=skip" >&2
      exit 1
    fi
    maintenance_mode=0
    skip_migrate=1
    ;;
  auto)
    if [[ "$migration_changed" == "1" ]]; then
      maintenance_mode=1
      skip_migrate=0
    else
      maintenance_mode=0
      skip_migrate=1
    fi
    ;;
esac

if [[ "$model_changed" == "1" && "$migration_changed" == "0" ]]; then
  echo "⚠️  models/ 有變更但沒有新的 Alembic migration；請確認這是純業務邏輯變更。" >&2
fi

echo
echo "部署決策："
echo "  commit:       $release_sha"
echo "  remote:       $ssh_user@$host:$deploy_dir"
echo "  strategy:     bluegreen"
echo "  workers:      $with_workers"
echo "  migration:    $([[ "$skip_migrate" == "1" ]] && echo skip || echo maintenance+upgrade)"
echo "  keep old:     $keep_old"

if [[ "$dry_run" == "1" ]]; then
  echo "✓ dry-run 完成；未連線、未推送、未部署。"
  exit 0
fi

printf -v remote_args ' %q' \
  "$deploy_dir" "$branch" "$release_sha" "$remote_name" "$maintenance_mode" \
  "$skip_migrate" "$with_workers" "$keep_old" "$drain_seconds" \
  "$health_wait_seconds" "$image_wait_seconds" "$require_gpg_verify" "$health_report_required"

echo "▶ 連線遠端並執行精確 SHA 部署"
ssh \
  -i "$ssh_key" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=6 \
  "$ssh_user@$host" "bash -s --$remote_args" <<'REMOTE'
set -euo pipefail

deploy_dir="$1"
branch="$2"
release_sha="$3"
remote_name="$4"
maintenance_mode="$5"
skip_migrate="$6"
with_workers="$7"
keep_old="$8"
drain_seconds="$9"
health_wait_seconds="${10}"
image_wait_seconds="${11}"
require_gpg_verify="${12}"
health_report_required="${13}"

cd -- "$deploy_dir"
[[ -d .git ]] || { echo "❌ 遠端不是 Git 工作樹：$deploy_dir" >&2; exit 1; }
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
[[ "$current_branch" == "$branch" ]] || {
  echo "❌ 遠端分支是 '$current_branch'，不是 '$branch'" >&2
  exit 1
}

dirty="$(git status --porcelain --untracked-files=all)"
if [[ -n "$dirty" ]]; then
  echo "❌ 遠端工作樹有未提交變更，為避免覆蓋手動設定而中止：" >&2
  echo "$dirty" >&2
  exit 1
fi

git fetch --quiet "$remote_name" "$branch"
git pull --ff-only "$remote_name" "$branch"
[[ "$(git rev-parse HEAD)" == "$release_sha" ]] || {
  echo "❌ 遠端 HEAD 與要求的 release SHA 不一致" >&2
  echo "  expected: $release_sha" >&2
  echo "  actual:   $(git rev-parse HEAD)" >&2
  exit 1
}

if [[ "$require_gpg_verify" != "1" ]]; then
  git verify-commit HEAD >/dev/null 2>&1 || \
    echo "⚠️  HEAD 沒有可驗證的 GPG 簽章（REQUIRE_GPG_VERIFY 未啟用）"
elif ! git verify-commit HEAD >/dev/null 2>&1; then
  echo "❌ REQUIRE_GPG_VERIFY=1：commit 簽章驗證失敗" >&2
  exit 1
fi

[[ -x scripts/prod-pull-deploy.sh && -x scripts/prod-health-report.sh ]] || {
  echo "❌ 遠端部署腳本沒有 executable 權限" >&2
  exit 1
}
export RELEASE_SHA="$release_sha"
export SKIP_GIT=1
export WITH_WORKERS="$with_workers"
export MAINTENANCE_MODE="$maintenance_mode"
export SKIP_MIGRATE="$skip_migrate"
export KEEP_OLD="$keep_old"
export DRAIN_SECONDS="$drain_seconds"
export HEALTH_WAIT_SECONDS="$health_wait_seconds"
export GHCR_IMAGE_WAIT_SECONDS="$image_wait_seconds"
export DEPLOY_STRATEGY=bluegreen

./scripts/prod-pull-deploy.sh

if [[ "$health_report_required" == "1" ]]; then
  ./scripts/prod-health-report.sh .env.production docker-compose.bluegreen.yml
else
  ./scripts/prod-health-report.sh .env.production docker-compose.bluegreen.yml || \
    echo "⚠️  部署後健康報告有警告，但 DEPLOY_HEALTH_REPORT_REQUIRED=0，保留部署結果"
fi

echo "✓ 遠端部署完成：$release_sha"
REMOTE

echo "✓ 智慧部署完成：$release_sha"
