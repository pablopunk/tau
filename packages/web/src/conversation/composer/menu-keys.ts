import type { KeyboardEvent } from "react";

export type MenuKeyAction = "next" | "previous" | "pick" | "close";

export function menuKeyAction(event: KeyboardEvent, menuOpen: boolean): MenuKeyAction | null {
  if (!menuOpen || event.nativeEvent.isComposing) return null;
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "Escape") return "close";
  if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) return "pick";
  return null;
}

export function movedIndex(current: number, delta: 1 | -1, size: number): number {
  return size === 0 ? 0 : (current + delta + size) % size;
}
