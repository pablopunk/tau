import { defineExtension, section } from "@earendil-works/pi-durable";

export const PREAMBLE =
  "You are a coding agent working inside the user's project folder. Use the tools to read, edit and run commands there. Be concise.";

export const PROJECT_INSTRUCTIONS_FILE = "AGENTS.md";

export const codingExtension = defineExtension({
  name: "coding",
  sections: [
    section("preamble", () => PREAMBLE, { tag: false }),
    section("cwd", (input) => input.env?.cwd),
    section("project-instructions", async (input, context) => {
      const read = await input.env?.readTextFile(PROJECT_INSTRUCTIONS_FILE, context);
      return read?.ok ? read.value : undefined;
    }),
  ],
});
