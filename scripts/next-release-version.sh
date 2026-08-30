#!/usr/bin/env bash
set -euo pipefail

release_date="${READER_RELEASE_DATE:-$(TZ=Asia/Tokyo date +%Y-%m-%d)}"
if [[ ! "$release_date" =~ ^([0-9]{4})-(0[1-9]|1[0-2])-[0-9]{2}$ ]]; then
  printf 'invalid release date: %s\n' "$release_date" >&2
  exit 1
fi

year="${BASH_REMATCH[1]}"
month="$((10#${BASH_REMATCH[2]}))"
latest_release=-1

while IFS= read -r tag; do
  release="${tag#*-v${year}.${month}.}"
  if [[ "$release" =~ ^(0|[1-9][0-9]*)$ ]] && (( 10#$release > latest_release )); then
    latest_release="$((10#$release))"
  fi
done < <(git tag --list "chrome-v${year}.${month}.*" "apple-v${year}.${month}.*")

printf '%s.%s.%s\n' "$year" "$month" "$((latest_release + 1))"
