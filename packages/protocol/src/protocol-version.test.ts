import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./protocol-hash";
import { computeProtocolVersion } from "./protocol-version";

const hashFile = fileURLToPath(new URL("./protocol-hash.ts", import.meta.url));

function bump(version: string): void {
  const text = readFileSync(hashFile, "utf8");
  writeFileSync(hashFile, text.replace(/PROTOCOL_VERSION = "[^"]*"/, `PROTOCOL_VERSION = "${version}"`));
}

describe("protocolVersion", () => {
  it("equals the hash of the routes, frames and Change union (bump with `pnpm bump-protocol`)", () => {
    const actual = computeProtocolVersion();
    if (process.env.BUMP_PROTOCOL === "1" && actual !== PROTOCOL_VERSION) bump(actual);
    else
      expect(PROTOCOL_VERSION, "A schema changed: run `pnpm --filter @tau/protocol bump-protocol`").toBe(
        actual,
      );
  });

  it("is deterministic", () => {
    expect(computeProtocolVersion()).toBe(computeProtocolVersion());
    expect(computeProtocolVersion()).toMatch(/^[0-9a-f]{32}$/);
  });
});
