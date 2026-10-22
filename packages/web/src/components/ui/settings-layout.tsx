import * as React from "react"
import { ChevronLeftIcon } from "lucide-react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"

interface SettingsSection {
  id: string
  label: string
  icon?: React.ReactNode
}

interface SettingsLayoutProps {
  sections: readonly SettingsSection[]
  active: string
  onActiveChange: (id: string) => void
  title: string
  /** Forces the layout instead of following the `md` breakpoint. */
  mobile?: boolean
  /** A search field shown above the section list. */
  search?: React.ReactNode
  /** Replaces the section body (and on mobile the section list) while set, for search results. */
  results?: React.ReactNode
  /** Changes whenever the caller wants the section body shown, so the mobile layout leaves its list. */
  sectionRequest?: number
  /** Replaces the generated flat section list with a custom nav tree (e.g. grouped, with nested items). */
  nav?: React.ReactNode
  children: React.ReactNode
}

/** Marks one setting so search can find, scroll to and flash it. Use `asChild` to mark an existing element. */
function SettingRow({
  id,
  asChild,
  className,
  ...props
}: React.ComponentProps<"div"> & { id: string; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="setting-row"
      data-setting-id={id}
      className={cn(
        !asChild && "-mx-2 -my-1.5 px-2 py-1.5",
        "scroll-mt-4 rounded-lg transition-colors duration-700 data-[highlighted]:bg-accent data-[highlighted]:ring-2 data-[highlighted]:ring-ring/40 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function SettingsDialogContent({ className, ...props }: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      showCloseButton={false}
      className={cn("h-[min(780px,92vh)] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl", className)}
      {...props}
    />
  )
}

function SectionNav({ sections, active, onPick }: { sections: readonly SettingsSection[]; active: string; onPick: (id: string) => void }) {
  return (
    <nav aria-label="Settings sections">
      <SidebarMenu>
        {sections.map((section) => (
          <SidebarMenuItem key={section.id}>
            <SidebarMenuButton
              isActive={section.id === active}
              aria-current={section.id === active ? "page" : undefined}
              onClick={() => onPick(section.id)}
            >
              {section.icon}
              <span>{section.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </nav>
  )
}

function SectionScroller({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-6 p-4 md:p-6">{children}</div>
    </ScrollArea>
  )
}

function DesktopSettings({ sections, active, onActiveChange, title, search, results, nav, children }: SettingsLayoutProps) {
  return (
    <SidebarProvider className="h-full min-h-0 w-full">
      <Sidebar collapsible="none" className="w-48 shrink-0 p-2">
        <SidebarContent>
          {search}
          <SidebarGroup className="p-0">
            {nav ? <nav aria-label="Settings sections">{nav}</nav> : <SectionNav sections={sections} active={active} onPick={onActiveChange} />}
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <DialogTitle className="px-6 pt-5 text-base font-medium">{title}</DialogTitle>
        <SectionScroller>{results ?? children}</SectionScroller>
      </div>
    </SidebarProvider>
  )
}

function MobileSettings({ sections, active, onActiveChange, title, search, results, sectionRequest, nav, children }: SettingsLayoutProps) {
  const [showSection, setShowSection] = React.useState(false)
  React.useEffect(() => {
    if (sectionRequest) setShowSection(true)
  }, [sectionRequest])
  const activeLabel = sections.find((section) => section.id === active)?.label ?? title
  const pick = (id: string) => {
    onActiveChange(id)
    setShowSection(true)
  }
  return (
    <SidebarProvider className="h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-4 pb-2">
        {showSection && (
          <Button variant="ghost" size="icon-sm" aria-label="Back to settings" onClick={() => setShowSection(false)}>
            <ChevronLeftIcon />
          </Button>
        )}
        <DialogTitle className="text-base font-medium">{showSection ? activeLabel : title}</DialogTitle>
      </div>
      {showSection ? (
        <SectionScroller>{children}</SectionScroller>
      ) : (
        <>
          {search}
          {results ? (
            <SectionScroller>{results}</SectionScroller>
          ) : (
            <div className="p-2">{nav ? <nav aria-label="Settings sections">{nav}</nav> : <SectionNav sections={sections} active={active} onPick={pick} />}</div>
          )}
        </>
      )}
    </SidebarProvider>
  )
}

/** A sectioned settings screen for inside a Dialog: side nav on desktop, list then section with a back button on mobile. */
function SettingsLayout({ mobile, ...props }: SettingsLayoutProps) {
  const isMobile = useIsMobile()
  return (mobile ?? isMobile) ? <MobileSettings {...props} /> : <DesktopSettings {...props} />
}

export { SettingRow, SettingsDialogContent, SettingsLayout }
export type { SettingsLayoutProps, SettingsSection }
