import { useEffect, useRef } from "react";

export type HotkeyHandler = (event: KeyboardEvent) => void;

interface ParsedCombo {
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly key: string;
}

const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+");
  return {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key: parts.at(-1) ?? "",
  };
}

function matches(event: KeyboardEvent, combo: ParsedCombo): boolean {
  const modPressed = isMac() ? event.metaKey : event.ctrlKey;
  return (
    event.key.toLowerCase() === combo.key &&
    modPressed === combo.mod &&
    event.shiftKey === combo.shift &&
    event.altKey === combo.alt
  );
}

function isTextInput(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

/** `Mod` is Cmd on macOS and Ctrl elsewhere. Combos without `Mod` do not fire while typing in a text input. */
export function useHotkey(combo: string, handler: HotkeyHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const parsed = parseCombo(combo);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matches(event, parsed)) return;
      if (!parsed.mod && isTextInput(event.target)) return;
      event.preventDefault();
      latest.current(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo]);
}
