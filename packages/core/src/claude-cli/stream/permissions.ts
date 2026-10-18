import { parseConnectorToolName } from "../connectors/names";
import type { ClaudeCanUseTool, ClaudePermissionDecision, ClaudePermissionRequest } from "../sdk-types";
import type { Binding } from "./binding";
import type { Runtime } from "./runtime";

const DENIED_MESSAGE = "The user denied this tool call.";
const NOT_CHOSEN_MESSAGE = "This connector is not switched on in tau.";

const deny = (message: string): ClaudePermissionDecision => ({ behavior: "deny", message });

const allow = (request: ClaudePermissionRequest): ClaudePermissionDecision => ({
  behavior: "allow",
  updatedInput: request.input,
});

async function askUser(
  rt: Runtime,
  binding: Binding,
  request: ClaudePermissionRequest,
  call: { readonly server: string; readonly tool: string },
): Promise<ClaudePermissionDecision> {
  const approvals = rt.deps.approvals;
  if (!approvals) return deny(DENIED_MESSAGE);
  binding.pendingApprovals += 1;
  try {
    const verdict = await approvals.request({
      piSessionId: binding.id,
      toolUseId: request.toolUseId,
      server: call.server,
      tool: call.tool,
      arguments: request.input,
      signal: request.signal,
    });
    return verdict.allowed ? allow(request) : deny(verdict.message);
  } finally {
    binding.pendingApprovals -= 1;
  }
}

/**
 * The `canUseTool` of a query with connectors: (1) deny a server that is not chosen,
 * (2) allow a tool the user always allowed, (3) ask the user.
 */
export function createCanUseTool(rt: Runtime, binding: Binding, chosen: readonly string[]): ClaudeCanUseTool {
  return async (request) => {
    const server = request.mcpServer?.name;
    const call = parseConnectorToolName(request.toolName);
    if (!server || !call || !chosen.includes(server)) return deny(NOT_CHOSEN_MESSAGE);
    if (await rt.deps.approvals?.isAlwaysAllowed(request.toolName)) return allow(request);
    return askUser(rt, binding, request, call);
  };
}
