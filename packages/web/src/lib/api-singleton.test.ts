import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { API_SINGLETON_BASELINE } from "./api-singleton-baseline";

const SRC = join(process.cwd(), "src");
const IMPORT_FROM_API = /import\s*\{([^}]*)\}\s*from\s*["'](?:@\/lib\/api|(?:\.\.?\/)+(?:[\w-]+\/)*api)["']/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function importsSingleton(text: string): boolean {
  for (const match of text.matchAll(IMPORT_FROM_API)) {
    const names = (match[1] ?? "").split(",").map((name) => name.trim());
    if (names.some((name) => name === "api" || name.startsWith("api as "))) return true;
  }
  return false;
}

function filesImportingSingletonApi(): string[] {
  return sourceFiles(SRC)
    .filter((path) => importsSingleton(readFileSync(path, "utf8")))
    .map((path) => relative(SRC, path))
    .sort();
}

describe("grep gate: the singleton api (MVP12 Stage 2)", () => {
  const current = filesImportingSingletonApi();

  it("lets no new file import `api` from lib/api (use useApi() or useNodeApi(id))", () => {
    const fresh = current.filter((file) => !API_SINGLETON_BASELINE.includes(file));
    expect(fresh, "new importers of the singleton api").toEqual([]);
  });

  it("has no stale baseline entries: remove a file from the baseline once it stops importing it", () => {
    const stale = API_SINGLETON_BASELINE.filter((file) => !current.includes(file));
    expect(stale).toEqual([]);
  });
});
