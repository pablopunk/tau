import { AppError, MAX_UPLOAD_FILE_BYTES } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import type { Transport } from "./transport/types";

function stubTransport() {
  const request = vi.fn(async () => ({ name: "notes.txt", path: "uploads/staged", size: 2 }));
  const transport = {
    request,
    live: { open: () => ({ send() {}, close() {} }) },
    openStream: () => {
      throw new Error("no streams in this test");
    },
  } as unknown as Transport;
  return { transport, request };
}

const textFile = (text: string, name = "notes.txt") => new File([text], name, { type: "text/plain" });

describe("api.uploads.stage", () => {
  it("posts name, mimeType and base64 data to stageUpload", async () => {
    const { transport, request } = stubTransport();
    const ref = await createApi(transport).uploads.stage(textFile("hi"));
    expect(ref).toEqual({ name: "notes.txt", path: "uploads/staged", size: 2 });
    expect(request).toHaveBeenCalledWith("stageUpload", {
      body: { name: "notes.txt", mimeType: "text/plain", data: "aGk=" },
    });
  });

  it("defaults an empty name and mime type", async () => {
    const { transport, request } = stubTransport();
    await createApi(transport).uploads.stage(new File(["hi"], "", { type: "" }));
    expect(request).toHaveBeenCalledWith("stageUpload", {
      body: { name: "file", mimeType: "application/octet-stream", data: "aGk=" },
    });
  });

  it("rejects past 5 MiB locally with too_large, before anything goes on the wire", async () => {
    const { transport, request } = stubTransport();
    const big = new File([new Uint8Array(MAX_UPLOAD_FILE_BYTES + 1)], "big.bin", {
      type: "application/octet-stream",
    });
    await expect(createApi(transport).uploads.stage(big)).rejects.toMatchObject({ code: "too_large" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects with the transport error when staging fails", async () => {
    const { transport, request } = stubTransport();
    request.mockRejectedValueOnce(new AppError("file_expired", "Stage it again."));
    await expect(createApi(transport).uploads.stage(textFile("hi"))).rejects.toMatchObject({
      code: "file_expired",
    });
  });
});
