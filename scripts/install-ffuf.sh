#!/usr/bin/env bash
set -euo pipefail

version="2.3.0"
archive_name="ffuf_${version}_linux_amd64.tar.gz"
checksums_name="ffuf_${version}_checksums.txt"
checksums_sha256="e23603e903d40453c8bd477561466d494db0e502f2dccbd93926378fead9d0f0"
archive_sha256="b2a3c725fcb9da175159682f54d6e9149f2905b00d84d155e7efc5d599975ceb"
release_url="https://github.com/ffuf/ffuf/releases/download/v${version}"
install_dir="${HOME:?HOME is required}/.local/bin"
temp_dir="$(mktemp -d)"
trap 'rm -rf -- "${temp_dir}"' EXIT

if [[ "$(uname -m)" != "x86_64" ]]; then
  printf 'This pinned ffuf archive requires x86_64.\n' >&2
  exit 1
fi

curl --fail --location --silent --show-error --retry 3 --max-time 180 \
  --output "${temp_dir}/${checksums_name}" "${release_url}/${checksums_name}"
printf '%s  %s\n' "${checksums_sha256}" "${temp_dir}/${checksums_name}" | sha256sum --check --status
grep --fixed-strings --line-regexp \
  "${archive_sha256}  ${archive_name}" "${temp_dir}/${checksums_name}" >/dev/null

curl --fail --location --silent --show-error --retry 3 --max-time 180 \
  --output "${temp_dir}/${archive_name}" "${release_url}/${archive_name}"
printf '%s  %s\n' "${archive_sha256}" "${temp_dir}/${archive_name}" | sha256sum --check --status
tar --extract --gzip --to-stdout --file "${temp_dir}/${archive_name}" ffuf \
  >"${temp_dir}/ffuf"

install -d -m 0755 "${install_dir}"
install -m 0755 "${temp_dir}/ffuf" "${install_dir}/ffuf"
"${install_dir}/ffuf" -V | grep --fixed-strings "ffuf version: ${version}" >/dev/null
printf 'Installed verified ffuf %s at %s/ffuf\n' "${version}" "${install_dir}"
