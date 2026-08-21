#!/usr/bin/env bash
set -euo pipefail

current_tag="${1:?current Chrome tag is required}"

git rev-parse --verify "${current_tag}^{commit}" >/dev/null
previous_tag="$(git describe --tags --match 'chrome-v*' --abbrev=0 "${current_tag}^" 2>/dev/null || true)"
revision_range="$current_tag"
if [[ -n "$previous_tag" ]]; then
  revision_range="${previous_tag}..${current_tag}"
fi

write_notes() {
  printf '%s\n\n' 'zipを展開し、Chromeの拡張機能画面から展開したディレクトリを読み込んでください。'
  printf '%s\n\n' 'SHA256SUMSでダウンロードしたzipを検証できます。'
  printf '%s\n\n' '## 変更'
  git log --reverse --format='- %s' "$revision_range"
}

if [[ $# -ge 2 ]]; then
  write_notes > "$2"
else
  write_notes
fi
