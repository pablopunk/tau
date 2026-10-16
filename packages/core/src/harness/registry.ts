import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { codingExtension } from "./coding-extension";

export function createAgentRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(codingExtension);
  return registry;
}
