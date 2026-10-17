import { describe, expect, it } from "vitest";
import { EMPTY_MCP_FORM, parsePairs, toMcpConfig } from "./mcp-form";

describe("mcp form", () => {
  it("builds a stdio config from lines", () => {
    expect(
      toMcpConfig({
        ...EMPTY_MCP_FORM,
        name: " files ",
        command: "npx",
        args: "-y\n\n server ",
        env: "TOKEN=a=b\nMODE=x",
      }),
    ).toEqual({ name: "files", command: "npx", args: ["-y", "server"], env: { TOKEN: "a=b", MODE: "x" } });
  });

  it("builds an http config with headers", () => {
    expect(
      toMcpConfig({
        ...EMPTY_MCP_FORM,
        name: "docs",
        transport: "http",
        url: "https://example.com/mcp",
        headers: "Authorization: Bearer x",
      }),
    ).toEqual({ name: "docs", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } });
  });

  it("rejects missing fields and malformed lines with a readable message", () => {
    expect(() => toMcpConfig(EMPTY_MCP_FORM)).toThrow("Enter a name.");
    expect(() => toMcpConfig({ ...EMPTY_MCP_FORM, name: "a" })).toThrow("Enter the command to run.");
    expect(() => toMcpConfig({ ...EMPTY_MCP_FORM, name: "a", transport: "http", url: "ftp://x" })).toThrow(
      "http://",
    );
    expect(() => parsePairs("nope", "=")).toThrow('"nope" must look like NAME=value.');
  });
});
