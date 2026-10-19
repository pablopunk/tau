// Throwaway stdio MCP server for the real tool-search pins. Not shipped.
// Tools: fixture_read (readOnlyHint true) and fixture_write (readOnlyHint false; appends a line to FIXTURE_FILE).
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const file = process.env.FIXTURE_FILE;
const TOOLS = [
  {
    name: "fixture_read",
    description: "Returns the fixed marker string READ_OK. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "fixture_write",
    description: "Appends the given text as one line to the fixture file. Changes data.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });

function call(name, args) {
  if (name === "fixture_read") return { content: [{ type: "text", text: "READ_OK" }] };
  if (name === "fixture_write" && file) {
    appendFileSync(file, `${args?.text ?? ""}\n`);
    return { content: [{ type: "text", text: "WRITE_OK" }] };
  }
  return { isError: true, content: [{ type: "text", text: "unknown tool" }] };
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  if (request.method === "initialize")
    reply(request.id, {
      protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "tau-pin-fixture", version: "0.0.0" },
    });
  else if (request.method === "tools/list") reply(request.id, { tools: TOOLS });
  else if (request.method === "tools/call")
    reply(request.id, call(request.params.name, request.params.arguments));
  else send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "no such method" } });
});
