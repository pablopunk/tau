import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { Skill } from "@pi-everywhere/protocol";
import { parseSkillFrontmatter } from "./frontmatter";

export const MAX_SKILL_FILE_BYTES = 256 * 1024;
export const MAX_DESCRIPTION_CHARS = 300;
export const SKILLS_CACHE_MS = 30_000;

const PROJECT_SKILL_DIRS = [".agents/skills", ".pi/skills", ".claude/skills"];
const USER_SKILL_DIRS = [".agents/skills", ".pi/agent/skills", ".claude/skills"];

type Root = { directory: string; scope: Skill["scope"]; base: string; prefix: string };

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !path.startsWith(sep);
};

const toPosix = (path: string) => path.split(sep).join("/");

function rootsFor(projectFolder: string | null, home: string): Root[] {
  const project =
    projectFolder === null
      ? []
      : PROJECT_SKILL_DIRS.map((dir) => ({
          directory: join(projectFolder, dir),
          scope: "project" as const,
          base: projectFolder,
          prefix: "",
        }));
  const user = USER_SKILL_DIRS.map((dir) => ({
    directory: join(home, dir),
    scope: "user" as const,
    base: home,
    prefix: "~/",
  }));
  return [...project, ...user];
}

const listNames = (directory: string) => readdir(directory).catch(() => [] as string[]);

async function readSkillFile(rootReal: string, file: string): Promise<string | undefined> {
  const real = await realpath(file).catch(() => undefined);
  if (real === undefined || !isInside(rootReal, real)) return undefined;
  const info = await stat(real).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_SKILL_FILE_BYTES) return undefined;
  return readFile(real, "utf8").catch(() => undefined);
}

async function skillIn(root: Root, rootReal: string, folderName: string): Promise<Skill | undefined> {
  const file = join(root.directory, folderName, "SKILL.md");
  const text = await readSkillFile(rootReal, file);
  const meta = text === undefined ? undefined : parseSkillFrontmatter(text);
  if (!meta) return undefined;
  const path = root.prefix + toPosix(relative(root.base, file));
  return {
    name: meta.name,
    description: meta.description.slice(0, MAX_DESCRIPTION_CHARS),
    scope: root.scope,
    path,
  };
}

async function skillsInRoot(root: Root): Promise<Skill[]> {
  const rootReal = await realpath(root.directory).catch(() => undefined);
  if (rootReal === undefined) return [];
  const names = (await listNames(root.directory)).sort();
  const skills = await Promise.all(names.map((name) => skillIn(root, rootReal, name)));
  return skills.filter((skill): skill is Skill => skill !== undefined);
}

function firstByName(skills: Skill[]): Skill[] {
  const seen = new Set<string>();
  return skills.filter((skill) => !seen.has(skill.name) && seen.add(skill.name));
}

async function scan(projectFolder: string | null, home: string): Promise<Skill[]> {
  const perRoot = await Promise.all(rootsFor(projectFolder, home).map(skillsInRoot));
  return firstByName(perRoot.flat());
}

const cache = new Map<string, { at: number; skills: Promise<Skill[]> }>();

export function discoverSkills(projectFolder: string | null, home: string = homedir()): Promise<Skill[]> {
  const key = `${home}\0${projectFolder ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SKILLS_CACHE_MS) return hit.skills;
  const skills = scan(projectFolder, home);
  cache.set(key, { at: Date.now(), skills });
  return skills;
}

export function clearSkillsCache(): void {
  cache.clear();
}
