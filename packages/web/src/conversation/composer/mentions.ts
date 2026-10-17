export interface MentionTrigger {
  readonly start: number;
  readonly query: string;
}

export function activeMention(text: string, caret: number): MentionTrigger | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  const query = before.slice(start + 1);
  const startsWord = start === 0 || /\s/.test(before[start - 1] ?? "");
  return startsWord && !/\s/.test(query) ? { start, query } : null;
}

export function applyMention(text: string, trigger: MentionTrigger, caret: number, insertion: string) {
  const replaced = `${text.slice(0, trigger.start)}@${insertion} `;
  return { text: replaced + text.slice(caret), caret: replaced.length };
}

export function matchesQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}
