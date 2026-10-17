import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import type { ContractTarget, MakeContractTarget } from "./types";

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

export function fsCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("fs", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("suggests folders by a typed prefix, case-insensitively and sorted", async () => {
      const { core, paths } = target;
      const beta = await paths.directory("suggest-beta");
      const alpha = await paths.directory("suggest-alpha");
      const parent = parentOf(alpha);
      const suggestions = await core.fs.suggestDirectories({ prefix: `${parent}/SUGGEST-` });
      expect(suggestions.map((item) => item.path)).toEqual([alpha, beta]);
      expect(suggestions[0]).toEqual({ path: alpha, display: alpha, isGitRepo: false });
      expect(await core.fs.suggestDirectories({ prefix: `${parent}/suggest-a` })).toHaveLength(1);
    });

    test("never suggests files and honours the limit", async () => {
      const { core, paths } = target;
      const file = await paths.file("notes.txt");
      const alpha = await paths.directory("limit-alpha");
      await paths.directory("limit-beta");
      const parent = parentOf(alpha);
      const names = (await core.fs.suggestDirectories({ prefix: `${parent}/notes` })).map(
        (item) => item.path,
      );
      expect(names).not.toContain(file);
      expect(await core.fs.suggestDirectories({ prefix: `${parent}/limit-`, limit: 1 })).toHaveLength(1);
    });

    test("gives nothing for a missing folder", async () => {
      const { core, paths } = target;
      expect(await core.fs.suggestDirectories({ prefix: `${paths.missing()}/x` })).toEqual([]);
    });

    test("understands ~ and suggests from home for an empty prefix", async () => {
      const { core } = target;
      for (const prefix of ["~/", "~", ""]) {
        const suggestions = await core.fs.suggestDirectories({ prefix, limit: 5 });
        for (const item of suggestions) expect(item.display.startsWith("~/")).toBe(true);
      }
    });
  });
}
