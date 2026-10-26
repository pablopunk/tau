import { useEffect, useState } from "react";

/** Rows drawn on the first render of a thread: enough to fill the screen at the bottom, where the view lands. */
const FIRST = 40;
/** Rows added per step while the rest is drawn between frames. */
const STEP = 40;

/**
 * How many of `total` rows to draw, counted from the newest. A long transcript mounts the newest rows at once and
 * fills in the older ones in the following frames, so opening a thread costs the same however long it is. Once
 * everything is drawn it stays drawn: later rows never push an older one out.
 */
export function useProgressiveCount(total: number): number {
  const [state, setState] = useState({ count: FIRST, full: total <= FIRST });
  useEffect(() => {
    if (state.full) return;
    const timer = setTimeout(
      () =>
        setState((previous) => {
          const count = previous.count + STEP;
          return { count, full: count >= total };
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [state, total]);
  return state.full ? total : Math.min(state.count, total);
}
