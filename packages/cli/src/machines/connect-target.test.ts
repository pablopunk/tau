import { describe, expect, it } from "vitest";
import { parseConnectTarget } from "./connect-target";

describe("tau connect target", () => {
  it("reads the hub, the code and the name from a link", () => {
    expect(parseConnectTarget("https://abc123.opentunnel.xyz/pair#0123abcd.Home%20Mac")).toEqual({
      hubUrl: "https://abc123.opentunnel.xyz",
      code: "0123abcd",
      hubName: "Home Mac",
    });
    expect(parseConnectTarget("https://abc.test/pair#code")).toEqual({
      hubUrl: "https://abc.test",
      code: "code",
    });
  });

  it("takes a short code with --hub, spaces ignored", () => {
    expect(parseConnectTarget("ABCD 2345", "https://abc.test/anything")).toEqual({
      hubUrl: "https://abc.test",
      code: "ABCD2345",
    });
    expect(() => parseConnectTarget("ABCD2345")).toThrow(/--hub/);
  });

  it("allows http only for loopback", () => {
    expect(parseConnectTarget("c0de", "http://127.0.0.1:4317").hubUrl).toBe("http://127.0.0.1:4317");
    expect(parseConnectTarget("http://localhost:1/pair#c0de").hubUrl).toBe("http://localhost:1");
    expect(() => parseConnectTarget("http://evil.test/pair#c0de")).toThrow(/https/);
    expect(() => parseConnectTarget("c0de", "http://192.168.1.5:4317")).toThrow(/https/);
  });

  it("rejects other pages, missing codes and garbage", () => {
    expect(() => parseConnectTarget("https://abc.test/")).toThrow();
    expect(() => parseConnectTarget("https://abc.test/pair")).toThrow(/link code/);
    expect(() => parseConnectTarget("not a url/")).toThrow();
  });
});
