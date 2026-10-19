import { describe, expect, it } from "vitest";
import { installMethodOf } from "./install-method";

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

describe("manualCommand", () => {
  it.each([
    [
      "bun",
      "/h/.bun/install/global/node_modules/@pablopunk/tau/dist/bin.js",
      "bun add -g @pablopunk/tau@1.2.3",
    ],
    [
      "volta",
      "/h/.volta/tools/image/packages/@pablopunk/tau/lib/node_modules/@pablopunk/tau/dist/bin.js",
      "volta install @pablopunk/tau@1.2.3",
    ],
    [
      "npx",
      "/h/.npm/_npx/abc/node_modules/@pablopunk/tau/dist/bin.js",
      "npm i -g @pablopunk/tau@latest && tau restart",
    ],
    ["dev checkout", "/h/src/tau/packages/cli/dist/bin.js", undefined],
  ])("%s", (_name, entry, command) => {
    expect(installMethodOf(probe(entry))).toMatchObject({ kind: "manual", manualCommand: command });
  });
});
