import { test } from "@playwright/test";

// Outside tests/: the default config must never launch its Node server for this proof.
test("artifact browser qualification requires the owned artifact runner", async () => {
  throw new Error(
    "BLOCKED: artifact execution, frontend provenance and browser assertions are not implemented",
  );
});
