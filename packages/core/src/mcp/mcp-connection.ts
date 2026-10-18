import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "@tau/protocol";

export interface McpConnection {
  readonly client: Client;
  close(): Promise<void>;
}

const CLIENT_INFO = { name: "tau", version: "0.0.0" };

function transportOf(config: McpServerConfig, cwd: string): Transport {
  if ("command" in config) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...getDefaultEnvironment(), ...config.env },
      cwd,
      stderr: "ignore",
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
}

export async function openMcpConnection(config: McpServerConfig, cwd: string): Promise<McpConnection> {
  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transportOf(config, cwd));
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return { client, close: () => client.close() };
}
