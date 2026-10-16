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
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
  /** Secondary text under the label, e.g. an id. */
  description?: string
  /** Why the option cannot be chosen, shown next to a disabled option. */
  hint?: string
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
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          data-slot="combobox-trigger"
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-slot="combobox-content"
        className="w-(--radix-popover-trigger-width) min-w-52 p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groupOptions(options).map(([group, items]) => (
              <CommandGroup key={group ?? "options"} heading={group}>
                {items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={[option.label, option.description, ...(option.keywords ?? [])].join(" ")}
                    disabled={option.disabled}
                    onSelect={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </div>
                    {option.hint ? (
                      <span className="ml-auto text-xs text-muted-foreground">{option.hint}</span>
                    ) : null}
                    <CheckIcon
                      className={cn(
                        option.hint ? "" : "ml-auto",
                        option.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
export type { ComboboxProps }
