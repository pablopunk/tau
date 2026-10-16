import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN = [
  "Simulated provider failure",
  "Recovered after a failed attempt",
  "/Users/demo/project",
  "faux-1",
];

async function* filesIn(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesIn(path);
    else yield path;
  }
}

const leaks = [];
for await (const file of filesIn("dist")) {
  if (!/\.(js|css|html|map)$/.test(file)) continue;
  const content = await readFile(file, "utf8");
  for (const needle of FORBIDDEN) if (content.includes(needle)) leaks.push(`${file}: ${needle}`);
}

if (leaks.length > 0) {
  console.error(`Fixture or fake data leaked into the production bundle:\n${leaks.join("\n")}`);
  process.exit(1);
}
console.log("web/dist has no fixture strings");
