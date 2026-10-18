import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ConversationSummary, Project, ThreadWorkspace } from "@tau/protocol";
import { legacyWorkspace } from "../harness/conversation-index";
import type { ConversationStore } from "../harness/conversation-store";
import { createWorkspaceService, type WorkspaceDeps } from "./workspace-service";

const run = promisify(execFile);
const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

export const git = async (cwd: string, ...args: string[]) =>
  (await run("git", [...identity, "-C", cwd, ...args])).stdout.trim();

export async function makeRepo(options: { subfolder?: string } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "tau-workspaces-")));
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  await git(repo, "init", "--quiet", "-b", "main");
  await writeFile(join(repo, "hello.txt"), "hello\n");
  if (options.subfolder) {
    await mkdir(join(repo, options.subfolder), { recursive: true });
    await writeFile(join(repo, options.subfolder, "app.txt"), "app\n");
  }
  await git(repo, "add", ".");
  await git(repo, "commit", "--quiet", "-m", "first");
  return { root, repo, home: join(root, "home") };
}

export const projectAt = (path: string, kind: Project["kind"] = "git"): Project => ({
  id: "p1",
  name: "repo",
  path,
  createdAt: 0,
  kind,
  status: "ready",
  isGitRepo: kind === "git",
});

export async function commitFile(cwd: string, name: string, content: string) {
  await writeFile(join(cwd, name), content);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "--quiet", "-m", `change ${name}`);
}

export function fakeConversations() {
  const threads = new Map<string, ConversationSummary>();
  const store = {
    find: async (id: string) => threads.get(id),
    list: async () => [...threads.values()],
    setWorkspace: async (id: string, workspace: ThreadWorkspace) => {
      const thread = threads.get(id);
      if (!thread) throw new Error("unknown");
      const updated = { ...thread, workspace };
      threads.set(id, updated);
      return updated;
    },
  } as unknown as ConversationStore;
  const add = (workspace: ThreadWorkspace, status: ConversationSummary["status"] = "idle") => {
    const id = String(threads.size + 1);
    const thread = {
      id,
      projectId: "p1",
      title: "Thread",
      status,
      workspace,
    } as unknown as ConversationSummary;
    threads.set(id, thread);
    return thread;
  };
  const setStatus = (id: string, status: ConversationSummary["status"]) => {
    const thread = threads.get(id);
    if (thread) threads.set(id, { ...thread, status });
  };
  return { store, add, setStatus };
}

export async function setUp(options: { subfolder?: string; deps?: Partial<WorkspaceDeps> } = {}) {
  const repo = await makeRepo(options);
  const conversations = fakeConversations();
  const service = createWorkspaceService({
    home: repo.home,
    conversations: conversations.store,
    ...options.deps,
  });
  const projectPath = options.subfolder ? join(repo.repo, options.subfolder) : repo.repo;
  const startThread = async (message = "add feature") => {
    const workspace = await service.create({
      project: projectAt(projectPath),
      mode: "worktree",
      requestId: `req-${message}-${Math.random()}`,
      firstMessage: message,
    });
    return conversations.add(workspace);
  };
  return { ...repo, ...conversations, service, projectPath, startThread, legacy: legacyWorkspace };
}
