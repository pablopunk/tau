import { readWithLegacy } from "@/lib/legacy-storage";

const PREFIX = "tau:draft:";

export function loadDraft(target: string): string {
  try {
    return readWithLegacy(PREFIX + target) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(target: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(PREFIX + target, text);
    else window.localStorage.removeItem(PREFIX + target);
  } catch {
    return;
  }
}
