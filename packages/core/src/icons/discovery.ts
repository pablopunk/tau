import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { type ScannedDirectory, type ScanOptions, scanIcons } from "./scan-directories";

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
const WORKSPACE_CONTAINERS = ["apps", "packages"] as const;
const MEMBER_SUBDIRECTORIES = ["", "public", "static", "assets", "src/assets", "src/app"];
const MAX_MEMBERS_PER_CONTAINER = 32;

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

/** Repository-named folders first, then alphabetical. */
function folderOrder(root: string): (a: string, b: string) => number {
  const brand = repositoryName(root);
  const demote = (name: string) => Number(!name.toLowerCase().includes(brand));
  return (a, b) => demote(a) - demote(b) || a.localeCompare(b);
}

const byIconRank = (a: string, b: string) => rankOf(a) - rankOf(b) || a.localeCompare(b);

const scanOptionsFor = (root: string): ScanOptions => ({
  isIconName: (name) => Number.isFinite(rankOf(name)),
  compareIconNames: byIconRank,
  compareFolderNames: folderOrder(root),
});

async function workspaceMemberDirectories(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const container of WORKSPACE_CONTAINERS) {
    const names = (await subdirectories(join(root, container)))
      .sort(folderOrder(root))
      .slice(0, MAX_MEMBERS_PER_CONTAINER);
    for (const name of names) {
      for (const part of MEMBER_SUBDIRECTORIES) out.push(join(root, container, name, part));
    }
  }
  return out;
}

async function searchDirectories(root: string): Promise<string[]> {
  const fixed = FIXED_DIRECTORIES.map((part) => join(root, part));
  return [...fixed, ...(await sourceDirectories(root)), ...(await workspaceMemberDirectories(root))];
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
      .sort(byIconRank);
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

async function firstApproved(root: string, directories: string[]): Promise<FoundIcon | null> {
  const lists = await Promise.all(directories.map((directory) => iconsInDirectory(root, directory)));
  return lists.find((list) => list.length > 0)?.[0] ?? null;
}

const notIn = (searched: Set<string>) => (scanned: ScannedDirectory) => !searched.has(scanned.directory);

const filesOf = ({ directory, files }: ScannedDirectory) => files.map((file) => ({ directory, file }));

const byRankThenPath = (a: { directory: string; file: string }, b: { directory: string; file: string }) =>
  rankOf(a.file) - rankOf(b.file) || a.directory.localeCompare(b.directory);

/** The closest level to the root that has an icon wins, then the best name within it. */
async function firstScannedIcon(root: string, scanned: ScannedDirectory[]): Promise<FoundIcon | null> {
  for (const depth of [...new Set(scanned.map((item) => item.depth))]) {
    const level = scanned
      .filter((item) => item.depth === depth)
      .flatMap(filesOf)
      .sort(byRankThenPath);
    for (const { directory, file } of level) {
      const icon = await approvedIcon(root, directory, file);
      if (icon) return icon;
    }
  }
  return null;
}

export async function findFirstIcon(projectPath: string): Promise<FoundIcon | null> {
  const root = await realRoot(projectPath);
  if (!root) return null;
  const searched = await searchDirectories(root);
  const known = await firstApproved(root, searched);
  if (known) return known;
  const scanned = await scanIcons(root, scanOptionsFor(root));
  return firstScannedIcon(root, scanned.filter(notIn(new Set(searched))));
}

const MAX_SCANNED_TO_CHECK = 2 * MAX_CANDIDATES;

export async function findCandidates(projectPath: string): Promise<FoundIcon[]> {
  const root = await realRoot(projectPath);
  if (!root) return [];
  const searched = await searchDirectories(root);
  const scanned = await scanIcons(root, scanOptionsFor(root));
  const nearest = scanned
    .filter(notIn(new Set(searched)))
    .flatMap((item) => filesOf(item).map((entry) => ({ ...entry, depth: item.depth })))
    .sort(
      (a, b) =>
        rankOf(a.file) - rankOf(b.file) || a.depth - b.depth || a.directory.localeCompare(b.directory),
    )
    .slice(0, MAX_SCANNED_TO_CHECK);
  const lists = await Promise.all([
    ...searched.map((directory) => iconsInDirectory(root, directory)),
    Promise.all(nearest.map(({ directory, file }) => approvedIcon(root, directory, file))).then((icons) =>
      icons.filter((icon): icon is FoundIcon => icon !== null),
    ),
  ]);
  const seen = new Set<string>();
  const found = lists.flat().filter((icon) => !seen.has(icon.name) && seen.add(icon.name));
  return found.sort((a, b) => a.rank - b.rank).slice(0, MAX_CANDIDATES);
}
