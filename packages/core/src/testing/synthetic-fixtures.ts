import { RETIRED_OPS } from "@tau/protocol";
import type { Fixture } from "@tau/testkit";

function retiredFrom(text: Fixture): Fixture {
  const lastAt = text.frames.at(-1)?.at ?? 0;
  return {
    ...text,
    name: "retired",
    description: "A finished conversation whose view is retired at the end (synthetic: derived from `text`).",
    synthetic: true,
    frames: [...text.frames, { at: lastAt + 100, ops: RETIRED_OPS }],
  };
}

export function deriveSyntheticFixtures(recorded: readonly Fixture[]): Fixture[] {
  const text = recorded.find((fixture) => fixture.name === "text");
  return text ? [retiredFrom(text)] : [];
}
