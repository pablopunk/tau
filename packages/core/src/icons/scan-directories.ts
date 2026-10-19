import { readdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_DEPTH = 3;
const MAX_DIRECTORIES = 400;
const CONCURRENCY = 32;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "bower_components",
  "site-packages",
  "venv",
  "env",
  "__pycache__",
  "__MACOSX",
  "dist",
  "build",
  "out",
  "target",
  "release",
  "generated",
  "storybook-static",
  "coverage",
  "vendor",
  "third_party",
  "Pods",
  "Carthage",
  "DerivedData",
  "Library",
  "cache",
  "logs",
  "tmp",
  "temp",
]);

export interface ScannedDirectory {
  readonly directory: string;
  readonly depth: number;
  /** Icon-looking file names, best first. */
  readonly files: string[];
}

export interface ScanOptions {
  isIconName(name: string): boolean;
  compareIconNames(a: string, b: string): number;
  /** Order of sibling folders; matters when the folder cap cuts the scan short. */
  compareFolderNames(a: string, b: string): number;
}

interface Listing {
  readonly folders: string[];
  readonly files: string[];
}

const isScannable = (name: string) => !name.startsWith(".") && !SKIPPED_DIRECTORIES.has(name);

async function list(path: string, options: ScanOptions): Promise<Listing> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory() && isScannable(entry.name))
      .map((entry) => entry.name)
      .sort(options.compareFolderNames);
    const files = entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && options.isIconName(entry.name))
      .map((entry) => entry.name)
      .sort(options.compareIconNames);
    return { folders, files };
  } catch {
    return { folders: [], files: [] };
  }
}

async function listAll(paths: string[], options: ScanOptions): Promise<Listing[]> {
  const listings: Listing[] = [];
  for (let start = 0; start < paths.length; start += CONCURRENCY) {
    const batch = paths.slice(start, start + CONCURRENCY);
    listings.push(...(await Promise.all(batch.map((path) => list(path, options)))));
  }
  return listings;
}

/** Folders up to three levels below `root`, shallow first, one `readdir` each; skips dot-folders and big or generated ones. */
export async function scanIcons(root: string, options: ScanOptions): Promise<ScannedDirectory[]> {
  const scanned: ScannedDirectory[] = [];
  let level = [root];
  let budget = MAX_DIRECTORIES;
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const listings = await listAll(level, options);
    level.forEach((directory, index) => {
      const { files } = listings[index] as Listing;
      if (depth > 0 && files.length > 0) scanned.push({ directory, depth, files });
    });
    const children = level.flatMap((parent, index) =>
      (listings[index] as Listing).folders.map((name) => join(parent, name)),
    );
    level = depth < MAX_DEPTH ? children.slice(0, budget) : [];
    budget -= level.length;
  }
  return scanned;
}
