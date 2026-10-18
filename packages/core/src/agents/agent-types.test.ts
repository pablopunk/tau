import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAgentTypeFile } from "./agent-type-file";
import { createAgentTypeLoader } from "./agent-types";
import { mapClaudeTools } from "./tool-mapping";

const agentMd = (fields: string, body = "Do the work.") => `---\n${fields}\n---\n${body}\n`;

describe("parseAgentTypeFile", () => {
  it("reads comma tools, model, and the body", () => {
    const type = parseAgentTypeFile(
      "x",
      agentMd("name: reviewer\ndescription: Reviews\ntools: Read, Grep\nmodel: opus"),
      "project-pi",
    );
    expect(type).toMatchObject({
      name: "reviewer",
      description: "Reviews",
      tools: ["read", "bash"],
      model: "opus",
      prompt: "Do the work.",
    });
  });

  it("reads thinking, and effort as its alias", () => {
    expect(parseAgentTypeFile("x", agentMd("thinking: low"), "user-pi").thinking).toBe("low");
    expect(parseAgentTypeFile("x", agentMd("effort: High"), "user-pi").thinking).toBe("high");
    expect(parseAgentTypeFile("x", agentMd("thinking: low\neffort: high"), "user-pi").thinking).toBe("low");
    expect(parseAgentTypeFile("x", agentMd("effort: loud"), "user-pi").thinking).toBeUndefined();
  });

  it("reads YAML list tools and disallowedTools", () => {
    const type = parseAgentTypeFile(
      "x",
      agentMd("tools:\n  - Read\n  - Edit\ndisallowedTools: Write, Bash"),
      "user-pi",
    );
    expect(type.tools).toEqual(["read", "edit"]);
    expect(type.disallowedTools).toEqual(["write", "bash"]);
  });

  it("handles CRLF and multi-line descriptions", () => {
    const text = agentMd("name: a\ndescription: >\n  first line\n  second line\ntools: Read").replace(
      /\n/g,
      "\r\n",
    );
    const type = parseAgentTypeFile("x", text, "user-claude");
    expect(type.description).toBe("first line second line");
    expect(type.tools).toEqual(["read"]);
    expect(type.prompt).toBe("Do the work.");
  });

  it("falls back to the filename and all tools", () => {
    const type = parseAgentTypeFile("helper", "No frontmatter here", "project-claude");
    expect(type).toMatchObject({ name: "helper", tools: undefined, prompt: "No frontmatter here" });
    expect(type.error).toBeUndefined();
  });

  it("flags a type whose tools map to nothing", () => {
    const type = parseAgentTypeFile("x", agentMd("tools: Task, NotebookEdit"), "project-pi");
    expect(type.tools).toEqual([]);
    expect(type.error).toMatch(/map/);
  });
});

describe("mapClaudeTools", () => {
  it("applies the mapping table", () => {
    const all = [
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "Bash",
      "Grep",
      "Glob",
      "WebSearch",
      "WebFetch",
      "TodoWrite",
      "mcp__x__y",
      "Task",
      "Agent",
    ];
    expect(mapClaudeTools(all)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "web_search",
      "fetch_content",
      "todo_write",
      "mcp_search",
      "mcp_call",
    ]);
  });
});

describe("createAgentTypeLoader", () => {
  let root: string;
  let home: string;
  let project: string;
  let clock: number;
  const loader = () => createAgentTypeLoader({ home, now: () => clock });
  const put = async (base: string, dir: string, file: string, content: string) => {
    await mkdir(join(base, dir), { recursive: true });
    await writeFile(join(base, dir, file), content);
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-types-"));
    home = join(root, "home");
    project = join(root, "project");
    await mkdir(home, { recursive: true });
    await mkdir(project, { recursive: true });
    clock = 0;
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("lists general-purpose and fork when nothing is defined", async () => {
    const names = (await loader().load(project)).map((type) => type.name);
    expect(names).toEqual(["general-purpose", "fork"]);
  });

  it("applies precedence project .pi > project .claude > user .pi > user .claude", async () => {
    await put(home, ".claude/agents", "t.md", agentMd("name: t\ndescription: user-claude"));
    await put(home, ".pi/agent/agents", "t.md", agentMd("name: t\ndescription: user-pi"));
    await put(project, ".claude/agents", "t.md", agentMd("name: t\ndescription: project-claude"));
    expect((await loader().load(project)).find((type) => type.name === "t")?.description).toBe(
      "project-claude",
    );
    await put(project, ".pi/agents", "t.md", agentMd("name: t\ndescription: project-pi"));
    const fresh = await loader().load(project);
    expect(fresh.find((type) => type.name === "t")).toMatchObject({
      description: "project-pi",
      source: "project-pi",
    });
    expect(fresh.filter((type) => type.name === "t")).toHaveLength(1);
  });

  it("returns an error type for an empty mapping", async () => {
    await put(project, ".claude/agents", "bad.md", agentMd("tools: Task"));
    expect((await loader().load(project)).find((type) => type.name === "bad")?.error).toBeDefined();
  });

  it("caches for 30 seconds and clears on demand", async () => {
    const subject = loader();
    await subject.load(project);
    await put(project, ".pi/agents", "late.md", agentMd("name: late"));
    clock = 29_000;
    expect((await subject.load(project)).some((type) => type.name === "late")).toBe(false);
    subject.clearCache();
    expect((await subject.load(project)).some((type) => type.name === "late")).toBe(true);
    await put(project, ".pi/agents", "later.md", agentMd("name: later"));
    clock = 100_000;
    expect((await subject.load(project)).some((type) => type.name === "later")).toBe(true);
  });

  it("skips oversized files and symlinks that escape the directory", async () => {
    await put(project, ".pi/agents", "big.md", agentMd("name: big", "x".repeat(257 * 1024)));
    await put(root, "outside", "secret.md", agentMd("name: secret"));
    await symlink(join(root, "outside", "secret.md"), join(project, ".pi/agents", "link.md"));
    const names = (await loader().load(project)).map((type) => type.name);
    expect(names).not.toContain("big");
    expect(names).not.toContain("secret");
  });
});
