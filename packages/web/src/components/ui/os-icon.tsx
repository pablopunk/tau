import type * as React from "react"
import { cn } from "@/lib/utils"

type OsKind = "mac" | "linux" | "windows" | "unknown"

const OS_LABELS: Record<OsKind, string> = {
  mac: "macOS",
  linux: "Linux",
  windows: "Windows",
  unknown: "Unknown OS",
}

/** Maps a machine `os` string ("darwin arm64", "linux x64", "win32 x64") to an icon kind. */
function osKindOf(os: string | undefined): OsKind {
  const platform = (os ?? "").trim().toLowerCase().split(/\s+/)[0] ?? ""
  if (platform === "darwin" || platform === "macos") return "mac"
  if (platform === "linux") return "linux"
  if (platform === "win32" || platform === "windows") return "windows"
  return "unknown"
}

const osLabelOf = (os: string | undefined): string => OS_LABELS[osKindOf(os)]

const PATHS: Record<OsKind, string> = {
  mac: "M16.4 12.7c0-2.4 2-3.5 2.1-3.6-1.1-1.700-2.900-1.900-3.500-1.900-1.500-.2-2.900.9-3.700.9s-1.900-.9-3.200-.8c-1.600 0-3.100.9-4 2.400-1.700 3-.4 7.400 1.200 9.800.8 1.200 1.800 2.500 3 2.400 1.200 0 1.700-.8 3.100-.8s1.900.8 3.200.8 2.100-1.200 2.900-2.400c.9-1.300 1.300-2.600 1.300-2.700 0 0-2.400-.9-2.400-3.700zM14 5.600c.7-.8 1.100-1.900 1-3-1 0-2.100.7-2.800 1.500-.6.700-1.100 1.800-1 2.900 1.100.1 2.100-.6 2.800-1.400z",
  linux:
    "M12 2.500c-2 0-3.200 1.700-3.200 4 0 1.100.3 2 .1 2.700-.4 1.100-2.500 3.500-2.900 5.700-.2 1.200 0 2.200.6 2.800-.5.700-1.500 1.100-2.100 1.600-.5.500-.1 1.100.8 1.300 1 .2 2.100.2 2.800.9.500.5 1.200.9 2 .9s1.500-.3 1.900-.9c.4.600 1.100.9 1.900.9s1.500-.4 2-.9c.7-.7 1.800-.7 2.800-.9.900-.2 1.300-.8.800-1.300-.6-.5-1.600-.9-2.100-1.600.6-.6.800-1.600.6-2.800-.4-2.200-2.500-4.600-2.900-5.700-.2-.7.100-1.600.1-2.700 0-2.300-1.200-4-3.200-4zM10.700 6c.4 0 .7.500.7 1s-.3.900-.7.900-.7-.4-.7-.9.300-1 .7-1zm2.600 0c.4 0 .7.500.7 1s-.3.900-.7.900-.7-.4-.7-.9.300-1 .7-1zM12 8.200c.8 0 1.600.5 1.600.9 0 .5-.7 1-1.600 1s-1.600-.5-1.600-1 .800-.9 1.600-.9z",
  windows: "M3 5.500 10.500 4.500v7H3zM11.500 4.350 21 3v8.500h-9.500zM3 12.500h7.500v7L3 18.500zM11.500 12.500H21V21l-9.500-1.350z",
  unknown: "",
}

/** A monochrome OS mark drawn in `currentColor`; unknown systems get a plain computer outline. */
function OsIcon({ os, className, ...props }: Omit<React.ComponentProps<"svg">, "children"> & { os: string | undefined }) {
  const kind = osKindOf(os)
  return (
    <svg
      data-slot="os-icon"
      data-os={kind}
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      {...(kind === "unknown"
        ? { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }
        : { fill: "currentColor" })}
      {...props}
    >
      {kind === "unknown" ? (
        <>
          <rect width="18" height="12" x="3" y="4" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </>
      ) : (
        <path d={PATHS[kind]} />
      )}
    </svg>
  )
}

export { OsIcon, osKindOf, osLabelOf }
export type { OsKind }
