import { type GoalVerdict, GoalVerdictSchema } from "@tau/protocol";
import { Value } from "typebox/value";

export type ParsedVerdict = { verdict: GoalVerdict; reason: string };

const firstJsonObject = (text: string): string | undefined => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
};

/** Undefined when the answer is not the JSON the judge prompt asks for. */
export function parseVerdict(answer: string): ParsedVerdict | undefined {
  const json = firstJsonObject(answer);
  if (json === undefined) return undefined;
  try {
    const value = JSON.parse(json) as { verdict?: unknown; reason?: unknown };
    if (!Value.Check(GoalVerdictSchema, value.verdict)) return undefined;
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    return { verdict: value.verdict, reason: reason || "No reason given." };
  } catch {
    return undefined;
  }
}
