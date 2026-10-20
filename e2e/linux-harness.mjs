// Linux verification harness: runs on the target box (node >= 24) against a built tau CLI.
// Usage from a scenario: const t = await startTau({ replies: { prompt: [{tools:[{name:"bash",arguments:{command}}]},{text:"ok"}] } })
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const sh = (cmd, opts = {}) => {
  try {
    return execFileSync("/bin/sh", ["-c", cmd], { encoding: "utf8", ...opts }).trimEnd();
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`.trimEnd() || `rc=${e.status}`;
  }
};
export const ALL_ON = { main: true, worktrees: true, subagents: true };
export const OFF = { priority: "off", heavySlots: null, memoryLimitMb: null, appliesTo: ALL_ON };

const freePort = async () => {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
};

export async function startTau({
  root: root0,
  replies = {},
  env = {},
  unset = [],
  cli = process.env.TAU_CLI,
  node = process.execPath,
} = {}) {
  const reuse = root0 !== undefined;
  const root = root0 ?? mkdtempSync(join(tmpdir(), "tau-vl-"));
  const repo = join(root, "code");
  if (!reuse) mkdirSync(repo);
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "E",
    GIT_AUTHOR_EMAIL: "e@e.io",
    GIT_COMMITTER_NAME: "E",
    GIT_COMMITTER_EMAIL: "e@e.io",
  };
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore", env: gitEnv });
  if (!reuse) {
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "# vl\n");
    git("add", ".");
    git("commit", "-q", "-m", "first");
  }
  writeFileSync(join(root, "replies.json"), JSON.stringify(replies));
  const port = await freePort();
  const state = join(root, "state");
  if (!reuse) mkdirSync(join(root, "home"));
  const childEnv = {
    ...process.env,
    HOME: join(root, "home"),
    TAU_FAUX_REPLIES: join(root, "replies.json"),
    TAU_FAKE_CLAUDE_CLI: "1",
    ...env,
  };
  for (const key of unset) delete childEnv[key];
  const child = spawn(node, [cli, "serve", "--faux", "--no-open", "--port", String(port), "--home", state], {
    env: childEnv,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    if (
      await fetch(url).then(
        () => true,
        () => false,
      )
    )
      break;
    await sleep(200);
  }
  const token = readFileSync(join(state, "token"), "utf8").trim();
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(url + path, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    return {
      status: res.status,
      json: text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return text;
            }
          })()
        : null,
    };
  };
  await call("GET", `/?token=${encodeURIComponent(token)}`);
  await call("PUT", "/api/providers/openrouter/key", { key: "sk-or-v1-faux" });
  await call("PUT", "/api/settings/default-model", { provider: "faux", modelId: "faux-1" });
  const created = await call("POST", "/api/projects", { path: repo });
  const projectId = created.json.id ?? (await call("GET", "/api/projects")).json[0].id;
  let n = 0;
  const t = {
    root,
    repo,
    state,
    url,
    child,
    call,
    projectId,
    pid: child.pid,
    setResources: (value) => call("PUT", "/api/settings/resources", value),
    activity: async () => (await call("GET", "/api/settings/resources/activity")).json,
    support: async () => (await call("GET", "/api/settings/resources/support")).json,
    async thread(prompt) {
      const r = await call("POST", "/api/conversations", {
        projectId,
        text: prompt,
        requestId: `r-${++n}-${Date.now()}`,
      });
      return r.json.id;
    },
    status: async (id) => (await call("GET", "/api/conversations")).json.find((c) => c.id === id)?.status,
    async done(id, timeoutMs = 60000) {
      const t0 = Date.now();
      await sleep(500);
      while (Date.now() - t0 < timeoutMs) {
        const s = await t.status(id);
        if (s && s !== "running") return Date.now() - t0;
        await sleep(200);
      }
      throw new Error(`thread ${id} still running`);
    },
    abort: (id) => call("POST", `/api/conversations/${id}/abort`),
    /** Lines of the persisted store (tool results live there) that mention `text`. */
    stored: (text) =>
      sh(`grep -rahoE '.{0,120}${text}.{0,160}' ${JSON.stringify(state)} 2>/dev/null | head -3`),
    async stop(keep = false) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await Promise.race([exited, sleep(8000)]);
      child.kill("SIGKILL");
      if (!keep) rmSync(root, { recursive: true, force: true });
    },
  };
  return t;
}

export const bash = (command) => [
  { tools: [{ name: "bash", arguments: { command } }] },
  { text: "finished" },
];
export const units = () => sh("systemctl --user list-units 'tau-*' 'run-*.scope' --all --no-legend");
export const log = (title, body) =>
  console.log(`\n### ${title}\n${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`);
