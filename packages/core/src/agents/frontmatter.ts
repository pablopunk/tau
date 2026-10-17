export type FrontmatterValue = string | readonly string[];

export interface ParsedMarkdown {
  readonly fields: ReadonlyMap<string, FrontmatterValue>;
  readonly body: string;
}

const KEY_LINE = /^([A-Za-z_][\w-]*):\s*(.*)$/;
const BLOCK_SCALAR = /^[|>][+-]?$/;

const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, "\n").replace(/^﻿/, "");

const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2");

const parseInlineList = (value: string): readonly string[] =>
  value
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter(Boolean);

const isListItem = (line: string) => /^\s*-\s+/.test(line);

const listItemOf = (line: string) => unquote(line.replace(/^\s*-\s+/, "").trim());

function parseValue(inline: string, continuation: readonly string[]): FrontmatterValue {
  const lines = continuation.filter((line) => line.trim() !== "");
  if (inline === "" && lines.length > 0 && lines.every(isListItem)) return lines.map(listItemOf);
  if (inline.startsWith("[") && inline.endsWith("]")) return parseInlineList(inline);
  const isBlock = BLOCK_SCALAR.test(inline);
  const joiner = inline.startsWith("|") ? "\n" : " ";
  const parts = isBlock ? lines.map((line) => line.trim()) : [inline, ...lines.map((line) => line.trim())];
  return unquote(parts.filter((part) => part !== "").join(joiner));
}

function parseFields(lines: readonly string[]): Map<string, FrontmatterValue> {
  const fields = new Map<string, FrontmatterValue>();
  let key: string | undefined;
  let inline = "";
  let continuation: string[] = [];
  const flush = () => {
    if (key !== undefined) fields.set(key, parseValue(inline, continuation));
  };
  for (const line of lines) {
    const match = /^\s/.test(line) || isListItem(line) ? null : KEY_LINE.exec(line);
    if (match) {
      flush();
      key = match[1] as string;
      inline = (match[2] ?? "").trim();
      continuation = [];
    } else {
      continuation.push(line);
    }
  }
  flush();
  return fields;
}

export function parseFrontmatter(raw: string): ParsedMarkdown {
  const text = normalizeNewlines(raw);
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
  if (!match) return { fields: new Map(), body: text.trim() };
  return { fields: parseFields((match[1] as string).split("\n")), body: (match[2] as string).trim() };
}

export function listOf(value: FrontmatterValue | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function textOf(value: FrontmatterValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : value.join(", ");
}
