import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  resolveSidebarDrag,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "./sidebar-width";

describe("clampSidebarWidth", () => {
  it("keeps widths inside the range", () => {
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MIN)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MAX)).toBe(SIDEBAR_WIDTH_MAX);
  });
  it("clamps widths outside the range", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(9000)).toBe(SIDEBAR_WIDTH_MAX);
  });
  it("rounds and falls back to the default for bad numbers", () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});

describe("resolveSidebarDrag", () => {
  it("collapses below the threshold", () => {
    expect(resolveSidebarDrag(139)).toEqual({ open: false });
  });
  it("snaps to the minimum between the threshold and the minimum", () => {
    expect(resolveSidebarDrag(140)).toEqual({ open: true, width: SIDEBAR_WIDTH_MIN });
  });
  it("follows the pointer and stops at the maximum", () => {
    expect(resolveSidebarDrag(320)).toEqual({ open: true, width: 320 });
    expect(resolveSidebarDrag(900)).toEqual({ open: true, width: SIDEBAR_WIDTH_MAX });
  });
});
