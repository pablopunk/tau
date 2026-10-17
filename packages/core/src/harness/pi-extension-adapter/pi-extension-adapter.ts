/// <reference path="./pi-web-access.d.ts" />
import { defineExtension } from "@earendil-works/pi-durable";
import piWebAccess from "pi-web-access/dist/index.js";
import type { ToolFileFactory } from "../tools/tool-file";
import { collectExtensionTools } from "./fake-extension-api";
import { toToolRegistration } from "./tool-conversion";

export const piWebAccessToolFile: ToolFileFactory = () => ({
  implemented: true,
  extension: defineExtension({
    name: "pi-web-access",
    tools: collectExtensionTools(piWebAccess).map(toToolRegistration),
  }),
});
