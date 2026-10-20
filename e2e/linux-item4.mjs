// Item 4: probe, degraded mode, re-probe, concurrent probes, hung probe, minimal PATH.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_ON, bash, log, sh, sleep, startTau, units } from "./linux-harness.mjs";

const OUT = "/tmp/vl4.out";
const mark = (n) => bash(`echo "${n} cgroup=$(cat /proc/self/cgroup)" >> ${OUT}`);
const replies = Object.fromEntries(["c1", "c2", "c3", "c4"].map((n) => [n, mark(n)]));
const limit = { priority: "off", heavySlots: null, memoryLimitMb: 150, appliesTo: ALL_ON };
const out = () => sh(`cat ${OUT} 2>/dev/null; rm -f ${OUT}`);
const fakeDir = mkdtempSync(join(tmpdir(), "fakesd-"));
const fake = (body) => {
  writeFileSync(
    join(fakeDir, "systemd-run"),
    `#!/bin/sh\necho "$(date +%s.%N) $*" >> ${fakeDir}/calls\n${body}\n`,
  );
  chmodSync(join(fakeDir, "systemd-run"), 0o755);
  sh(`rm -f ${fakeDir}/calls`);
};
const calls = () => sh(`cat ${fakeDir}/calls 2>/dev/null | cut -c1-150`);
const runAll = async (t, names) => {
  const ids = [];
  for (const n of names) ids.push(await t.thread(n));
  for (const id of ids) await t.done(id, 40000);
};
const msgs = (t) => t.stored('Resource limits unavailable[^"]*');

// A1: env unset -> fill-in makes the probe succeed
let t = await startTau({ replies, unset: ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"] });
try {
  await t.setResources(limit);
  log("A1 support with XDG_RUNTIME_DIR/DBUS unset", await t.support());
  await runAll(t, ["c1"]);
  log("A1 c1 cgroup (expect a tau- scope)", out());
} finally {
  await t.stop();
}

// A2: env points to a dead bus -> degraded
t = await startTau({
  replies,
  env: { XDG_RUNTIME_DIR: "/nonexistent", DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus" },
});
try {
  await t.setResources(limit);
  log("A2 support (dead bus)", await t.support());
  for (const n of ["c1", "c2", "c3"]) {
    await runAll(t, [n]);
  }
  log("A2 commands that ran (c1 must be missing: it takes the one failure)", out());
  log("A2 the one explicit failure", msgs(t));
  log(
    "A2 count of failure messages stored (expect exactly 1 per run of c1; dup lines are store copies)",
    sh(
      `grep -rac 'Resource limits unavailable' ${t.state} | awk -F: '{s+=$2} END {print s" matching lines in store"}'`,
    ),
  );
} finally {
  await t.stop();
}

// A3: transient failure (flag file) then recovery through the 30 s re-probe
fake(
  `[ -e ${fakeDir}/broken ] && { echo "Failed to connect to bus: No medium found" >&2; exit 1; }; exec /usr/bin/systemd-run "$@"`,
);
t = await startTau({ replies, env: { PATH: `${fakeDir}:${process.env.PATH}` } });
try {
  await t.setResources(limit);
  sh(`touch ${fakeDir}/broken`);
  await runAll(t, ["c1"]);
  const first = msgs(t);
  await runAll(t, ["c2"]);
  log("A3 broken: c1 failed with", first);
  log("A3 broken: c2 ran basic wrapper", out());
  sh(`rm ${fakeDir}/broken`);
  const t0 = Date.now();
  let recovered = false;
  while (Date.now() - t0 < 50000 && !recovered) {
    await sleep(5000);
    await runAll(t, ["c3"]);
    recovered = /tau-[0-9a-f]{12}-/.test(out());
  }
  log(
    `A3 recovery: scope in use again after ${Math.round((Date.now() - t0) / 1000)} s (re-probe every 30 s)`,
    recovered,
  );
} finally {
  await t.stop();
}

// B1: concurrent spawns share one probe
fake(`exec /usr/bin/systemd-run "$@"`);
t = await startTau({ replies, env: { PATH: `${fakeDir}:${process.env.PATH}` } });
try {
  await t.setResources(limit);
  await runAll(t, ["c1", "c2", "c3", "c4"]);
  log("B1 systemd-run calls for 4 simultaneous threads (probe lines have tau-probe)", calls());
  log("B1 probe count", sh(`grep -c 'tau-probe' ${fakeDir}/calls`));
  out();
} finally {
  await t.stop();
}

// B2: hung systemd-run -> 2 s timeout, retry once, degrade
fake(`sleep 30`);
t = await startTau({ replies, env: { PATH: `${fakeDir}:${process.env.PATH}` } });
try {
  await t.setResources(limit);
  const t0 = Date.now();
  const ids = [];
  for (const n of ["c1", "c2", "c3"]) ids.push(await t.thread(n));
  const times = [];
  for (const id of ids) {
    await t.done(id, 40000);
    times.push(Date.now() - t0);
  }
  log("B2 hung probe: thread completion ms", times);
  log("B2 probe invocations (expect 2: first + one retry after timeout)", calls());
  log("B2 failure message", msgs(t));
  log("B2 which ran", out());
  log("B2 hung fakes left", sh("pgrep -af 'fakesd.*systemd-run|sleep 30' | head -3 || true"));
} finally {
  await t.stop();
}

// C: minimal PATH
t = await startTau({ replies, env: { PATH: "/nonexistent" } });
try {
  await t.setResources({ priority: "background", heavySlots: null, memoryLimitMb: 150, appliesTo: ALL_ON });
  log("C support with PATH=/nonexistent", await t.support());
  await runAll(t, ["c1"]);
  log("C c1 under PATH=/nonexistent: ran inside a scope", out());
} finally {
  await t.stop();
}
t = await startTau({
  replies: { prio: bash(`ps -o pid,ni,cls -p $$ >> ${OUT}`) },
  env: { PATH: "/usr/bin:/bin" },
});
try {
  await t.setResources({ priority: "background", heavySlots: null, memoryLimitMb: 150, appliesTo: ALL_ON });
  await runAll(t, ["prio"]);
  log("C PATH=/usr/bin:/bin background+scope (expect IDL)", out());
} finally {
  await t.stop();
}
sh(`rm -rf ${fakeDir}`);
log("leftover units", units() || "(none)");
