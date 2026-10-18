export const SIDEBAR_WIDTH_DEFAULT = 256;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_COLLAPSE_BELOW = 140;
export const SIDEBAR_KEYBOARD_STEP = 16;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

export type SidebarDragResult = { open: false } | { open: true; width: number };

/** Maps the pointer distance from the sidebar's outer edge to what the sidebar should do. */
export function resolveSidebarDrag(distanceFromEdge: number): SidebarDragResult {
  if (distanceFromEdge < SIDEBAR_COLLAPSE_BELOW) return { open: false };
  return { open: true, width: clampSidebarWidth(distanceFromEdge) };
}
