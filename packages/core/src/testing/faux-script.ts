import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import { JUDGE_SYSTEM_MARKER } from "../goals/judge-prompt";

export const SCRIPT_USAGE = [
  "write <path> <text>",
  "edit <path> <old> => <new>",
  "read <path>",
  "bash <command>",
  "task <description>",
  "agent <prompt>",
  "agent-fork <prompt>",
  "agents",
  "continue <subagent id> <prompt>",
  "bg <command>",
  "bg-quiet <command>",
  "monitor <command>",
  "todo <first> | <second> | ...",
  "think",
  "fail",
  "flaky",
  "overloaded",
  "image",
] as const;

type Reply = ReturnType<typeof fauxAssistantMessage>;

function messageText(message: Message): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function imageCount(message: UserMessage | undefined): number {
  if (!message || typeof message.content === "string") return 0;
  return message.content.filter((part) => part.type === "image").length;
}

function imageCountReply(message: UserMessage | undefined): Reply {
  return fauxAssistantMessage(`Images received: ${imageCount(message)}`);
}

const FAST_MODEL_ID = "faux-fast";
const TITLE_WORDS = 3;

function titleReply(input: string): Reply {
  return fauxAssistantMessage(`Title: ${input.trim().split(/\s+/).slice(0, TITLE_WORDS).join(" ")}`);
}

function toolCallReply(name: string, args: Record<string, unknown>): Reply {
  return fauxAssistantMessage([fauxText(`Running ${name}.`), fauxToolCall(name, args as never)], {
    stopReason: "toolUse",
  });
}

function todoArguments(rest: string) {
  const items = rest.split("|").map((item) => item.trim());
  return {
    todos: items.map((content, index) => ({ content, status: index === 0 ? "in_progress" : "pending" })),
  };
}

function slowTextReply(input: string): Reply {
  const sentence = `You said "${input}". This is a scripted reply from the faux model, streamed slowly. `;
  return fauxAssistantMessage(sentence.repeat(3).trim());
}

function failureReply(): Reply {
  return fauxAssistantMessage([], { stopReason: "error", errorMessage: "Simulated provider failure" });
}

function retryableFailureReply(): Reply {
  return fauxAssistantMessage([], {
    stopReason: "error",
    errorMessage: "Provider returned error: 503 service unavailable, the model is overloaded",
  });
}

function parseEdit(rest: string): Record<string, unknown> | undefined {
  const [path, change] = splitOnce(rest, " ");
  const [oldText, newText] = (change ?? "").split(" => ");
  if (!path || oldText === undefined || newText === undefined) return undefined;
  return { path, edits: [{ oldText, newText }] };
}

function splitOnce(text: string, separator: string): [string, string | undefined] {
  const index = text.indexOf(separator);
  return index < 0 ? [text, undefined] : [text.slice(0, index), text.slice(index + separator.length)];
}

const SUMMARY_REQUEST_START = "<conversation>";
const FAILING_SUMMARY_FOCUS = "Additional focus: fail";

const isFailingSummaryRequest = (input: string) =>
  input.startsWith(SUMMARY_REQUEST_START) && input.includes(FAILING_SUMMARY_FOCUS);

function scriptedReply(input: string, attempt: number, user: UserMessage | undefined): Reply {
  if (isFailingSummaryRequest(input)) return failureReply();
  const [command = "", rest = ""] = splitOnce(input.trim(), " ") as [string, string];
  switch (command) {
    case "write": {
      const [path, content] = splitOnce(rest, " ");
      return toolCallReply("write", { path, content: content ?? "" });
    }
    case "edit": {
      const args = parseEdit(rest);
      return args ? toolCallReply("edit", args) : slowTextReply(input);
    }
    case "read":
      return toolCallReply("read", { path: rest });
    case "bash":
      return toolCallReply("bash", { command: rest });
    case "task":
      return toolCallReply("task", { description: rest, prompt: rest });
    case "fork_agent":
      return toolCallReply("fork_agent", { description: rest, prompt: rest });
    case "agent":
      return toolCallReply("agent", { description: rest, prompt: rest });
    case "agent-fork":
      return toolCallReply("agent", { description: rest, prompt: rest, subagent_type: "fork" });
    case "agents":
      return toolCallReply("list_agents", {});
    case "continue": {
      const [subagent, prompt = ""] = splitOnce(rest, " ");
      return toolCallReply("task", { description: prompt, prompt, subagent });
    }
    case "bg":
      return toolCallReply("process_start", { command: rest });
    case "bg-quiet":
      return toolCallReply("process_start", { command: rest, notify_on_exit: false });
    case "monitor":
      return toolCallReply("monitor", { command: rest, description: rest });
    case "todo":
      return toolCallReply("todo_write", todoArguments(rest));
    case "think":
      return fauxAssistantMessage([
        fauxThinking("Let me think about this for a moment. The question is simple, so the answer is too."),
        fauxText("I thought about it, and here is the answer."),
      ]);
    case "fail":
      return failureReply();
    case "flaky":
      return attempt === 0
        ? retryableFailureReply()
        : fauxAssistantMessage("Recovered after a failed attempt.");
    case "overloaded":
      return retryableFailureReply();
    case "image":
      return imageCountReply(user);
    default:
      return slowTextReply(input);
  }
}

const systemTextOf = (message: Message): string => {
  const { role, content } = message as { role: string; content?: unknown };
  return role === "system" && typeof content === "string" ? content : "";
};

const isJudgeRequest = (messages: readonly Message[]) =>
  messages.some((message) => systemTextOf(message).startsWith(JUDGE_SYSTEM_MARKER));

const GOAL_MET_WORD = "goal-met";

/** The scripted judge: `met` once a tool result in the transcript contains "goal-met", else `not_met`. */
function judgeReply(messages: readonly Message[]): Reply {
  const request = messages.map(messageText).join("\n");
  const met = new RegExp(`result: [^\\n]*${GOAL_MET_WORD}`).test(request);
  const reason = met ? "The transcript shows it." : "There is no sign of it yet.";
  return fauxAssistantMessage(JSON.stringify({ verdict: met ? "met" : "not_met", reason }));
}

function withoutSectionUpdates(messages: readonly Message[]): Message[] {
  return messages.filter((message) => (message.role as string) !== "system");
}

function lastMessageIsToolResult(messages: readonly Message[]): boolean {
  return withoutSectionUpdates(messages).at(-1)?.role === "toolResult";
}

function lastUserMessage(messages: readonly Message[]): UserMessage | undefined {
  const real = withoutSectionUpdates(messages);
  for (let index = real.length - 1; index >= 0; index--) {
    const message = real[index];
    if (message?.role === "user") return message;
  }
  return undefined;
}

/**
 * A faux response function: the last user message is a tiny script (see SCRIPT_USAGE), a tool result is answered
 * with "Done.", and anything else gets a slow streamed reply. `fail` is a final error, `overloaded` a retryable one, and `flaky` is retryable on its first attempt only.
 */
export function createFauxScript(): FauxResponseFactory {
  const attempts = new Map<string, number>();
  return (context, _options, _state, model) => {
    if (isJudgeRequest(context.messages)) return judgeReply(context.messages);
    const user = lastUserMessage(context.messages);
    const input = user ? messageText(user) : "";
    if (model.id === FAST_MODEL_ID) return titleReply(input);
    if (lastMessageIsToolResult(context.messages)) return fauxAssistantMessage("Done.");
    const requestKey = `${user?.timestamp}:${input}`;
    const attempt = attempts.get(requestKey) ?? 0;
    attempts.set(requestKey, attempt + 1);
    return scriptedReply(input, attempt, user);
  };
}
