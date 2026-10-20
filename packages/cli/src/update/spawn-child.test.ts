import { describe, expect, it } from "vitest";
import { buildSpec } from "../service/spec";
import { CLI, createTestNode } from "../service/test-context";
import {
  childEnvOf,
  launchdRemoveArgs,
  launchdSubmitArgs,
  spawnUpdateChild,
  systemdRunArgs,
} from "./spawn-child";

function request(kind: "systemd" | "launchd" | "detached" = "systemd") {
  const node = createTestNode({ platform: "linux" });
  const spec = buildSpec(node.context, CLI, node.tauHome);
  return {
    node,
    spec,
    req: {
      context: node.context,
      cli: CLI,
      home: node.tauHome,
      target: "1.1.0",
      nonce: "secret-nonce",
      kind,
      env: { PATH: "/usr/bin", TAU_THREAD_ID: "t", HOME: "/h" } as NodeJS.ProcessEnv,
      epoch: 1700000000000,
    },
  };
}

describe("systemd-run argv", () => {
  it("is exactly the planned argv, with TAU_UPDATE_JOB valueless", () => {
    const { req, spec, node } = request();
    expect(systemdRunArgs(req, spec)).toEqual([
      "--user",
      "--collect",
      "--quiet",
      "--unit=tau-update-1700000000000",
      `--working-directory=${node.tauHome}`,
      `--setenv=PATH=${spec.path}`,
      `--setenv=HOME=${node.osHome}`,
      `--setenv=TAU_HOME=${node.tauHome}`,
      "--setenv=TAU_UPDATE_JOB",
      "-p",
      `StandardOutput=file:${node.tauHome}/update.log`,
      "-p",
      "StandardError=inherit",
      "--",
      CLI.command,
      CLI.args[0],
      "update",
      "--target",
      "1.1.0",
      "--yes",
      "--force",
      "--home",
      node.tauHome,
    ]);
  });

  it("runs systemd-run with the nonce in its env and not on argv", async () => {
    const { req, node } = request();
    await spawnUpdateChild(req);
    expect(node.runner.calls).toHaveLength(1);
    expect(node.runner.calls[0]?.startsWith("systemd-run --user --collect")).toBe(true);
    expect(node.runner.calls[0]).not.toContain("secret-nonce");
  });

  it("env is ours minus TAU_THREAD_ID plus the nonce, never a replacement", () => {
    const env = childEnvOf({ PATH: "/usr/bin", TAU_THREAD_ID: "t", HOME: "/h" }, "n1");
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/h", TAU_UPDATE_JOB: "n1" });
  });
});

describe("launchd fallback argv", () => {
  it("submits and removes by label", () => {
    const { req, spec, node } = request("launchd");
    const args = launchdSubmitArgs(req, spec);
    expect(args.slice(0, 9)).toEqual([
      "submit",
      "-l",
      "tau-update-1700000000000",
      "-o",
      `${node.tauHome}/update.log`,
      "-e",
      `${node.tauHome}/update.log`,
      "--",
      "/usr/bin/env",
    ]);
    expect(args).toContain("TAU_UPDATE_JOB=secret-nonce");
    expect(args).toContain("TAU_UPDATE_LABEL=tau-update-1700000000000");
    expect(launchdRemoveArgs("tau-update-1")).toEqual(["remove", "tau-update-1"]);
  });
});
