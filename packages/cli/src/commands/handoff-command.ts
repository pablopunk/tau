import { randomUUID } from "node:crypto";
import { describeHandoffLosses, HANDOFF_INSTRUCTION_MAX_LENGTH, type HandoffPreview } from "@tau/protocol";
import { usageError } from "./cli-exit";
import { callRoute, discoverServer, type Server } from "./client";
import type { CommandEnv } from "./command-env";
import { scanArgs } from "./scan-args";

const USAGE = "Usage: tau threads handoff <id> [--instruction <text>] [--yes]";

export function describePreview(id: string, preview: HandoffPreview): string {
  const verdict = preview.canHandoff
    ? "can be handed off"
    : `cannot be handed off: ${preview.reason ?? "unknown"}`;
  return [
    `Thread ${id} ${verdict}.`,
    `Losses: ${describeHandoffLosses(preview.losses)}.`,
    `Exported characters: ${preview.losses.exportedChars}.`,
    "--- preview of what the new thread receives ---",
    preview.preview,
    "--- end of preview ---",
    "Nothing was created.",
    ...(preview.canHandoff ? ["Add --yes to start a new native Claude thread from this."] : []),
  ].join("\n");
}

function instructionOf(raw: string | boolean | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "boolean") throw usageError(USAGE);
  if (raw.length > HANDOFF_INSTRUCTION_MAX_LENGTH) {
    throw usageError(`--instruction can have at most ${HANDOFF_INSTRUCTION_MAX_LENGTH} characters`);
  }
  return raw;
}

async function perform(server: Server, env: CommandEnv, id: string, instruction: string | undefined) {
  const body = { requestId: randomUUID(), ...(instruction !== undefined && { instruction }) };
  const created = await callRoute(server, "handoffConversation", { params: { id }, body }, env);
  env.stdout(JSON.stringify(created, null, 2));
}

/**
 * `tau threads handoff <id> [--instruction <text>] [--yes]`: a dry run by default, so nothing is created until `--yes`.
 */
export async function runHandoff(argv: readonly string[], env: CommandEnv): Promise<void> {
  const { positionals, flags } = scanArgs(argv, { instruction: "value", yes: "boolean", home: "value" });
  if (positionals.length !== 1) throw usageError(USAGE);
  const id = positionals[0] as string;
  const instruction = instructionOf(flags.get("instruction"));
  const home = flags.get("home");
  const scoped = typeof home === "string" ? { ...env, home } : env;
  const server = await discoverServer(scoped);
  if (flags.get("yes") === true) return perform(server, scoped, id, instruction);
  const preview = (await callRoute(
    server,
    "getHandoffPreview",
    { params: { id } },
    scoped,
  )) as HandoffPreview;
  env.stdout(describePreview(id, preview));
}
