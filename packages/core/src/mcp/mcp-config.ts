import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "@pi-everywhere/protocol";

export type McpSource = "settings" | "project";

export type SourcedServer = { readonly source: McpSource; readonly config: McpServerConfig };

const PROJECT_MCP_FILE = ".mcp.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringRecord = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

function configOf(name: string, entry: unknown): McpServerConfig | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry.command === "string") {
    const args = Array.isArray(entry.args) ? entry.args.filter((arg) => typeof arg === "string") : [];
    return { name, command: entry.command, args, env: stringRecord(entry.env) };
  }
  if (typeof entry.url === "string") return { name, url: entry.url, headers: stringRecord(entry.headers) };
  return undefined;
}

export function parseMcpJson(text: string): McpServerConfig[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const servers = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
    return Object.entries(servers).flatMap(([name, entry]) => configOf(name, entry) ?? []);
  } catch {
    return [];
  }
}

export async function readProjectServers(projectPath: string): Promise<McpServerConfig[]> {
  try {
    return parseMcpJson(await readFile(join(projectPath, PROJECT_MCP_FILE), "utf8"));
  } catch {
    return [];
  }
}

export function mergeServers(settings: McpServerConfig[], project: McpServerConfig[]): SourcedServer[] {
  return [
    ...settings.map((config) => ({ source: "settings" as const, config })),
    ...project.map((config) => ({ source: "project" as const, config })),
  ];
}

/** Project servers win over settings servers of the same name when the agent calls one by name. */
export function findServer(servers: SourcedServer[], name: string): SourcedServer | undefined {
  return (
    servers.find((server) => server.source === "project" && server.config.name === name) ??
    servers.find((server) => server.config.name === name)
  );
}
