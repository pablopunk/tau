import { type Fixture, type FixtureName, fixtures } from "./index";

const COMMAND_FIXTURES: Record<string, FixtureName> = {
  think: "thinking",
  read: "read",
  write: "write",
  edit: "edit",
  bash: "bash",
  fail: "error",
  flaky: "retry",
  overloaded: "retry-exhausted",
  image: "image",
  todo: "todo",
};

export function triggerOf(fixture: Fixture): string | undefined {
  const first = fixture.steps[0];
  return first?.kind === "send" ? first.text : undefined;
}

/** The fixture a user message plays: an exact trigger, then its script command word, then the plain text one. */
export function fixtureForMessage(text: string): Fixture {
  const exact = Object.values(fixtures).find(
    (fixture) => !fixture.synthetic && fixture.steps.length === 1 && triggerOf(fixture) === text,
  );
  if (exact) return exact;
  const command = text.trim().split(/\s+/)[0] ?? "";
  return fixtures[COMMAND_FIXTURES[command] ?? "text"];
}
