import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toSummary } from "../packages/core/src/harness/conversation-index";
import { conversationPath } from "../packages/web/src/lib/paths";
import {
  awaitAllOwned,
  candidateVerdict,
  containedFile,
  descendantIdentities,
  digest,
  executeArtifact,
  FIXTURES,
  freePort,
  isolatedEnv,
  isPiConversationSummary,
  LONG_STREAM_TEXT,
  portOwnedBy,
  processIdentity,
  seedRepository,
  stopOwned,
  validateBrowserDescriptor,
  verifyArtifact,
} from "./product-artifact-support";
import { parseArtifactManifest } from "./verify-product-artifact";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "tau-E-unit-"));
  roots.push(path);
  return path;
}
function item(directory: string) {
  const file = (path: string) => ({ path, sha256: digest("bytes") });
  return parseArtifactManifest({
    version: 1,
    baseline: {
      directory,
      binary: file("tau"),
      version: "0.11.0",
      platform: { os: process.platform, arch: process.arch },
      web: { index: file("web/index.html"), js: [file("web/index.js")], css: [file("web/index.css")] },
      sdk: { name: "@anthropic-ai/claude-agent-sdk", version: "0.0.0" },
    },
    candidate: {
      directory,
      binary: file("tau"),
      version: "0.11.0",
      platform: { os: process.platform, arch: process.arch },
      web: { index: file("web/index.html"), js: [file("web/index.js")], css: [file("web/index.css")] },
      sdk: { name: "@anthropic-ai/claude-agent-sdk", version: "0.0.0" },
    },
  }).candidate;
}
describe("artifact execution boundaries", () => {
  it("uses a credential-free explicit home and git environment", () => {
    const env = isolatedEnv("/owned");
    expect(env.HOME).toBe("/owned");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENROUTER_API_KEY", "SSH_AUTH_SOCK"])
      expect(env[key]).toBeUndefined();
  });
  it("rejects path escape before reading outside the artifact", async () => {
    const path = await root();
    await expect(containedFile(path, "../secret")).rejects.toThrow("path_escape");
  });
  it("rejects both intermediate and final symbolic links", async () => {
    const path = await root();
    await mkdir(join(path, "web"));
    await writeFile(join(path, "web/index"), "bytes");
    await symlink(join(path, "web"), join(path, "linked"));
    await symlink(join(path, "web/index"), join(path, "index"));
    await expect(containedFile(path, "linked/index")).rejects.toThrow("symlink");
    await expect(containedFile(path, "index")).rejects.toThrow("symlink");
  });
  it("refuses platform mismatch before launching", async () => {
    const artifact = item(await root());
    artifact.platform.arch = process.arch === "arm64" ? "x64" : "arm64";
    await expect(verifyArtifact(artifact)).rejects.toThrow("unsupported_platform");
  });
  it("checks actual binary bytes, not a caller PASS", async () => {
    const path = await root();
    await writeFile(join(path, "tau"), "tampered");
    await expect(verifyArtifact(item(path))).rejects.toThrow("artifact_checksum_mismatch");
  });
  it("rejects a script masquerading as a compiled binary", async () => {
    const path = await root();
    await mkdir(join(path, "web"));
    for (const name of ["tau", "web/index.html", "web/index.js", "web/index.css"])
      await writeFile(join(path, name), "bytes");
    await expect(verifyArtifact(item(path))).rejects.toThrow("not_compiled_binary");
  });
  it("defines a deterministic 8192-character long-stream payload", () => {
    const prefix = "E_LONG_STREAM_START:";
    const suffix = ":E_LONG_STREAM_END";
    const payload = LONG_STREAM_TEXT.slice(prefix.length, -suffix.length);
    expect(LONG_STREAM_TEXT.startsWith(prefix)).toBe(true);
    expect(LONG_STREAM_TEXT.endsWith(suffix)).toBe(true);
    expect(payload).toBe("0123456789abcdef".repeat(512));
    expect(payload).toHaveLength(8192);
  });
  it("constructs the frozen small fixture with actual tracked payloads", async () => {
    const path = await root();
    const repo = await seedRepository(path, "small-v1", isolatedEnv(path));
    expect((await readFile(join(repo, "dir-0/file-0.txt"))).length).toBe(1024);
    const index = await readFile(join(repo, ".git/HEAD"), "utf8");
    expect(index.trim()).toBe("ref: refs/heads/main");
    expect(FIXTURES["monorepo-v1"].files * FIXTURES["monorepo-v1"].bytesPerFile).toBe(16777216);
  });
  it("rejects unknown fixture declarations", async () => {
    await expect(seedRepository(await root(), "owner-repo", {})).rejects.toThrow("unsupported_fixture");
  });
  it("allocates an explicit non-default port", async () => {
    expect(await freePort()).toBeGreaterThan(0);
  });
  it("never qualifies zero assertions or missing evidence", () => {
    expect(candidateVerdict([])).toBe("BLOCKED");
    expect(candidateVerdict([{ id: "E.x", status: "BLOCKED", reason: "missing" }])).toBe("BLOCKED");
  });
  it("failure wins even with blocked cases; only actual pass set qualifies", () => {
    expect(
      candidateVerdict([
        { id: "E.x", status: "FAIL", reason: "failed" },
        { id: "E.y", status: "BLOCKED", reason: "missing" },
      ]),
    ).toBe("FAIL");
    expect(candidateVerdict([{ id: "E.x", status: "PASS", reason: "observed" }])).toBe("PASS");
  });
  it("missing artifact produces blocked assertions without execution", async () => {
    const result = await executeArtifact(item(await root()), {
      version: 1,
      namespace: "E",
      seed: 15158,
      fixtures: {},
      cases: [{ id: "E.x", fixtureId: "small-v1", requiredAssertions: ["E.native-actual-sdk"] }],
    });
    expect(result.provenanceVerified).toBe(false);
    expect(result.assertions[0]?.status).toBe("BLOCKED");
    expect(result.cleanup.verified).toBe(false);
  });
  it("rejects an untrusted descriptor before browser attachment", async () => {
    await expect(validateBrowserDescriptor({ version: 0 } as never)).rejects.toThrow(
      "untrusted_browser_descriptor",
    );
  });
  it("reaps its actual child and does not signal an unrelated sentinel", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
    try {
      if (!child.pid || !sentinel.pid) throw new Error("child_not_spawned");
      const identities = await descendantIdentities(child.pid);
      expect(identities.has(sentinel.pid)).toBe(false);
      expect(await stopOwned(child, identities)).toBe(true);
      expect(await processIdentity(sentinel.pid)).not.toBeNull();
    } finally {
      child.kill("SIGKILL");
      sentinel.kill("SIGKILL");
    }
  });
});

