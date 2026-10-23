export type ExecutorKind = "pi" | "claude-code";

export type MarkName =
  | "submit"
  | "receipt"
  | "launch"
  | "firstEvent"
  | "firstText"
  | "terminal"
  | "failureCancel";

/** Local monotonic clock readings in milliseconds; only differences of marks of one sample are ever used. */
export type Marks = Partial<Record<MarkName, number>>;

export interface StageDefinition {
  readonly name: string;
  readonly from: MarkName;
  readonly to: MarkName;
  readonly description: string;
}

export const TOTAL_STAGE = "total";

const SUBMIT_TO_RECEIPT: StageDefinition = {
  name: "submitToReceipt",
  from: "submit",
  to: "receipt",
  description: "conversations.start is called until it resolves with the admitted thread",
};

const TERMINAL_OUTCOME: StageDefinition = {
  name: "terminalOutcome",
  from: "firstText",
  to: "terminal",
  description:
    "first assistant text until the benchmark observes the run ended (lastRunEndedAt) through conversations.list",
};

export const STAGES: Readonly<Record<ExecutorKind, readonly StageDefinition[]>> = {
  pi: [
    SUBMIT_TO_RECEIPT,
    {
      name: "firstAssistantText",
      from: "receipt",
      to: "firstText",
      description: "receipt until the watched thread view first contains nonempty assistant text",
    },
    TERMINAL_OUTCOME,
  ],
  "claude-code": [
    SUBMIT_TO_RECEIPT,
    {
      name: "preparation",
      from: "receipt",
      to: "launch",
      description:
        "receipt until the SDK query seam is invoked: pump scheduling, operation begin, workspace fence, checkpoint-before, sandbox policy, launch intent",
    },
    {
      name: "launchToFirstEvent",
      from: "launch",
      to: "firstEvent",
      description:
        "SDK query invoked until its first message reaches the controller: SDK pre-spawn work, sandbox-exec process spawn, CLI boot, first fake API round trip",
    },
    {
      name: "firstAssistantText",
      from: "firstEvent",
      to: "firstText",
      description: "first SDK message until the first assistant text (partial delta or block)",
    },
    TERMINAL_OUTCOME,
  ],
};

export const stageNamesOf = (executor: ExecutorKind): string[] => [
  ...STAGES[executor].map((stage) => stage.name),
  TOTAL_STAGE,
];

export interface Timeline {
  readonly durationsMs: Readonly<Record<string, number>>;
  /** Stages whose start or end mark was never recorded. A sample with any is a failed sample. */
  readonly missing: readonly string[];
  /** Stages whose marks are out of order or not finite. A sample with any is a failed sample. */
  readonly invalid: readonly string[];
}

const spanOf = (marks: Marks, from: MarkName, to: MarkName): number | undefined => {
  const start = marks[from];
  const end = marks[to];
  return start === undefined || end === undefined ? undefined : end - start;
};

const isValidSpan = (span: number): boolean => Number.isFinite(span) && span >= 0;

export function timelineOf(
  executor: ExecutorKind,
  marks: Marks,
  domains?: Partial<Record<MarkName, string>>,
): Timeline {
  const durationsMs: Record<string, number> = {};
  const missing: string[] = [];
  const invalid: string[] = [];
  const stages = [
    ...STAGES[executor],
    { name: TOTAL_STAGE, from: "submit", to: "terminal" } as const,
  ] as readonly Pick<StageDefinition, "name" | "from" | "to">[];
  for (const { name, from, to } of stages) {
    const span = spanOf(marks, from, to);
    if (span === undefined) missing.push(name);
    else if (!isValidSpan(span) || (domains && (!domains[from] || domains[from] !== domains[to])))
      invalid.push(name);
    else durationsMs[name] = span;
  }
  return { durationsMs, missing, invalid };
}

export const isCompleteTimeline = (timeline: Timeline): boolean =>
  timeline.missing.length === 0 && timeline.invalid.length === 0;
