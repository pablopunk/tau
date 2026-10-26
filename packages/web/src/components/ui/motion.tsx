import { AnimatePresence, MotionConfig, motion } from "motion/react"
import type { Transition } from "motion/react"
import type { ReactNode } from "react"

/**
 * Shared Motion entry point. Import animation primitives from here, not
 * `motion/react` directly, so presets and reduced-motion handling stay in one place.
 *
 * Motion respects `prefers-reduced-motion` via `MotionProvider` below; the global
 * CSS kill-switch in `index.css` covers the remaining CSS transitions.
 */

export { AnimatePresence, motion }

/** Short fade-and-rise for mounting panels: queued items, approvals, composer extras. */
export const rise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
} as const

/** Plain fade for overlays and inline errors. */
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} as const

/** Snappy spring for shared-element moves (e.g. the sidebar project icon). */
export const snappy: Transition = { type: "spring", stiffness: 550, damping: 38 }

/** Gentle tween for enter/exit fades. Transform/opacity only, so scroll anchoring is unaffected. */
export const gentle: Transition = { duration: 0.16, ease: "easeOut" }

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
