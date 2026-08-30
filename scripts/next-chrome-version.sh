#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CHROME_RELEASE_DATE:-}" && -z "${READER_RELEASE_DATE:-}" ]]; then
  export READER_RELEASE_DATE="$CHROME_RELEASE_DATE"
fi

exec bash "$(dirname "$0")/next-release-version.sh"
