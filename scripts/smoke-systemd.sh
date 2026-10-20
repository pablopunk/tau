#!/usr/bin/env bash
set -euo pipefail

# P6 on systemd (BUN-BINARY.md section 10): swap `current` while a user unit runs, then restart and roll back.
# Linux only; needs a systemd user manager (XDG_RUNTIME_DIR set). Scratch dirs and a scratch unit name only.
#   scripts/smoke-systemd.sh <release-dir>   (archives, SHA256SUMS, install.sh)

release="${1:?usage: smoke-systemd.sh <release-dir>}"
scratch="$(mktemp -d)"
unit="tau-scratch-$$"
install_dir="$scratch/install"
home="$scratch/home"
mkdir -p "$home"

cleanup() {
  systemctl --user stop "$unit.service" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/$unit.service"
  systemctl --user daemon-reload || true
  rm -rf "$scratch"
}
trap cleanup EXIT

TAU_INSTALL_DIR="$install_dir" TAU_BIN_DIR="$scratch/bin" TAU_RELEASE_BASE="file://$release" \
  TAU_INSTALL_NO_START=1 sh "$release/install.sh" >/dev/null
first="$(readlink "$install_dir/current")"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$unit.service" <<UNIT
[Service]
ExecStart=$install_dir/current/tau serve --faux --no-open --port $port --home $home
Restart=always
UNIT
systemctl --user daemon-reload
systemctl --user start "$unit.service"

wait_health() {
  for _ in $(seq 1 150); do
    curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "no health on port $port" >&2; journalctl --user -u "$unit.service" --no-pager | tail -n 30 >&2; return 1
}
main_pid() { systemctl --user show -p MainPID --value "$unit.service"; }
exe_of() { readlink "/proc/$(main_pid)/exe"; }
swap_to() {
  ln -s "versions/$1" "$install_dir/current.tmp"
  mv -T "$install_dir/current.tmp" "$install_dir/current"
}

wait_health
pid="$(main_pid)"
[[ "$(exe_of)" == "$install_dir/versions/${first#versions/}/tau" ]] || { echo "unexpected exe $(exe_of)" >&2; exit 1; }

cp -a "$install_dir/versions/${first#versions/}" "$install_dir/versions/next"
swap_to next
[[ "$(main_pid)" == "$pid" && "$(exe_of)" == *"/versions/${first#versions/}/tau" ]] || { echo "the running server changed on swap" >&2; exit 1; }
curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null

systemctl --user restart "$unit.service"
wait_health
[[ "$(exe_of)" == *"/versions/next/tau" ]] || { echo "restart did not pick the new version: $(exe_of)" >&2; exit 1; }

swap_to "${first#versions/}"
systemctl --user restart "$unit.service"
wait_health
[[ "$(exe_of)" == *"/versions/${first#versions/}/tau" ]] || { echo "rollback failed: $(exe_of)" >&2; exit 1; }
echo "systemd swap, restart and rollback ok"
