import { ChangeSchema } from "./entities";
import { BASE_FRAME_SCHEMAS, CHUNK_BYTES, DATA_HEADER_BYTES, LinkFrameSchema } from "./node-link";
import { routes } from "./rest";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** cyrb53: a small, fast, deterministic string hash (not a secret; browser-safe, no `node:crypto`). */
function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** What a node and its hub must agree on: the routes table, the link frames and the `Change` union. */
export function protocolSurface(): string {
  return stableStringify({
    routes,
    frames: LinkFrameSchema,
    binary: { CHUNK_BYTES, DATA_HEADER_BYTES },
    change: ChangeSchema,
  });
}

/** What two nodes must agree on to link at all: the BASE frames (hello, proof, ready, bye, request, response, open, close, credit) and the binary header. */
export function linkSurface(): string {
  return stableStringify({ frames: BASE_FRAME_SCHEMAS, binary: { CHUNK_BYTES, DATA_HEADER_BYTES } });
}

export function computeLinkProtocol(): string {
  const surface = linkSurface();
  return `${cyrb53(surface, 3)}${cyrb53(surface, 4)}`;
}

export function computeProtocolVersion(): string {
  const surface = protocolSurface();
  return `${cyrb53(surface, 1)}${cyrb53(surface, 2)}`;
}
