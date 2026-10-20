// Item 2: priority really applied (nice / chrt / fallback), pid == group leader, Stop kills the tree.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_ON, bash, log, sh, sleep, startTau } from "./linux-harness.mjs";

const out = mkdtempSync(join(tmpdir(), "vl2-"));
const probe = (name) =>
  `{ echo "shell=$$"; ps -o pid,ni,cls,pgid,policy -p $$; chrt -p $$; ps -o pid,ni,cls -p $$; } > ${out}/${name}.txt 2>&1`;
const replies = {
  base: bash(probe("off")),
  bal: bash(probe("balanced")),
  bg: bash(probe("background")),
  exit7: bash(`${probe("bgexit")}; exit 7`),
  tree: bash(
    `sleep 300 & sleep 301 & { echo "shell=$$"; ps -o pid,ppid,pgid,args -g $$ ; } > ${out}/tree.txt 2>&1; sleep 300`,
  ),
};
const run = async (t, prompt, priority) => {
  await t.setResources({ priority, heavySlots: null, memoryLimitMb: null, appliesTo: ALL_ON });
  const id = await t.thread(prompt);
  await t.done(id);
  return id;
};
const show = (n) => {
  try {
    return readFileSync(`${out}/${n}.txt`, "utf8");
  } catch {
    return "(missing)";
  }
};

let t = await startTau({ replies, env: { TAU_CLI: undefined } });
try {
  await run(t, "base", "off");
  log("Off", show("off"));
  await run(t, "bal", "balanced");
  log("Balanced (expect NI 5)", show("balanced"));
  await run(t, "bg", "background");
  log("Background (expect cls IDL / SCHED_IDLE)", show("background"));
  const id = await run(t, "exit7", "background");
  log("Background exit 7: stored tool result", t.stored("exit code|Exit code|exited with"));
  // tree + Stop
  await t.setResources({ priority: "background", heavySlots: null, memoryLimitMb: null, appliesTo: ALL_ON });
  const tid = await t.thread("tree");
  await sleep(2500);
  log("tree: wrapped shell = group leader? (pid==pgid of shell)", show("tree"));
  log("sleepers alive before Stop", sh("pgrep -af 'sleep 30[01]'"));
  await t.abort(tid);
  await t.done(tid, 20000);
  await sleep(500);
  log("sleepers after Stop (expect none)", sh("pgrep -af 'sleep 30[01]' || echo none"));
  log("stored message", t.stored("Command aborted"));
} finally {
  await t.stop();
}

// forced fallback: chrt hidden from the server's PATH and /usr/bin first... chrt lives in /usr/bin, so use a fake failing chrt first in PATH
const fake = mkdtempSync(join(tmpdir(), "fakechrt-"));
sh(`printf '#!/bin/sh\\nexit 1\\n' > ${fake}/chrt && chmod +x ${fake}/chrt`);
t = await startTau({
  replies: { fb: bash(probe("fallback")), fbx: bash(`${probe("fallbackexit")}; exit 3`) },
  env: { PATH: `${fake}:${process.env.PATH}` },
});
try {
  await run(t, "fb", "background");
  log("Fallback (chrt fails): expect NI 19, cls TS", show("fallback"));
  await run(t, "fbx", "background");
  log("Fallback exit 3 file", show("fallbackexit"));
  log("Fallback exit 3 stored tool result", t.stored("exited with code 3|exit code 3|code 3"));
} finally {
  await t.stop();
}
sh(`rm -rf ${out} ${fake}`);
