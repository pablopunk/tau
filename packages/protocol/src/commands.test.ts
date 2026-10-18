import { describe, expect, it } from "vitest";
import {
  AUTO_FIELDS,
  COMMAND_EXCLUSIONS,
  COMMAND_NOUNS,
  type CommandDef,
  commands,
  flagNameOf,
  isModelRefNode,
  nodeAtPath,
  routeFields,
} from "./commands";
import { type RouteName, routes } from "./rest";

const routeNames = Object.keys(routes) as RouteName[];
const excluded = Object.keys(COMMAND_EXCLUSIONS);
const routesInTable = new Set(commands.map((entry) => entry.route));

const coversModelRef = (entry: CommandDef, path: string) =>
  (entry.modelRefs ?? []).some((ref) => path === ref || path.startsWith(`${ref}.`));

describe("command table", () => {
  it("covers every route, in the table or the exclusions, never both", () => {
    for (const name of routeNames) {
      expect(routesInTable.has(name as never) !== excluded.includes(name), name).toBe(true);
    }
    for (const name of excluded) expect(routeNames).toContain(name);
    for (const reason of Object.values(COMMAND_EXCLUSIONS)) expect(reason.length).toBeGreaterThan(0);
  });

  it("has unique commands under a known noun", () => {
    const names = commands.map((entry) => entry.command);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(COMMAND_NOUNS as readonly string[]).toContain(name.split(" ")[0]);
  });

  it("names a real schema field in every positional, fixed value and model reference", () => {
    for (const entry of commands) {
      const paths = new Set(routeFields(entry.route).map((field) => field.path));
      for (const positional of entry.positionals) {
        const ok = paths.has(positional) || (positional === "body" && entry.modelRefs?.includes("body"));
        expect(ok, `${entry.command} ${positional}`).toBe(true);
      }
      for (const path of Object.keys(entry.fixed ?? {})) expect(paths.has(path), path).toBe(true);
      for (const ref of entry.modelRefs ?? []) {
        const node = nodeAtPath(entry.route, ref);
        expect(node && isModelRefNode(node), `${entry.command} ${ref}`).toBe(true);
      }
    }
  });

  it("reaches every required field through a positional, a flag, a fixed value or --json", () => {
    for (const entry of commands) {
      for (const field of routeFields(entry.route)) {
        if (!field.required) continue;
        const reachable =
          entry.positionals.includes(field.path) ||
          field.path in (entry.fixed ?? {}) ||
          AUTO_FIELDS.includes(field.name) ||
          coversModelRef(entry, field.path) ||
          (coversModelRef(entry, "body") && field.source === "body" && entry.modelRefs?.includes("body")) ||
          field.primitive ||
          entry.json === true;
        expect(reachable, `${entry.command} ${field.path}`).toBe(true);
      }
    }
  });

  it("flags only the six destructive commands", () => {
    const destructive = commands.filter((entry) => entry.destructive).map((entry) => entry.command);
    expect(destructive.sort()).toEqual(
      [
        "devices revoke",
        "projects remove",
        "remote off",
        "threads delete",
        "threads delete-archived",
        "workspaces remove",
      ].sort(),
    );
  });

  it("names flags in kebab case", () => {
    expect(flagNameOf("projectId")).toBe("project");
    expect(flagNameOf("thinkingLevel")).toBe("thinking-level");
  });
});
