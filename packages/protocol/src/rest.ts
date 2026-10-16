import { type TSchema, Type } from "typebox";
import {
  ConversationSummarySchema,
  ModelInfoSchema,
  ModelRefSchema,
  ProjectSchema,
  ProviderStatusSchema,
  RetryInputSchema,
  SendMessageInputSchema,
  SettingsSchema,
  StartConversationInputSchema,
} from "./entities";

export const API_PREFIX = "/api";
export const LIVE_PATH = `${API_PREFIX}/live`;

export const MESSAGE_BODY_LIMIT = 42 * 1024 * 1024;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteDef {
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: 200 | 201 | 204;
  readonly params?: TSchema;
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
  retryClone: { method: "POST", path: `${API_PREFIX}/projects/:id/retry-clone`, status: 204, params: IdParams },
  renameProject: {
    method: "PATCH",
    path: `${API_PREFIX}/projects/:id`,
    status: 204,
    params: IdParams,
    body: Type.Object({ name: Type.String({ minLength: 1 }) }),
  },
  removeProject: { method: "DELETE", path: `${API_PREFIX}/projects/:id`, status: 204, params: IdParams },
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
  removeConversation: { method: "DELETE", path: `${API_PREFIX}/conversations/:id`, status: 204, params: IdParams },
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

type StaticOf<S> = S extends TSchema ? Type.Static<S> : never;

export type RouteInput<R extends RouteDef> = (R extends { params: infer P }
  ? { params: StaticOf<P> }
  : unknown) &
  (R extends { body: infer B } ? { body: StaticOf<B> } : unknown);

export type RouteOutput<R extends RouteDef> = R extends { response: infer S } ? StaticOf<S> : undefined;

export function fillPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => encodeURIComponent(params?.[name] ?? ""));
}
