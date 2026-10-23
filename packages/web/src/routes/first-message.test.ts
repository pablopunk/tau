import type { FileRef, ImageInput } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import {
  FIRST_MESSAGE_STATE_KEY,
  type FirstMessage,
  firstMessageOf,
  firstMessageState,
} from "./first-message";

const message: FirstMessage = {
  text: "Inspect this image",
  images: [{ mimeType: "image/png", data: "encoded" } satisfies ImageInput],
  files: [{ name: "notes.txt", path: "uploads/notes.txt", size: 5 } satisfies FileRef],
};

describe("first message route state", () => {
  it("stores the message under the route state key", () => {
    expect(FIRST_MESSAGE_STATE_KEY).toBe("tauFirstMessage");
    expect(firstMessageState(message)).toEqual({ tauFirstMessage: message });
  });

  it("reads a valid message from location state", () => {
    expect(firstMessageOf(firstMessageState(message))).toEqual(message);
  });

  it("accepts an empty message without images", () => {
    expect(firstMessageOf(firstMessageState({ text: "", images: [] }))).toEqual({
      text: "",
      images: [],
      files: [],
    });
  });

  it.each([
    undefined,
    null,
    "invalid",
    [],
    {},
    { tauFirstMessage: null },
    { tauFirstMessage: { images: [] } },
    { tauFirstMessage: { text: 1, images: [] } },
    { tauFirstMessage: { text: "hello", images: {} } },
    { tauFirstMessage: { text: "hello", images: [{ mimeType: "image/tiff", data: "x" }] } },
    { tauFirstMessage: { text: "hello", images: [{ mimeType: "image/png", data: 1 }] } },
    { tauFirstMessage: { text: "hello", images: Array.from({ length: 17 }, () => message.images[0]) } },
    { tauFirstMessage: { text: "hello", images: [], files: [{ name: "", path: "uploads/a", size: 1 }] } },
    { tauFirstMessage: { text: "hello", images: [], files: [{ name: "a", path: "uploads/a", size: -1 }] } },
    { tauFirstMessage: { text: "hello", images: [], files: {} } },
  ])("returns undefined for malformed route state %#", (locationState) => {
    expect(firstMessageOf(locationState)).toBeUndefined();
  });

  it("returns undefined if reading the state key throws", () => {
    const locationState = Object.defineProperty({}, FIRST_MESSAGE_STATE_KEY, {
      get: () => {
        throw new Error("unreadable state");
      },
    });
    expect(firstMessageOf(locationState)).toBeUndefined();
  });
});
