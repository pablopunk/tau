// Item 3: kernel memory limit through a systemd scope.
import { ALL_ON, bash, log, sh, sleep, startTau, units } from "./linux-harness.mjs";

const HOG = (mb, secs = 0) => `python3 -c "import time; b=b'x'*(${mb}*2**20); time.sleep(${secs})"`;
const replies = {
  hog: bash(`${HOG(400, 5)}; echo "after hog rc=$?"`),
  under: bash(`${HOG(100)}; echo "under-limit ok"`),
  stopme: bash(`${HOG(100, 300)}`),
  escape: bash(
    `setsid sleep 311 >/dev/null 2>&1 & ( setsid sleep 312 >/dev/null 2>&1 & ) ; sleep 1; for p in $(pgrep -f 'sleep 31[12]'); do echo "escapee $p cgroup=$(cat /proc/$p/cgroup) sid=$(ps -o sid= -p $p)" >> /tmp/vl3-escape.txt; done; sleep 2; ${HOG(400, 5)}`,
  ),
  slow: bash(`sleep 3; echo slow-done`),
};
const limit = { priority: "off", heavySlots: null, memoryLimitMb: 150, appliesTo: ALL_ON };
const failed = () => sh("systemctl --user list-units --state=failed 'tau-*' --no-legend || true");
let t = await startTau({ replies });
const root = t.root;
try {
  await t.setResources(limit);
  log("support", await t.support());
  let id = await t.thread("under");
  await t.done(id);
  log("under limit (150M, 100M hog): tool result", t.stored("under-limit ok"));
  log("units after under-limit", units() || "(none)");

  id = await t.thread("hog");
  await sleep(1500);
  log("units while hog runs", units());
  const t0 = Date.now();
  await t.done(id);
  log(`hog thread done in ${Date.now() - t0} ms`, "");
  log("tool result for the 400M hog", t.stored("memory limit"));
  log("failed tau units after (expect none)", failed() || "(none)");
  log("all tau units after (expect none)", units() || "(none)");

  sh("rm -f /tmp/vl3-escape.txt");
  id = await t.thread("escape");
  await sleep(2000);
  log("units + escapees before kill", `${units()}\n${sh("pgrep -af 'sleep 31[12]'")}`);
  await t.done(id);
  log("escapee cgroups recorded while alive", sh("cat /tmp/vl3-escape.txt; rm -f /tmp/vl3-escape.txt"));
  log("escapees after oom kill (expect none)", sh("pgrep -af 'sleep 31[12]' || echo none"));
  log("scope units after", units() || "(none)");

  await t.stop(true);
  t = await startTau({ replies });
  await t.setResources(limit);
  id = await t.thread("stopme");
  await sleep(2000);
  const unitsBefore = units();
  await t.abort(id);
  await t.done(id, 20000);
  log("user Stop: units before", unitsBefore);
  log("user Stop: stored message (must NOT say memory limit)", t.stored("Command aborted|aborted|Stopped"));
  log("user Stop: python left?", sh("pgrep -af 'time.sleep\\(300\\)' || echo none"));
  log("user Stop: units/failed after", `${units() || "(none)"} | failed: ${failed() || "(none)"}`);
  await t.stop(true);

  // manual proof of Result=oom-kill and SIGTERM exit
  log(
    "manual scope: Result before reset-failed",
    sh(
      `systemd-run --user --scope --quiet --unit=tau-manual-vl -p MemoryMax=150M -p MemorySwapMax=0 -- ${HOG(400, 3)}; echo "rc=$?"; systemctl --user show tau-manual-vl.scope -p Result,ActiveState`,
    ),
  );
  log(
    "manual: failed list then reset-failed",
    `${failed()}\n--\n${sh("systemctl --user reset-failed tau-manual-vl.scope; systemctl --user list-units --state=failed 'tau-*' --no-legend || true") || "(none)"}`,
  );

  // startup reset-failed: learn prefix, plant a stale failed unit, restart tau on the same state
  t = await startTau({ root, replies });
  await t.setResources(limit);
  id = await t.thread("slow");
  await sleep(1500);
  const prefix = (sh("systemctl --user list-units 'tau-*' --all --no-legend; true").match(
    /tau-[0-9a-f]{12}/,
  ) ?? [])[0];
  await t.done(id);
  await t.stop(true);
  log("node unit prefix", prefix ?? "(not seen; command too fast)");
  if (prefix) {
    sh(
      `systemd-run --user --scope --quiet --unit=${prefix}-stale -p MemoryMax=64M -p MemorySwapMax=0 -- ${HOG(300, 2)}`,
    );
    log("planted stale failed unit", failed());
    t = await startTau({ root, replies });
    await t.setResources(limit);
    log("failed before first governed spawn (server up, no command yet)", failed());
    id = await t.thread("under");
    await t.done(id);
    log("failed after first governed spawn (expect none)", failed() || "(none)");
  }
} finally {
  await t.stop();
}
