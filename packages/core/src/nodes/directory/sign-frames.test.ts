import {
  createAck,
  createAnnounce,
  createExpel,
  generateNodeKeys,
  nodeIdOf,
  signPayload,
} from "@tau/protocol/identity";
import { describe, expect, it } from "vitest";
import type { NodeIdentity } from "../../identity/node-identity";
import { signAck, signAnnounce, signExpel } from "./sign-frames";

const keys = generateNodeKeys();
const identity: NodeIdentity = {
  nodeId: nodeIdOf(keys.publicKey),
  publicKey: keys.publicKey,
  createdAt: 0,
  sign: (payload) => signPayload(keys, payload),
};
const self = {
  name: "Mac book|x",
  os: "darwin arm64",
  tauVersion: "1.2.3",
  protocolVersion: "p",
  linkProtocol: "l",
};

describe("core signs the same bytes as protocol", () => {
  it("announce", () => {
    const body = { boot: 4, counter: 9, neighbours: ["a", "b"], ...self };
    expect(signAnnounce(identity, { boot: 4, counter: 9, neighbours: ["a", "b"], self }, 5)).toEqual(
      createAnnounce(keys, body, 5),
    );
  });
  it("expel and ack", () => {
    expect(signExpel(identity, "target", 77)).toEqual(createExpel(keys, "target", 77));
    expect(signAck(identity, "target", 77)).toEqual(createAck(keys, "target", 77));
  });
});
