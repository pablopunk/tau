type Searchable = { server: string; name: string; description: string };

const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

export function matchesQuery(tool: Searchable, query: string): boolean {
  const haystack = `${tool.server} ${tool.name} ${tool.description}`.toLowerCase();
  return wordsOf(query).every((word) => haystack.includes(word));
}
