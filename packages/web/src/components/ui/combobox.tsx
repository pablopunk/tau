import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { rankOption, searchValueOf } from "@/components/ui/combobox-rank"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
  /** What the trigger shows while this option is selected; defaults to `label`. */
  triggerLabel?: string
  /** Secondary text under the label, e.g. an id. */
  description?: string
  /** Short text on the right of the option, e.g. why it cannot be chosen, or "local". */
  hint?: React.ReactNode
  /** Leading icon, e.g. a project icon or a lock. */
  icon?: React.ReactNode
  disabled?: boolean
  group?: string
  /** Extra words the search matches. */
  keywords?: string[]
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  id?: string
  disabled?: boolean
  className?: string
  /** Classes for the popover; the default is as wide as the trigger. */
  contentClassName?: string
  /** Controls the popover; leave unset to let it manage itself. */
  open?: boolean
  /** Called when the popover opens or closes. */
  onOpenChange?: (open: boolean) => void
  /** Show the search box; turn off for short lists. */
  searchable?: boolean
  /** Pinned under the list, always visible and never filtered, e.g. an "Add" action. Receives a function that closes the popover. */
  footer?: (close: () => void) => React.ReactNode
  /** A control shown on the right of a group's heading, by group name, e.g. a refresh button. */
  groupActions?: Record<string, React.ReactNode>
  /** An icon shown before a group's heading, by group name, e.g. a machine's OS. */
  groupIcons?: Record<string, React.ReactNode>
  /** `ghost` with `sm` fits inside a composer toolbar. */
  variant?: "outline" | "ghost"
  size?: "default" | "sm"
  /** Shown before the selected label in the trigger. */
  triggerIcon?: React.ReactNode
  "aria-label"?: string
}

function groupOptions(options: ComboboxOption[]): [string | undefined, ComboboxOption[]][] {
  const groups = new Map<string | undefined, ComboboxOption[]>()
  for (const option of options) {
    groups.set(option.group, [...(groups.get(option.group) ?? []), option])
  }
  return [...groups.entries()]
}

function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  id,
  disabled,
  className,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
  groupActions,
  groupIcons,
  searchable = true,
  footer,
  variant = "outline",
  size = "default",
  triggerIcon,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [ownOpen, setOwnOpen] = React.useState(false)
  const open = controlledOpen ?? ownOpen
  const setOpen = (next: boolean) => {
    setOwnOpen(next)
    onOpenChange?.(next)
  }
  const listRef = React.useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          data-slot="combobox-trigger"
          type="button"
          variant={variant}
          size={size}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          {triggerIcon}
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.triggerLabel ?? selected?.label ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-slot="combobox-content"
        className={cn("max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) min-w-52 max-w-[calc(100vw-2rem)] p-0 [&_[data-slot=command-list]]:max-h-[max(9rem,min(18rem,calc(var(--radix-popover-content-available-height)-6rem)))]", contentClassName)}
        align="start"
        collisionPadding={12}
      >
        <Command filter={rankOption}>
          {searchable ? <CommandInput placeholder={searchPlaceholder} onValueChange={() => listRef.current && (listRef.current.scrollTop = 0)} /> : null}
          <CommandList ref={listRef}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groupOptions(options).map(([group, items]) => (
              <CommandGroup key={group ?? "options"} heading={
                  group !== undefined && groupIcons?.[group] ? (
                    <span data-slot="combobox-group-heading" className="flex items-center gap-2">
                      {groupIcons[group]}
                      {group}
                    </span>
                  ) : (
                    group
                  )
                }
                className="relative"
              >
                {group !== undefined && groupActions?.[group] ? (
                  <div data-slot="combobox-group-action" className="absolute top-1 right-1 z-10">
                    {groupActions[group]}
                  </div>
                ) : null}
                {items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={searchValueOf(option.value, [option.label, option.description, ...(option.keywords ?? [])])}
                    disabled={option.disabled}
                    onSelect={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    {option.icon}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </div>
                    {option.hint ? (
                      <span className="text-xs text-muted-foreground">{option.hint}</span>
                    ) : null}
                    <CheckIcon
                      className={cn("ml-auto", option.value === value ? "opacity-100" : "opacity-0")}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          {footer ? (
            <div data-slot="combobox-footer" className="border-t p-1">
              {footer(() => setOpen(false))}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
export type { ComboboxProps }
