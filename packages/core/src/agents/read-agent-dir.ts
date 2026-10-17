import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { parseAgentTypeFile } from "./agent-type-file";
import type { AgentType, AgentTypeSource } from "./agent-types";

export const MAX_AGENT_FILE_BYTES = 256 * 1024;

const isInside = (root: string, path: string) => path.startsWith(root + sep);

async function readableMarkdown(root: string, path: string): Promise<string | undefined> {
  try {
    const real = await realpath(path);
    if (!isInside(root, real)) return undefined;
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_AGENT_FILE_BYTES) return undefined;
    return await readFile(real, "utf8");
  } catch {
    return undefined;
  }
}

async function realDirectory(dir: string): Promise<string | undefined> {
  try {
    return await realpath(dir);
  } catch {
    return undefined;
  }
}

export async function readAgentDir(dir: string, source: AgentTypeSource): Promise<readonly AgentType[]> {
  const root = await realDirectory(dir);
  if (!root) return [];
  const names = (await readdir(root).catch(() => [])).filter((name) => name.endsWith(".md")).sort();
  const types: AgentType[] = [];
  for (const name of names) {
    const content = await readableMarkdown(root, join(root, name));
    if (content !== undefined) types.push(parseAgentTypeFile(name.slice(0, -3), content, source));
  }
  return types;
}
