import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { helpText } from "./help";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome } from "./test-support";

const node = (id: string, name: string, hops: number, via: string | null) => ({
  id,
  name,
  identified: true,
  os: "darwin",
  tauVersion: "1",
  protocolVersion: "1",
  status: "online",
  lastSeenAt: 0,
  threadCount: 2,
  links: [],
  direct: hops === 1,
  hops,
  nextHop: null,
  via,
  skewMs: null,
  ghost: false,
  unsynced: false,
});

const device = (id: string, name: string, kind: string, current = false) => ({
  id,
  name,
  kind,
  createdAt: 0,
  lastSeenAt: 0,
  current,
});

const exitOf = async (promise: Promise<unknown>): Promise<CliExit> => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CliExit);
  return error as CliExit;
};

function fakeWithGroup(): FakeTau {
  const fake = new FakeTau();
  fake.answers.set("GET /api/nodes/directory", {
    status: 200,
    body: [node("c", "Carol", 2, "Bob"), node("b", "Bob", 1, null)],
  });
  return fake;
}

describe("tau nodes list", () => {
  it("shows hops and via, nearest first", async () => {
    const fake = fakeWithGroup();
    await executeApiCommand("nodes", ["list"], fake.env(makeHome()));
    const rows = JSON.parse(fake.stdout[0] as string) as { name: string; hops: number; via: string }[];
    expect(rows.map((row) => [row.name, row.hops, row.via])).toEqual([
      ["Bob", 1, null],
      ["Carol", 2, "Bob"],
    ]);
  });
});

describe("tau nodes remove", () => {
  it("refuses --yes without --confirm and calls nothing", async () => {
    const fake = fakeWithGroup();
    const exit = await exitOf(executeApiCommand("nodes", ["remove", "Carol", "--yes"], fake.env(makeHome())));
    expect(exit.exitCode).toBe(2);
    expect(exit.message).toContain("--confirm");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a confirmation that is not the node's name or id", async () => {
    const fake = fakeWithGroup();
    const exit = await exitOf(
      executeApiCommand("nodes", ["remove", "Carol", "--confirm", "Bob"], fake.env(makeHome())),
    );
    expect(exit.message).toContain("Carol");
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("resolves a name to its id and sends the confirmation", async () => {
    const fake = fakeWithGroup();
    await executeApiCommand("nodes", ["remove", "Carol", "--confirm", "Carol"], fake.env(makeHome()));
    expect(fake.calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/nodes/c/remove",
      body: { confirm: "Carol" },
    });
    expect(fake.stdout.join("\n")).toContain("tau access rotate");
  });
});

describe("tau nodes forget", () => {
  it("is local, destructive and needs --yes", async () => {
    const fake = new FakeTau();
    const exit = await exitOf(executeApiCommand("nodes", ["forget", "b"], fake.env(makeHome())));
    expect(exit.message).toContain("--yes");
    await executeApiCommand("nodes", ["forget", "b", "--yes"], fake.env(makeHome()));
    expect(fake.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/nodes/b/forget" });
  });

  it("help tells forget from remove", () => {
    expect(helpText("nodes", "forget")).toContain("this node only");
    expect(helpText("nodes", "remove")).toContain("WHOLE group");
    expect(helpText("nodes", "remove")).toContain("--confirm");
  });
});

describe("tau access rotate", () => {
  const rotating = (): FakeTau => {
    const fake = new FakeTau();
    fake.answers.set("GET /api/access/devices", {
      status: 200,
      body: [device("me", "Me", "cli", true), device("n1", "Evil", "node"), device("p1", "Phone", "phone")],
    });
    fake.answers.set("POST /api/access/rotate", {
      status: 200,
      body: { revoked: [{ id: "n1", name: "Evil", kind: "node" }], token: "NEWTOKEN" },
    });
    return fake;
  };

  it("lists what is revoked, sends keep split on commas and prints the token", async () => {
    const fake = rotating();
    await executeApiCommand("access", ["rotate", "--keep", "p1", "--yes"], fake.env(makeHome()));
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/access/rotate", body: { keep: ["p1"] } });
    const out = fake.stdout.join("\n");
    expect(out).toContain("Evil");
    expect(out).not.toContain("- Phone");
    expect(out).toContain("NEWTOKEN");
  });

  it("needs --yes without a terminal and rotates nothing", async () => {
    const fake = rotating();
    const exit = await exitOf(executeApiCommand("access", ["rotate"], fake.env(makeHome())));
    expect(exit.message).toContain("--yes");
    expect(fake.calls.some((call) => call.path === "/api/access/rotate")).toBe(false);
  });

  it("asks on a terminal and cancels on no", async () => {
    const fake = rotating();
    const env = fake.env(makeHome(), { confirm: async () => false });
    await exitOf(executeApiCommand("access", ["rotate"], env));
    expect(fake.calls.some((call) => call.path === "/api/access/rotate")).toBe(false);
    await executeApiCommand("access", ["rotate"], fake.env(makeHome(), { confirm: async () => true }));
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/access/rotate", body: {} });
  });

  it("rejects an unknown --keep id", async () => {
    const fake = rotating();
    const exit = await exitOf(
      executeApiCommand("access", ["rotate", "--keep", "zzz", "--yes"], fake.env(makeHome())),
    );
    expect(exit.message).toContain("zzz");
  });
});
