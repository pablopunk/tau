#!/bin/sh
# Install tau from a GitHub release:
#   curl -fsSL https://github.com/pablopunk/tau/releases/latest/download/install.sh | sh
#
# Environment (all optional):
#   TAU_INSTALL_DIR       install root (default ~/.local/share/tau)
#   TAU_BIN_DIR           where the `tau` link goes (default ~/.local/bin)
#   TAU_VERSION           install this version (default: the latest release)
#   TAU_RELEASE_BASE      download base URL (default: the GitHub release); tests use file://
#   TAU_INSTALL_NO_START  1 = do not run bare `tau` at the end (tests)
set -eu

REPO="pablopunk/tau"
INSTALL_DIR="${TAU_INSTALL_DIR:-$HOME/.local/share/tau}"
BIN_DIR="${TAU_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
die() { printf 'tau install: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "do not run as root; run it as the user that will use tau"

detect_platform() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "unsupported OS: $(uname -s) (macOS and Linux only)" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) die "unsupported CPU: $(uname -m) (arm64 and x64 only)" ;;
  esac
}

release_base() {
  if [ -n "${TAU_RELEASE_BASE:-}" ]; then
    printf '%s' "$TAU_RELEASE_BASE"
  elif [ -n "${TAU_VERSION:-}" ]; then
    printf 'https://github.com/%s/releases/download/v%s' "$REPO" "${TAU_VERSION#v}"
  else
    printf 'https://github.com/%s/releases/latest/download' "$REPO"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f 1
  else die "need sha256sum or shasum to verify the download"
  fi
}

swap_current() {
  version="$1"
  ln -s "versions/$version" "$INSTALL_DIR/current.tmp"
  if [ "$os" = darwin ]; then mv -fh "$INSTALL_DIR/current.tmp" "$INSTALL_DIR/current"
  else mv -T "$INSTALL_DIR/current.tmp" "$INSTALL_DIR/current"
  fi
}

report_other_taus() {
  others=""
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] || continue
    [ "$dir" != "$BIN_DIR" ] || continue
    [ -x "$dir/tau" ] && others="$others$dir/tau
"
  done
  IFS=$old_ifs
  if [ -n "$others" ]; then
    say ""
    say "Other tau installs on your PATH (they may shadow this one). Remove them:"
    printf '%s' "$others" | sed 's/^/  /'
  fi
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say ""; say "$BIN_DIR is not on your PATH. Add it, for example: export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
}

main() {
  detect_platform
  command -v curl >/dev/null 2>&1 || die "curl is required"
  base=$(release_base)
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT INT TERM

  say "Downloading SHA256SUMS ($os-$arch)"
  curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS" || die "could not download $base/SHA256SUMS"
  line=$(grep -E "  tau-.*-$os-$arch\.tar\.gz\$" "$work/SHA256SUMS" | head -n 1 || true)
  [ -n "$line" ] || die "this release has no archive for $os-$arch"
  expected=$(printf '%s' "$line" | cut -d ' ' -f 1)
  archive=$(printf '%s' "$line" | sed 's/^[^ ]*  //')
  version=${archive#tau-}
  version=${version%-"$os-$arch.tar.gz"}

  say "Downloading $archive"
  curl -fsSL "$base/$archive" -o "$work/$archive" || die "could not download $base/$archive"
  [ "$(sha256_of "$work/$archive")" = "$expected" ] || die "SHA-256 mismatch for $archive; nothing was installed"

  mkdir -p "$INSTALL_DIR/versions" "$BIN_DIR"
  staging="$INSTALL_DIR/versions/.$version.tmp"
  rm -rf "$staging"
  mkdir -p "$staging"
  tar -xzf "$work/$archive" -C "$staging" --strip-components=1
  [ -x "$staging/tau" ] || { rm -rf "$staging"; die "the archive has no tau binary"; }
  [ "$os" != darwin ] || xattr -dr com.apple.quarantine "$staging" 2>/dev/null || true
  rm -rf "$INSTALL_DIR/versions/$version"
  mv "$staging" "$INSTALL_DIR/versions/$version"

  swap_current "$version"
  ln -sf "$INSTALL_DIR/current/tau" "$BIN_DIR/tau.tmp"
  mv -f "$BIN_DIR/tau.tmp" "$BIN_DIR/tau"
  say "Installed tau $version in $INSTALL_DIR (linked at $BIN_DIR/tau)"
  report_other_taus

  if [ "${TAU_INSTALL_NO_START:-}" = 1 ]; then return 0; fi
  say ""
  "$INSTALL_DIR/current/tau"
}

main "$@"
