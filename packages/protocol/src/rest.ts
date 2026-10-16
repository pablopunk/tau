import { type TSchema, Type } from "typebox";
import {
  ConfigureConversationInputSchema,
  ConversationSummarySchema,
  GithubRepoSchema,
  GithubStatusSchema,
  IconCandidateLinkSchema,
  ModelInfoSchema,
  ModelRefSchema,
  ProjectSchema,
  ProviderStatusSchema,
  RetryInputSchema,
  SendMessageInputSchema,
  SettingsSchema,
  StartConversationInputSchema,
  SuggestedCodeFolderSchema,
  UseGithubRepoInputSchema,
} from "./entities";
import { ICON_BODY_LIMIT } from "./icons";

export const API_PREFIX = "/api";
export const LIVE_PATH = `${API_PREFIX}/live`;

export const MESSAGE_BODY_LIMIT = 42 * 1024 * 1024;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteDef {
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: 200 | 201 | 204;
  readonly params?: TSchema;
  readonly query?: TSchema;
  /** `image` routes answer raw bytes (cookie-authenticated GET, used as `<img src>`); the default is JSON. */
  readonly responseKind?: "json" | "image";
  readonly body?: TSchema;
  readonly response?: TSchema;
  readonly bodyLimit?: number;
}

const IdParams = Type.Object({ id: Type.String({ minLength: 1 }) });

