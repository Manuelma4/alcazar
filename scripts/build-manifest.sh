#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Write build/manifest.json: the compilers and hardening flags the core was
# built with. Gatehouse shows it on /api/posture.
#   usage: build-manifest.sh COBC FC COBFLAGS FFLAGS
set -eu

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

json_flags() {
  set -f
  first=1
  printf '['
  for flag in $(printf '%s' "$1" | tr -d '"'); do
    [ "$first" -eq 1 ] || printf ','
    json_string "$flag"
    first=0
  done
  printf ']'
  set +f
}

cobc_version=$("$1" --version 2>/dev/null | head -n 1 || echo unknown)
fc_version=$("$2" --version 2>/dev/null | head -n 1 || echo unknown)

printf '{"generatedAt":%s,' "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
printf '"cobol":{"compiler":%s,"flags":%s},' "$(json_string "$cobc_version")" "$(json_flags "$3")"
printf '"fortran":{"compiler":%s,"flags":%s}}\n' "$(json_string "$fc_version")" "$(json_flags "$4")"
