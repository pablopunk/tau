import type { TranscribeInput } from "@tau/protocol";

/**
 * Provider speech-to-text: multipart POST to `{providerBase}/audio/transcriptions`
 * with the connection key, file from blob bytes. Agent (b) fills this; map
 * failures to `invalid_request` (bad audio/key) or `internal`.
 */
export async function transcribeWithProvider(
  _input: TranscribeInput,
  _provider: string,
  _modelId: string,
): Promise<string> {
  // TODO(agent b): OpenRouter `POST {openrouterBase}/audio/transcriptions` with connection key.
  throw new Error("Not implemented: transcribeWithProvider");
}
