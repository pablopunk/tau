import { defineTool, type Extension, type ToolRegistration } from "@earendil-works/pi-durable";
import type { ModelInfo, ResourceScope } from "@tau/protocol";
import type { TSchema } from "typebox";
import type { ClaudeConnectorToolServices } from "../../claude-cli/connectors/connector-tool-services";
import type { McpService } from "../../mcp/mcp-service";
import { notImplemented } from "../../not-implemented";
import type { ProcessService } from "../../processes/process-service";
import type { Scheduler } from "../../timers/scheduler-api";
import type { TimerToolServices } from "../../timers/timer-tool-services";
import type { LiveWork } from "../live-work";
import type { NotificationSubmitter } from "../notification-submitter";
import type { SubagentServices } from "../subagent-services";

export interface ToolServices {
  /** Models the user has a key for; the `agent` tool lists them in its description. */
  readonly connectedModels: () => Promise<readonly ModelInfo[]>;
  readonly processes: ProcessService;
  readonly mcp: McpService;
  readonly subagents: SubagentServices;
  /** The only way to put a notification into a thread (MVP8). */
  readonly notifications: NotificationSubmitter;
  readonly scheduler: Scheduler;
  readonly timers: TimerToolServices;
  readonly liveWork: LiveWork;
  readonly claudeConnectors: ClaudeConnectorToolServices;
  /**
   * Layer-2 sandbox plumbing. Absent until the integrator wires it (settings +
   * worktree roots); tools treat absence as unenforced, never as sandboxed.
   */
  readonly sandbox?: SandboxToolServices;
}

/** What confined tools need: the thread's scope when sandboxed, and the MCP allowlist. */
export interface SandboxToolServices {
  /** The thread's scope when the sandbox switch confines it; `undefined` when off or unknown. */
  readonly scopeOf: (conversationId: string | number) => Promise<ResourceScope | undefined>;
  /** Whether a sandboxed thread may reach this MCP server (per-server allowlist, stdio and HTTP alike). */
  readonly mcpAllowed: (server: string) => Promise<boolean>;
}

/** The tools are built before the services exist (the Harness needs the registry first), so they read this lazily. */
export interface ToolServicesRef {
  current(): ToolServices;
  set(services: ToolServices): void;
}

export function createToolServicesRef(): ToolServicesRef {
  let services: ToolServices | undefined;
  return {
    current() {
      if (!services) throw notImplemented("tool services are not ready");
      return services;
    },
    set(next) {
      services = next;
    },
  };
}

/** A Phase 1 agent flips `implemented` to true; until then the registry leaves the extension out. */
export interface ToolFile {
  readonly implemented: boolean;
  readonly extension: Extension;
}

export type ToolFileFactory = (services: ToolServicesRef) => ToolFile;

export function unimplementedTool<TParameters extends TSchema>(
  name: string,
  description: string,
  parameters: TParameters,
  replay: "safe" | "unsafe" = "unsafe",
): ToolRegistration<TParameters> {
  return defineTool({
    name,
    description,
    parameters,
    replay,
    execute: async () => {
      throw notImplemented(`tool ${name}`);
    },
  });
}
