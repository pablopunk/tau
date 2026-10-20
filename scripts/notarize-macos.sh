#!/usr/bin/env bash
set -euo pipefail

# Notarizes the signed Mach-Os of a tau version folder (a throwaway ditto zip; bare executables cannot be stapled).
#   APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… scripts/notarize-macos.sh <version-dir>

dir="${1:?usage: notarize-macos.sh <version-dir>}"
: "${APPLE_ID:?}" "${APPLE_APP_SPECIFIC_PASSWORD:?}" "${APPLE_TEAM_ID:?}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/stage"
find "$dir" -type f -print0 | while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q 'Mach-O'; then
    relative="${file#"$dir"/}"
    mkdir -p "$work/stage/$(dirname "$relative")"
    ditto "$file" "$work/stage/$relative"
  fi
done
ditto -c -k --keepParent "$work/stage" "$work/notarize.zip"

result="$(xcrun notarytool submit "$work/notarize.zip" \
  --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait --output-format json)"
echo "$result"
status="$(jq -r .status <<<"$result")"
if [[ "$status" != "Accepted" ]]; then
  id="$(jq -r .id <<<"$result")"
  xcrun notarytool log "$id" --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" || true
  echo "notarization status: $status" >&2
  exit 1
fi
