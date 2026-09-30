#!/usr/bin/env bash
set -euo pipefail

user_home="${HOME:?HOME is required}"
user_name="$(id -un)"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
user_unit_dir="${XDG_CONFIG_HOME:-${user_home}/.config}/systemd/user"
report_dir="${user_home}/.local/state/hcca-security"

mkdir -p "${user_unit_dir}" "${report_dir}"
chmod 700 "${report_dir}"
install -m 0644 "${repo_root}/scripts/systemd/user/hcca-security@.service" "${user_unit_dir}/hcca-security@.service"
install -m 0644 "${repo_root}/scripts/systemd/user/hcca-security-daily.timer" "${user_unit_dir}/hcca-security-daily.timer"
install -m 0644 "${repo_root}/scripts/systemd/user/hcca-security-http-baseline.timer" "${user_unit_dir}/hcca-security-http-baseline.timer"
install -m 0644 "${repo_root}/scripts/systemd/user/hcca-security-path-enumeration.timer" "${user_unit_dir}/hcca-security-path-enumeration.timer"
install -m 0644 "${repo_root}/scripts/systemd/user/hcca-security-public-metadata.timer" "${user_unit_dir}/hcca-security-public-metadata.timer"
install -m 0644 "${repo_root}/scripts/systemd/user/hcca-security-path-fuzz.timer" "${user_unit_dir}/hcca-security-path-fuzz.timer"

systemctl --user daemon-reload
loginctl enable-linger "${user_name}"
systemctl --user enable --now \
  hcca-security-daily.timer \
  hcca-security-http-baseline.timer \
  hcca-security-path-enumeration.timer \
  hcca-security-public-metadata.timer \
  hcca-security-path-fuzz.timer
systemctl --user list-timers --all --no-pager
