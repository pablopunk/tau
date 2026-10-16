import abort from "../../fixtures/abort.json";
import bash from "../../fixtures/bash.json";
import bashFail from "../../fixtures/bash-fail.json";
import edit from "../../fixtures/edit.json";
import error from "../../fixtures/error.json";
import overflow from "../../fixtures/overflow.json";
import read from "../../fixtures/read.json";
import retired from "../../fixtures/retired.json";
import retry from "../../fixtures/retry.json";
import retryExhausted from "../../fixtures/retry-exhausted.json";
import steer from "../../fixtures/steer.json";
import text from "../../fixtures/text.json";
import thinking from "../../fixtures/thinking.json";
import write from "../../fixtures/write.json";
import type { Fixture } from "./types";

export type { Fixture, FixtureFrame, FixtureStep } from "./types";

function asFixture(json: unknown): Fixture {
  return json as Fixture;
}

export const fixtures = {
  text: asFixture(text),
  thinking: asFixture(thinking),
  read: asFixture(read),
  write: asFixture(write),
  edit: asFixture(edit),
  bash: asFixture(bash),
  "bash-fail": asFixture(bashFail),
  error: asFixture(error),
  retry: asFixture(retry),
  "retry-exhausted": asFixture(retryExhausted),
  steer: asFixture(steer),
  abort: asFixture(abort),
  overflow: asFixture(overflow),
  retired: asFixture(retired),
} as const;

export type FixtureName = keyof typeof fixtures;

export const allFixtures: readonly Fixture[] = Object.values(fixtures);
