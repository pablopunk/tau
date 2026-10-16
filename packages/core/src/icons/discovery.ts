import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";

export const CONTENT_TYPES: Record<string, string> = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
export const MAX_CANDIDATES = 12;

const FIXED_DIRECTORIES = [
  "build/Icon.icon/Assets",
  "",
  "public",
  "static",
  "assets",
  "web",
  "web/public",
  "app/public",
  "src/assets",
  "src/app",
  "frontend/public",
];
const APP_SUBDIRECTORIES = ["public", "static", "assets", "src/assets", "src/app"];

export interface FoundIcon {
  /** Name relative to the project root. */
  name: string;
  file: string;
  contentType: string;
  rank: number;
  size: number;
  mtimeMs: number;
}

export function rankOf(fileName: string): number {
  const extension = extname(fileName).toLowerCase();
  if (!CONTENT_TYPES[extension]) return Number.POSITIVE_INFINITY;
  const stem = fileName.slice(0, -extension.length).toLowerCase();
  if (stem === "favicon") return 0;
  if (stem.startsWith("favicon-")) return 1;
  if (stem.startsWith("apple-touch-icon")) return 2;
  if (stem === "icon" || stem === "app-icon") return 3;
  if (stem.startsWith("icon-") || stem === "logo" || stem === "brand" || stem === "mark") return 4;
  if (stem.startsWith("logo-") || stem.startsWith("brand-")) return 5;
  return Number.POSITIVE_INFINITY;
}

function isInside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

async function subdirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function sourceDirectories(root: string): Promise<string[]> {
  const names = (await subdirectories(join(root, "src"))).sort().slice(0, 8);
  return names.map((name) => join(root, "src", name, "public"));
}

function repositoryName(root: string): string {
  const name = basename(root) === "monorepo" ? basename(dirname(root)) : basename(root);
  return name.toLowerCase();
}

async function appDirectories(root: string): Promise<string[]> {
  const apps = join(root, "apps");
  const brand = repositoryName(root);
  const matches = (name: string) => Number(!name.toLowerCase().includes(brand));
  const names = (await subdirectories(apps))
    .sort((a, b) => matches(a) - matches(b) || a.localeCompare(b))
    .slice(0, 32);
  return names.flatMap((name) => APP_SUBDIRECTORIES.map((part) => join(apps, name, part)));
}

async function searchDirectories(root: string): Promise<string[]> {
  const fixed = FIXED_DIRECTORIES.map((part) => join(root, part));
  return [...fixed, ...(await sourceDirectories(root)), ...(await appDirectories(root))];
}

async function approvedIcon(root: string, directory: string, file: string): Promise<FoundIcon | null> {
  try {
    const real = await realpath(join(directory, file));
    if (!isInside(root, real)) return null;
    const info = await stat(real);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_ICON_BYTES) return null;
    const contentType = CONTENT_TYPES[extname(file).toLowerCase()] as string;
    const name = relative(root, real);
    return { name, file: real, contentType, rank: rankOf(file), size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

async function iconsInDirectory(root: string, directory: string): Promise<FoundIcon[]> {
  try {
    const actual = await realpath(directory);
    if (!isInside(root, actual)) return [];
    const entries = await readdir(actual, { withFileTypes: true });
    const names = entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && Number.isFinite(rankOf(entry.name)))
      .map((entry) => entry.name)
      .sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
    const found = await Promise.all(names.map((name) => approvedIcon(root, actual, name)));
    return found.filter((icon): icon is FoundIcon => icon !== null);
  } catch {
    return [];
  }
}

async function realRoot(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

export async function findFirstIcon(projectPath: string): Promise<FoundIcon | null> {
  const root = await realRoot(projectPath);
  if (!root) return null;
  for (const directory of await searchDirectories(root)) {
    const [first] = await iconsInDirectory(root, directory);
    if (first) return first;
  }
  return null;
}

export async function findCandidates(projectPath: string): Promise<FoundIcon[]> {
  const root = await realRoot(projectPath);
  if (!root) return [];
  const seen = new Set<string>();
  const found: FoundIcon[] = [];
  for (const directory of await searchDirectories(root)) {
    for (const icon of await iconsInDirectory(root, directory)) {
      if (seen.has(icon.name)) continue;
      seen.add(icon.name);
      found.push(icon);
    }
  }
  return found.sort((a, b) => a.rank - b.rank).slice(0, MAX_CANDIDATES);
}
