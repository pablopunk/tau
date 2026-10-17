import * as React from "react"
import { ChevronLeftIcon } from "lucide-react"
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
  children: React.ReactNode
}

function SettingsDialogContent({ className, ...props }: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      showCloseButton={false}
      className={cn("h-[min(640px,85vh)] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl", className)}
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

function DesktopSettings({ sections, active, onActiveChange, title, children }: SettingsLayoutProps) {
  return (
    <SidebarProvider className="h-full min-h-0 w-full">
      <Sidebar collapsible="none" className="w-48 shrink-0 p-2">
        <SidebarContent>
          <SidebarGroup className="p-0">
            <SectionNav sections={sections} active={active} onPick={onActiveChange} />
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <DialogTitle className="px-6 pt-5 text-base font-medium">{title}</DialogTitle>
        <SectionScroller>{children}</SectionScroller>
      </div>
    </SidebarProvider>
  )
}

function MobileSettings({ sections, active, onActiveChange, title, children }: SettingsLayoutProps) {
  const [showSection, setShowSection] = React.useState(false)
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
        <div className="p-2">
          <SectionNav sections={sections} active={active} onPick={pick} />
        </div>
      )}
    </SidebarProvider>
  )
}

/** A sectioned settings screen for inside a Dialog: side nav on desktop, list then section with a back button on mobile. */
function SettingsLayout({ mobile, ...props }: SettingsLayoutProps) {
  const isMobile = useIsMobile()
  return (mobile ?? isMobile) ? <MobileSettings {...props} /> : <DesktopSettings {...props} />
}

export { SettingsDialogContent, SettingsLayout }
export type { SettingsLayoutProps, SettingsSection }
