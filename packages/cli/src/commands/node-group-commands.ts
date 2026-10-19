import type { Device, DirectoryNode, RotateAccessResult } from "@tau/protocol";
import { failure, usageError } from "./cli-exit";
import { callRoute, discoverServer, type Server } from "./client";
import type { CommandEnv } from "./command-env";
import { scanArgs } from "./scan-args";

export const NODE_GROUP_COMMANDS: readonly string[] = ["nodes list", "nodes remove", "access rotate"];

const SPEC = { yes: "boolean", home: "value", confirm: "value", keep: "value", json: "value" } as const;

async function serverOf(env: CommandEnv, home: unknown): Promise<{ server: Server; scoped: CommandEnv }> {
  const scoped = typeof home === "string" ? { ...env, home } : env;
  return { server: await discoverServer(scoped), scoped };
}

const ago = (now: number, at: number): string => `${Math.max(0, Math.round((now - at) / 1000))}s ago`;

function rowOf(node: DirectoryNode, now: number) {
  return {
    id: node.id,
    name: node.name,
    status: node.ghost ? "ghost" : node.status,
    hops: node.hops,
    via: node.via,
    direct: node.direct,
    unsynced: node.unsynced,
    skewMs: node.skewMs,
    threads: node.threadCount,
    lastSeen: ago(now, node.lastSeenAt),
  };
}

/** `tau nodes list`: every node of the group this node can route to, nearest first, with `hops` and `via`. */
async function listGroup(argv: readonly string[], env: CommandEnv): Promise<void> {
  const { flags } = scanArgs(argv, SPEC);
  const { server, scoped } = await serverOf(env, flags.get("home"));
  const nodes = (await callRoute(server, "getNodeDirectory", {}, scoped)) as DirectoryNode[];
  const sorted = [...nodes].sort((a, b) => a.hops - b.hops || a.name.localeCompare(b.name));
  env.stdout(
    JSON.stringify(
      sorted.map((node) => rowOf(node, env.now())),
      null,
      2,
    ),
  );
}

/** An exact name resolves to its id; an id (or anything unknown) is sent as typed. */
function resolveNode(nodes: readonly DirectoryNode[], typed: string): DirectoryNode | undefined {
  const byId = nodes.find((node) => node.id === typed);
  if (byId) return byId;
  const byName = nodes.filter((node) => node.name === typed);
  if (byName.length > 1) throw usageError(`${byName.length} nodes are named "${typed}"; use the node id.`);
  return byName[0];
}

/** `tau nodes remove <node> --confirm <name|id>`: the typed confirmation replaces `--yes`. */
async function removeNode(argv: readonly string[], env: CommandEnv): Promise<void> {
  const { positionals, flags } = scanArgs(argv, SPEC);
  if (positionals.length !== 1) throw usageError("Usage: tau nodes remove <node> --confirm <name or id>");
  const typed = positionals[0] as string;
  const confirm = flags.get("confirm");
  if (typeof confirm !== "string" || confirm.length === 0) {
    throw usageError(
      `tau nodes remove cuts "${typed}" off the WHOLE group. Add --confirm <the node's name or id> (--yes is not enough).`,
    );
  }
  const { server, scoped } = await serverOf(env, flags.get("home"));
  const directory = (await callRoute(server, "getNodeDirectory", {}, scoped)) as DirectoryNode[];
  const target = resolveNode(directory, typed);
  const id = target?.id ?? typed;
  if (target && confirm !== target.name && confirm !== target.id) {
    throw usageError(`--confirm must be "${target.name}" or ${target.id}.`);
  }
  await callRoute(server, "removeNode", { params: { id }, body: { confirm } }, scoped);
  env.stdout(
    [
      `Removed ${target?.name ?? typed} from the group: every node cuts it off, and it must reset its identity to rejoin.`,
      "This does not undo what that node did. Run `tau access rotate` to revoke devices and swap the token.",
    ].join("\n"),
  );
}

const describeDevice = (device: Pick<Device, "name" | "kind" | "id">) =>
  `  - ${device.name} (${device.kind}, ${device.id})`;

function keepIds(raw: string | boolean | undefined): string[] {
  if (raw === undefined) return [];
  if (typeof raw === "boolean") throw usageError("--keep needs device ids, comma separated");
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

async function approved(env: CommandEnv, yes: boolean, question: string): Promise<boolean> {
  if (yes) return true;
  if (!env.confirm) throw usageError("tau access rotate is destructive. Add --yes to confirm.");
  return env.confirm(question);
}

/** `tau access rotate [--keep id,id]`: preview, ask, rotate, print the new token once. */
async function rotateAccess(argv: readonly string[], env: CommandEnv): Promise<void> {
  const { positionals, flags } = scanArgs(argv, SPEC);
  if (positionals.length > 0) throw usageError(`Unexpected argument: ${positionals[0]}`);
  const keep = keepIds(flags.get("keep"));
  const { server, scoped } = await serverOf(env, flags.get("home"));
  const devices = (await callRoute(server, "listDevices", {}, scoped)) as Device[];
  const unknown = keep.filter((id) => !devices.some((device) => device.id === id));
  if (unknown.length > 0) throw usageError(`Unknown device id: ${unknown.join(", ")}`);
  const doomed = devices.filter((device) => !device.current && !keep.includes(device.id));
  env.stdout(
    [
      "Rotating access swaps this node's master token and signs out every browser here.",
      doomed.length === 0
        ? "No device would be revoked."
        : `Devices that would be revoked (${doomed.length}):`,
      ...doomed.map(describeDevice),
      "Your own device is never revoked. Nodes (also hostile ones) are revoked too unless kept.",
    ].join("\n"),
  );
  if (!(await approved(scoped, flags.get("yes") === true, "Rotate access? [y/N] "))) {
    throw failure("Cancelled. Nothing was changed.");
  }
  const result = (await callRoute(
    server,
    "rotateAccess",
    { body: keep.length > 0 ? { keep } : {} },
    scoped,
  )) as RotateAccessResult;
  env.stdout(
    [
      `Revoked ${result.revoked.length} device(s).`,
      ...result.revoked.map(describeDevice),
      "New token (shown once, also written to <home>/token):",
      result.token,
    ].join("\n"),
  );
}

export async function runNodeGroupCommand(
  command: string,
  argv: readonly string[],
  env: CommandEnv,
): Promise<void> {
  if (command === "nodes list") return listGroup(argv, env);
  if (command === "nodes remove") return removeNode(argv, env);
  return rotateAccess(argv, env);
}
