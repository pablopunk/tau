import { describe, expect, it } from "vitest"
import { rankOption } from "./combobox-rank"

const item = (label: string, description = "") => `${label}\n${description}`

describe("rankOption", () => {
  it("ranks a name substring above a fuzzy match", () => {
    const webr = rankOption(item("pablopunk/webr"), "webr")
    const fuzzy = rankOption(item("mazedesignhq/maze-monorepo", "the mono repo"), "webr")
    expect(webr).toBeGreaterThan(fuzzy)
  })

  it("ranks exact name, then prefix, then substring", () => {
    const [exact, prefix, inside] = [
      rankOption(item("me/webr"), "webr"),
      rankOption(item("me/webr-ui"), "webr"),
      rankOption(item("me/my-webr"), "webr"),
    ]
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(inside)
  })
})
