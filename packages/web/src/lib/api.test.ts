import { AppError } from "@pi-everywhere/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import { createHttpTransport } from "./transport/http";

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("http transport", () => {
  const api = createApi(createHttpTransport());

  it("calls the route with its path, method and JSON body", async () => {
    const fetchMock = stubFetch(respond(204));
    await api.projects.rename("p 1", "New name");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p%201", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New name" }),
    });
  });

  it("returns the validated response body", async () => {
    stubFetch(respond(200, { defaultModel: null }));
    expect(await api.settings.get()).toEqual({ defaultModel: null });
  });

  it("maps an error body to an AppError with the server's code", async () => {
    stubFetch(respond(422, { error: { code: "invalid_key", message: "Bad key" } }));
    await expect(api.provider.setKey("nope")).rejects.toMatchObject({
      code: "invalid_key",
      message: "Bad key",
    });
  });

  it("maps a response without an error body to unauthorized or internal", async () => {
    stubFetch(new Response("<html>open the URL</html>", { status: 401 }));
    await expect(api.projects.list()).rejects.toMatchObject({ code: "unauthorized" });
    stubFetch(new Response("boom", { status: 500 }));
    await expect(api.projects.list()).rejects.toMatchObject({ code: "internal" });
  });

  it("rejects a response that does not match the schema", async () => {
    stubFetch(respond(200, { nonsense: true }));
    await expect(api.settings.get()).rejects.toMatchObject({ code: "internal" });
  });

  it("rejects an invalid request body before sending it", async () => {
    const fetchMock = stubFetch(respond(204));
    await expect(api.provider.setKey("")).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable server as internal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.projects.list()).rejects.toMatchObject({ code: "internal" });
  });
});
