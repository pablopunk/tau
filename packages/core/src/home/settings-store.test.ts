import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { createSettingsStore } from "./settings-store";

const tempDir = useTempDir();
const ref = { provider: "openrouter", modelId: "x/y" };

describe("settings store", () => {
  it("starts without a default model", async () => {
    const store = createSettingsStore(join(await tempDir(), "settings.json"));
    expect(await store.get()).toEqual({ defaultModel: null });
  });

  it("persists the default model in a 0600 file", async () => {
    const path = join(await tempDir(), "settings.json");
    await createSettingsStore(path).setDefaultModel(ref);
    expect(await createSettingsStore(path).get()).toEqual({ defaultModel: ref });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ defaultModel: ref });
  });

  it("falls back to the defaults for a corrupt file", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, "{ nope");
    expect(await createSettingsStore(path).get()).toEqual({ defaultModel: null });
    await writeFile(path, JSON.stringify({ defaultModel: 3 }));
    expect(await createSettingsStore(path).get()).toEqual({ defaultModel: null });
  });
});
