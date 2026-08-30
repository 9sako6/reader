#!/usr/bin/env bash
set -euo pipefail

repository="${1:-.}"
revision="$(git -C "$repository" rev-parse --short=8 HEAD)"

if [[ -n "$(git -C "$repository" status --porcelain --untracked-files=normal)" ]]; then
  revision="${revision}-dirty"
fi

printf '%s\n' "$revision"
