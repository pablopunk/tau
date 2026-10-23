import type { AssistantMessage as AssistantMessageData, ToolCall as ToolCallBlock } from "@tau/protocol";
import { memo } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import type { ToolCallState } from "../model/tool-state";
import { ToolCall } from "../tools/ToolCall";
import { Markdown } from "./Markdown";
import { MessageMenu } from "./MessageMenu";
import { ModelLabel } from "./ModelLabel";
import { type MessageEntry, sameEntry } from "./message-actions";
import { ErrorNotice } from "./notices";
import { ThinkingBlock } from "./ThinkingBlock";

export interface AssistantMessageProps {
  readonly message: AssistantMessageData;
  readonly resolveTool: (call: ToolCallBlock) => ToolCallState;
  /** A partial message still being generated: tool calls are shown from the live slots instead. */
  readonly streaming?: boolean;
  readonly entry?: MessageEntry;
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

function AssistantMessageView(props: AssistantMessageProps) {
  const { message } = props;
  const markdown = markdownOf(message);
  return (
    <div className="group space-y-2" data-testid="assistant-message">
      {message.content.map((block, index) => (
        <BlockView key={keyOf(block, index)} block={block} props={props} />
      ))}
      {message.stopReason === "error" ? <ErrorNotice message={message.errorMessage} /> : null}
      {markdown && !props.streaming ? (
        <div className="flex items-center gap-2">
          <CopyButton text={markdown} label="Copy answer" />
          <ModelLabel message={message} />
          {props.entry ? <MessageMenu entry={props.entry} /> : null}
        </div>
      ) : null}
      {message.stopReason === "aborted" ? <p className="text-xs text-muted-foreground">Stopped.</p> : null}
    </div>
  );
}

const toolCallsOf = (message: AssistantMessageData) =>
  message.content.filter((block): block is ToolCallBlock => block.type === "toolCall");

/**
 * Skips the render when the message, its actions and the state of each of its tool calls are all unchanged.
 * `resolveTool` is a new closure every render, so it is judged by what it returns for this message's calls.
 */
function sameAssistantMessage(before: AssistantMessageProps, after: AssistantMessageProps): boolean {
  if (before.message !== after.message || before.streaming !== after.streaming) return false;
  if (!sameEntry(before.entry, after.entry)) return false;
  return toolCallsOf(after.message).every((call) => before.resolveTool(call) === after.resolveTool(call));
}

export const AssistantMessage = memo(AssistantMessageView, sameAssistantMessage);
