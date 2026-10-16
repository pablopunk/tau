import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

export const prefersReducedMotion = () => window.matchMedia(QUERY).matches;

export const usePrefersReducedMotion = () =>
  useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
