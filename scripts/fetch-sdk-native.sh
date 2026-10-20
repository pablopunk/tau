#!/usr/bin/env bash
set -euo pipefail

# Puts the Claude Agent SDK native package for a target platform where scripts/build-binary.ts looks for it
# (pnpm's virtual store), when the install host skipped it. The tarball is checked against the lockfile integrity.
#   scripts/fetch-sdk-native.sh <darwin-arm64|darwin-x64|linux-x64[-baseline]|linux-arm64>

platform="${1:?usage: fetch-sdk-native.sh <platform>}"
platform="${platform%-baseline}"
name="claude-agent-sdk-$platform"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
store="$root/node_modules/.pnpm"

entry="$(grep -E "^  '@anthropic-ai/$name@[0-9.]+':" "$root/pnpm-lock.yaml" | head -n 1 || true)"
[[ -n "$entry" ]] || { echo "no lockfile entry for @anthropic-ai/$name" >&2; exit 1; }
version="$(sed -E "s/.*@([0-9.]+)':.*/\1/" <<<"$entry")"
integrity="$(grep -A1 -F "$entry" "$root/pnpm-lock.yaml" | sed -nE 's/.*integrity: (sha512-[^,}]+).*/\1/p' | head -n 1)"
[[ -n "$integrity" ]] || { echo "no integrity for $name@$version in the lockfile" >&2; exit 1; }

target="$store/@anthropic-ai+$name@$version/node_modules/@anthropic-ai/$name"
if [[ -d "$target" ]]; then echo "$name@$version already installed"; exit 0; fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(cd "$work" && npm pack "@anthropic-ai/$name@$version" --silent >/dev/null)
tarball="$(ls "$work"/*.tgz)"
actual="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 | tr -d '\n')"
[[ "$actual" == "$integrity" ]] || { echo "integrity mismatch for $name@$version" >&2; exit 1; }
mkdir -p "$target"
tar -xzf "$tarball" -C "$target" --strip-components=1
echo "fetched $name@$version"
