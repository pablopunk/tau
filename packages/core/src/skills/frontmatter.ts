export type SkillFrontmatter = { name: string; description: string };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

function readFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1], unquote(match[2]));
  }
  return fields;
}

export function parseSkillFrontmatter(text: string): SkillFrontmatter | undefined {
  const block = FRONTMATTER.exec(text)?.[1];
  if (block === undefined) return undefined;
  const fields = readFields(block);
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !description) return undefined;
  return { name, description };
}
