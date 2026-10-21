import { AppError, type TranscribeInput } from "@tau/protocol";
import { OPENROUTER_API_BASE } from "../provider/voice-models";

const TRANSCRIPTIONS_URL = `${OPENROUTER_API_BASE}/audio/transcriptions`;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Provider speech-to-text via `POST {openrouterBase}/audio/transcriptions`
 * with a JSON body, using the connection key. Blob inputs pass through with
 * their container format; raw f32 PCM is wrapped in a WAV header first
 * because the endpoint takes audio containers, not raw floats.
 */
export async function transcribeWithProvider(
  input: TranscribeInput,
  provider: string,
  modelId: string,
  apiKey: string,
): Promise<string> {
  if (provider !== "openrouter") {
    throw new AppError("invalid_request", `Unknown speech provider: ${provider}.`);
  }
  if (apiKey === "") {
    throw new AppError("invalid_request", "OpenRouter is not connected.");
  }
  const inputAudio = audioPayloadOf(input);
  let response: Response;
  try {
    response = await fetch(TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: modelId, input_audio: inputAudio, response_format: "json" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("internal", "Could not reach OpenRouter to transcribe the audio. Check your connection.");
  }
  if (!response.ok) {
    throw response.status >= 500
      ? new AppError("internal", `OpenRouter could not transcribe the audio (HTTP ${response.status}).`)
      : new AppError("invalid_request", `OpenRouter could not transcribe the audio (HTTP ${response.status}).`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof (body as { text?: unknown } | null)?.text !== "string") {
    throw new AppError("internal", "OpenRouter returned an unreadable transcription.");
  }
  return (body as { text: string }).text;
}

function audioPayloadOf(input: TranscribeInput): { data: string; format: string } {
  if (input.format === "blob") {
    return { data: input.data, format: input.mimeType === "audio/webm" ? "webm" : "mp4" };
  }
  return { data: pcmF32ToWavBase64(input.data, input.sampleRate), format: "wav" };
}

/** Wraps raw f32 mono samples (base64) in a 44-byte IEEE-float WAV header. */
function pcmF32ToWavBase64(data: string, sampleRate: number): string {
  const samples = Buffer.from(data, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]).toString("base64");
}
