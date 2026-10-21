import type { Core, TranscribeInput } from "@tau/protocol";
import type { SettingsStore } from "./home/settings-store";
import { notImplemented } from "./not-implemented";

export function createVoiceApi(_deps: { settings: SettingsStore }): Core["voice"] {
  return {
    // TODO(agent a): local availability = WASM binding importable + download state.
    // TODO(agent b): providers = live catalog ∩ connections, each with `error?`.
    async options() {
      return { local: { available: true, state: "needs-download" }, providers: [] };
    },
    async transcribe(_input: TranscribeInput) {
      // Dispatches on the *stored* setting: agent (a) local path, agent (b) provider path.
      throw notImplemented("voice.transcribe");
    },
    async removeModel() {
      // TODO(agent a): delete `<node-home>/models/parakeet-tdt-0.6b-v3-int8`.
      throw notImplemented("voice.removeModel");
    },
  };
}
