import { defaultFilter } from "cmdk"

export const LABEL_SEPARATOR = "\n"

const labelOf = (value: string) => (value.split(LABEL_SEPARATOR)[0] ?? "").toLowerCase()
const nameOf = (label: string) => label.slice(label.lastIndexOf("/") + 1)

/** Exact name, then name prefix, then label substring, then any text substring, then cmdk's fuzzy match. */
export function rankOption(value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLowerCase()
  if (needle === "") return 1
  const label = labelOf(value)
  if (nameOf(label) === needle) return 1
  if (nameOf(label).startsWith(needle)) return 0.95
  if (label.includes(needle)) return 0.9
  if (value.toLowerCase().includes(needle)) return 0.6
  return defaultFilter(value, search, keywords) * 0.5
}
