import { type Core, PROCESS_LOG_TAIL_DEFAULT, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { defineRoute } from "./define-route";
import { registerConnectorRoutes } from "./register-connector-routes";

function registerThreadRoutes(app: FastifyInstance, core: Core): void {
  const { conversations, workspaces } = core;
  defineRoute(app, routes.forkConversation, ({ params, body }) =>
    conversations.fork(params.id, body.entryId),
  );
  defineRoute(app, routes.rewindPreview, ({ params, body }) =>
    conversations.rewindPreview(params.id, body.entryId),
  );
  defineRoute(app, routes.rewindConversation, ({ params, body }) =>
    conversations.rewind(params.id, body.entryId),
  );
  defineRoute(app, routes.stopAgent, ({ params }) => conversations.stopAgent(params.id));
  defineRoute(app, routes.cancelQueued, ({ params }) => conversations.cancelQueued(params.id, params.itemId));
  defineRoute(app, routes.listCheckpoints, ({ params }) => conversations.checkpoints(params.id));
  defineRoute(app, routes.getCheckpointDiff, async ({ params, query }) => ({
    diff: await conversations.checkpointDiff(params.id, params.cid, query.path),
  }));
  defineRoute(app, routes.getWorkspace, ({ params }) => workspaces.status(params.id));
  defineRoute(app, routes.mergeWorkspace, ({ params }) => workspaces.merge(params.id));
  defineRoute(app, routes.createPullRequest, ({ params }) => workspaces.createPullRequest(params.id));
  defineRoute(app, routes.removeWorkspace, ({ params, query }) =>
    workspaces.remove(params.id, query.force === "true"),
  );
}

function registerToolRoutes(app: FastifyInstance, core: Core): void {
  const { processes, mcp, settings, timers, goals } = core;
  defineRoute(app, routes.listProcesses, ({ params }) => processes.list(params.id));
  defineRoute(app, routes.getProcessLogs, async ({ params, query }) => ({
    logs: await processes.logs(params.id, query.tail ? Number(query.tail) : PROCESS_LOG_TAIL_DEFAULT),
  }));
  defineRoute(app, routes.stopProcess, ({ params }) => processes.stop(params.id));
  defineRoute(app, routes.backgroundToolCall, ({ params }) => processes.background(params.id, params.callId));
  defineRoute(app, routes.stopToolCall, ({ params }) => processes.stopToolCall(params.id, params.callId));
  defineRoute(app, routes.listTimers, ({ params }) => timers.list(params.id));
  defineRoute(app, routes.deleteTimer, ({ params }) => timers.delete(params.id));
  defineRoute(app, routes.startLoop, ({ params, body }) => timers.loop(params.id, body));
  defineRoute(app, routes.stopLoop, ({ params }) => timers.stopLoop(params.id));
  defineRoute(app, routes.getGoal, ({ params }) => goals.get(params.id));
  defineRoute(app, routes.setGoal, ({ params, body }) => goals.set(params.id, body.condition));
  defineRoute(app, routes.clearGoal, ({ params }) => goals.clear(params.id));
  defineRoute(app, routes.listMcpServers, ({ query }) => mcp.servers(query.projectId ?? null));
  defineRoute(app, routes.saveMcpServer, ({ params, body }) => mcp.save({ ...body, name: params.name }));
  defineRoute(app, routes.removeMcpServer, ({ params }) => mcp.remove(params.name));
  defineRoute(app, routes.setMessageMode, ({ body }) => settings.setMessageMode(body.mode));
  defineRoute(app, routes.setWorkspaceDefault, ({ body }) => settings.setWorkspaceDefault(body.mode));
}

export function registerWorkspaceRoutes(app: FastifyInstance, core: Core): void {
  registerThreadRoutes(app, core);
  registerToolRoutes(app, core);
  registerConnectorRoutes(app, core);
}
