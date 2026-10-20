#!/usr/bin/env node
import "./install-warning-filter";
import { compiled } from "./runtime/install-paths";

if (compiled()) {
  const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
  registerBunOAuthFlows();
}

const { main } = await import("./main");

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
