import type { ClaudeConnectorSettings } from "@tau/protocol";
import type { ApprovalRequest, Approvals } from "../../approvals/approvals-port";
import type { ClaudeMcpServerStatus } from "../sdk-types";
import {
  FAKE_LINEAR,
  FAKE_NEEDS_AUTH,
  FAKE_SLACK,
  type FakeConnectorServer,
} from "../testing/fake-claude-connectors";
import type { FakeStep } from "../testing/fake-claude-script";
import { createHarness, type Harness, type HarnessOptions, tick } from "./test-support";

export const statusOf = (server: FakeConnectorServer): ClaudeMcpServerStatus => ({
  name: server.name,
  status: server.status,
  source: server.source ?? "claudeai",
  error: null,
  tools: server.tools,
});

export const connectedStatuses = async (): Promise<readonly ClaudeMcpServerStatus[]> =>
  [FAKE_LINEAR, FAKE_SLACK, FAKE_NEEDS_AUTH].map(statusOf);

export const LINEAR = "claude.ai Linear";
export const SLACK = "claude.ai Slack";

/** Slack is switched off, so Linear is the only chosen connector. */
export const linearOnly: ClaudeConnectorSettings = {
  disabled: [SLACK],
  alwaysAllow: [],
  askBeforeWrites: false,
};

export const linearAsking: ClaudeConnectorSettings = { ...linearOnly, askBeforeWrites: true };

export const connectorHarness = (options: HarnessOptions = {}): Harness =>
  createHarness({
    connectors: [FAKE_LINEAR, FAKE_SLACK, FAKE_NEEDS_AUTH],
    connectorSettings: linearOnly,
    ...options,
  });

export const connectorStep = (
  tool: string,
  result: string,
  extra: { readonly server?: string; readonly delayMs?: number; readonly isError?: boolean } = {},
): FakeStep => ({
  kind: "tools",
  calls: [
    {
      name: tool,
      arguments: {},
      connector: { server: extra.server ?? LINEAR, result, delayMs: extra.delayMs, isError: extra.isError },
    },
  ],
});

export interface FakeApprovals extends Approvals {
  readonly requests: ApprovalRequest[];
  answer: "allow" | "deny";
  always: Set<string>;
}

export function createFakeApprovals(): FakeApprovals {
  const requests: ApprovalRequest[] = [];
  const approvals: FakeApprovals = {
    requests,
    answer: "allow",
    always: new Set(),
    async request(request) {
      requests.push(request);
      return approvals.answer === "allow"
        ? { allowed: true }
        : { allowed: false, message: "The user denied this tool call." };
    },
    list: () => [],
    decide: async () => undefined,
    denyAll: () => undefined,
    hasPending: () => false,
    isAlwaysAllowed: async (name) => approvals.always.has(name),
  };
  return approvals;
}

/** Advances the manual clock in poll-sized steps, letting promises run between steps. */
export async function advanceUntil(harness: Harness, done: () => boolean): Promise<void> {
  for (let step = 0; step < 80 && !done(); step++) {
    harness.clock.advance(250);
    await tick();
  }
}
