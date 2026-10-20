#!/bin/sh
# usage: linux-item6.sh  (from an ssh session; node 24 on PATH, TAU_CLI set)
cd "$(dirname "$0")"
echo "ssh session cgroup: $(cat /proc/self/cgroup)"
echo "== no load =="; LOADS=0 node linux-item6.mjs session 2>&1 | grep -a "iterations\|^off\|^balanced\|^background"
pids=""
for i in 1 2 3 4; do sh -c 'while :; do :; done' & pids="$pids $!"; done
sleep 1
echo "load cgroup: $(cat /proc/$(echo $pids | cut -d' ' -f1)/cgroup)"
echo "== tau started from the ssh session (same cgroup as the loads) =="
LOADS=4 node linux-item6.mjs session 2>&1 | grep -av "title\|generateTitle\|generateFor\|pi-web-access"
echo "== tau as a systemd --user service =="
systemd-run --user --pipe --wait --collect --quiet --unit=tau-vl6-service \
  --setenv=PATH="$PATH" --setenv=TAU_CLI="$TAU_CLI" --setenv=LOADS=4 --working-directory="$PWD" \
  node linux-item6.mjs service 2>&1 | grep -av "title\|generateTitle\|generateFor\|pi-web-access"
kill $pids 2>/dev/null
