import { describe, expect, it } from "vitest";
import { renderCmdWrapper, renderPlist, renderSystemdUnit, renderTaskXml } from "./render";
import type { ServiceSpec } from "./spec";

const spec: ServiceSpec = {
  names: { launchdLabel: "dev.tau.server", systemdUnit: "tau.service", taskName: "tau" },
  home: "/home/pablo/.tau",
  node: "/opt/node/bin/node",
  entry: "/opt/tau/dist/bin.js",
  path: "/home/pablo/.local/share/mise/shims:/usr/local/bin:/usr/bin",
  args: ["serve", "--service", "--no-open"],
};

describe("service definitions (golden files)", () => {
  it("renders the launchd plist", async () => {
    await expect(renderPlist(spec)).toMatchFileSnapshot("./golden/dev.tau.server.plist");
  });

  it("renders the systemd user unit", async () => {
    await expect(renderSystemdUnit(spec)).toMatchFileSnapshot("./golden/tau.service");
  });

  it("renders the Task Scheduler XML", async () => {
    await expect(renderTaskXml("C:\\Users\\pablo\\.tau\\bin\\tau-service.cmd")).toMatchFileSnapshot(
      "./golden/tau-task.xml",
    );
  });

  it("renders the .cmd wrapper with PATH", async () => {
    const windows = {
      ...spec,
      node: "C:\\node\\node.exe",
      entry: "C:\\tau\\bin.js",
      path: "C:\\bin;C:\\tools",
    };
    await expect(renderCmdWrapper(windows)).toMatchFileSnapshot("./golden/tau-service.cmd");
  });

  it("gives a non-default home its --home argument in every format", () => {
    const dev = { ...spec, args: [...spec.args, "--home", "/tmp/dev"] };
    expect(renderPlist(dev)).toContain("<string>/tmp/dev</string>");
    expect(renderSystemdUnit(dev)).toContain('"--home" "/tmp/dev"');
    expect(renderCmdWrapper(dev)).toContain('"--home" "/tmp/dev"');
  });
});
