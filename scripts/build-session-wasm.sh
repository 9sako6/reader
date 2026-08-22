#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
wasm_bindgen_version="0.2.127"
wasm_target="wasm32-unknown-unknown"
wasm_output="$repo_root/.build/session-wasm"
wasm_binary="$repo_root/target/$wasm_target/release/reader_session.wasm"

command -v cargo >/dev/null
command -v wasm-bindgen >/dev/null

if ! wasm-bindgen --version | grep -F "wasm-bindgen $wasm_bindgen_version" >/dev/null; then
  echo "wasm-bindgen $wasm_bindgen_version is required" >&2
  exit 1
fi

if ! rustc --print target-libdir --target "$wasm_target" >/dev/null 2>&1; then
  echo "Rust target $wasm_target is required" >&2
  exit 1
fi

cargo build --locked --package reader-session --target "$wasm_target" --release
rm -rf "$wasm_output"
install -d "$wasm_output"
wasm-bindgen "$wasm_binary" --target no-modules --no-typescript --out-dir "$wasm_output"
