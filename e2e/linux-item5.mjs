// Item 5: polled (non-cgroup) memory watcher on Linux: forced by a dead user bus.
import { readFileSync } from "node:fs";
import { ALL_ON, bash, log, sh, sleep, startTau } from "./linux-harness.mjs";

const P = "/tmp/vl5.pids";
const HOG = (mb, secs) => `python3 -c "import time; b=b'x'*(${mb}*2**20); time.sleep(${secs})"`;
const replies = {
  sacrificial: bash("echo sacrificial"),
  tree: bash(
    `echo main=$$ >> ${P}; setsid sleep 321 & echo escapee=$! >> ${P}; ( setsid sleep 322 & echo daemon=$! >> ${P} ); ${HOG(400, 90)} & echo hog=$! >> ${P}; wait`,
  ),
  small: bash(`${HOG(100, 22)}; echo small-done`),
  idle: bash("sleep 22"),
};
const limit = { priority: "off", heavySlots: null, memoryLimitMb: 150, appliesTo: ALL_ON };
const alive = (pid) => {
  try {
    return !/^\w+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
};
const cpuTicks = (pid) => {
  const f = readFileSync(`/proc/${pid}/stat`, "utf8")
    .replace(/^.*\) /, "")
    .split(" ");
  return [14, 15, 16, 17].reduce((a, i) => a + Number(f[i - 3]), 0); // utime stime cutime cstime
};

const t = await startTau({
  replies,
  env: { XDG_RUNTIME_DIR: "/nonexistent", DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus" },
});
try {
  await t.setResources(limit);
  log("forced linux-basic: support", await t.support());
  const s = await t.thread("sacrificial");
  await t.done(s); // eats the one degraded failure
  sh(`rm -f ${P}`);
  const t0 = Date.now();
  const id = await t.thread("tree");
  await sleep(1500);
  const pids = Object.fromEntries(
    readFileSync(P, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split("=")),
  );
  log("pids", pids);
  const died = {};
  while (Date.now() - t0 < 40000 && Object.keys(died).length < Object.keys(pids).length) {
    for (const [name, pid] of Object.entries(pids))
      if (!(name in died) && !alive(pid)) died[name] = Date.now() - t0;
    await sleep(100);
  }
  log("ms from thread start until each process is gone (hog allocates at ~+0.6 s)", died);
  await t.done(id, 20000);
  log("tool result", t.stored("memory limit"));
  log("survivors (untracked daemons, documented)", sh("pgrep -af 'sleep 32[12]' || echo none"));
  sh("pkill -f 'sleep 32[12]'");

  // CPU cost of the sweep: tau + reaped children CPU ticks over a 20 s window, with and without a limited command
  const clk = Number(sh("getconf CLK_TCK"));
  const window = async (prompt) => {
    const _a = cpuTicks(t.pid);
    const _w0 = Date.now();
    const th = await t.thread(prompt);
    await sleep(1000);
    const b0 = cpuTicks(t.pid);
    await sleep(18000);
    const b1 = cpuTicks(t.pid);
    await t.done(th, 20000);
    return { ticksOver18s: b1 - b0, cpuPercentOfOneCore: Number((((b1 - b0) / clk / 18) * 100).toFixed(2)) };
  };
  await t.setResources({ ...limit, memoryLimitMb: null });
  log("tau CPU while an UNLIMITED sleep runs (baseline, no sweep)", await window("idle"));
  await t.setResources(limit);
  log("tau CPU while a limited command runs (sweep every 2 s)", await window("small"));
  log(
    "one sweep, timed with the real ps format, 20 runs",
    sh(
      `n=$(ps -e | wc -l); echo "procs=$n"; s=$(date +%s%N); for i in $(seq 20); do LC_ALL=C ps -axo pid=,ppid=,pgid=,rss=,lstart= >/dev/null; done; e=$(date +%s%N); echo "avg ms per ps: $(( (e-s)/20000000 ))"`,
    ),
  );
} finally {
  await t.stop();
  sh(`rm -f ${P}; pkill -f 'sleep 32[12]'; true`);
}
