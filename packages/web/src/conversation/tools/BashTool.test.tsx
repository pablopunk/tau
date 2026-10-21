import type { ToolCall } from "@tau/protocol";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "@/sidebar/test-support";
import type { ToolCallState } from "../model/tool-state";
import type { ToolResultInfo } from "../model/transcript";
import { BashTool } from "./BashTool";
import { ToolConversationProvider } from "./tool-conversation";

const { background, stopCall } = vi.hoisted(() => ({
  background: vi.fn(async () => ({})),
  stopCall: vi.fn(async () => {}),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { ...original.api, processes: { ...original.api.processes, background, stopCall } },
  };
});

const call = { id: "call-7", name: "bash", arguments: { command: "sleep 60" } } as unknown as ToolCall;

const running: ToolCallState = { call, status: "running", result: undefined, slot: undefined };

function finished(details: unknown, durationMs?: number): ToolCallState {
  const message = {
    role: "toolResult",
    isError: false,
    details,
    content: [{ type: "text", text: "ok" }],
    ...(durationMs !== undefined && { durationMs }),
  };
  return {
    call,
    status: "done",
    result: { message, diagnostics: [] } as unknown as ToolResultInfo,
    slot: undefined,
  };
}

function failedWithExit(exitCode: number, durationMs?: number): ToolCallState {
  const message = {
    role: "toolResult",
    isError: true,
    content: [{ type: "text", text: "boom" }],
    ...(durationMs !== undefined && { durationMs }),
  };
  return {
    call,
    status: "error",
    result: {
      message,
      diagnostics: [
        { severity: "error", code: "exit_code", message: `Command exited with code ${exitCode}` },
      ],
    } as unknown as ToolResultInfo,
    slot: undefined,
  };
}

const inThread = (state: ToolCallState) => (
  <ToolConversationProvider value="thread-1">
    <BashTool state={state} />
  </ToolConversationProvider>
);

describe("bash tool card", () => {
  beforeEach(() => {
    background.mockClear();
    stopCall.mockClear();
  });

  it("sends a running command to the background", async () => {
    renderAt("/", inThread(running));
    await userEvent.click(screen.getByRole("button", { name: "Run in background" }));
    expect(background).toHaveBeenCalledWith("thread-1", "call-7");
  });

  it("stops a running command", async () => {
    renderAt("/", inThread(running));
    await userEvent.click(screen.getByRole("button", { name: "Stop command" }));
    expect(stopCall).toHaveBeenCalledWith("thread-1", "call-7");
  });

  it("offers nothing once the command is done", () => {
    renderAt("/", inThread(finished({})));
    expect(screen.queryByRole("button", { name: "Run in background" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop command" })).toBeNull();
  });

  it("offers nothing where the transcript has no thread", () => {
    renderAt("/", <BashTool state={running} />);
    expect(screen.queryByRole("button", { name: "Run in background" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop command" })).toBeNull();
  });

  it("marks a command that was moved to the background", () => {
    renderAt("/", inThread(finished({ processId: "p1", backgrounded: true })));
    expect(screen.getByText("Background")).toBeTruthy();
  });

  it("shows how long a successful command took", () => {
    renderAt("/", inThread(finished({}, 1250)));
    expect(screen.getByText("1.3s")).toBeTruthy();
  });

  it("shows duration next to a non-zero exit", () => {
    renderAt("/", inThread(failedWithExit(1, 65_000)));
    expect(screen.getByText("1m 5s")).toBeTruthy();
    expect(screen.getByText("Exit 1")).toBeTruthy();
  });

  it("shows milliseconds for fast commands", () => {
    renderAt("/", inThread(finished({}, 25)));
    expect(screen.getByText("25ms")).toBeTruthy();
  });
});
