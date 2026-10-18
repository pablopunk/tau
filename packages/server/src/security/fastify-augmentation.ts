declare module "fastify" {
  interface FastifyRequest {
    /** `"owner"` for the master token, a device id for a device cookie, `""` before the guard authenticates. */
    deviceId: string;
  }
}

export {};
