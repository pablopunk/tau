import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { LegacyNodeRedirect } from "./LegacyNodeRedirect";

function Where() {
  const { pathname, search } = useLocation();
  return <p>{pathname + search}</p>;
}

describe("LegacyNodeRedirect", () => {
  it("sends /m/<id>/... to /n/<id>/... with the same id", () => {
    render(
      <MemoryRouter initialEntries={["/m/abc/p/p1/c/c1/terminal?x=1"]}>
        <Routes>
          <Route path="/m/*" element={<LegacyNodeRedirect />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("/n/abc/p/p1/c/c1/terminal?x=1")).toBeTruthy();
  });
});
