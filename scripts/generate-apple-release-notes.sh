#!/usr/bin/env bash
set -euo pipefail

current_tag="${1:?current Apple tag is required}"
repository_url="${APPLE_RELEASE_REPOSITORY_URL:?Apple release repository URL is required}"
repository_url="${repository_url%/}"

git rev-parse --verify "${current_tag}^{commit}" >/dev/null
previous_tag="$(git describe --tags --match 'apple-v*' --abbrev=0 "${current_tag}^" 2>/dev/null || true)"
if [[ -z "$previous_tag" ]]; then
  previous_tag="$(git describe --tags --match 'chrome-v*' --abbrev=0 "${current_tag}^" 2>/dev/null || true)"
fi
revision_range="$current_tag"
if [[ -n "$previous_tag" ]]; then
  revision_range="${previous_tag}..${current_tag}"
fi

write_notes() {
  printf '%s\n\n' 'Apple版を再現するためのソーススナップショットです。署名情報は含まれず、iPhoneへ直接インストールする配布物ではありません。'
  printf '%s\n\n' 'SHA256SUMSでダウンロードしたスナップショットを検証できます。'
  printf '%s\n\n' '## 変更'
  git log --reverse --format="- %s ([%h](${repository_url}/commit/%H))" "$revision_range"
}

if [[ $# -ge 2 ]]; then
  write_notes > "$2"
else
  write_notes
fi
