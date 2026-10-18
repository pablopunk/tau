import { createHash } from "node:crypto";
import { routes } from "@tau/protocol";

/** The one UI outside the design system, on purpose: the React app needs a session first. Colours by value. */
const SCRIPT = `
const $ = (id) => document.getElementById(id);
const REDEEM_PATH = ${JSON.stringify(routes.redeemPairing.path)};
const MESSAGES = {
  401: "That code did not work. Check it, or ask for a new one.",
  429: "Too many tries. Wait a little, then try again.",
};
const guessName = () => {
  const agent = navigator.userAgent;
  const os = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Mac/.test(agent) ? "Mac" : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "";
  const browser = /Edg\\//.test(agent) ? "Edge" : /Firefox\\//.test(agent) ? "Firefox" : /Chrome\\//.test(agent) ? "Chrome" : /Safari\\//.test(agent) ? "Safari" : "Browser";
  return os ? browser + " on " + os : browser;
};
const show = (text) => { $("error").textContent = text; };
const busy = (on) => { $("link").disabled = on; };
const redeem = async (code, deviceName) => {
  busy(true);
  show("");
  try {
    const response = await fetch(REDEEM_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: deviceName.slice(0, 120) || guessName() }),
    });
    if (response.ok) return location.replace("/");
    show(MESSAGES[response.status] || "Something went wrong. Try again.");
  } catch {
    show("Could not reach tau. Check your connection and try again.");
  }
  busy(false);
};
const groups = (text) => text.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8).replace(/(.{4})(?=.)/g, "$1 ");
const fromLink = () => {
  const [code, name] = location.hash.slice(1).split(".");
  try { return { code, name: name ? decodeURIComponent(name) : "" }; } catch { return { code, name: "" }; }
};
$("name").value = guessName();
const linked = fromLink();
if (linked.code) {
  history.replaceState(null, "", location.pathname + location.search);
  if (linked.name) $("name").value = linked.name;
  redeem(linked.code, $("name").value);
}
$("code").addEventListener("input", (event) => { event.target.value = groups(event.target.value); });
$("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const typed = $("code").value.replace(/\\s/g, "");
  if (typed.length !== 8) return show("The code has 8 characters.");
  redeem(typed, $("name").value.trim());
});
`;

const STYLE = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#0a0a0a;--muted:#737373;--border:#e5e5e5;--primary:#171717;--primary-fg:#fafafa;--danger:#e7000b}
@media(prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#fafafa;--muted:#b5b5b5;--border:#ffffff26;--primary:#e5e5e5;--primary-fg:#171717;--danger:#ff6467}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:24rem;padding:1.5rem}
h1{margin:0 0 .25rem;font-size:1.25rem;font-weight:600}
p{margin:0 0 1.25rem;color:var(--muted);font-size:.875rem}
label{display:block;margin:0 0 .375rem;font-size:.875rem;font-weight:500}
input,button{font:inherit;width:100%;height:2.5rem;padding:0 .75rem;border-radius:.5rem;border:1px solid var(--border)}
input{background:transparent;color:var(--fg);margin-bottom:1rem}
#code{font-family:ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase}
input:focus-visible,button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
button{background:var(--primary);color:var(--primary-fg);border-color:transparent;font-weight:500;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
#error{min-height:1.5rem;margin:1rem 0 0;color:var(--danger)}
`;

const BODY = `<main><h1>Link this device</h1><p>Type the 8-character code shown on your tau, or open the link it gave you.</p>
<form id="form" novalidate><label for="code">Code</label><input id="code" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="ABCD EFGH" aria-describedby="error">
<label for="name">Device name</label><input id="name" autocomplete="off" maxlength="120"><button id="link" type="submit">Link this device</button></form>
<p id="error" role="alert" aria-live="polite"></p></main>`;

export const PAIR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Link this device</title><style>${STYLE}</style></head><body>${BODY}<script>${SCRIPT}</script></body></html>`;

export const PAIR_SCRIPT_HASH = `sha256-${createHash("sha256").update(SCRIPT).digest("base64")}`;

export const PAIR_PAGE_HEADERS = {
  "content-security-policy": `default-src 'none'; script-src '${PAIR_SCRIPT_HASH}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  "cache-control": "no-store",
} as const;
