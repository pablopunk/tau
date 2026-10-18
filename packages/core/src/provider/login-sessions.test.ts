import { join } from "node:path";
import type { Change } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { FileCredentialStore } from "../auth/file-credential-store";
import { createChangeEmitter } from "../change-emitter";
import { useTempDir } from "../test-support/temp-dir";
import { FAUX_CALLBACK_URL } from "../testing/faux-chatgpt-login";
import { createFauxSetup } from "../testing/faux-provider";
import { createLoginSessions, MAX_URL_ATTEMPTS } from "./login-sessions";

const tempDir = useTempDir();
const WRONG_ORIGIN = "http://evil.example/auth/callback?code=ok&state=faux";

async function sessionsWith(options: { timeoutMs?: number; dropAfterMs?: number } = {}) {
  const dir = await tempDir();
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const { models } = createFauxSetup({ credentials });
  const changes: Change[] = [];
  const emitter = createChangeEmitter();
  emitter.subscribe((change) => changes.push(change));
  const sessions = createLoginSessions({
    models,
    changes: emitter,
    deviceIdFile: join(dir, "device-id"),
    ...options,
  });
  return { sessions, credentials, changes };
}

describe("login sessions", () => {
  it("waits with the sign-in url once started", async () => {
    const { sessions } = await sessionsWith();
    const session = await sessions.start();
    expect(session).toMatchObject({ provider: "openai", method: "chatgpt", state: "waiting", error: null });
    expect(session.authUrl).toMatch(/^https:\/\//);
    expect(await sessions.get(session.id)).toEqual(session);
  });

  it("finishes with a pasted callback url, stores the credential and announces it", async () => {
    const { sessions, credentials, changes } = await sessionsWith();
    const session = await sessions.start();
    const done = await sessions.submitUrl(session.id, FAUX_CALLBACK_URL);
    expect(done).toMatchObject({ state: "done", error: null });
    expect((await credentials.read("openai"))?.type).toBe("oauth");
    expect(changes).toEqual([{ resource: "providers" }]);
  });

  it("keeps waiting after a url with the wrong origin, then accepts the right one", async () => {
    const { sessions } = await sessionsWith();
    const session = await sessions.start();
    const rejected = await sessions.submitUrl(session.id, WRONG_ORIGIN);
    expect(rejected.state).toBe("waiting");
    expect(rejected.error).toContain("http://127.0.0.1:1455/auth/callback");
    expect(await sessions.submitUrl(session.id, "not a url")).toMatchObject({ state: "waiting" });
    expect(await sessions.submitUrl(session.id, FAUX_CALLBACK_URL)).toMatchObject({
      state: "done",
      error: null,
    });
  });

  it("fails on the fifth wrong url and then rejects more with login_failed", async () => {
    const { sessions } = await sessionsWith();
    const session = await sessions.start();
    let last = session;
    for (let attempt = 0; attempt < MAX_URL_ATTEMPTS; attempt += 1) {
      last = await sessions.submitUrl(session.id, WRONG_ORIGIN);
    }
    expect(last.state).toBe("failed");
    expect(last.error).not.toBeNull();
    await expect(sessions.submitUrl(session.id, FAUX_CALLBACK_URL)).rejects.toMatchObject({
      code: "login_failed",
    });
  });

  it("fails when pi rejects a well-formed url (state mismatch)", async () => {
    const { sessions } = await sessionsWith();
    const session = await sessions.start();
    const failed = await sessions.submitUrl(
      session.id,
      "http://127.0.0.1:1455/auth/callback?code=x&state=no",
    );
    expect(failed).toMatchObject({ state: "failed", error: "OAuth state mismatch" });
  });

  it("cancels, and cancelling again or an unknown id is fine", async () => {
    const { sessions, changes } = await sessionsWith();
    const session = await sessions.start();
    await sessions.cancel(session.id);
    await sessions.cancel(session.id);
    await sessions.cancel("nope");
    expect(await sessions.get(session.id)).toMatchObject({ state: "cancelled", error: null });
    expect(changes).toEqual([]);
  });

  it("cancels the old session when a new one starts", async () => {
    const { sessions } = await sessionsWith();
    const first = await sessions.start();
    const second = await sessions.start();
    expect((await sessions.get(first.id)).state).toBe("cancelled");
    expect((await sessions.get(second.id)).state).toBe("waiting");
  });

  it("rejects an unknown session with not_found", async () => {
    const { sessions } = await sessionsWith();
    await expect(sessions.get("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(sessions.submitUrl("nope", FAUX_CALLBACK_URL)).rejects.toMatchObject({ code: "not_found" });
  });

  it("fails a session that waits past the timeout", async () => {
    const { sessions } = await sessionsWith({ timeoutMs: 20 });
    const session = await sessions.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await sessions.get(session.id)).toMatchObject({ state: "failed" });
  });

  it("drops a session shortly after it ends", async () => {
    const { sessions } = await sessionsWith({ dropAfterMs: 20 });
    const session = await sessions.start();
    await sessions.cancel(session.id);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(sessions.get(session.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
