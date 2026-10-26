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
    // Cancelling a file drag (Escape, app switch, OS abort) delivers no
    // drop/dragend/dragleave to the page, so the overlay would stick forever.
    const cancel = (event: KeyboardEvent) => event.key === "Escape" && setDragging(false);
    // A drag cannot outlive the window's focus, and no pointer press can happen mid-drag:
    // either firing while armed means the drag ended without telling us.
    const aborted = () => setDragging(false);
    window.addEventListener("dragenter", start);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", aborted);
    window.addEventListener("pointerdown", aborted);
    return () => {
      window.removeEventListener("dragenter", start);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", aborted);
      window.removeEventListener("pointerdown", aborted);
    };
  }, [enabled]);
  return [dragging, () => setDragging(false)];
}
