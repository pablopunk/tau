import { createHash } from "node:crypto";
import { routes } from "@tau/protocol";

/** The one UI outside the design system, on purpose: the React app needs a session. Colours by value. */
const SCRIPT = `
const fail = (text) => { document.getElementById("error").textContent = text; };
const redeem = async (code) => {
  const name = navigator.userAgent.slice(0, 80);
  const response = await fetch(${JSON.stringify(routes.redeemPairing.path)}, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName: name }),
  });
  if (!response.ok) return fail("That code did not work. Ask for a new one.");
  location.replace("/");
};
const fromLink = location.hash.slice(1);
if (fromLink) { history.replaceState(null, "", location.pathname); redeem(fromLink); }
document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  redeem(document.getElementById("code").value.trim());
});
`;

const STYLE = `
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#171717;font:16px system-ui,sans-serif}
main{max-width:22rem;padding:2rem}input,button{font:inherit;padding:.6rem .8rem;border-radius:.5rem;border:1px solid #d4d4d4}
button{background:#171717;color:#fff;cursor:pointer}p{color:#525252}#error{color:#b91c1c}
@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#fafafa}p{color:#a3a3a3}input{background:#171717;color:#fafafa;border-color:#404040}button{background:#fafafa;color:#0a0a0a}}
`;

export const PAIR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link this device</title><style>${STYLE}</style></head><body><main><h1>Link this device</h1><p>Type the code shown on your tau.</p><form id="form"><input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false"> <button>Link</button></form><p id="error"></p></main><script>${SCRIPT}</script></body></html>`;

export const PAIR_SCRIPT_HASH = `sha256-${createHash("sha256").update(SCRIPT).digest("base64")}`;

export const PAIR_PAGE_HEADERS = {
  "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src '${PAIR_SCRIPT_HASH}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  "cache-control": "no-store",
} as const;
