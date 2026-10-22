import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const getSnapshot = (): boolean => open;

type OpenUpdate = boolean | ((current: boolean) => boolean);

const setPaletteOpen = (update: OpenUpdate): void => {
  const next = typeof update === "function" ? update(open) : update;
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
};

/** Opens the command palette from anywhere (the sidebar logo button). */
export const openPalette = (): void => setPaletteOpen(true);

/** Resets the shared open state; tests call this in `beforeEach` so one render cannot leak into the next. */
export const resetPaletteOpen = (): void => setPaletteOpen(false);

/** The command palette's open state, shared between the palette and its triggers. */
export function usePaletteOpen(): readonly [boolean, (update: OpenUpdate) => void] {
  return [useSyncExternalStore(subscribe, getSnapshot), setPaletteOpen] as const;
}
