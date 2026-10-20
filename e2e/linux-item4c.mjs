// Item 4c: background priority + memory scope under a minimal PATH (absolute chrt/nice/systemd-run).
import { ALL_ON, bash, log, sh, startTau, units } from "./linux-harness.mjs";

const OUT = "/tmp/vl4c.out";
for (const path of ["/usr/bin:/bin", "/nonexistent"]) {
  sh(`rm -f ${OUT}`);
  const cmd = `/usr/bin/ps -o pid,ni,cls,policy -p $$ >> ${OUT}; read l < /proc/self/cgroup; echo "cgroup=$l" >> ${OUT}`;
  const t = await startTau({ replies: { prio: bash(cmd) }, env: { PATH: path } });
  try {
    await t.setResources({ priority: "background", heavySlots: null, memoryLimitMb: 150, appliesTo: ALL_ON });
    const id = await t.thread("prio");
    await t.done(id, 30000);
    log(`PATH=${path}: background + memory scope (expect IDL and a tau- scope)`, sh(`cat ${OUT}`));
  } finally {
    await t.stop();
  }
}
log("leftover units", units() || "(none)");
