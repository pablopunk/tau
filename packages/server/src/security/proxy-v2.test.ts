import { describe, expect, it } from "vitest";
import { buildProxyV2, parseProxyV2 } from "./proxy-v2";

describe("PROXY v2", () => {
  it("round-trips the peer and the authority TLV and returns the rest", () => {
    const parsed = parseProxyV2(Buffer.concat([buildProxyV2("203.0.113.9", "a.b.test"), Buffer.from("GET")]));
    expect(parsed).toMatchObject({ kind: "ok", peer: "203.0.113.9", sni: "a.b.test" });
    expect(parsed.kind === "ok" && parsed.rest.toString()).toBe("GET");
  });

  it("asks for more bytes until the whole header has arrived", () => {
    const header = buildProxyV2("203.0.113.9", "a.b.test");
    expect(parseProxyV2(Buffer.alloc(0)).kind).toBe("need-more");
    expect(parseProxyV2(header.subarray(0, 15)).kind).toBe("need-more");
    expect(parseProxyV2(header.subarray(0, header.length - 1)).kind).toBe("need-more");
  });

  it("rejects a wrong signature, command or family at the first bad byte", () => {
    expect(parseProxyV2(Buffer.from("GET / HTTP/1.1")).kind).toBe("malformed");
    const header = buildProxyV2("203.0.113.9", "a.b.test");
    const wrongCommand = Buffer.from(header);
    wrongCommand[12] = 0x25;
    expect(parseProxyV2(wrongCommand).kind).toBe("malformed");
    const wrongFamily = Buffer.from(header);
    wrongFamily[13] = 0x31;
    expect(parseProxyV2(wrongFamily).kind).toBe("malformed");
  });

  it("treats LOCAL as one shared peer", () => {
    const header = Buffer.concat([
      Buffer.from("0d0a0d0a000d0a515549540a", "hex"),
      Buffer.from([0x20, 0x00, 0, 0]),
    ]);
    expect(parseProxyV2(header)).toMatchObject({ kind: "ok", peer: "local", sni: undefined });
  });
});
