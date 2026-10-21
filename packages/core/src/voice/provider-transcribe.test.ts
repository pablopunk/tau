import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, type TranscribeInput } from "@tau/protocol";
import { transcribeWithProvider } from "./provider-transcribe";
import { OPENROUTER_API_BASE } from "../provider/voice-models";

afterEach(() => vi.unstubAllGlobals());

interface CapturedRequest {
  url: string;
  method: string;
  authorization: string | null;
  body: { model: unknown; input_audio: { data: unknown; format: unknown }; response_format: unknown };
}

function stubTranscribe(text: unknown, status = 200): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input instanceof Request ? input.url : input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) as CapturedRequest["body"],
      });
      return new Response(JSON.stringify(text), { status });
    }),
  );
  return requests;
}

const webmInput: TranscribeInput = { format: "blob", mimeType: "audio/webm", data: "aGVsbG8=" };

describe("transcribeWithProvider", () => {
  it("posts JSON with the model and input audio, and returns the text", async () => {
    const requests = stubTranscribe({ text: "hello world" });
    const text = await transcribeWithProvider(webmInput, "openrouter", "openai/whisper-large-v3", "sk-test");
    expect(text).toBe("hello world");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${OPENROUTER_API_BASE}/audio/transcriptions`);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.authorization).toBe("Bearer sk-test");
    expect(requests[0]?.body).toEqual({
      model: "openai/whisper-large-v3",
      input_audio: { data: "aGVsbG8=", format: "webm" },
      response_format: "json",
    });
  });

  it("maps mp4 blobs to the mp4 format", async () => {
    const requests = stubTranscribe({ text: "hi" });
    await transcribeWithProvider({ format: "blob", mimeType: "audio/mp4", data: "AAAA" }, "openrouter", "m", "sk");
    expect(requests[0]?.body.input_audio.format).toBe("mp4");
  });

  it("wraps raw f32 PCM in a WAV container", async () => {
    const samples = Buffer.from(new Float32Array([0.5, -0.5]).buffer).toString("base64");
    const requests = stubTranscribe({ text: "hi" });
    await transcribeWithProvider(
      { format: "pcm-f32", sampleRate: 16000, data: samples },
      "openrouter",
      "m",
      "sk",
    );
    const sent = requests[0]?.body.input_audio;
    expect(sent?.format).toBe("wav");
    const bytes = Buffer.from(String(sent?.data), "base64");
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
    expect(bytes.readUInt32LE(24)).toBe(16000);
    expect(bytes.readUInt16LE(20)).toBe(3); // IEEE float
    expect(bytes.subarray(44)).toEqual(Buffer.from(new Float32Array([0.5, -0.5]).buffer));
  });

  it("rejects unknown providers and missing keys as invalid_request", async () => {
    stubTranscribe({ text: "hi" });
    await expect(transcribeWithProvider(webmInput, "openai", "whisper-1", "sk")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(transcribeWithProvider(webmInput, "openrouter", "m", "")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it.each([400, 401, 403, 404, 429])("maps HTTP %i to invalid_request", async (status) => {
    stubTranscribe({ error: "nope" }, status);
    const error = await transcribeWithProvider(webmInput, "openrouter", "m", "sk").catch(
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("invalid_request");
  });

  it.each([500, 503])("maps HTTP %i to internal", async (status) => {
    stubTranscribe({ error: "nope" }, status);
    await expect(transcribeWithProvider(webmInput, "openrouter", "m", "sk")).rejects.toMatchObject({
      code: "internal",
    });
  });

  it("maps network failures and unreadable bodies to internal", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(transcribeWithProvider(webmInput, "openrouter", "m", "sk")).rejects.toMatchObject({
      code: "internal",
    });
    stubTranscribe({ noText: true });
    await expect(transcribeWithProvider(webmInput, "openrouter", "m", "sk")).rejects.toMatchObject({
      code: "internal",
    });
  });
});