it("classifies executor values from actual serialized conversation summaries", () => {
  const project = { id: "p1", path: "/work/p1" };
  const entry = (executor?: "pi" | "claude-code") => ({
    conversationId: 1,
    title: "fixture",
    createdAt: 1,
    updatedAt: 2,
    ...(executor === undefined ? {} : { executor }),
  });

  expect(isPiConversationSummary(toSummary(project, entry()))).toBe(true);
  expect(isPiConversationSummary(toSummary(project, entry("pi")))).toBe(true);
  expect(isPiConversationSummary(toSummary(project, entry("claude-code")))).toBe(false);
  expect(isPiConversationSummary({ executor: null } as never)).toBe(false);
  expect(isPiConversationSummary({ executor: "unknown" } as never)).toBe(false);
});

it("does not accept a ready response on another process's port identity", async () => {
  const server = createServer();
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("port_missing");
    const base = `http://127.0.0.1:${address.port}`;
    expect(await portOwnedBy(process.pid, base)).toBe(true);
    expect(await portOwnedBy(99999999, base)).toBe(false);
  } finally {
    await new Promise<void>((yes, no) => server.close((error) => (error ? no(error) : yes())));
  }
});

it("uses the actual project-scoped product conversation path", () => {
  expect(conversationPath("project/a", "thread?#")).toBe("/p/project%2Fa/c/thread%3F%23");
});

it("waits for all owned sibling tasks before surfacing a failure for cleanup", async () => {
  let siblingFinished = false;
  const sibling = new Promise<void>((yes) =>
    setImmediate(() => {
      siblingFinished = true;
      yes();
    }),
  );
  await expect(awaitAllOwned([Promise.reject(new Error("owned_failed")), sibling])).rejects.toThrow(
    "owned_failed",
  );
  expect(siblingFinished).toBe(true);
  await expect(awaitAllOwned([Promise.resolve(1), Promise.resolve(2)])).resolves.toEqual([1, 2]);
});
