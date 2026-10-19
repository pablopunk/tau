import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRestartResume } from "./restart-resume";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let file: string;

beforeEach(async () => {
  file = join(await tempDir(), "interrupted-runs.json");
});

function setup(busy: string[], retry = vi.fn().mockResolvedValue("project")) {
  const conversations = { busyIds: vi.fn().mockResolvedValue(busy), retry };
  const resume = createRestartResume({ file, conversations, now: () => 500, log: () => undefined });
  return { resume, retry };
}

describe("restart resume", () => {
  it("retries each thread that was running at shutdown, once", async () => {
    const first = setup(["5", "9"]);
    await first.resume.markRunning();
    const second = setup([]);
    await second.resume.resumeAtStartup();
    await second.resume.resumeAtStartup();
    expect(second.retry.mock.calls.map(([id, input]) => [id, input.requestId])).toEqual([
      ["5", "restart-resume-500-5"],
      ["9", "restart-resume-500-9"],
    ]);
    expect(existsSync(file)).toBe(false);
  });

  it("writes nothing when no thread is running, so a Stop is never retried", async () => {
    const { resume } = setup([]);
    await resume.markRunning();
    expect(existsSync(file)).toBe(false);
  });

  it("keeps going when one thread cannot be retried", async () => {
    const retry = vi.fn().mockRejectedValueOnce(new Error("nothing to retry")).mockResolvedValue("project");
    const { resume } = setup(["1", "2"], retry);
    await resume.markRunning();
    await resume.resumeAtStartup();
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("ignores a corrupt file", async () => {
    writeFileSync(file, "{nope");
    const { resume, retry } = setup([]);
    await resume.resumeAtStartup();
    expect(retry).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });
});
