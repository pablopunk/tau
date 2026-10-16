import type {
  AssistantMessage as AssistantMessageData,
  ToolCall as ToolCallBlock,
} from "@pi-everywhere/protocol";
import { CopyButton } from "@/components/ui/copy-button";
import type { ToolCallState } from "../model/tool-state";
import { ToolCall } from "../tools/ToolCall";
import { Markdown } from "./Markdown";
import { ErrorNotice } from "./notices";
import { ThinkingBlock } from "./ThinkingBlock";

export interface AssistantMessageProps {
  readonly message: AssistantMessageData;
  readonly resolveTool: (call: ToolCallBlock) => ToolCallState;
  /** A partial message still being generated: tool calls are shown from the live slots instead. */
  readonly streaming?: boolean;
}

type Block = AssistantMessageData["content"][number];

function BlockView({ block, props }: { block: Block; props: AssistantMessageProps }) {
  const streaming = props.streaming ?? false;
  if (block.type === "text") return block.text ? <Markdown>{block.text}</Markdown> : null;
  if (block.type === "thinking")
    return block.thinking ? <ThinkingBlock text={block.thinking} streaming={streaming} /> : null;
  if (block.type === "toolCall" && !streaming) return <ToolCall state={props.resolveTool(block)} />;
  return null;
}

function keyOf(block: Block, index: number): string {
  return block.type === "toolCall" ? block.id : `${block.type}:${index}`;
}

export function markdownOf(message: AssistantMessageData): string {
  return message.content
    .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
    .join("\n\n");
}

export function AssistantMessage(props: AssistantMessageProps) {
  const { message } = props;
  const markdown = markdownOf(message);
  return (
    <div className="group space-y-2" data-testid="assistant-message">
      {message.content.map((block, index) => (
        <BlockView key={keyOf(block, index)} block={block} props={props} />
      ))}
      {message.stopReason === "error" ? <ErrorNotice message={message.errorMessage} /> : null}
      {markdown && !props.streaming ? <CopyButton text={markdown} label="Copy answer" /> : null}
      {message.stopReason === "aborted" ? <p className="text-xs text-muted-foreground">Stopped.</p> : null}
    </div>
  );
}
