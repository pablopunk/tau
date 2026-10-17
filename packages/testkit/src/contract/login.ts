import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export const VALID_CALLBACK_URL = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";
const WRONG_ORIGIN_URL = "http://example.com/auth/callback?code=ok&state=faux";
const MAX_ATTEMPTS = 5;

export function loginCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("login", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[login] starts a session that waits with a sign-in url", async () => {
      const { core } = target;
      const session = await core.providers.startLogin("openai");
      expect(session).toMatchObject({ provider: "openai", method: "chatgpt", state: "waiting", error: null });
      expect(session.authUrl).toMatch(/^https:\/\//);
      expect(await core.providers.login(session.id)).toEqual(session);
    });

    test("[login] connects ChatGPT when the callback url is pasted, and announces it", async () => {
      const { core } = target;
      const session = await core.providers.startLogin("openai");
      const { changes, stop } = collectChanges(core);
      const done = await core.providers.submitLoginUrl(session.id, VALID_CALLBACK_URL);
      stop();
      expect(done).toMatchObject({ state: "done", error: null });
      expect(changes).toContainEqual({ resource: "providers" });
      const openai = (await core.providers.list()).find((provider) => provider.id === "openai");
      expect(openai?.connection).toMatchObject({ method: "chatgpt", source: "file" });
      expect((await core.models.list()).length).toBeGreaterThan(0);
    });

    test("[login] a wrong url keeps the session waiting with an error", async () => {
      const { core } = target;
      const session = await core.providers.startLogin("openai");
      const rejected = await core.providers.submitLoginUrl(session.id, WRONG_ORIGIN_URL);
      expect(rejected.state).toBe("waiting");
      expect(rejected.error).toEqual(expect.any(String));
      const done = await core.providers.submitLoginUrl(session.id, VALID_CALLBACK_URL);
      expect(done.state).toBe("done");
    });

    test("[login] fails after five wrong urls, then rejects more with login_failed", async () => {
      const { core } = target;
      const session = await core.providers.startLogin("openai");
      let last = session;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        last = await core.providers.submitLoginUrl(session.id, WRONG_ORIGIN_URL);
      }
      expect(last.state).toBe("failed");
      expect(await core.providers.login(session.id)).toMatchObject({ state: "failed" });
      await rejectsWithCode(core.providers.submitLoginUrl(session.id, VALID_CALLBACK_URL), "login_failed");
    });

    test("[login] cancel is idempotent, and a new login cancels the old one", async () => {
      const { core } = target;
      const first = await core.providers.startLogin("openai");
      const second = await core.providers.startLogin("openai");
      expect((await core.providers.login(first.id)).state).toBe("cancelled");
      await core.providers.cancelLogin(second.id);
      await core.providers.cancelLogin(second.id);
      expect((await core.providers.login(second.id)).state).toBe("cancelled");
    });

    test("[login] rejects an unknown session with not_found", async () => {
      const { core } = target;
      await rejectsWithCode(core.providers.login("nope"), "not_found");
      await rejectsWithCode(core.providers.submitLoginUrl("nope", VALID_CALLBACK_URL), "not_found");
    });
  });
}
