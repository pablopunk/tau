import { type Core, iconCandidateUrl, routes } from "@pi-everywhere/protocol";
import type { FastifyInstance } from "fastify";
import { requireCandidateName } from "./candidate-name";
import { defineImageRoute } from "./define-image-route";
import { defineRoute } from "./define-route";

export function registerRoutes(app: FastifyInstance, core: Core): void {
  defineRoute(app, routes.getSettings, () => core.settings.get());
  defineRoute(app, routes.setDefaultModel, ({ body }) => core.settings.setDefaultModel(body));
  defineRoute(app, routes.setFastModel, ({ body }) => core.settings.setFastModel(body.model));
  defineRoute(app, routes.setProjectsFolder, ({ body }) => core.settings.setProjectsFolder(body.path));
  defineRoute(app, routes.getSuggestedCodeFolder, () => core.settings.suggestedCodeFolder());
  defineRoute(app, routes.getGithubStatus, () => core.github.status());
  defineRoute(app, routes.listGithubRepos, () => core.github.repos());
  defineRoute(app, routes.refreshGithubRepos, () => core.github.refreshRepos());
  defineRoute(app, routes.useGithubRepo, ({ body }) => core.github.use(body));
  defineRoute(app, routes.getProvider, () => core.provider.status());
  defineRoute(app, routes.setProviderKey, ({ body }) => core.provider.setApiKey(body.key));
  defineRoute(app, routes.listModels, () => core.provider.listModels());
  defineRoute(app, routes.listProjects, () => core.projects.list());
  defineRoute(app, routes.addProject, ({ body }) => core.projects.add(body));
  defineRoute(app, routes.cloneProject, ({ body }) => core.projects.clone(body));
  defineRoute(app, routes.retryClone, ({ params }) => core.projects.retryClone(params.id));
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
  defineRoute(app, routes.startConversation, ({ body }) => core.conversations.start(body));
  defineRoute(app, routes.renameConversation, ({ params, body }) =>
    core.conversations.rename(params.id, body.title),
  );
  defineRoute(app, routes.sendMessage, ({ params, body }) => core.conversations.send(params.id, body));
  defineRoute(app, routes.abortConversation, ({ params }) => core.conversations.abort(params.id));
  defineRoute(app, routes.archiveConversation, ({ params, body }) =>
    core.conversations.archive(params.id, body.archived),
  );
  defineRoute(app, routes.removeConversation, ({ params }) => core.conversations.remove(params.id));
  defineRoute(app, routes.configureConversation, ({ params, body }) =>
    core.conversations.configure(params.id, body),
  );
  defineRoute(app, routes.retryConversation, ({ params, body }) => core.conversations.retry(params.id, body));
}
