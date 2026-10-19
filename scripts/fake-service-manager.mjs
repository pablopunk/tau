// Fake launchctl / systemctl / loginctl for scripts/smoke-bare.ts.
// Usage: node fake-service-manager.mjs <tool> [args...]
// Env: FAKE_SM_DIR (state + log dir, inside the scratch dir), HOME (scratch).
// It logs every call, succeeds, and on start-like verbs spawns the unit's command detached.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const [tool, ...args] = process.argv.slice(2);
const stateDir = process.env.FAKE_SM_DIR;
const home = process.env.HOME;
if (!stateDir || !home || !stateDir.startsWith(home)) {
  console.error("fake-service-manager: FAKE_SM_DIR must be set inside the scratch HOME");
  process.exit(2);
}
mkdirSync(stateDir, { recursive: true });
appendFileSync(join(stateDir, "calls.log"), `${tool} ${args.join(" ")}\n`);
const pidFile = join(stateDir, "service.pid");

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const readPid = () => (existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0);
const stopService = () => {
  const pid = readPid();
  if (pid && alive(pid)) process.kill(pid, "SIGTERM");
};
const files = (dir, suffix) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(suffix))
        .map((name) => join(dir, name))
    : [];
const unescapeXml = (text) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

function plistCommand(file) {
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(readFileSync(file, "utf8"));
  return [...(block?.[1] ?? "").matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]));
}

function unitCommand(file) {
  const line = /^ExecStart=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

function spawnService(command) {
  if (command.length === 0) return;
  stopService();
  const log = openSync(join(stateDir, "service.log"), "a");
  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
}

const has = (...verbs) => args.some((arg) => verbs.includes(arg));
const status = (running) => process.exit(running ? 0 : tool === "launchctl" ? 113 : 3);

if (tool === "launchctl") {
  if (has("bootstrap", "load")) {
    const plist =
      args.find((arg) => arg.endsWith(".plist")) ?? files(join(home, "Library", "LaunchAgents"), ".plist")[0];
    if (plist) spawnService(plistCommand(plist));
  } else if (has("kickstart")) {
    const plist = files(join(home, "Library", "LaunchAgents"), ".plist")[0];
    if (plist) spawnService(plistCommand(plist));
  } else if (has("bootout", "unload", "remove")) stopService();
  else if (has("print", "list")) {
    const pid = readPid();
    if (!pid || !alive(pid)) status(false);
    console.log(`state = running\npid = ${pid}`);
  }
} else if (tool === "systemctl") {
  if (has("start", "restart")) {
    const unit = files(join(home, ".config", "systemd", "user"), ".service")[0];
    if (unit) spawnService(unitCommand(unit));
  } else if (has("stop", "disable")) stopService();
  else if (has("is-active")) {
    const pid = readPid();
    console.log(pid && alive(pid) ? "active" : "inactive");
    status(Boolean(pid && alive(pid)));
  } else if (has("show")) {
    const pid = readPid();
    console.log(
      `ActiveState=${pid && alive(pid) ? "active" : "inactive"}\nMainPID=${pid && alive(pid) ? pid : 0}`,
    );
  }
} else if (tool === "loginctl") {
  if (has("show-user")) console.log("Linger=yes");
}
