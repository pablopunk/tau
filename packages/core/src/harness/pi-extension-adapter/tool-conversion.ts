import type { Context, JsonValue } from "@earendil-works/chord";
import { defineTool, type ToolExecutionApi, type ToolRegistration } from "@earendil-works/pi-durable";
import { createExtensionContext } from "./extension-context";
import type { PiTool, PiToolResult, ToolContent } from "./fake-extension-api";

type DurableContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const toJson = (value: unknown): JsonValue | undefined =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as JsonValue);

function durableContentOf(item: ToolContent): DurableContent {
  if (item.type === "image" && item.data !== undefined && item.mimeType !== undefined) {
    return { type: "image", data: item.data, mimeType: item.mimeType };
  }
  return { type: "text", text: item.text ?? JSON.stringify(item) };
}

const durableContentsOf = (result: PiToolResult): DurableContent[] =>
  (result.content ?? []).map(durableContentOf);

const textOf = (result: PiToolResult): string =>
  (result.content ?? []).flatMap((item) => (item.text === undefined ? [] : [item.text])).join("\n");

function progressForwarder(api: ToolExecutionApi, context: Context) {
  return (partial: PiToolResult) => {
    const text = textOf(partial);
    if (text !== "") api.output(`${text}\n`);
    const details = toJson(partial.details);
    if (details !== undefined) void api.details(details, context).catch(() => undefined);
  };
}

export function toToolRegistration(tool: PiTool): ToolRegistration {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    replay: "unsafe",
    async execute(args, api, context) {
      const signal = context.abortSignal;
      const cwd = api.env?.cwd ?? process.cwd();
      const result = await tool.execute(
        api.callId,
        args as never,
        signal,
        progressForwarder(api, context),
        createExtensionContext(cwd, signal),
      );
      const details = toJson(result.details);
      return {
        output: durableContentsOf(result),
        isError: result.isError === true,
        ...(details !== undefined && { details }),
      };
    },
  });
}
