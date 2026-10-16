import { describe, expect, it } from "vitest";
import { withCloneHint } from "./clone-hints";

describe("withCloneHint", () => {
  it.each([
    ["fatal: could not read Username for 'https://github.com'", "gh auth setup-git"],
    ["git@github.com: Permission denied (publickey).", "SSH key"],
    ["Host key verification failed.", "ssh -T git@github.com"],
    ["remote: Resource protected by organization SAML enforcement", "Authorize your token"],
  ])("explains %s", (error, hint) => {
    const result = withCloneHint(error);
    expect(result.startsWith(error)).toBe(true);
    expect(result).toContain(hint);
  });

  it("leaves other failures alone", () => {
    expect(withCloneHint("fatal: repository not found")).toBe("fatal: repository not found");
  });
});
