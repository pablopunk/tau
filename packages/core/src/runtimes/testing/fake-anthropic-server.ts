import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptedBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: unknown };

export interface RecordedMessage {
  readonly role: string;
  readonly content: unknown;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly keyHeader: "x-api-key" | "authorization" | null;
  readonly keyWasFake: boolean;
  readonly stream: boolean;
  readonly messages: readonly RecordedMessage[];
  readonly body: unknown;
}

export interface ScriptedTurn {
  readonly blocks: readonly ScriptedBlock[];
  /** Returns a problem description, or nothing when the request is as expected. */
  readonly validate?: (request: RecordedRequest) => string | undefined;
  /** The request is received and held until this resolves; nothing is answered meanwhile. */
  readonly holdResponseUntil?: Promise<void>;
}

export interface FakeAnthropicServer {
  readonly url: string;
  /** Every request of any kind, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /** Only POST /v1/messages requests. */
  readonly messageRequests: readonly RecordedRequest[];
  /** Validation failures and unexpected requests. Must stay empty. */
  readonly violations: readonly string[];
  /** Resolves once the Nth (1-based) /v1/messages request has arrived. */
  messageRequestArrived(count: number): Promise<void>;
  /** Resolves once the response to the Nth /v1/messages request was fully written. */
  messageResponseSent(count: number): Promise<void>;
  close(): Promise<void>;
}

export interface FakeAnthropicOptions {
  readonly apiKey: string;
  readonly script: readonly ScriptedTurn[];
  readonly model?: string;
}

const MESSAGES_PATH = "/v1/messages";

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const keyOf = (req: IncomingMessage): { header: RecordedRequest["keyHeader"]; value: string | null } => {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string") return { header: "x-api-key", value: apiKey };
  const authorization = req.headers.authorization;
  if (typeof authorization === "string")
    return { header: "authorization", value: authorization.replace(/^Bearer\s+/i, "") };
  return { header: null, value: null };
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const messagesOf = (body: unknown): RecordedMessage[] => {
  const list = (body as { messages?: unknown } | null)?.messages;
  return Array.isArray(list) ? (list as RecordedMessage[]) : [];
};

const sseEvent = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const emptyMessage = (id: string, model: string) => ({
  id,
  type: "message",
  role: "assistant",
  model,
  content: [],
  stop_reason: null,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 1 },
});

const startEventOf = (block: ScriptedBlock) =>
  block.type === "text"
    ? { type: "text", text: "" }
    : { type: "tool_use", id: block.id, name: block.name, input: {} };

const deltaOf = (block: ScriptedBlock) =>
  block.type === "text"
    ? { type: "text_delta", text: block.text }
    : { type: "input_json_delta", partial_json: JSON.stringify(block.input) };

const stopReasonOf = (blocks: readonly ScriptedBlock[]) =>
  blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn";

export function streamBody(turnIndex: number, blocks: readonly ScriptedBlock[], model: string): string {
  const parts = [
    sseEvent("message_start", {
      type: "message_start",
      message: emptyMessage(`msg_fake_${turnIndex}`, model),
    }),
  ];
  blocks.forEach((block, index) => {
    parts.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: startEventOf(block),
      }),
    );
    parts.push(
      sseEvent("content_block_delta", { type: "content_block_delta", index, delta: deltaOf(block) }),
    );
    parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
  });
  parts.push(
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReasonOf(blocks), stop_sequence: null },
      usage: { output_tokens: 5 },
    }),
  );
  parts.push(sseEvent("message_stop", { type: "message_stop" }));
  return parts.join("");
}

