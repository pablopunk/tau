import { useEffect } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const FLASH_MS = 1600;
const WAIT_FOR_ROW_MS = 4000;
const CONTROL = "input, button, textarea, [role=switch], [role=radio], [role=combobox], a[href]";

const findRow = (id: string) => document.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(id)}"]`);

function reveal(row: HTMLElement, smooth: boolean) {
  row.scrollIntoView?.({ block: "center", behavior: smooth ? "smooth" : "auto" });
  row.querySelector<HTMLElement>(CONTROL)?.focus({ preventScroll: true });
  row.setAttribute("data-highlighted", "");
  window.setTimeout(() => row.removeAttribute("data-highlighted"), FLASH_MS);
}

/** Scrolls to, focuses and flashes the row with this `data-setting-id`, waiting for it to render. `nonce` repeats it. */
export function useRevealSetting(settingId: string | null, nonce: number, section: string) {
  const reducedMotion = usePrefersReducedMotion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce and section re-run the reveal on purpose
  useEffect(() => {
    if (!settingId) return;
    let done = false;
    const attempt = () => {
      const row = findRow(settingId);
      if (!row || done) return;
      done = true;
      observer.disconnect();
      reveal(row, !reducedMotion);
    };
    const observer = new MutationObserver(attempt);
    observer.observe(document.body, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => observer.disconnect(), WAIT_FOR_ROW_MS);
    attempt();
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
  }, [settingId, nonce, section, reducedMotion]);
}
