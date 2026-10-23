import type { ResourceScope } from "@tau/protocol";

/**
 * Layer-2 scoping for MCP servers. `edit`/`write` are checked per call against
 * the sandbox root; MCP servers are whole processes outside our code, so they
 * are deny-by-default per server instead: a sandboxed thread may only reach an
 * explicitly allowlisted server, over stdio AND HTTP alike. Anything unlisted
 * is reported as UNENFORCED, never silently trusted.
 */
export const MCP_UNENFORCED_MARK = "UNENFORCED";

export type McpScopeVerdict = "allowed" | "denied";

/** Unlisted servers are denied for sandboxed threads; everything is allowed when the thread is not sandboxed. */
export function classifyMcpServer(options: {
  /** The thread's sandbox scope; `undefined` when the sandbox switch does not confine it. */
  readonly scope: ResourceScope | undefined;
  readonly allowlisted: boolean;
}): McpScopeVerdict {
  if (options.scope === undefined) return "allowed";
  return options.allowlisted ? "allowed" : "denied";
}

/** The model-visible denial: names the server, the scope, and its UNENFORCED state. */
export function mcpDeniedText(server: string, scope: ResourceScope): string {
  return (
    `MCP server "${server}" is not allowlisted for sandboxed ${scope} threads, so the call was denied. ` +
    `The server runs ${MCP_UNENFORCED_MARK}: outside the worktree confinement, do not pass it worktree paths.`
  );
}