export function jsonBody(turnIndex: number, blocks: readonly ScriptedBlock[], model: string) {
  return {
    ...emptyMessage(`msg_fake_${turnIndex}`, model),
    content: blocks.map((block) =>
      block.type === "text"
        ? block
        : { type: "tool_use", id: block.id, name: block.name, input: block.input },
    ),
    stop_reason: stopReasonOf(blocks),
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

interface Waiters {
  arrived: Map<number, () => void>;
  sent: Map<number, () => void>;
}

const eventually = (table: Map<number, () => void>, count: number, already: number): Promise<void> =>
  already >= count ? Promise.resolve() : new Promise((resolve) => table.set(count, resolve));

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const rejectBadKey = (res: ServerResponse) =>
  sendJson(res, 401, {
    type: "error",
    error: { type: "authentication_error", message: "invalid x-api-key" },
  });

export async function startFakeAnthropicServer(options: FakeAnthropicOptions): Promise<FakeAnthropicServer> {
  const model = options.model ?? "claude-sonnet-4-5";
  const requests: RecordedRequest[] = [];
  const messageRequests: RecordedRequest[] = [];
  const violations: string[] = [];
  let sentCount = 0;
  const waiters: Waiters = { arrived: new Map(), sent: new Map() };

  async function handleMessages(res: ServerResponse, recorded: RecordedRequest) {
    messageRequests.push(recorded);
    const number = messageRequests.length;
    waiters.arrived.get(number)?.();
    const turn = options.script[number - 1];
    if (!turn) {
      violations.push(
        `request #${number} to ${MESSAGES_PATH} exceeds the script of ${options.script.length} turns`,
      );
      return sendJson(res, 500, { type: "error", error: { type: "api_error", message: "script exhausted" } });
    }
    const problem = turn.validate?.(recorded);
    if (problem) {
      violations.push(`request #${number}: ${problem}`);
      return sendJson(res, 400, {
        type: "error",
        error: { type: "invalid_request_error", message: problem },
      });
    }
    if (turn.holdResponseUntil) await turn.holdResponseUntil;
    if (res.destroyed) return;
    const finish = () => {
      sentCount = Math.max(sentCount, number);
      waiters.sent.get(number)?.();
    };
    if (recorded.stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(streamBody(number, turn.blocks, model), finish);
    } else {
      sendJson(res, 200, jsonBody(number, turn.blocks, model));
      finish();
    }
  }

  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const raw = await readBody(req);
    const body = parseJson(raw);
    const key = keyOf(req);
    const recorded: RecordedRequest = {
      method: req.method ?? "",
      path,
      keyHeader: key.header,
      keyWasFake: key.value === options.apiKey,
      stream: (body as { stream?: unknown } | null)?.stream === true,
      messages: messagesOf(body),
      body,
    };
    requests.push(recorded);
    if (!recorded.keyWasFake) {
      violations.push(`${recorded.method} ${path} carried a key that is not the fake key`);
      return rejectBadKey(res);
    }
    if (req.method === "POST" && path === MESSAGES_PATH) return handleMessages(res, recorded);
    if (req.method === "POST" && path === `${MESSAGES_PATH}/count_tokens`)
      return sendJson(res, 200, { input_tokens: 10 });
    violations.push(`unexpected request ${recorded.method} ${path}`);
    sendJson(res, 404, { type: "error", error: { type: "not_found_error", message: path } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    messageRequests,
    violations,
    messageRequestArrived: (count) => eventually(waiters.arrived, count, messageRequests.length),
    messageResponseSent: (count) => eventually(waiters.sent, count, sentCount),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const textOfContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = part as { type?: string; text?: string; content?: unknown };
      if (block.type === "text") return block.text ?? "";
      if (block.type === "tool_result") return textOfContent(block.content);
      return "";
    })
    .join("\n");
};

interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content?: unknown;
  readonly is_error?: boolean;
}

export const toolResultsIn = (message: RecordedMessage | undefined): ToolResultBlock[] =>
  message && Array.isArray(message.content)
    ? (message.content as { type?: string }[]).filter(
        (block): block is ToolResultBlock => block.type === "tool_result",
      )
    : [];

export const toolResultText = (result: ToolResultBlock): string => textOfContent(result.content);

/** A validator: the last message must hold a tool_result for `toolUseId` containing `expectedText`. */
export const expectToolResult =
  (toolUseId: string, expectedText: string) =>
  (request: RecordedRequest): string | undefined => {
    const result = toolResultsIn(request.messages.at(-1)).find((block) => block.tool_use_id === toolUseId);
    if (!result) return `last message has no tool_result for ${toolUseId}`;
    if (!toolResultText(result).includes(expectedText))
      return `tool_result for ${toolUseId} lacks "${expectedText}": ${toolResultText(result)}`;
    return undefined;
  };
