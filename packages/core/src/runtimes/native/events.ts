export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type NativeEvent =
  | { readonly type: "session"; readonly key: string; readonly sessionId: string }
  | {
      readonly type: "assistant-text";
      readonly key: string;
      readonly messageId: string;
      readonly partIndex: number;
      readonly text: string;
    }
  | {
      readonly type: "assistant-thinking";
      readonly key: string;
      readonly messageId: string;
      readonly partIndex: number;
      readonly text: string;
      readonly visible: boolean;
    }
  | {
      readonly type: "tool-call";
      readonly key: string;
      readonly callId: string;
      readonly name: string;
      readonly input: JsonValue;
    }
  | {
      readonly type: "tool-result";
      readonly key: string;
      readonly callId: string;
      readonly isError: boolean;
      readonly text: string;
      readonly imageCount: number;
    }
  | {
      readonly type: "usage";
      readonly key: string;
      readonly messageId: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
    }
  | {
      readonly type: "result";
      readonly key: string;
      readonly subtype: string;
      readonly isError: boolean;
      readonly text?: string;
      readonly durationMs?: number;
      readonly costUsd?: number;
      readonly sessionId: string;
    }
  | { readonly type: "notice"; readonly key: string; readonly code: string; readonly text: string };

export type NativeEventType = NativeEvent["type"];
