import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHubFileStore } from "./hub-file";

describe("hub.json", () => {
  it("writes mode 0600, reads back, ignores junk and deletes idempotently", async () => {
    const home = mkdtempSync(join(tmpdir(), "tau-hubfile-"));
    const store = createHubFileStore(home);
    expect(await store.read()).toBeUndefined();
    const file = { hubUrl: "https://abc.test", machineSecret: "s3cret", name: "Homelab" };
    await store.write(file);
    expect(statSync(join(home, "hub.json")).mode & 0o777).toBe(0o600);
    expect(await store.read()).toEqual(file);
    await store.delete();
    await store.delete();
    expect(await store.read()).toBeUndefined();
  });
});
