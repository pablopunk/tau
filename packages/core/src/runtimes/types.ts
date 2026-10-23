import type {
  AdmissionReceipt,
  CancelReceipt,
  ExecutorKind,
  ObserveFrame,
  ProjectionCursor,
  ReconcileOutcome,
  RuntimeCapabilities,
  RuntimeLifecycle,
  WriterState,
} from "@tau/protocol";
import { isSafeToDestroy } from "@tau/protocol";

export type RuntimePayload = {
  readonly text: string;
  readonly attachmentIds: readonly string[];
  readonly origin: "user" | "timer" | "notification" | "child-report";
  readonly delivery: "queue" | "steer" | "send-now";
};

export type AdmitRequest = {
  threadId: string;
  requestId: string;
  payload: RuntimePayload;
};

export type RuntimeInspection = {
  executor: ExecutorKind;
  capabilities: RuntimeCapabilities;
  lifecycle: RuntimeLifecycle | undefined;
  writer: WriterState;
  unresolvedOutcomes: number;
  cursor: ProjectionCursor;
};

export type CancelRequest = {
  threadId: string;
  operationId: string;
};

export interface RuntimeExecutor {
  readonly executor: ExecutorKind;
  admit(req: AdmitRequest): Promise<AdmissionReceipt>;
  inspect(threadId: string): Promise<RuntimeInspection>;
  observe(threadId: string, from: ProjectionCursor | undefined): AsyncIterable<ObserveFrame>;
  cancel(req: CancelRequest): Promise<CancelReceipt>;
  reconcile(threadId: string, epoch: number): Promise<ReconcileOutcome>;
  capabilities(threadId: string): Promise<RuntimeCapabilities>;
}

export type RuntimeLifecyclePort = {
  inspectWriter(threadId: string): Promise<WriterState>;
};

export type WorkspaceWriterPort = {
  writersOf(workspaceKey: string): Promise<readonly { threadId: string; state: WriterState }[]>;
};

export function safeToDestroyAll(writers: readonly { state: WriterState }[]): boolean {
  return writers.every((writer) => isSafeToDestroy(writer.state));
}
