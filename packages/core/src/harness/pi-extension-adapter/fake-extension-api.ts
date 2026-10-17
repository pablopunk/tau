import type { TSchema } from "typebox";

export type ToolContent = { type: string; text?: string; data?: string; mimeType?: string };

export type PiToolResult = {
  content?: ToolContent[];
  details?: unknown;
  isError?: boolean;
};

export type PiToolUpdate = (partial: PiToolResult) => void;

export type PiTool = {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: never,
    signal: AbortSignal | undefined,
    onUpdate: PiToolUpdate | undefined,
    ctx: unknown,
  ) => Promise<PiToolResult>;
};

export type PiExtension = (api: never) => unknown;

const doNothing = () => undefined;

function createFakeExtensionApi(collected: PiTool[]) {
  const registerTool = (tool: PiTool) => void collected.push(tool);
  return new Proxy(
    { registerTool },
    { get: (target, key) => (key in target ? target[key as "registerTool"] : doNothing) },
  );
}

export function collectExtensionTools(extension: PiExtension): PiTool[] {
  const collected: PiTool[] = [];
  extension(createFakeExtensionApi(collected) as never);
  return collected;
}
