const SIGNATURE = Buffer.from("0d0a0d0a000d0a515549540a", "hex");
const HEADER_BYTES = 16;
const COMMAND_LOCAL = 0x20;
const COMMAND_PROXY = 0x21;
const FAMILY_UNSPEC = 0x00;
const FAMILY_TCP4 = 0x11;
const FAMILY_TCP6 = 0x21;
const TLV_AUTHORITY = 0x02;
const TCP4_ADDRESS_BYTES = 12;
const TCP6_ADDRESS_BYTES = 36;

export type ProxyParse =
  | { readonly kind: "need-more" }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "ok"; readonly peer: string; readonly sni: string | undefined; readonly rest: Buffer };

function peerOf(command: number, family: number, body: Buffer): { peer: string; skip: number } {
  if (command === COMMAND_LOCAL) return { peer: "local", skip: 0 };
  if (family === FAMILY_TCP4) return { peer: [...body.subarray(0, 4)].join("."), skip: TCP4_ADDRESS_BYTES };
  if (family === FAMILY_TCP6) return { peer: body.subarray(0, 16).toString("hex"), skip: TCP6_ADDRESS_BYTES };
  return { peer: "local", skip: 0 };
}

function authorityOf(tlvs: Buffer): string | undefined {
  let offset = 0;
  while (offset + 3 <= tlvs.length) {
    const length = tlvs.readUInt16BE(offset + 1);
    if (tlvs[offset] === TLV_AUTHORITY) return tlvs.subarray(offset + 3, offset + 3 + length).toString();
    offset += 3 + length;
  }
  return undefined;
}

function addressBytesNeeded(command: number, family: number): number {
  if (command === COMMAND_LOCAL) return 0;
  if (family === FAMILY_TCP4) return TCP4_ADDRESS_BYTES;
  return family === FAMILY_TCP6 ? TCP6_ADDRESS_BYTES : 0;
}

/** Parses a PROXY protocol v2 header at the start of `buffer`. */
export function parseProxyV2(buffer: Buffer): ProxyParse {
  const seen = buffer.subarray(0, Math.min(buffer.length, SIGNATURE.length));
  if (!seen.equals(SIGNATURE.subarray(0, seen.length))) return { kind: "malformed", reason: "signature" };
  if (buffer.length < HEADER_BYTES) return { kind: "need-more" };
  const command = buffer[12] as number;
  const family = buffer[13] as number;
  if (command !== COMMAND_PROXY && command !== COMMAND_LOCAL) return { kind: "malformed", reason: "command" };
  if (![FAMILY_TCP4, FAMILY_TCP6, FAMILY_UNSPEC].includes(family)) {
    return { kind: "malformed", reason: "family" };
  }
  const length = buffer.readUInt16BE(14);
  if (length < addressBytesNeeded(command, family)) return { kind: "malformed", reason: "length" };
  if (buffer.length < HEADER_BYTES + length) return { kind: "need-more" };
  const body = buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
  const { peer, skip } = peerOf(command, family, body);
  return {
    kind: "ok",
    peer,
    sni: authorityOf(body.subarray(skip)),
    rest: buffer.subarray(HEADER_BYTES + length),
  };
}

/** Builds a header, for tests and fakes. `peer` is an IPv4 address. */
export function buildProxyV2(peer: string, sni: string | undefined): Buffer {
  const address = Buffer.concat([
    Buffer.from(peer.split(".").map(Number)),
    Buffer.from([127, 0, 0, 1]),
    Buffer.from([0xc3, 0x50, 0x01, 0xbb]),
  ]);
  const tlv = sni === undefined ? Buffer.alloc(0) : tlvOf(TLV_AUTHORITY, Buffer.from(sni));
  const body = Buffer.concat([address, tlv]);
  const head = Buffer.from([COMMAND_PROXY, FAMILY_TCP4, 0, 0]);
  head.writeUInt16BE(body.length, 2);
  return Buffer.concat([SIGNATURE, head, body]);
}

function tlvOf(type: number, value: Buffer): Buffer {
  const head = Buffer.from([type, 0, 0]);
  head.writeUInt16BE(value.length, 1);
  return Buffer.concat([head, value]);
}
