import { describe, expect, it } from "vitest";
import type { RunCommand } from "./command-runner";
import { installMethodOf } from "./install-method";
import { fetchLatestVersion } from "./latest-version";

const probe = (entry: string, platform: NodeJS.Platform = "darwin") => ({
  entry,
  execPath: "/n/bin/node",
  platform,
  target: "1.2.3",
});
const NPM = "/lib/node_modules/@pablopunk/tau/dist/bin.js";

describe("installMethodOf", () => {
  it.each([
    ["npm prefix", `/usr/local${NPM}`],
    ["nvm", `/Users/p/.nvm/versions/node/v22.1.0${NPM}`],
    ["homebrew", `/opt/homebrew${NPM}`],
    ["mise", `/Users/p/.local/share/mise/installs/node/22.1.0${NPM}`],
  ])("runs npm for %s", (_name, entry) => {
    const method = installMethodOf(probe(entry));
    expect(method).toMatchObject({
      kind: "npm",
      install: { command: "/n/bin/npm", args: ["i", "-g", "@pablopunk/tau@1.2.3"] },
    });
    if (method.kind === "npm") expect(method.packageDir).toBe(entry.replace("/dist/bin.js", ""));
  });

  it("hints mise reshim only for mise", () => {
    const mise = installMethodOf(probe(`/h/.local/share/mise/installs/node/22${NPM}`));
    expect(mise.kind === "npm" && mise.hint).toContain("mise reshim");
    const plain = installMethodOf(probe(`/usr/local${NPM}`));
    expect(plain.kind === "npm" && plain.hint).toBeUndefined();
  });

  it("uses pnpm for a pnpm global store", () => {
    const entry =
      "/h/Library/pnpm/global/5/node_modules/.pnpm/@pablopunk+tau@1.0.0/node_modules/@pablopunk/tau/dist/bin.js";
    expect(installMethodOf(probe(entry))).toMatchObject({
      kind: "pnpm",
      install: { command: "pnpm", args: ["add", "-g", "@pablopunk/tau@1.2.3"] },
    });
  });

  it.each([
    ["bun", "/h/.bun/install/global/node_modules/@pablopunk/tau/dist/bin.js"],
    ["volta", "/h/.volta/tools/image/packages/@pablopunk/tau/lib/node_modules/@pablopunk/tau/dist/bin.js"],
    ["npx", `/h/.npm/_npx/abc/node_modules/@pablopunk/tau/dist/bin.js`],
    ["dev checkout", "/h/src/tau/packages/cli/dist/bin.js"],
    ["unknown", "/somewhere/tau/bin.js"],
  ])("never guesses for %s", (_name, entry) => {
    expect(installMethodOf(probe(entry)).kind).toBe("manual");
  });

  it("does not automate Windows", () => {
    expect(installMethodOf(probe(`C:/x${NPM}`, "win32"))).toMatchObject({
      kind: "manual",
      manualCommand: "npm i -g @pablopunk/tau@1.2.3",
    });
  });
});

describe("fetchLatestVersion", () => {
  const run =
    (result: Awaited<ReturnType<RunCommand>>): RunCommand =>
    async () =>
      result;
  it("returns a plain version", async () => {
    await expect(
      fetchLatestVersion(run({ code: 0, stdout: "1.2.3\n", stderr: "" }), "/n/bin/node"),
    ).resolves.toBe("1.2.3");
  });
  it("fails offline and on a non-semver answer", async () => {
    await expect(
      fetchLatestVersion(run({ code: 1, stdout: "", stderr: "ENOTFOUND" }), "/n/bin/node"),
    ).rejects.toThrow(/ENOTFOUND/);
    await expect(
      fetchLatestVersion(run({ code: null, stdout: "", stderr: "timed out" }), "/n/bin/node"),
    ).rejects.toThrow();
    await expect(
      fetchLatestVersion(run({ code: 0, stdout: "2.0.0-beta.1", stderr: "" }), "/n/bin/node"),
    ).rejects.toThrow(/unexpected/);
  });
  it("calls npm next to node with an args array", async () => {
    const calls: unknown[][] = [];
    await fetchLatestVersion(
      async (c, a, o) => (calls.push([c, a, o]), { code: 0, stdout: "1.0.0", stderr: "" }),
      "/n/bin/node",
    );
    expect(calls[0]).toEqual([
      "/n/bin/npm",
      ["view", "@pablopunk/tau@latest", "version", "--prefer-online"],
      { stdio: "capture", timeoutMs: 15000 },
    ]);
  });
});
