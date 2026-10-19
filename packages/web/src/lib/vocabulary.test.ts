import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const withoutComments = (text: string): string =>
  text
    .replace(/\bfrom\s+"[^"]*"/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const STRING_LITERAL = /(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g;
const JSX_TEXT = />[^<>{}\n]*[A-Za-z][^<>{}\n]*</g;

/** What a user can read: string literals and JSX text. The device kind `"machine"` stays on disk until MVP13 Step 1. */
const userFacing = (text: string): string[] =>
  [...(text.match(STRING_LITERAL) ?? []), ...(text.match(JSX_TEXT) ?? [])]
    .filter((piece) => piece !== '"machine"')
    .map((piece) => piece.replace(/Git[Hh]ub/g, ""));

/** Hub-link copy that Step 1 replaces with peer links; remove each entry as Step 1 rewrites it. */
const HUB_ALLOWED = new Set([
  "lib/queries.ts", // the `["nodes", "hub"]` query key
  "nodes/node-text.ts",
  "settings/ConnectNodeDialog.tsx",
  "settings/HubLinkRow.tsx",
  "settings/NodesList.tsx",
  "settings/NodesVersion.tsx",
  "settings/settings-index.ts",
]);

describe("vocabulary", () => {
  const files = sourceFiles(SRC).map((path) => ({
    rel: relative(SRC, path),
    pieces: userFacing(withoutComments(readFileSync(path, "utf8"))),
  }));
  const saying = (word: RegExp) =>
    files.filter((f) => f.pieces.some((piece) => word.test(piece))).map((f) => f.rel);

  it("never says machine in user-facing strings", () => {
    expect(saying(/machine/i)).toEqual([]);
  });

  it("never says hub outside the files that wait for Step 1", () => {
    expect(saying(/\bhubs?\b/i).filter((rel) => !HUB_ALLOWED.has(rel))).toEqual([]);
  });
});
