import type { ClaudeContentBlock, ClaudeSdkMessage, ClaudeToolResult } from "../sdk-types";

export interface CliToolResult {
  readonly toolUseId: string;
  readonly result: ClaudeToolResult;
}

interface RawBlock {
  readonly type?: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
  readonly source?: { readonly data?: string; readonly media_type?: string };
}

interface RawToolResult {
  readonly type?: string;
  readonly tool_use_id?: string;
  readonly content?: string | readonly RawBlock[];
  readonly is_error?: boolean;
}

function contentBlockOf(block: RawBlock): ClaudeContentBlock | null {
  if (block.type === "text") return { type: "text", text: block.text ?? "" };
  if (block.type !== "image") return null;
  const data = block.source?.data ?? block.data;
  const mimeType = block.source?.media_type ?? block.mimeType;
  return data && mimeType ? { type: "image", data, mimeType } : null;
}

const contentOf = (raw: RawToolResult["content"]): ClaudeContentBlock[] => {
  if (typeof raw === "string") return [{ type: "text", text: raw }];
  return (raw ?? []).flatMap((block) => contentBlockOf(block) ?? []);
};

/** The tool results of a CLI `user` message, content unchanged. */
export function toolResultsOf(message: ClaudeSdkMessage): CliToolResult[] {
  const body = message.message as { readonly content?: unknown } | undefined;
  if (!Array.isArray(body?.content)) return [];
  return (body.content as RawToolResult[])
    .filter((block) => block.type === "tool_result" && typeof block.tool_use_id === "string")
    .map((block) => ({
      toolUseId: block.tool_use_id as string,
      result: { content: contentOf(block.content), isError: block.is_error === true },
    }));
}
