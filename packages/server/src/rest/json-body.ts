import type { FastifyInstance } from "fastify";

/** Like Fastify's JSON parser, but an empty body is `undefined` instead of an error (bodiless POSTs such as abort). */
export function allowEmptyJsonBodies(app: FastifyInstance): void {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("Body is not valid JSON"), { statusCode: 400 }), undefined);
    }
  });
}
