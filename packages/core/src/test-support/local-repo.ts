import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/** A local repository with one commit (`hello.txt`), usable as a clone URL when file clones are allowed. */
export async function makeLocalRepo(parent: string, name: string): Promise<string> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  await run("git", ["init", "--quiet", path]);
  await writeFile(join(path, "hello.txt"), "hello");
  await run("git", ["-C", path, "add", "."]);
  await run("git", ["-C", path, ...identity, "commit", "--quiet", "-m", "first"]);
  return path;
}
