export interface Searchable {
  readonly label: string;
  readonly description: string;
  readonly sectionLabel: string;
  readonly keywords: readonly string[];
}

const SCORE = {
  labelPrefix: 10,
  labelSubstring: 7,
  keywordPhrase: 8,
  keywordPrefix: 6,
  labelTypo: 4,
  keywordTypo: 3,
  descriptionPrefix: 3,
  descriptionSubstring: 2,
  section: 2,
} as const;

export const tokensOf = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);

const allowedTypos = (length: number) => (length < 4 ? 0 : length < 8 ? 1 : 2);

/** Optimal string alignment distance: insert, delete, substitute, or swap two neighbours. */
export function editDistance(a: string, b: string): number {
  const width = b.length + 1;
  const grid = new Array<number>((a.length + 1) * width).fill(0);
  const at = (i: number, j: number) => grid[i * width + j] ?? 0;
  for (let i = 0; i <= a.length; i++) grid[i * width] = i;
  for (let j = 0; j <= b.length; j++) grid[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      grid[i * width + j] = best;
    }
  }
  return at(a.length, b.length);
}

const isTypoOfWord = (token: string, word: string): boolean => {
  const allowed = allowedTypos(token.length);
  if (allowed === 0 || token[0] !== word[0]) return false;
  return editDistance(token, word.slice(0, token.length)) <= allowed || editDistance(token, word) <= allowed;
};

const startsAWord = (words: string[], token: string) => words.some((word) => word.startsWith(token));
const hasTypoWord = (words: string[], token: string) => words.some((word) => isTypoOfWord(token, word));

function scoreToken(token: string, item: Searchable): number {
  const labelWords = tokensOf(item.label);
  const keywordWords = item.keywords.flatMap(tokensOf);
  const descriptionWords = tokensOf(item.description);
  const candidates = [
    startsAWord(labelWords, token) ? SCORE.labelPrefix : 0,
    item.label.toLowerCase().includes(token) ? SCORE.labelSubstring : 0,
    startsAWord(keywordWords, token) ? SCORE.keywordPrefix : 0,
    hasTypoWord(labelWords, token) ? SCORE.labelTypo : 0,
    hasTypoWord(keywordWords, token) ? SCORE.keywordTypo : 0,
    startsAWord(descriptionWords, token) ? SCORE.descriptionPrefix : 0,
    item.description.toLowerCase().includes(token) ? SCORE.descriptionSubstring : 0,
    startsAWord(tokensOf(item.sectionLabel), token) ? SCORE.section : 0,
  ];
  return Math.max(...candidates);
}

const matchesKeywordPhrase = (query: string, item: Searchable) =>
  item.keywords.some((keyword) => keyword.toLowerCase().includes(query));

/** Zero means no match. Every word of the query must match somewhere; a whole-phrase keyword hit ranks high. */
export function scoreSearchable(query: string, item: Searchable): number {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return 0;
  const scores = tokens.map((token) => scoreToken(token, item));
  if (scores.some((score) => score === 0)) return 0;
  const total = scores.reduce((sum, score) => sum + score, 0);
  const phrase = tokens.length > 1 && matchesKeywordPhrase(query.trim().toLowerCase(), item);
  return total + (phrase ? SCORE.keywordPhrase : 0);
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** Character ranges of `text` hit by any query word. Typo matches are not marked. */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokensOf(query)) {
    const at = lower.indexOf(token);
    if (at >= 0) ranges.push([at, at + token.length]);
  }
  return mergeRanges(ranges);
}
