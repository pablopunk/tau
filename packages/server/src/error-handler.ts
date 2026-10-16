import { AppError, ERROR_STATUS, isAppError, toErrorBody } from "@pi-everywhere/protocol";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

function isClientError(error: FastifyError): boolean {
  return error.validation !== undefined || (error.statusCode !== undefined && error.statusCode < 500);
}

function toAppError(error: FastifyError): AppError {
  if (isAppError(error)) return error;
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE")
    return new AppError("too_large", "The request is too large.");
  if (isClientError(error)) return new AppError("invalid_request", error.message);
  return new AppError("internal", "Internal error");
}

export function handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const appError = toAppError(error);
  if (appError.code === "internal") request.log.error(error);
  return reply.code(ERROR_STATUS[appError.code]).send(toErrorBody(appError));
}

export function sendApiNotFound(reply: FastifyReply) {
  return reply.code(ERROR_STATUS.not_found).send(toErrorBody(new AppError("not_found", "Unknown route")));
}
