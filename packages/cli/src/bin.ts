#!/usr/bin/env node
import "./install-warning-filter";

const { main } = await import("./main");

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
