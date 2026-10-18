import { useEffect, useState } from "react";

export const NARROW_BELOW = 760;

/** True below 760 px: panes become tabs. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_BELOW);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${NARROW_BELOW - 1}px)`);
    const update = () => setNarrow(window.innerWidth < NARROW_BELOW);
    query.addEventListener("change", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return narrow;
}
