import { defineExtension, section } from "@earendil-works/pi-durable";
import { discoverSkills } from "../skills/discover-skills";
import { skillsPrompt } from "../skills/skills-prompt";
import { renderMonitorSection } from "./prompts/monitor-prompt";
import { renderTimersSection } from "./prompts/timers-prompt";
import { renderSubagentsSection } from "./subagents-prompt";

export const PREAMBLE =
  "You are a coding agent working inside the user's project folder. Use the tools to read, edit and run commands there. Be concise.";

export const MENTIONS_PROMPT =
  "Mentions: `@path` is a file or folder relative to the working directory; read it before answering.";

export const PROJECT_INSTRUCTIONS_FILE = "AGENTS.md";

export const codingExtension = defineExtension({
  name: "coding",
  sections: [
    section("preamble", () => PREAMBLE, { tag: false }),
    section("cwd", (input) => input.env?.cwd),
    section("mentions", () => MENTIONS_PROMPT),
    section("skills", async (input) => {
      const cwd = input.env?.cwd;
      return cwd === undefined ? undefined : skillsPrompt(await discoverSkills(cwd));
    }),
    section("subagents", renderSubagentsSection),
    section("monitor", renderMonitorSection),
    section("timers", renderTimersSection),
    section("project-instructions", async (input, context) => {
      const read = await input.env?.readTextFile(PROJECT_INSTRUCTIONS_FILE, context);
      return read?.ok ? read.value : undefined;
    }),
  ],
});
