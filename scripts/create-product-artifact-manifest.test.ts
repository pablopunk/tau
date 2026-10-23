import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { main } from "./create-product-artifact-manifest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function artifact(root: string, version = "0.11.0"): Promise<void> {
  await mkdir(join(root, "web", "assets"), { recursive: true });
  await mkdir(join(root, "claude-sdk", "node_modules", "@anthropic-ai", "claude-agent-sdk"), {
    recursive: true,
  });
  const binary = join(root, "tau");
  await writeFile(binary, `#!/bin/sh\necho 'tau ${version}'\n`);
  await chmod(binary, 0o755);
  await writeFile(join(root, "web", "index.html"), "index");
  await writeFile(join(root, "web", "assets", "app.js"), "js");
  await writeFile(join(root, "web", "assets", "app.css"), "css");
  await writeFile(
    join(root, "claude-sdk", "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"),
    JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.3.302" }),
  );
}

it("accepts SemVer prerelease and build identifiers from the executed artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "tau-artifact-manifest-semver-"));
  roots.push(root);
  const baseline = join(root, "baseline");
  const candidate = join(root, "candidate");
  await Promise.all([mkdir(baseline), mkdir(candidate)]);
  const version = "1.2.3-rc.1+build.7";
  await Promise.all([artifact(baseline, version), artifact(candidate, version)]);
  const output = join(root, "manifest.json");

  await main([
    "--baseline",
    baseline,
    "--candidate",
    candidate,
    "--os",
    process.platform === "darwin" ? "darwin" : "linux",
    "--arch",
    process.arch,
    "--output",
    output,
  ]);

  const manifest = JSON.parse(await readFile(output, "utf8")) as {
    baseline: { version: string };
    candidate: { version: string };
  };
  expect(manifest.baseline.version).toBe(version);
  expect(manifest.candidate.version).toBe(version);
});

it.each(["01.2.3", "1.2.3-..", "1.2.3-rc..1", "1.2.3+build..7"])(
  "rejects malformed SemVer %s from the executed artifact",
  async (version) => {
    const root = await mkdtemp(join(tmpdir(), "tau-artifact-manifest-invalid-semver-"));
    roots.push(root);
    const baseline = join(root, "baseline");
    const candidate = join(root, "candidate");
    await Promise.all([mkdir(baseline), mkdir(candidate)]);
    await Promise.all([artifact(baseline, version), artifact(candidate)]);
    const output = join(root, "manifest.json");

    await expect(
      main([
        "--baseline",
        baseline,
        "--candidate",
        candidate,
        "--os",
        process.platform === "darwin" ? "darwin" : "linux",
        "--arch",
        process.arch,
        "--output",
        output,
      ]),
    ).rejects.toThrow("invalid_manifest");
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("creates a complete manifest and refuses symlinked web assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "tau-artifact-manifest-"));
  roots.push(root);
  const baseline = join(root, "baseline");
  const candidate = join(root, "candidate");
  await Promise.all([mkdir(baseline), mkdir(candidate)]);
  await Promise.all([artifact(baseline), artifact(candidate)]);
  const output = join(root, "manifest.json");

  await main([
    "--baseline",
    baseline,
    "--candidate",
    candidate,
    "--os",
    process.platform === "darwin" ? "darwin" : "linux",
    "--arch",
    process.arch,
    "--output",
    output,
  ]);
  const manifest = JSON.parse(await readFile(output, "utf8")) as {
    version: number;
    baseline: { web: { js: { path: string; sha256: string }[]; css: { path: string; sha256: string }[] } };
    candidate: { sdk: { version: string } };
  };
  expect(manifest.version).toBe(1);
  expect(manifest.candidate.sdk.version).toBe("0.3.302");
  expect(manifest.baseline.web.js).toHaveLength(1);
  expect(manifest.baseline.web.css[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);

  await rm(output);
  await symlink(join(baseline, "web", "assets", "app.js"), join(candidate, "web", "assets", "linked.js"));
  await expect(
    main([
      "--baseline",
      baseline,
      "--candidate",
      candidate,
      "--os",
      process.platform === "darwin" ? "darwin" : "linux",
      "--arch",
      process.arch,
      "--output",
      output,
    ]),
  ).rejects.toThrow("artifact_symlink_forbidden");
});
