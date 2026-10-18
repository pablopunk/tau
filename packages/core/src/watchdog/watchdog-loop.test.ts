import { describe, expect, it } from "vitest";
import { createWatchdogLoop } from "./watchdog-loop";

function setup() {
  let counter = 0;
  let now = 0;
  const stalls: string[] = [];
  const loop = createWatchdogLoop({
    readCounter: () => counter,
    now: () => now,
    onStall: (d) => stalls.push(d),
  });
  const tick = (ms = 5000, beat = false) => {
    now += ms;
    if (beat) counter += 1;
    loop.tick();
  };
  return { tick, stalls };
}

describe("watchdog loop", () => {
  it("stalls after 12 unchanged ticks", () => {
    const { tick, stalls } = setup();
    for (let i = 0; i < 11; i++) tick();
    expect(stalls).toEqual([]);
    tick();
    expect(stalls).toHaveLength(1);
  });

  it("a heartbeat resets the count", () => {
    const { tick, stalls } = setup();
    for (let i = 0; i < 11; i++) tick();
    tick(5000, true);
    for (let i = 0; i < 11; i++) tick();
    expect(stalls).toEqual([]);
  });

  it("a pause above 10 s resets the count", () => {
    const { tick, stalls } = setup();
    for (let i = 0; i < 11; i++) tick();
    tick(30_000);
    tick();
    expect(stalls).toEqual([]);
  });
});
