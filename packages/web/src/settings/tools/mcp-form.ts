import type { McpServerConfig } from "@pi-everywhere/protocol";

export type McpTransport = "stdio" | "http";

export interface McpFormValues {
  readonly name: string;
  readonly transport: McpTransport;
  readonly command: string;
  readonly args: string;
  readonly env: string;
  readonly url: string;
  readonly headers: string;
}

export const EMPTY_MCP_FORM: McpFormValues = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
};

const nonEmptyLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const parseArgs = (text: string): string[] => nonEmptyLines(text);

export function parsePairs(text: string, separator: "=" | ":"): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of nonEmptyLines(text)) {
    const at = line.indexOf(separator);
    if (at <= 0) throw new Error(`"${line}" must look like NAME${separator}value.`);
    pairs[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return pairs;
}

function requireValue(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(message);
  return trimmed;
}

function requireHttpUrl(value: string): string {
  const url = requireValue(value, "Enter the server URL.");
  if (!/^https?:\/\//.test(url)) throw new Error("The URL must start with http:// or https://.");
  return url;
}

export function toMcpConfig(values: McpFormValues): McpServerConfig {
  const name = requireValue(values.name, "Enter a name.");
  if (values.transport === "stdio") {
    const command = requireValue(values.command, "Enter the command to run.");
    return { name, command, args: parseArgs(values.args), env: parsePairs(values.env, "=") };
  }
  return { name, url: requireHttpUrl(values.url), headers: parsePairs(values.headers, ":") };
}
