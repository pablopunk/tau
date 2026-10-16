import { useEffect, useState } from "react";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function usePageDrag(enabled: boolean): [boolean, () => void] {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const start = (event: DragEvent) => hasFiles(event) && setDragging(true);
    const stop = () => setDragging(false);
    const leave = (event: DragEvent) => event.relatedTarget === null && setDragging(false);
    window.addEventListener("dragenter", start);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragenter", start);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
    };
  }, [enabled]);
  return [dragging, () => setDragging(false)];
}
