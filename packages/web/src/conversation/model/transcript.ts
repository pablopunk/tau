import { type ConversationView, type Transcript, transcriptOf } from "@tau/protocol";

export type { ToolDiagnostic, ToolResultInfo, Transcript, TranscriptItem } from "@tau/protocol";
export { userImages, userText } from "@tau/protocol";

export function buildTranscript(view: ConversationView): Transcript {
  return transcriptOf(view);
}
