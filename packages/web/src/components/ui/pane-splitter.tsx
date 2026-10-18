import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { cn } from "@/lib/utils";

export interface PaneSplitterProps {
  /** Left pane share, in percent. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** The container whose width the pointer position is measured against. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly onChange: (percent: number) => void;
  readonly onReset?: () => void;
  readonly label?: string;
}

const KEY_STEP = 2;

/** A vertical drag handle between two panes (`role=separator`), also moved with the arrow keys. */
export function PaneSplitter({ value, min, max, containerRef, onChange, onReset, label = "Resize panes" }: PaneSplitterProps) {
  const dragging = useRef(false);
  const clamp = (percent: number) => Math.min(max, Math.max(min, percent));

  const move = (event: PointerEvent) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!dragging.current || !box || box.width === 0) return;
    onChange(clamp(((event.clientX - box.left) / box.width) * 100));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    onChange(clamp(value + delta));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-slot="pane-splitter"
      title="Drag to resize, double-click to reset"
      className={cn(
        "relative w-px shrink-0 cursor-col-resize bg-border outline-none transition-colors",
        "after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']",
        "hover:bg-ring focus-visible:bg-ring",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragging.current = true;
        document.body.style.userSelect = "none";
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={move}
      onPointerUp={() => {
        dragging.current = false;
        document.body.style.removeProperty("user-select");
      }}
      onPointerCancel={() => {
        dragging.current = false;
        document.body.style.removeProperty("user-select");
      }}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
