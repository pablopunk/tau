import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NodeAvatar } from "./node-avatar"
import { OsIcon, osKindOf } from "./os-icon"

describe("osKindOf", () => {
  it.each([
    ["darwin arm64", "mac"],
    ["macOS", "mac"],
    ["linux x64", "linux"],
    ["Linux", "linux"],
    ["win32 x64", "windows"],
    ["windows", "windows"],
    ["freebsd x64", "unknown"],
    ["", "unknown"],
    [undefined, "unknown"],
  ])("%s -> %s", (os, kind) => expect(osKindOf(os)).toBe(kind))
})

describe("OsIcon", () => {
  it.each([
    ["darwin arm64", "mac"],
    ["linux x64", "linux"],
    ["win32 x64", "windows"],
    ["plan9", "unknown"],
  ])("draws %s", (os, kind) => {
    const { container } = render(<OsIcon os={os} />)
    expect(container.querySelector("svg")).toHaveAttribute("data-os", kind)
  })
})

describe("NodeAvatar", () => {
  it.each([
    ["darwin arm64", "online", "macOS, online"],
    ["linux x64", "offline", "Linux, offline"],
    ["win32 x64", "reconnecting", "Windows, reconnecting"],
    ["", "update-required", "Unknown OS, update required"],
  ] as const)("%s %s is labelled %s", (os, status, label) => {
    render(<NodeAvatar os={os} status={status} />)
    expect(screen.getByRole("img", { name: label })).toHaveAttribute("data-status", status)
  })
})
