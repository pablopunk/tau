import { type RefObject, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./use-prefers-reduced-motion";

export const FLIP_DURATION_MS = 160;

type Tops = Map<string, number>;

const rowsOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-flip-id]")];

const measure = (rows: HTMLElement[]): Tops =>
  new Map(rows.map((row) => [row.dataset.flipId ?? "", row.getBoundingClientRect().top]));

const sameOrderedIds = (before: Tops, after: Tops) =>
  before.size === after.size && [...before.keys()].every((id) => after.has(id));

function slide(row: HTMLElement, distance: number) {
  row.animate([{ transform: `translateY(${distance}px)` }, { transform: "translateY(0)" }], {
    duration: FLIP_DURATION_MS,
    easing: "ease-out",
  });
}

/**
 * FLIP-animates the `[data-flip-id]` rows inside `containerRef`: rows slide from their old position when the list is a
 * pure reorder, and when `resetKey` changes (a group opened or closed). Does nothing under reduced motion.
 */
export function useFlipList(containerRef: RefObject<HTMLElement | null>, resetKey: unknown): void {
  const previous = useRef<{ tops: Tops; resetKey: unknown }>({ tops: new Map(), resetKey });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const tops = measure(rowsOf(container));
    const { tops: before, resetKey: beforeKey } = previous.current;
    previous.current = { tops, resetKey };
    if (prefersReducedMotion()) return;
    const animate = beforeKey !== resetKey || sameOrderedIds(before, tops);
    if (!animate) return;
    for (const row of rowsOf(container)) {
      const id = row.dataset.flipId ?? "";
      const from = before.get(id);
      const to = tops.get(id);
      if (from !== undefined && to !== undefined && from !== to) slide(row, from - to);
    }
  });
}
