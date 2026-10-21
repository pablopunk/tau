import { AppError, type Core, type TranscribeInput } from "@tau/protocol";
import type { SettingsStore } from "./home/settings-store";
import { listProviderOptions, type VoiceProviderSource } from "./provider/voice-models";
import { transcribeWithProvider } from "./voice/provider-transcribe";
import { modelDirForHome, sherpaPackageDir, Transcriber } from "./voice/transcriber";

export type VoiceApi = Core["voice"] & {
  /** Releases the local model worker. Called from Core.close(). */
  close(): Promise<void>;
};

function base64ToFloat32(data: string): Float32Array {
  const bytes = Buffer.from(data, "base64");
  if (bytes.length % 4 !== 0 || bytes.length === 0) {
    throw new AppError("invalid_request", "The audio data is not 32-bit float PCM.");
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

export function createVoiceApi(deps: {
  settings: SettingsStore;
  homeRoot: string;
  provider: VoiceProviderSource;
  versionDir?: string;
}): VoiceApi {
  const { settings, homeRoot, provider, versionDir } = deps;
  const transcriber = new Transcriber({
    modelDir: modelDirForHome(homeRoot),
    sherpaDir: sherpaPackageDir(versionDir),
  });

  return {
    async options() {
      return { local: transcriber.getStatus(), providers: await listProviderOptions(provider) };
    },
    async transcribe(input: TranscribeInput) {
      const setting = (await settings.get()).voiceModel ?? null;
      if (setting === null) {
        throw new AppError("invalid_request", "No voice model is set.");
      }
      if (setting.kind === "local") {
        if (input.format !== "pcm-f32") {
          throw new AppError("invalid_request", "The local model needs decoded PCM audio.");
        }
        return { text: await transcriber.transcribe(base64ToFloat32(input.data), input.sampleRate) };
      }
      const key = (await provider.models.getAuth(setting.provider))?.auth.apiKey;
      if (!key) {
        throw new AppError("invalid_request", "That provider is not connected.");
      }
      return { text: await transcribeWithProvider(input, setting.provider, setting.modelId, key) };
    },
    async removeModel() {
      await transcriber.removeModel();
    },
    async warm() {
      if (((await settings.get()).voiceModel?.kind ?? null) === "local") {
        await transcriber.warm();
      }
    },
    async close() {
      transcriber.close();
    },
  };
}
