import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LINK_PROTOCOL, PROTOCOL_VERSION } from "./protocol-hash";
import { computeLinkProtocol, computeProtocolVersion } from "./protocol-version";

const hashFile = fileURLToPath(new URL("./protocol-hash.ts", import.meta.url));

function bump(name: "PROTOCOL_VERSION" | "LINK_PROTOCOL", version: string): void {
  const text = readFileSync(hashFile, "utf8");
  writeFileSync(hashFile, text.replace(new RegExp(`${name} = "[^"]*"`), `${name} = "${version}"`));
}

describe("protocolVersion", () => {
  it("equals the hash of the routes, frames and Change union (bump with `pnpm bump-protocol`)", () => {
    const actual = computeProtocolVersion();
    if (process.env.BUMP_PROTOCOL === "1" && actual !== PROTOCOL_VERSION) bump("PROTOCOL_VERSION", actual);
    else
      expect(PROTOCOL_VERSION, "A schema changed: run `pnpm --filter @tau/protocol bump-protocol`").toBe(
        actual,
      );
  });

  it("linkProtocol equals the hash of the base frames only (bump with `pnpm bump-protocol`)", () => {
    const actual = computeLinkProtocol();
    if (process.env.BUMP_PROTOCOL === "1" && actual !== LINK_PROTOCOL) bump("LINK_PROTOCOL", actual);
    else
      expect(LINK_PROTOCOL, "A base frame changed: run `pnpm --filter @tau/protocol bump-protocol`").toBe(
        actual,
      );
  });

  it("linkProtocol ignores routes, ping and pong: only base frames decide whether nodes may link", () => {
    expect(computeLinkProtocol()).toMatch(/^[0-9a-f]{32}$/);
    expect(computeLinkProtocol()).not.toBe(computeProtocolVersion());
  });

  it("is deterministic", () => {
    expect(computeProtocolVersion()).toBe(computeProtocolVersion());
    expect(computeProtocolVersion()).toMatch(/^[0-9a-f]{32}$/);
  });
});
