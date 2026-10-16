import { describe, expect, it } from "vitest";
import { ghFailure, ghOk, recordingRunGh, spawnError, statusJson } from "../test-support/fake-run-gh";
import { FAKE_GH_ARGV, GH_REPOS_ARGV, GH_STATUS_ARGV } from "../test-support/gh-argv";
import { REPOS_ARGS, STATUS_ARGS } from "./gh-commands";
import { readGithubStatus } from "./gh-status";

const host = (overrides: Record<string, unknown>) => ({
  state: "success",
  active: true,
  host: "github.com",
  login: "demo",
  tokenSource: "keyring",
  gitProtocol: "ssh",
  ...overrides,
});

const statusFor = (reply: Parameters<typeof recordingRunGh>[0]) =>
  readGithubStatus(recordingRunGh(reply).run);

describe("gh commands", () => {
  it("match the argv the fake gh answers", () => {
    expect(STATUS_ARGS).toEqual([...GH_STATUS_ARGV]);
    expect(REPOS_ARGS).toEqual([...GH_REPOS_ARGV]);
    expect(FAKE_GH_ARGV).toHaveLength(2);
  });
});

describe("readGithubStatus", () => {
  it("is connected with the login, protocol and token source", async () => {
    expect(await statusFor(() => statusJson({ "github.com": [host({})] }))).toEqual({
      state: "connected",
      login: "demo",
      gitProtocol: "ssh",
      tokenSource: "keyring",
    });
  });

  it("uses the active account of several", async () => {
    const hosts = { "github.com": [host({ active: false, login: "old" }), host({ login: "new" })] };
    expect(await statusFor(() => statusJson(hosts))).toMatchObject({ state: "connected", login: "new" });
  });

  it("is not logged in without a github.com host", async () => {
    expect(await statusFor(() => statusJson({}))).toEqual({
      state: "not_logged_in",
      hint: "Run `gh auth login`.",
    });
  });

  it("asks for a refresh on a 401 and reports any other error as is", async () => {
    const unauthorized = host({ state: "error", error: "HTTP 401: Bad credentials" });
    expect(await statusFor(() => statusJson({ "github.com": [unauthorized] }))).toEqual({
      state: "not_logged_in",
      hint: "Run `gh auth refresh`.",
    });
    const offline = host({ state: "error", error: "dial tcp: lookup api.github.com" });
    expect(await statusFor(() => statusJson({ "github.com": [offline] }))).toEqual({
      state: "error",
      message: "dial tcp: lookup api.github.com",
    });
  });

  it("asks to update an old gh that lacks --json", async () => {
    expect(await statusFor(() => ghFailure("unknown flag: --json\n"))).toEqual({
      state: "error",
      message: "Update gh to 2.81.0 or later.",
    });
  });

  it("maps a missing gh and a timeout", async () => {
    expect(await statusFor(() => spawnError("ENOENT"))).toEqual({ state: "not_installed" });
    expect(await statusFor(() => spawnError("ETIMEDOUT"))).toMatchObject({ state: "error" });
  });

  it("reports the last stderr line for output it cannot read", async () => {
    expect(await statusFor(() => ghFailure("something\nwent wrong\n"))).toEqual({
      state: "error",
      message: "went wrong",
    });
    expect(await statusFor(() => ghOk("not json"))).toMatchObject({ state: "error" });
  });

  it("makes exactly one call with the frozen argv", async () => {
    const fake = recordingRunGh(() => statusJson({}));
    await readGithubStatus(fake.run);
    expect(fake.calls).toEqual([[...GH_STATUS_ARGV]]);
  });
});
