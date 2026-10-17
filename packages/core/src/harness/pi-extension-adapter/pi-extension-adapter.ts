import { defineExtension } from "@earendil-works/pi-durable";
import type { ToolFileFactory } from "../tools/tool-file";

/**
 * Phase 1 (D): a fake pi-coding-agent `ExtensionAPI` whose `registerTool` turns each tool into a Pi Durable
 * `ToolRegistration`, and the default export of `pi-web-access` loaded through it. The pin test
 * (`pi-web-access.pin.test.ts`) proves the idea; the tools become one extension named `pi-web-access`.
 */
export const piWebAccessToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({ name: "pi-web-access", tools: [] }),
});
