#!/usr/bin/env bash
set -euo pipefail

release_ref="${1:-HEAD}"
output_directory="${2:-artifacts/apple}"
project_spec="$(git show "${release_ref}:apps/ios/project.yml")"
version="$(printf '%s\n' "$project_spec" | sed -nE 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*([^[:space:]]+)[[:space:]]*$/\1/p')"

if [[ ! "$version" =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]]; then
  printf 'invalid Apple release version at %s: %s\n' "$release_ref" "$version" >&2
  exit 1
fi

archive_name="reader-apple-${version}-source.tar.gz"
archive_path="${output_directory}/${archive_name}"
install -d "$output_directory"
if [[ -e "$archive_path" ]]; then
  unlink "$archive_path"
fi
git archive --format=tar.gz --prefix="reader-${version}/" --output="$archive_path" "$release_ref"
(cd "$output_directory" && shasum -a 256 "$archive_name" > SHA256SUMS)
