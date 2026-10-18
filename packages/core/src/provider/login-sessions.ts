import type { Models } from "@earendil-works/pi-ai/models";
import { AppError, type LoginSession } from "@tau/protocol";
import { readOrCreateDeviceId } from "../auth/device-id";
import type { ChangeEmitter } from "../change-emitter";
import { callbackUrlProblem } from "./callback-url";
import { isTerminal, type LoginRecord, newLoginRecord } from "./login-session-record";

export const MAX_URL_ATTEMPTS = 5;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const DROP_AFTER_TERMINAL_MS = 60 * 1000;

export interface LoginSessions {
  start(): Promise<LoginSession>;
  get(sessionId: string): Promise<LoginSession>;
  submitUrl(sessionId: string, url: string): Promise<LoginSession>;
  cancel(sessionId: string): Promise<void>;
}

export interface LoginSessionsDeps {
  readonly models: Pick<Models, "login">;
  readonly changes: ChangeEmitter;
  readonly deviceIdFile: string;
  readonly timeoutMs?: number;
  readonly dropAfterMs?: number;
}

type Terminal = "done" | "failed" | "cancelled";

const snapshot = (record: LoginRecord): LoginSession => ({ ...record.session });
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createLoginSessions(deps: LoginSessionsDeps): LoginSessions {
  const records = new Map<string, LoginRecord>();
  const dropAfterMs = deps.dropAfterMs ?? DROP_AFTER_TERMINAL_MS;
  let active: LoginRecord | undefined;

  function requireRecord(sessionId: string): LoginRecord {
    const record = records.get(sessionId);
    if (!record) throw new AppError("not_found", "This sign-in session does not exist.");
    return record;
  }

  function dropLater(record: LoginRecord) {
    const drop = setTimeout(() => records.delete(record.session.id), dropAfterMs);
    drop.unref();
    record.timers = [drop];
  }

  function finish(record: LoginRecord, state: Terminal, error: string | null) {
    if (isTerminal(record)) return;
    record.session = { ...record.session, state, error };
    record.timers.forEach(clearTimeout);
    record.firstEvent.resolve();
    dropLater(record);
    if (state === "done") deps.changes.emit({ resource: "providers" });
  }

  function failAndAbort(record: LoginRecord, error: string) {
    finish(record, "failed", error);
    record.controller.abort();
  }

  function interactionOf(record: LoginRecord) {
    return {
      signal: record.controller.signal,
      notify(event: { type: string; url?: string }) {
        if (event.type !== "auth_url" || !event.url || isTerminal(record)) return;
        record.session = { ...record.session, state: "waiting", authUrl: event.url };
        record.firstEvent.resolve();
      },
      async prompt(prompt: { type: string }): Promise<string> {
        if (prompt.type !== "manual_code") {
          failAndAbort(record, "The sign-in asked for something this app cannot provide.");
          throw new Error("Unsupported sign-in prompt");
        }
        return record.pastedUrl.promise;
      },
    };
  }

  async function runLogin(record: LoginRecord, deviceId: string): Promise<void> {
    try {
      await deps.models.login("openai", "oauth", interactionOf(record) as never, {
        getDeviceId: () => deviceId,
        agentName: "tau",
      });
      finish(record, "done", null);
    } catch (error) {
      finish(record, "failed", messageOf(error));
    }
  }

  function armTimeout(record: LoginRecord) {
    const timer = setTimeout(
      () => failAndAbort(record, "Sign-in timed out. Start again."),
      deps.timeoutMs ?? LOGIN_TIMEOUT_MS,
    );
    timer.unref();
    record.timers.push(timer);
  }

  async function cancelRecord(record: LoginRecord): Promise<void> {
    finish(record, "cancelled", null);
    record.controller.abort();
    record.pastedUrl.reject(new Error("Sign-in cancelled"));
    await record.settled;
  }

  async function start(): Promise<LoginSession> {
    if (active) await cancelRecord(active);
    const deviceId = await readOrCreateDeviceId(deps.deviceIdFile);
    const record = newLoginRecord();
    active = record;
    records.set(record.session.id, record);
    armTimeout(record);
    record.settled = runLogin(record, deviceId);
    await record.firstEvent.promise;
    return snapshot(record);
  }

  async function abortAfterTooManyAttempts(record: LoginRecord, problem: string) {
    failAndAbort(record, problem);
    record.pastedUrl.reject(new Error(problem));
    await record.settled;
  }

  async function submitUrl(sessionId: string, url: string): Promise<LoginSession> {
    const record = requireRecord(sessionId);
    if (record.session.state !== "waiting") {
      throw new AppError("login_failed", "This sign-in is not waiting for a URL.");
    }
    const problem = callbackUrlProblem(url.trim());
    if (problem === null) {
      record.pastedUrl.resolve(url.trim());
      await record.settled;
      return snapshot(record);
    }
    record.attempts += 1;
    if (record.attempts >= MAX_URL_ATTEMPTS) await abortAfterTooManyAttempts(record, problem);
    else record.session = { ...record.session, error: problem };
    return snapshot(record);
  }

  return {
    start,
    async get(sessionId) {
      return snapshot(requireRecord(sessionId));
    },
    submitUrl,
    async cancel(sessionId) {
      const record = records.get(sessionId);
      if (record) await cancelRecord(record);
    },
  };
}
