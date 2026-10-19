import { describe, expect, it } from "vitest";
import { parseConnectArgs } from "./connect-args";
import { parseConnectTarget } from "./connect-target";

describe("tau connect target", () => {
  it("reads the node, the code and the name from a link", () => {
    expect(parseConnectTarget("https://abc123.opentunnel.xyz/pair#0123abcd.Home%20Mac")).toEqual({
      nodeUrl: "https://abc123.opentunnel.xyz",
      code: "0123abcd",
      peerLabel: "Home Mac",
    });
    expect(parseConnectTarget("https://abc.test/pair#code")).toEqual({
      nodeUrl: "https://abc.test",
      code: "code",
    });
  });

  it("reads the node id after &node=", () => {
    expect(parseConnectTarget("https://abc.test/pair#c0de.Home%20Mac&node=n-123")).toEqual({
      nodeUrl: "https://abc.test",
      code: "c0de",
      peerLabel: "Home Mac",
      nodeId: "n-123",
    });
  });

  it("takes a short code with --node, spaces ignored", () => {
    expect(parseConnectTarget("ABCD 2345", "https://abc.test/anything")).toEqual({
      nodeUrl: "https://abc.test",
      code: "ABCD2345",
    });
    expect(() => parseConnectTarget("ABCD2345")).toThrow(/--node/);
  });

  it("still reads the hidden --hub alias in the arguments", () => {
    expect(parseConnectArgs(["ABCD2345", "--hub", "http://127.0.0.1:9"]).node).toBe("http://127.0.0.1:9");
    expect(parseConnectArgs(["ABCD2345", "--hub=http://127.0.0.1:9"]).node).toBe("http://127.0.0.1:9");
    expect(parseConnectArgs(["ABCD2345", "--node=http://127.0.0.1:9"]).node).toBe("http://127.0.0.1:9");
  });

  it("allows http only for loopback", () => {
    expect(parseConnectTarget("c0de", "http://127.0.0.1:4317").nodeUrl).toBe("http://127.0.0.1:4317");
    expect(parseConnectTarget("http://localhost:1/pair#c0de").nodeUrl).toBe("http://localhost:1");
    expect(() => parseConnectTarget("http://evil.test/pair#c0de")).toThrow(/https/);
    expect(() => parseConnectTarget("c0de", "http://192.168.1.5:4317")).toThrow(/https/);
  });

  it("rejects other pages, missing codes and garbage", () => {
    expect(() => parseConnectTarget("https://abc.test/")).toThrow();
    expect(() => parseConnectTarget("https://abc.test/pair")).toThrow(/link code/);
    expect(() => parseConnectTarget("not a url/")).toThrow();
  });
});
