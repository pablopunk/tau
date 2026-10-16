import type * as React from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

interface SegmentedOption<T extends string> {
  value: T
  /** Accessible name, also the tooltip text. */
  label: string
  icon: React.ReactNode
}

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  "aria-label": string
  className?: string
}

/** A single-choice switch of icon buttons, built on the shadcn `ToggleGroup`; one option is always chosen. */
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={props["aria-label"]}
      className={className}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label} title={option.label}>
          {option.icon}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export { SegmentedControl }
export type { SegmentedControlProps, SegmentedOption }
