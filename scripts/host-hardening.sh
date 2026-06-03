#!/usr/bin/env bash
#
# host-hardening.sh — VPS 主機層防護加固（在伺服器上以 root 跑一次）
#
#   sudo bash scripts/host-hardening.sh
#
# 做四件事，全部 idempotent（可重複跑）：
#   1. Docker daemon log rotation + live-restore（防 log 塞爆磁碟；重啟 daemon 時容器不中斷）
#   2. earlyoom — 在核心 OOM 凍住整機前，先殺掉最大記憶體 hog（通常就是失控的容器）
#   3. vm.swappiness 調低 — 減少過早 swap 造成的龜速
#   4. grub cgroup swapaccount — 讓 docker-compose 的 memswap_limit 真正生效（★需重開機★）
#
# 跑完後若有提示 REBOOT，請排一次重開機讓第 4 項生效。
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "請用 root 執行：sudo bash $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NEED_REBOOT=0

echo "==> [1/4] Docker daemon log rotation + live-restore"
install -d -m 0755 /etc/docker
if [[ -f "${REPO_ROOT}/deploy/daemon.json" ]]; then
  # 若已存在且內容相同就跳過 restart，避免無謂中斷
  if ! cmp -s "${REPO_ROOT}/deploy/daemon.json" /etc/docker/daemon.json 2>/dev/null; then
    cp "${REPO_ROOT}/deploy/daemon.json" /etc/docker/daemon.json
    echo "    daemon.json 已更新 → 重啟 docker（live-restore 下容器不會中斷）"
    systemctl restart docker
  else
    echo "    daemon.json 已是最新，略過"
  fi
else
  echo "    找不到 deploy/daemon.json，略過（請確認在 repo 根目錄下執行）" >&2
fi

echo "==> [2/4] earlyoom（userspace OOM 守護）"
if ! command -v earlyoom >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq earlyoom
fi
# -m 6 / -s 6：可用 RAM 或 swap 低於 6% 時動作；-r 3600：每小時報告一次
# --avoid：保護關鍵程序（DB / docker / ssh / init），讓 earlyoom 去殺其餘最大者
cat >/etc/default/earlyoom <<'EOF'
# 由 scripts/host-hardening.sh 產生
EARLYOOM_ARGS="-r 3600 -m 6 -s 6 --avoid '^(sshd|dockerd|containerd|systemd|init|postgres)$'"
EOF
systemctl enable --now earlyoom
systemctl restart earlyoom
echo "    earlyoom 已啟用：$(systemctl is-active earlyoom)"

echo "==> [3/4] vm.swappiness / vfs_cache_pressure"
cat >/etc/sysctl.d/99-hcca.conf <<'EOF'
# 由 scripts/host-hardening.sh 產生
vm.swappiness = 10
vm.vfs_cache_pressure = 50
EOF
sysctl --system >/dev/null
echo "    swappiness=$(cat /proc/sys/vm/swappiness)"

echo "==> [4/4] grub cgroup swapaccount（memswap_limit 生效所需）"
GRUB_FILE=/etc/default/grub
if [[ -f "${GRUB_FILE}" ]]; then
  if grep -q "swapaccount=1" "${GRUB_FILE}"; then
    echo "    swapaccount 已設定，略過"
  else
    # 在 GRUB_CMDLINE_LINUX 既有值後面附加參數
    sed -i -E 's/^(GRUB_CMDLINE_LINUX=")([^"]*)(")/\1\2 cgroup_enable=memory swapaccount=1\3/' "${GRUB_FILE}"
    update-grub
    NEED_REBOOT=1
    echo "    已寫入 grub 並 update-grub"
  fi
else
  echo "    找不到 ${GRUB_FILE}（非 grub 系統？），略過 swapaccount" >&2
fi

echo "==> 確保 docker 開機自啟"
systemctl enable docker >/dev/null 2>&1 || true

echo
echo "===================================================================="
echo " 主機加固完成。"
if [[ "${NEED_REBOOT}" -eq 1 ]]; then
  echo " ★ 需要重開機一次，memswap_limit（禁用 swap 的硬上限）才會生效："
  echo "     sudo reboot"
else
  echo " 無需重開機。"
fi
echo "===================================================================="
