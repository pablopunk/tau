import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

vi.mock("bot-avatars", () => ({
  BotAvatar: (props: { paused?: boolean; turn?: number }) =>
    createElement("canvas", {
      "data-testid": "bot-canvas",
      "data-paused": String(props.paused),
      "data-turn": props.turn,
    }),
  botAvatarTypes: ["clover", "blob", "cube"],
}));

afterEach(cleanup);

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Element.prototype.scrollIntoView ??= () => {};

Element.prototype.animate ??= (() => ({
  cancel() {},
  finish() {},
  onfinish: null,
})) as unknown as typeof Element.prototype.animate;
