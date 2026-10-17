import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "echo", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Repeat the given text",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    { name: "token", description: "Read the TOKEN env var", inputSchema: { type: "object", properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "echo") return { content: [{ type: "text", text: `echo: ${args.text}` }] };
  if (name === "token") return { content: [{ type: "text", text: process.env.TOKEN ?? "" }] };
  return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
});

await server.connect(new StdioServerTransport());
