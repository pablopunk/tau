import { Type } from "typebox";

export const ERROR_CODES = [
  "invalid_key",
  "path_not_found",
  "not_a_directory",
  "duplicate_project",
  "not_found",
  "no_provider",
  "no_default_model",
  "invalid_request",
  "unauthorized",
  "images_not_supported",
  "invalid_git_url",
  "too_large",
  "project_not_ready",
  "git_missing",
  "github_unavailable",
  "needs_folder",
  "remote_mismatch",
  "login_failed",
  "nothing_to_compact",
  "thread_busy",
  "merge_conflict",
  "base_dirty",
  "not_on_base",
  "worktree_dirty",
  "has_unmerged_work",
  "cannot_remove_self",
  "confirmation_mismatch",
  "rate_limited",
  "node_removed",
  "no_route",
  "clock_skew",
  "forbidden",
  "update_busy",
  "update_unsupported",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = Type.Union([
  Type.Literal("invalid_key"),
  Type.Literal("path_not_found"),
  Type.Literal("not_a_directory"),
  Type.Literal("duplicate_project"),
  Type.Literal("not_found"),
  Type.Literal("no_provider"),
  Type.Literal("no_default_model"),
  Type.Literal("invalid_request"),
  Type.Literal("unauthorized"),
  Type.Literal("images_not_supported"),
  Type.Literal("invalid_git_url"),
  Type.Literal("too_large"),
  Type.Literal("project_not_ready"),
  Type.Literal("git_missing"),
  Type.Literal("github_unavailable"),
  Type.Literal("needs_folder"),
  Type.Literal("remote_mismatch"),
  Type.Literal("login_failed"),
  Type.Literal("nothing_to_compact"),
  Type.Literal("thread_busy"),
  Type.Literal("merge_conflict"),
  Type.Literal("base_dirty"),
  Type.Literal("not_on_base"),
  Type.Literal("worktree_dirty"),
  Type.Literal("has_unmerged_work"),
  Type.Literal("cannot_remove_self"),
  Type.Literal("confirmation_mismatch"),
  Type.Literal("rate_limited"),
  Type.Literal("node_removed"),
  Type.Literal("no_route"),
  Type.Literal("clock_skew"),
  Type.Literal("forbidden"),
  Type.Literal("update_busy"),
  Type.Literal("update_unsupported"),
  Type.Literal("internal"),
]);

export const ErrorBodySchema = Type.Object({
  error: Type.Object({ code: ErrorCodeSchema, message: Type.String() }),
});
export type ErrorBody = Type.Static<typeof ErrorBodySchema>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_key: 422,
  path_not_found: 422,
  not_a_directory: 422,
  duplicate_project: 409,
  not_found: 404,
  no_provider: 409,
  no_default_model: 409,
  invalid_request: 400,
  unauthorized: 401,
  images_not_supported: 422,
  invalid_git_url: 422,
  too_large: 413,
  project_not_ready: 409,
  git_missing: 409,
  github_unavailable: 409,
  needs_folder: 409,
  remote_mismatch: 422,
  login_failed: 422,
  nothing_to_compact: 409,
  thread_busy: 409,
  merge_conflict: 409,
  base_dirty: 409,
  not_on_base: 409,
  worktree_dirty: 409,
  has_unmerged_work: 409,
  cannot_remove_self: 409,
  confirmation_mismatch: 422,
  rate_limited: 429,
  node_removed: 403,
  no_route: 502,
  clock_skew: 409,
  forbidden: 403,
  update_busy: 409,
  update_unsupported: 422,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toErrorBody(error: AppError): ErrorBody {
  return { error: { code: error.code, message: error.message } };
}

function isErrorCode(value: unknown): value is ErrorCode {
  return (ERROR_CODES as readonly unknown[]).includes(value);
}

export function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const { error } = value as { error?: { code?: unknown; message?: unknown } };
  return isErrorCode(error?.code) && typeof error?.message === "string";
}