export const routes = {
  getSettings: { method: "GET", path: `${API_PREFIX}/settings`, status: 200, response: SettingsSchema },
  setDefaultModel: {
    method: "PUT",
    path: `${API_PREFIX}/settings/default-model`,
    status: 204,
    body: ModelRefSchema,
  },
  setFastModel: {
    method: "PUT",
    path: `${API_PREFIX}/settings/fast-model`,
    status: 204,
    body: Type.Object({ model: Type.Union([ModelRefSchema, Type.Null()]) }),
  },
  setProjectsFolder: {
    method: "PUT",
    path: `${API_PREFIX}/settings/projects-folder`,
    status: 204,
    body: Type.Object({ path: Type.String({ minLength: 1 }) }),
  },
  getSuggestedCodeFolder: {
    method: "GET",
    path: `${API_PREFIX}/settings/suggested-code-folder`,
    status: 200,
    response: SuggestedCodeFolderSchema,
  },
  getGithubStatus: {
    method: "GET",
    path: `${API_PREFIX}/github/status`,
    status: 200,
    response: GithubStatusSchema,
  },
  listGithubRepos: {
    method: "GET",
    path: `${API_PREFIX}/github/repos`,
    status: 200,
    response: Type.Array(GithubRepoSchema),
  },
  refreshGithubRepos: {
    method: "POST",
    path: `${API_PREFIX}/github/repos/refresh`,
    status: 200,
    response: Type.Array(GithubRepoSchema),
  },
  useGithubRepo: {
    method: "POST",
    path: `${API_PREFIX}/github/use`,
    status: 201,
    body: UseGithubRepoInputSchema,
    response: ProjectSchema,
  },
  getProvider: { method: "GET", path: `${API_PREFIX}/provider`, status: 200, response: ProviderStatusSchema },
  setProviderKey: {
    method: "PUT",
    path: `${API_PREFIX}/provider/key`,
    status: 204,
    body: Type.Object({ key: Type.String({ minLength: 1 }) }),
  },
  listModels: {
    method: "GET",
    path: `${API_PREFIX}/models`,
    status: 200,
    response: Type.Array(ModelInfoSchema),
  },
  listProjects: {
    method: "GET",
    path: `${API_PREFIX}/projects`,
    status: 200,
    response: Type.Array(ProjectSchema),
  },
  addProject: {
    method: "POST",
    path: `${API_PREFIX}/projects`,
    status: 201,
    body: Type.Object({
      path: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
    }),
    response: ProjectSchema,
  },
  cloneProject: {
    method: "POST",
    path: `${API_PREFIX}/projects/clone`,
    status: 201,
    body: Type.Object({
      url: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String({ minLength: 1 })),
    }),
    response: ProjectSchema,
  },
  retryClone: {
    method: "POST",
    path: `${API_PREFIX}/projects/:id/retry-clone`,
    status: 204,
    params: IdParams,
  },
  renameProject: {
    method: "PATCH",
    path: `${API_PREFIX}/projects/:id`,
    status: 204,
    params: IdParams,
    body: Type.Object({ name: Type.String({ minLength: 1 }) }),
  },
  removeProject: { method: "DELETE", path: `${API_PREFIX}/projects/:id`, status: 204, params: IdParams },
  getProjectIcon: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/icon`,
    status: 200,
    params: IdParams,
    responseKind: "image",
  },
  setProjectIcon: {
    method: "PUT",
    path: `${API_PREFIX}/projects/:id/icon`,
    status: 204,
    params: IdParams,
    body: Type.Object({ png: Type.String({ minLength: 1 }) }),
    bodyLimit: ICON_BODY_LIMIT,
  },
  resetProjectIcon: {
    method: "DELETE",
    path: `${API_PREFIX}/projects/:id/icon`,
    status: 204,
    params: IdParams,
  },
  listIconCandidates: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/icon-candidates`,
    status: 200,
    params: IdParams,
    response: Type.Array(IconCandidateLinkSchema),
  },
  getIconCandidate: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/icon-candidates/file`,
    status: 200,
    params: IdParams,
    query: Type.Object({ name: Type.String({ minLength: 1 }) }),
    responseKind: "image",
  },
  listConversations: {
    method: "GET",
    path: `${API_PREFIX}/projects/:id/conversations`,
    status: 200,
    params: IdParams,
    response: Type.Array(ConversationSummarySchema),
  },
  listAllConversations: {
    method: "GET",
    path: `${API_PREFIX}/conversations`,
    status: 200,
    response: Type.Array(ConversationSummarySchema),
  },
  startConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations`,
    status: 201,
    body: StartConversationInputSchema,
    response: ConversationSummarySchema,
    bodyLimit: MESSAGE_BODY_LIMIT,
  },
  renameConversation: {
    method: "PATCH",
    path: `${API_PREFIX}/conversations/:id`,
    status: 204,
    params: IdParams,
    body: Type.Object({ title: Type.String({ minLength: 1 }) }),
  },
  sendMessage: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/messages`,
    status: 204,
    params: IdParams,
    body: SendMessageInputSchema,
    bodyLimit: MESSAGE_BODY_LIMIT,
  },
  archiveConversation: {
    method: "PUT",
    path: `${API_PREFIX}/conversations/:id/archived`,
    status: 204,
    params: IdParams,
    body: Type.Object({ archived: Type.Boolean() }),
  },
  removeConversation: {
    method: "DELETE",
    path: `${API_PREFIX}/conversations/:id`,
    status: 204,
    params: IdParams,
  },
  configureConversation: {
    method: "PATCH",
    path: `${API_PREFIX}/conversations/:id/agent`,
    status: 204,
    params: IdParams,
    body: ConfigureConversationInputSchema,
  },
  retryConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/retry`,
    status: 204,
    params: IdParams,
    body: RetryInputSchema,
  },
  abortConversation: {
    method: "POST",
    path: `${API_PREFIX}/conversations/:id/abort`,
    status: 204,
    params: IdParams,
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;
export type ImageRouteName = {
  [N in RouteName]: (typeof routes)[N] extends { responseKind: "image" } ? N : never;
}[RouteName];
export type JsonRouteName = Exclude<RouteName, ImageRouteName>;

/** The `src` of a candidate image; the name is query-encoded. */
export function iconCandidateUrl(projectId: string, name: string): string {
  const path = fillPath(routes.getIconCandidate.path, { id: projectId });
  return `${path}?name=${encodeURIComponent(name)}`;
}

type StaticOf<S> = S extends TSchema ? Type.Static<S> : never;

export type RouteInput<R extends RouteDef> = (R extends { params: infer P }
  ? { params: StaticOf<P> }
  : unknown) &
  (R extends { query: infer Q } ? { query: StaticOf<Q> } : unknown) &
  (R extends { body: infer B } ? { body: StaticOf<B> } : unknown);

export type RouteOutput<R extends RouteDef> = R extends { response: infer S } ? StaticOf<S> : undefined;

export function fillPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => encodeURIComponent(params?.[name] ?? ""));
}

/** The URL of a project's icon; `version` is the custom icon's hash, or "auto". */
export function projectIconUrl(projectId: string, version: string): string {
  return `${API_PREFIX}/projects/${encodeURIComponent(projectId)}/icon?v=${encodeURIComponent(version)}`;
}
