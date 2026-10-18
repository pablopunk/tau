import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { createIconService } from "./icon-service";

const tempDir = useTempDir();

async function setup() {
  const root = await tempDir();
  const project = join(root, "repo");
  await mkdir(project, { recursive: true });
  let time = 1000;
  const service = createIconService({ iconsDirectory: join(root, "home", "icons"), now: () => time });
  const info: Project = {
    id: "p1",
    name: "repo",
    path: project,
    createdAt: 0,
    kind: "folder",
    status: "ready",
    isGitRepo: false,
  };
  const put = async (name: string, content = "x") => {
    const path = join(project, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
    return path;
  };
  const advance = (ms: number) => {
    time += ms;
  };
  const names = async () => (await service.candidates(info)).map((c) => c.name);
  const text = async () => new TextDecoder().decode((await service.icon(info))?.data);
  return { root, project, service, info, put, advance, names, text };
}

describe("icon discovery", () => {
  it("ranks names and finds ico, png, svg and webp", async () => {
    const s = await setup();
    for (const name of [
      "logo.svg",
      "icon.webp",
      "apple-touch-icon.png",
      "favicon-16.png",
      "favicon.ico",
      "readme.png",
    ]) {
      await s.put(name);
    }
    expect(await s.names()).toEqual([
      "favicon.ico",
      "favicon-16.png",
      "apple-touch-icon.png",
      "icon.webp",
      "logo.svg",
    ]);
    expect((await s.service.icon(s.info))?.contentType).toBe("image/x-icon");
  });

  it("maps svg, png and webp content types", async () => {
    for (const [file, type] of [
      ["favicon.svg", "image/svg+xml"],
      ["favicon.png", "image/png"],
      ["favicon.webp", "image/webp"],
    ] as const) {
      const s = await setup();
      await s.put(file);
      expect((await s.service.icon(s.info))?.contentType).toBe(type);
    }
  });

  it("uses the first directory that has a match", async () => {
    const s = await setup();
    await s.put("public/favicon.ico", "public");
    await s.put("build/Icon.icon/Assets/logo.png", "build");
    expect(await s.text()).toBe("build");
    expect(await s.names()).toEqual(["public/favicon.ico", "build/Icon.icon/Assets/logo.png"]);
  });

  it("scans src/*/public and apps/*/public, repository-named apps first", async () => {
    const s = await setup();
    await s.put("src/zed/public/mark.png", "src");
    await s.put("apps/other/public/favicon.ico", "other");
    await s.put("apps/repo-web/public/favicon.ico", "web");
    expect(await s.names()).toEqual([
      "apps/repo-web/public/favicon.ico",
      "apps/other/public/favicon.ico",
      "src/zed/public/mark.png",
    ]);
  });

  it("discovers packages/*/public icons", async () => {
    const s = await setup();
    await s.put("packages/web/public/favicon.svg", "web");
    expect(await s.names()).toEqual(["packages/web/public/favicon.svg"]);
    expect(await s.text()).toBe("web");
  });

  it("discovers icons at the member root", async () => {
    const s = await setup();
    await s.put("packages/web/favicon.svg", "web");
    await s.put("apps/site/public/icon.png", "site");
    expect(await s.names()).toEqual(["packages/web/favicon.svg", "apps/site/public/icon.png"]);
  });

  it("prefers the member root over its public directory", async () => {
    const s = await setup();
    await s.put("packages/web/favicon.svg", "root");
    await s.put("packages/web/public/favicon.ico", "public");
    expect(await s.text()).toBe("root");
  });

  it("keeps all apps when packages are added and caps each container at 32", async () => {
    const s = await setup();
    for (let i = 0; i < 32; i++) await s.put(`apps/a-${String(i).padStart(2, "0")}/public/favicon.ico`, `a${i}`);
    for (let i = 0; i < 6; i++) await s.put(`packages/p-${String(i).padStart(2, "0")}/public/favicon.ico`, `p${i}`);
    const names = await s.names();
    expect(names).toHaveLength(12);
    expect(names).toContain("apps/a-00/public/favicon.ico");
    await s.put("apps/a-32/public/favicon.ico", "extra");
    expect(await s.names()).not.toContain("apps/a-32/public/favicon.ico");
  });

  it("prefers apps over packages on equal-rank first-icon ties", async () => {
    const s = await setup();
    await s.put("apps/other/public/favicon.ico", "apps");
    await s.put("packages/zed/public/favicon.ico", "packages");
    expect(await s.text()).toBe("apps");
  });

  it("limits candidates to 12", async () => {
    const s = await setup();
    for (let i = 0; i < 15; i++) await s.put(`icon-${String(i).padStart(2, "0")}.png`);
    expect(await s.names()).toHaveLength(12);
  });

  it("skips empty and oversized files", async () => {
    const s = await setup();
    await s.put("favicon.ico", "");
    await s.put("icon.png", "x".repeat(2 * 1024 * 1024 + 1));
    await s.put("logo.png", "x".repeat(2 * 1024 * 1024));
    expect(await s.names()).toEqual(["logo.png"]);
  });

  it("rejects files and directories whose realpath leaves the project", async () => {
    const s = await setup();
    await mkdir(join(s.root, "outside"), { recursive: true });
    await writeFile(join(s.root, "outside", "secret.png"), "x");
    await symlink(join(s.root, "outside", "secret.png"), join(s.project, "favicon.png"));
    await symlink(join(s.root, "outside"), join(s.project, "public"));
    expect(await s.names()).toEqual([]);
    expect(await s.service.icon(s.info)).toBeNull();
  });

  it("accepts a symlink that stays inside the project", async () => {
    const s = await setup();
    await s.put("real/art.png", "inside");
    await symlink(join(s.project, "real", "art.png"), join(s.project, "favicon.png"));
    expect(await s.text()).toBe("inside");
  });

  it("returns nothing for a missing project folder", async () => {
    const s = await setup();
    const gone = { ...s.info, path: join(s.root, "gone") };
    expect(await s.service.icon(gone)).toBeNull();
    expect(await s.service.candidates(gone)).toEqual([]);
  });

  it("caches the discovered icon for 60 seconds", async () => {
    const s = await setup();
    const path = await s.put("favicon.ico", "one");
    expect(await s.text()).toBe("one");
    await rm(path);
    await s.put("public/icon.png", "next");
    expect(await s.service.icon(s.info)).toBeNull();
    s.advance(60_001);
    expect(await s.text()).toBe("next");
  });
});

describe("candidate by name", () => {
  it("serves a current name, rejects others, and rejects one that vanished", async () => {
    const s = await setup();
    await s.put("favicon.ico", "fav");
    expect((await s.service.candidate(s.info, "favicon.ico")).data).toEqual(new TextEncoder().encode("fav"));
    for (const bad of ["../x.png", "missing.png", "/etc/passwd"]) {
      await expect(s.service.candidate(s.info, bad)).rejects.toMatchObject({ code: "not_found" });
    }
    await rm(join(s.project, "favicon.ico"));
    await expect(s.service.candidate(s.info, "favicon.ico")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("custom icon", () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

  it("wins over a discovered icon, changes the version and resets", async () => {
    const s = await setup();
    await s.put("favicon.ico", "found");
    expect(await s.service.version("p1")).toBe("auto");
    await s.service.setCustom("p1", png);
    expect(await s.service.icon(s.info)).toMatchObject({ contentType: "image/png", data: png });
    expect(await s.service.version("p1")).not.toBe("auto");
    await s.service.setCustom("p1", null);
    expect(await s.service.version("p1")).toBe("auto");
    expect(await s.text()).toBe("found");
  });

  it("removeCustom deletes it and tolerates none", async () => {
    const s = await setup();
    await s.service.setCustom("p1", png);
    await s.service.removeCustom("p1");
    expect(await s.service.icon(s.info)).toBeNull();
    await s.service.removeCustom("p1");
  });
});
