import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { QrCode } from "./qr-code"

describe("QrCode", () => {
  it("draws the link as modules in an svg with an accessible name", () => {
    render(<QrCode value="https://abc.opentunnel.xyz/pair#0123" label="Link this device" />)
    const svg = screen.getByRole("img", { name: "Link this device" })
    expect(svg.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(200)
  })

  it("draws a different code for a different link", () => {
    const first = render(<QrCode value="https://a.example/pair#1" />)
    const one = first.container.querySelector("path")?.getAttribute("d")
    first.unmount()
    const second = render(<QrCode value="https://a.example/pair#2" />)
    expect(second.container.querySelector("path")?.getAttribute("d")).not.toBe(one)
  })
})
