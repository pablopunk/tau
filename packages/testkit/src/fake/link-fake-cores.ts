import type { FakeCore } from "./fake-core";

/**
 * Links two fake taus the way two real nodes link: `dialler` dials, `acceptor` accepts, and each lists the
 * other (A sees B and B sees A, with opposite directions). `nodeCores` of each side reaches the other, so
 * `/api/n/<nodeId>/...` works from both.
 */
export async function linkFakeCores(dialler: FakeCore, acceptor: FakeCore): Promise<void> {
  await Promise.all([
    dialler.nodesControl.attach(acceptor, "dialled"),
    acceptor.nodesControl.attach(dialler, "accepted"),
  ]);
}
