import * as React from "react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"

interface MentionItem {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  group?: string
}

interface MentionMenuProps {
  open: boolean
  items: readonly MentionItem[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onSelect: (item: MentionItem) => void
  onClose: () => void
  emptyText: string
  anchor: HTMLElement | null
}

function groupItems(items: readonly MentionItem[]) {
  const groups = new Map<string, { item: MentionItem; index: number }[]>()
  items.forEach((item, index) => {
    const key = item.group ?? ""
    groups.set(key, [...(groups.get(key) ?? []), { item, index }])
  })
  return [...groups.entries()]
}

interface MentionRowProps {
  item: MentionItem
  index: number
  active: boolean
  onActiveIndexChange: (index: number) => void
  onSelect: (item: MentionItem) => void
}

function MentionRow({ item, index, active, onActiveIndexChange, onSelect }: MentionRowProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" })
  }, [active])
  return (
    <CommandItem
      ref={ref}
      value={item.id}
      data-selected={active}
      aria-selected={active}
      onMouseMove={() => !active && onActiveIndexChange(index)}
      onSelect={() => onSelect(item)}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
      {item.description && <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>}
    </CommandItem>
  )
}

/** A controlled suggestion menu above `anchor`; focus stays in the caller's textarea, which drives the active index. */
function MentionMenu({ open, items, activeIndex, onActiveIndexChange, onSelect, onClose, emptyText, anchor }: MentionMenuProps) {
  const virtualRef = React.useMemo(() => ({ current: anchor }), [anchor])
  return (
    <Popover open={open} onOpenChange={(next) => !next && onClose()}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="top"
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => anchor?.contains(event.target as Node) && event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false} value={items[activeIndex]?.id ?? ""} onValueChange={() => {}}>
          <CommandList>
            {items.length === 0 && <CommandEmpty>{emptyText}</CommandEmpty>}
            {groupItems(items).map(([group, rows]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {rows.map(({ item, index }) => (
                  <MentionRow
                    key={item.id}
                    item={item}
                    index={index}
                    active={index === activeIndex}
                    onActiveIndexChange={onActiveIndexChange}
                    onSelect={onSelect}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { MentionMenu }
export type { MentionItem, MentionMenuProps }
