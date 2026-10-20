import {
  AppError,
  type Core,
  iconCandidateUrl,
  type ProviderId,
  routes,
  type UpdateStatus,
} from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import type { DeviceSockets } from "../security/device-sockets";
import { OWNER_DEVICE_ID } from "../security/guard";
import { requireCandidateName } from "./candidate-name";
import { defineImageRoute } from "./define-image-route";
import { defineRoute } from "./define-route";
import { registerResourceRoutes } from "./register-resource-routes";
import { registerTerminalRoutes } from "./register-terminal-routes";
import { registerWorkspaceRoutes } from "./register-workspace-routes";

function startLoginFor(core: Core, id: ProviderId) {
  if (id !== "openai") throw new AppError("invalid_request", "This provider has no sign-in.");
  return core.providers.startLogin(id);
}

/** Non-owners never learn the install command or the updater log (paths, registry URLs), and cannot update. */
export function updateStatusFor(status: UpdateStatus, deviceId: string): UpdateStatus {
  if (deviceId === OWNER_DEVICE_ID) return status;
  return {
    ...status,
    canUpdate: false,
    install: { ...status.install, command: null },
    job: { ...status.job, logTail: null },
  };
}

export function registerRoutes(app: FastifyInstance, core: Core, sockets: DeviceSockets): void {
  defineRoute(app, routes.suggestDirectories, ({ body }) => core.fs.suggestDirectories(body));
  defineRoute(app, routes.getUpdateStatus, async (_input, request) =>
    updateStatusFor(await core.updates.status(), request.deviceId),
  );
  defineRoute(app, routes.refreshUpdateStatus, async (_input, request) =>
    updateStatusFor(await core.updates.refresh(), request.deviceId),
  );
  defineRoute(
    app,
    routes.startUpdate,
    async ({ body }, request) => updateStatusFor(await core.updates.start(body), request.deviceId),
    { ownerOnly: true },
  );
  defineRoute(app, routes.getSettings, () => core.settings.get());
  defineRoute(app, routes.setDefaultModel, ({ body }) => core.settings.setDefaultModel(body));
  defineRoute(app, routes.setDefaultThinking, ({ body }) =>
    core.settings.setDefaultThinkingLevel(body.thinkingLevel),
  );
  defineRoute(app, routes.setFastThinking, ({ body }) =>
    core.settings.setFastThinkingLevel(body.thinkingLevel),
  );
  defineRoute(app, routes.setFastModel, ({ body }) => core.settings.setFastModel(body.model));
  defineRoute(app, routes.setSetupSkipped, ({ body }) => core.settings.setSetupSkipped(body.skipped));
  defineRoute(app, routes.setProjectsFolder, ({ body }) => core.settings.setProjectsFolder(body.path));
  defineRoute(app, routes.getSuggestedCodeFolder, () => core.settings.suggestedCodeFolder());
  defineRoute(app, routes.getGithubStatus, () => core.github.status());
  defineRoute(app, routes.listGithubRepos, () => core.github.repos());
  defineRoute(app, routes.refreshGithubRepos, () => core.github.refreshRepos());
  defineRoute(app, routes.useGithubRepo, ({ body }) => core.github.use(body));
  defineRoute(app, routes.listProviders, () => core.providers.list());
  defineRoute(app, routes.setProviderKey, ({ params, body }) =>
    core.providers.setApiKey(params.id, body.key),
  );
  defineRoute(app, routes.disconnectProvider, ({ params }) => core.providers.disconnect(params.id));
  defineRoute(app, routes.acknowledgeClaudeCli, () => core.providers.acknowledgeClaudeCli());
  defineRoute(app, routes.refreshClaudeCli, () => core.providers.refreshClaudeCli());
  defineRoute(app, routes.installClaudeCliSdk, () => core.providers.installClaudeCliSdk());
  defineRoute(app, routes.startLogin, ({ params }) => startLoginFor(core, params.id));
  defineRoute(app, routes.getLogin, ({ params }) => core.providers.login(params.sid));
  defineRoute(app, routes.submitLoginUrl, ({ params, body }) =>
    core.providers.submitLoginUrl(params.sid, body.url),
  );
  defineRoute(app, routes.cancelLogin, ({ params }) => core.providers.cancelLogin(params.sid));
  defineRoute(app, routes.listModels, () => core.models.list());
  defineRoute(app, routes.listSkills, ({ query }) => core.skills.list(query.projectId ?? null));
  defineRoute(app, routes.suggestProjectFiles, ({ params, body }) =>
    core.projects.suggestFiles(params.id, body.query),
  );
  defineRoute(app, routes.listProjects, () => core.projects.list());
  defineRoute(app, routes.addProject, ({ body }) => core.projects.add(body));
  defineRoute(app, routes.cloneProject, ({ body }) => core.projects.clone(body));
  defineRoute(app, routes.retryClone, ({ params }) => core.projects.retryClone(params.id));
  defineRoute(app, routes.setProjectFolder, ({ params, body }) =>
    core.projects.setFolder(params.id, body.path),
  );
  defineRoute(app, routes.renameProject, ({ params, body }) => core.projects.rename(params.id, body.name));
  defineRoute(app, routes.removeProject, ({ params }) => core.projects.remove(params.id));
  defineImageRoute(app, routes.getProjectIcon, ({ params }) => core.projects.icon(params.id));
  defineRoute(app, routes.setProjectIcon, ({ params, body }) =>
    core.projects.setIcon(params.id, new Uint8Array(Buffer.from(body.png, "base64"))),
  );
  defineRoute(app, routes.resetProjectIcon, ({ params }) => core.projects.setIcon(params.id, null));
  defineRoute(app, routes.listIconCandidates, async ({ params }) =>
    (await core.projects.iconCandidates(params.id)).map(({ name }) => ({
      name,
      url: iconCandidateUrl(params.id, name),
    })),
  );
  defineImageRoute(app, routes.getIconCandidate, ({ params, query }) =>
    core.projects.iconCandidate(params.id, requireCandidateName(query.name)),
  );
  defineRoute(app, routes.listConversations, ({ params }) => core.conversations.list(params.id));
  defineRoute(app, routes.listAllConversations, () => core.conversations.listAll());
  defineRoute(app, routes.deleteArchivedConversations, ({ body }) => core.conversations.deleteArchived(body));
  defineRoute(app, routes.startConversation, ({ body }) => core.conversations.start(body));
  defineRoute(app, routes.renameConversation, ({ params, body }) =>
    core.conversations.rename(params.id, body.title),
  );
  defineRoute(app, routes.sendMessage, ({ params, body }) => core.conversations.send(params.id, body));
  defineRoute(app, routes.abortConversation, ({ params }) => core.conversations.abort(params.id));
  defineRoute(app, routes.archiveConversation, ({ params, body }) =>
    core.conversations.archive(params.id, body.archived),
  );
  defineRoute(app, routes.removeConversation, ({ params, query }) =>
    core.conversations.remove(params.id, { force: query.force === "true" }),
  );
  defineRoute(app, routes.configureConversation, ({ params, body }) =>
    core.conversations.configure(params.id, body),
  );
  defineRoute(app, routes.compactConversation, ({ params, body }) =>
    core.conversations.compact(params.id, body),
  );
  defineRoute(app, routes.retryConversation, ({ params, body }) => core.conversations.retry(params.id, body));
  registerWorkspaceRoutes(app, core);
  registerResourceRoutes(app, core);
  registerTerminalRoutes(app, core, sockets);
}
