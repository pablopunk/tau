// Item 7: heavy-slot queue end to end on Linux (API equivalent of e2e/tests/resources.spec.ts).
import { ALL_ON, bash, log, sh, sleep, startTau } from "./linux-harness.mjs";

const HEAVY = "cargo test --nothing 2>/dev/null; sleep 6; echo done";
const replies = Object.fromEntries(["heavy one", "heavy two", "heavy three"].map((p) => [p, bash(HEAVY)]));
const t = await startTau({ replies });
const waitActivity = async (check, label) => {
  for (let i = 0; i < 100; i++) {
    const a = await t.activity();
    if (check(a)) return a;
    await sleep(200);
  }
  throw new Error(`${label}: ${JSON.stringify(await t.activity())}`);
};
try {
  await t.setResources({ priority: "balanced", heavySlots: 1, memoryLimitMb: null, appliesTo: ALL_ON });
  const ids = [];
  for (const p of ["heavy one", "heavy two", "heavy three"]) {
    ids.push(await t.thread(p));
    await sleep(150);
  }
  const a = await waitActivity((v) => v.holders.length === 1 && v.waiting.length === 2, "queue");
  log("1 holder + 2 waiting", a);
  log("sleep processes running now (expect 1)", sh("pgrep -cx sleep || true"));
  log("queue message in the waiting threads", t.stored("Waiting for a free slot[^\\\\]*"));
  const victim = a.waiting[1].entryId;
  const r = await t.call("DELETE", `/api/settings/resources/activity/${victim}`);
  log(`Stop queued ${victim} -> HTTP`, r.status);
  const b = await waitActivity(
    (v) => v.holders.length === 1 && v.waiting.length === 1,
    "after stop of queued",
  );
  log("after Stop of a queued entry", b);
  log("stored message for the stopped queued thread", t.stored("Stopped from Resources settings"));
  const holder = b.holders[0].entryId;
  await t.call("DELETE", `/api/settings/resources/activity/${holder}`);
  const c = await waitActivity(
    (v) => v.holders.length === 1 && v.waiting.length === 0,
    "holder stop promotes waiter",
  );
  log("after Stop of the holder: the waiter was promoted", c);
  await waitActivity((v) => v.holders.length === 0 && v.waiting.length === 0, "drain");
  for (const id of ids) await t.done(id, 40000);
  log("drained, every thread ended; sleeps left", sh("pgrep -cx sleep || true"));
  // setting change drains waiters
  const ids2 = [];
  for (const p of ["heavy one", "heavy two", "heavy three"]) {
    ids2.push(await t.thread(p));
    await sleep(150);
  }
  await waitActivity((v) => v.holders.length === 1 && v.waiting.length === 2, "queue again");
  await t.setResources({ priority: "balanced", heavySlots: null, memoryLimitMb: null, appliesTo: ALL_ON });
  log("heavySlots -> null drains the waiters", await waitActivity((v) => v.waiting.length === 0, "no drain"));
  for (const id of ids2) await t.done(id, 40000);
  log("final activity", await t.activity());
} finally {
  await t.stop();
  sh("pkill -f 'sleep 6$'; true");
}
