import { describe, expect, it } from "vitest";
import { createStatusMachine, RECREATE_AFTER_MS } from "./status-machine";

function setup() {
  let now = 1000;
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const machine = createStatusMachine(
    () => now,
    (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  );
  const fire = () => {
    for (const t of timers) if (t.live) t.run();
  };
  return {
    machine,
    fire,
    timers,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("remote status machine", () => {
  it("starts with the few-minutes text and keeps since while the state holds", () => {
    const { machine, advance } = setup();
    machine.set("starting");
    expect(machine.status()).toMatchObject({ state: "starting", since: 1000 });
    expect(machine.status().message).toMatch(/3-6 minutes/);
    advance(50);
    machine.set("starting", { url: "https://x.test" });
    expect(machine.status().since).toBe(1000);
  });

  it("offers a new URL only after 10 minutes without going online", () => {
    const { machine, fire, timers } = setup();
    machine.set("online", { url: "https://x.test" });
    machine.set("reconnecting");
    expect(timers.at(-1)?.ms).toBe(RECREATE_AFTER_MS);
    expect(machine.status().canRecreate).toBe(false);
    fire();
    expect(machine.status()).toMatchObject({ canRecreate: true, state: "reconnecting" });
    machine.set("online");
    expect(machine.status().canRecreate).toBe(false);
  });

  it("an error after reconnecting keeps the same clock", () => {
    const { machine, fire } = setup();
    machine.set("reconnecting");
    machine.set("error", { message: "Cannot reach the tunnel service" });
    fire();
    expect(machine.status().canRecreate).toBe(true);
  });
});
