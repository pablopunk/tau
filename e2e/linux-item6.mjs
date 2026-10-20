// Item 6: priority vs the user's session. Run through linux-item6.sh (loads live in the ssh session's cgroup).
import { readFileSync } from "node:fs";
import { ALL_ON, bash, log, sh, startTau } from "./linux-harness.mjs";

const mode = process.argv[2];
const OUT = `/tmp/vl6-${mode}.out`;
const work = (name) =>
  bash(`python3 -c "import time; end=time.time()+8; n=0
while time.time()<end:
    for _ in range(10000): pass
    n+=1
print('${name} M-iterations-per-8s', round(n*10000/1e6))" >> ${OUT}; cat /proc/self/cgroup >> ${OUT}`);
const replies = Object.fromEntries(["off", "balanced", "background"].map((n) => [n, work(n)]));
const t = await startTau({ replies });
try {
  log(`mode=${mode}: tau's own cgroup`, readFileSync("/proc/self/cgroup", "utf8").trim());
  log(`mode=${mode}: support`, await t.support());
  for (const p of ["off", "balanced", "background"]) {
    await t.setResources({ priority: p, heavySlots: null, memoryLimitMb: null, appliesTo: ALL_ON });
    console.log("running", p);
    const id = await t.thread(p);
    await t.done(id, 120000);
  }
  log(
    `mode=${mode}: millions of loop iterations done in 8 s wall (higher = bigger CPU share) (competitors: ${process.env.LOADS ?? 0} busy loops in the ssh session)`,
    sh(`cat ${OUT}; rm -f ${OUT}`),
  );
} finally {
  await t.stop();
}
