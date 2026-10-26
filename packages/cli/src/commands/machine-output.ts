import type { RuntimeLifecycle, SendReceipt, TerminalServerFrame } from "@tau/protocol";
import { CliExit } from "./cli-exit";
import type { CommandEnv } from "./command-env";

export interface MachineEnvelope {
  version: 1;
  kind: "receipt" | "event" | "terminal" | "error";
  command: string;
  nodeId: string | null;
  threadId: string | null;
  terminalId: string | null;
  requestId: string | null;
  submissionId: SendReceipt["submissionId"] | null;
  entryId: NonNullable<SendReceipt["entryId"]> | null;
  lifecycle: RuntimeLifecycle | null;
  observation: "response" | "thread-idle" | null;
  result: unknown;
  error: { source: "protocol" | "cli"; code: string; message: string } | null;
  event: null | {
    stream: "terminal";
    sequence: number;
    frame: TerminalServerFrame | { type: "output"; encoding: "base64"; data: string };
  };
}

export class MachineOutput {
  private identity: Partial<MachineEnvelope> = {};
  constructor(
    private readonly env: CommandEnv,
    private readonly command: string,
  ) {}

  identify(
    identity: Partial<
      Pick<MachineEnvelope, "nodeId" | "threadId" | "terminalId" | "requestId" | "submissionId" | "entryId">
    >,
  ): void {
    this.identity = { ...this.identity, ...identity };
  }

  emit(kind: MachineEnvelope["kind"], fields: Partial<MachineEnvelope> = {}): void {
    const envelope: MachineEnvelope = {
      version: 1,
      kind,
      command: this.command,
      nodeId: null,
      threadId: null,
      terminalId: null,
      requestId: null,
      submissionId: null,
      entryId: null,
      lifecycle: null,
      observation: null,
      result: null,
      error: null,
      event: null,
      ...this.identity,
      ...fields,
    };
    this.env.stdout(JSON.stringify(envelope));
  }

  fail(error: unknown): CliExit {
    const exit =
      error instanceof CliExit
        ? error
        : new CliExit(1, error instanceof Error ? error.message : "Command failed", "transport_error");
    if (exit.reported) return exit;
    this.emit("error", {
      error: {
        source: exit.source,
        code: exit.code,
        message: exit.message,
      },
      lifecycle: exit.lifecycle,
      observation: exit.observation,
    });
    return exit;
  }
}
