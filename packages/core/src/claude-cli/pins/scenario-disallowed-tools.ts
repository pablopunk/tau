import { createClaudeInput } from "../claude-input";
import { disallowedToolsOf } from "../connectors/chosen-servers";
import type { ClaudeMcpControl } from "../sdk-types";
import {
  initOf,
  LINEAR_PREFIX,
  LINEAR_SERVER,
  TURN_TIMEOUT_MS,
  waitForConnectors,
} from "./connector-harness";
import { type PinContext, pinOptions } from "./pin-context";
import { createPinHost, isResult, pinTool, record } from "./pin-harness";

const TAU_PREFIX = "mcp__tau__";
const REPLY_PROMPT = "Reply with the single word ok.";

const toolNamesOf = (init: { readonly [field: string]: unknown } | undefined): string[] => {
  const tools = init?.tools;
  return Array.isArray(tools) ? tools.map(String) : [];
};

const isTauOrLinear = (name: string) => name.startsWith(TAU_PREFIX) || name.startsWith(LINEAR_PREFIX);

async function disallowedForLinearOnly(control: ClaudeMcpControl): Promise<string[]> {
  const { servers } = await waitForConnectors(control);
  return disallowedToolsOf([LINEAR_SERVER], servers);
}

/** Pin (o2): `disallowedTools` for every server but Linear keeps their tools out of `init.tools`. One Haiku turn, no toggle. */
export async function disallowedToolsPin(ctx: PinContext): Promise<void> {
  const probe = ctx.port.startProbe();
  const disallowedTools = await disallowedForLinearOnly(probe).finally(() => probe.close());
  const input = createClaudeInput();
  const query = ctx.port.startQuery(
    pinOptions(ctx.cwd, input.stream, createPinHost([pinTool("get_word")]), {
      strictMcpConfig: false,
      settings: { disableClaudeAiConnectors: false, autoCompactEnabled: false },
      permissionMode: "default",
      allowedTools: [`${TAU_PREFIX}*`],
      disallowedTools,
      canUseTool: async () => ({ behavior: "deny", message: "Not expected to be asked." }),
    }),
  );
  const recorder = record(query);
  try {
    await waitForConnectors(query);
    ctx.budget.spend(REPLY_PROMPT);
    input.push(REPLY_PROMPT);
    await recorder.waitFor(isResult, TURN_TIMEOUT_MS, "the o2 turn's result");
    await ctx.report.run(
      "o2",
      "disallowedTools for every server but Linear: init.tools lists only tau and Linear tools",
      async () => {
        const tools = toolNamesOf(initOf(recorder));
        const foreign = tools.filter((name) => !isTauOrLinear(name));
        if (foreign.length > 0) throw new Error(`other tools are still listed: ${foreign.slice(0, 5)}`);
        if (!tools.some((name) => name.startsWith(LINEAR_PREFIX)))
          throw new Error(`no Linear tool listed; init.tools: ${tools.slice(0, 8)}`);
        return `${tools.length} tools, all tau or Linear (${disallowedTools.length} server globs disallowed)`;
      },
    );
  } finally {
    input.close();
    query.close();
  }
}
