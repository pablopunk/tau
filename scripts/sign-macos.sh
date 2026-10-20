#!/usr/bin/env bash
set -euo pipefail

# Signs every Mach-O of a tau version folder inside-out (claude-sdk natives, pi-env, tau) with the hardened
# runtime and a timestamp, then verifies each one. Needs the Developer ID identity in the default keychain.
#   scripts/sign-macos.sh <version-dir>
# The native `claude` and `tau` are Bun executables and get packaging/tau.entitlements; the rest get none.

dir="${1:?usage: sign-macos.sh <version-dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
entitlements="$root/packaging/tau.entitlements"

identity="$(security find-identity -v -p codesigning | sed -nE 's/^ *[0-9]+\) ([0-9A-F]{40}) "Developer ID Application:.*/\1/p' | head -n 1)"
[[ -n "$identity" ]] || { echo "no Developer ID Application identity in the keychain" >&2; exit 1; }

machos() {
  find "$1" -type f -print0 | while IFS= read -r -d '' file; do
    if file -b "$file" | grep -q 'Mach-O'; then printf '%s\0' "$file"; fi
  done
}

sign() {
  local file="$1"; shift
  codesign --force --options runtime --timestamp --sign "$identity" "$@" "$file"
}

verify() {
  local file="$1" details
  codesign --verify --strict -vv "$file"
  details="$(codesign -dvv "$file" 2>&1)"
  grep -q 'Authority=Developer ID Application' <<<"$details" || { echo "$file: not Developer ID signed" >&2; return 1; }
  grep -Eq 'flags=0x[0-9a-f]+\(.*runtime' <<<"$details" || { echo "$file: hardened runtime flag missing" >&2; return 1; }
  if codesign -d --entitlements - "$file" 2>/dev/null | grep -q 'get-task-allow'; then
    echo "$file: has get-task-allow" >&2; return 1
  fi
}

sdk_files=()
while IFS= read -r -d '' file; do sdk_files+=("$file"); done < <(machos "$dir/claude-sdk")
[[ ${#sdk_files[@]} -gt 0 ]] || { echo "no Mach-O under claude-sdk: the layout changed" >&2; exit 1; }

for file in "${sdk_files[@]}"; do
  if [[ "$(basename "$file")" == claude ]]; then sign "$file" --entitlements "$entitlements"; else sign "$file"; fi
done
sign "$dir/pi-env"
sign "$dir/tau" --entitlements "$entitlements"

count=0
while IFS= read -r -d '' file; do
  verify "$file"
  count=$((count + 1))
done < <(machos "$dir")
echo "signed and verified $count Mach-O files in $dir"
