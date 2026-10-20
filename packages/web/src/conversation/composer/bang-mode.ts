export function isBangMode(draft: string): boolean {
  return draft.startsWith("! ");
}

export function isBareBang(draft: string): boolean {
  return draft.trim() === "!";
}

export const BANG_EMPTY_ERROR = "Type a command after `! `, e.g. `! ls`.";
