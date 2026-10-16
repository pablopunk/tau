import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AppError,
  changedFrame,
  decodeClientFrame,
  decodeServerFrame,
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorBody,
  ErrorBodySchema,
  encodeFrame,
  fillPath,
  isErrorBody,
  isRetryable,
  routes,
  toErrorBody,
} from "./index";

describe("errors", () => {
  it("has an HTTP status for every code", () => {
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it("round-trips an AppError through the error body schema", () => {
    const body: ErrorBody = toErrorBody(new AppError("not_found", "nope"));
    expect(Value.Check(ErrorBodySchema, body)).toBe(true);
    expect(isErrorBody(body)).toBe(true);
    expect(isErrorBody({ error: { code: "other", message: "x" } })).toBe(false);
  });
});

describe("routes", () => {
  it("fills and encodes path params", () => {
    expect(fillPath(routes.renameProject.path, { id: "a b" })).toBe("/api/projects/a%20b");
  });
});

describe("frames", () => {
  it("decodes valid client frames and rejects the rest", () => {
    expect(decodeClientFrame('{"type":"subscribe","conversationId":"c1"}')).toEqual({
      type: "subscribe",
      conversationId: "c1",
    });
    expect(decodeClientFrame('{"type":"subscribe"}')).toBeUndefined();
    expect(decodeClientFrame("not json")).toBeUndefined();
  });

  it("decodes ops and changed server frames", () => {
    const ops = encodeFrame({ type: "ops", conversationId: "c1", ops: [["r", null]] });
    expect(decodeServerFrame(ops)).toEqual({ type: "ops", conversationId: "c1", ops: [["r", null]] });
    const changed = encodeFrame(changedFrame({ resource: "conversations", projectId: "p1" }));
    expect(decodeServerFrame(changed)).toEqual({
      type: "changed",
      resource: "conversations",
      projectId: "p1",
    });
    expect(decodeServerFrame('{"type":"changed","resource":"nope"}')).toBeUndefined();
  });
});

describe("isRetryable", () => {
  const assistant = (stopReason: string) => ({
    kind: "pi.assistant",
    model: [{ role: "assistant", stopReason }],
  });
  const viewOf = (entries: unknown[], running = false) =>
    ({ conversation: { id: 1 }, entries, docs: { "pi.live": running ? { run: {} } : {} } }) as never;

  it("is false for a finished answer, a running thread and an empty one", () => {
    expect(isRetryable(viewOf([{ kind: "pi.user" }, assistant("stop")]))).toBe(false);
    expect(isRetryable(viewOf([{ kind: "pi.user" }, assistant("length")]))).toBe(false);
    expect(isRetryable(viewOf([{ kind: "pi.user" }], true))).toBe(false);
    expect(isRetryable(viewOf([]))).toBe(false);
  });

  it("is true after an error, an abort, a stop during a tool or before the first token", () => {
    expect(isRetryable(viewOf([{ kind: "pi.user" }, assistant("error")]))).toBe(true);
    expect(isRetryable(viewOf([{ kind: "pi.user" }, assistant("aborted")]))).toBe(true);
    expect(isRetryable(viewOf([{ kind: "pi.user" }, assistant("toolUse"), { kind: "pi.tool-result" }]))).toBe(
      true,
    );
    expect(isRetryable(viewOf([{ kind: "pi.user" }]))).toBe(true);
    expect(isRetryable(viewOf([{ kind: "pi.user" }, assistant("stop"), { kind: "app.retry" }]))).toBe(true);
  });
});
