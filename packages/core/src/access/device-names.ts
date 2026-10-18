import type { DeviceKind } from "@tau/protocol";

export function deviceKindFromName(name: string): DeviceKind {
  return /iphone|ipad|android|mobile/i.test(name) ? "phone" : "browser";
}

/** "Safari on iPhone" style names from a User-Agent; used by the server, editable later. */
export function nameFromUserAgent(userAgent: string | undefined): string {
  if (!userAgent) return "Unnamed device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}
