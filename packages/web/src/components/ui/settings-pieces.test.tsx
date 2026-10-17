import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { ContextMeter } from "./context-meter"
import { Dialog } from "./dialog"
import { MentionMenu, type MentionItem } from "./mention-menu"
import { SettingsDialogContent, SettingsLayout } from "./settings-layout"
import { TooltipProvider } from "./tooltip"

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
]

function Harness({ mobile }: { mobile?: boolean }) {
  const [active, setActive] = React.useState("general")
  return (
    <Dialog open>
      <SettingsDialogContent aria-describedby={undefined}>
        <SettingsLayout sections={SECTIONS} active={active} onActiveChange={setActive} title="Settings" mobile={mobile}>
          <p>content of {active}</p>
        </SettingsLayout>
      </SettingsDialogContent>
    </Dialog>
  )
}

describe("SettingsLayout", () => {
  it("marks the active section and switches with the keyboard on desktop", async () => {
    render(<Harness mobile={false} />)
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("content of general")).toBeInTheDocument()
    screen.getByRole("button", { name: "General" }).focus()
    await userEvent.tab()
    await userEvent.keyboard("{Enter}")
    expect(screen.getByRole("button", { name: "Providers" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("content of providers")).toBeInTheDocument()
  })

  it("on mobile shows the list, then a section with a back button", async () => {
    render(<Harness mobile />)
    expect(screen.queryByText(/content of/)).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Providers" }))
    expect(screen.getByText("content of providers")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Providers" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }))
    expect(screen.queryByText(/content of/)).toBeNull()
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
  })
})

const ITEMS: MentionItem[] = [
  { id: "a", label: "alpha.ts", group: "Files" },
  { id: "b", label: "beta.ts", description: "src", group: "Files" },
  { id: "c", label: "review", group: "Skills" },
]

function renderMenu(props: Partial<React.ComponentProps<typeof MentionMenu>> = {}) {
  const anchor = document.body.appendChild(document.createElement("div"))
  const onSelect = vi.fn()
  render(
    <MentionMenu open items={ITEMS} activeIndex={1} onActiveIndexChange={vi.fn()} onSelect={onSelect} onClose={vi.fn()} emptyText="Nothing" anchor={anchor} {...props} />,
  )
  return { onSelect }
}

describe("MentionMenu", () => {
  it("renders group headings and highlights the active item", () => {
    renderMenu()
    expect(screen.getByText("Files")).toBeInTheDocument()
    expect(screen.getByText("Skills")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /beta\.ts/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("option", { name: /alpha\.ts/ })).toHaveAttribute("aria-selected", "false")
  })

  it("selects an item by click", async () => {
    const { onSelect } = renderMenu()
    await userEvent.click(screen.getByRole("option", { name: /review/ }))
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])
  })

  it("shows the empty text when there are no items", () => {
    renderMenu({ items: [] })
    expect(screen.getByText("Nothing")).toBeInTheDocument()
  })

  it("renders nothing when closed", () => {
    renderMenu({ open: false })
    expect(screen.queryByText("Files")).toBeNull()
  })
})

describe("ContextMeter", () => {
  const meter = (used: number, total: number) =>
    render(<TooltipProvider><ContextMeter used={used} total={total} label="42k of 200k tokens · 21%" /></TooltipProvider>)

  it("exposes meter values", () => {
    meter(42, 200)
    const el = screen.getByRole("meter")
    expect(el).toHaveAttribute("aria-valuenow", "42")
    expect(el).toHaveAttribute("aria-valuemin", "0")
    expect(el).toHaveAttribute("aria-valuemax", "200")
    expect(el).toHaveClass("text-primary")
  })

  it("shifts to warning and destructive", () => {
    meter(80, 100)
    expect(screen.getByRole("meter")).toHaveClass("text-warning")
    meter(96, 100)
    expect(screen.getAllByRole("meter")[1]).toHaveClass("text-destructive")
  })

  it("shows the label in a tooltip on hover", async () => {
    meter(42, 200)
    await userEvent.hover(screen.getByRole("meter"))
    expect((await screen.findAllByText("42k of 200k tokens · 21%")).length).toBeGreaterThan(0)
  })

  it("renders nothing when total is 0", () => {
    meter(0, 0)
    expect(screen.queryByRole("meter")).toBeNull()
  })
})
