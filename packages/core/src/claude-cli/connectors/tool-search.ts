/** Legacy Claude 3 models (`claude-3-5-haiku-latest`, `claude-3-7-sonnet`, ...) predate `tool_reference`. */
const LEGACY_MODEL = /claude-3|(^|-)3-[5-7]-(haiku|sonnet)|haiku-3/i;

/**
 * Tool search (deferred MCP schemas) needs `tool_reference` support. Verified for the `haiku` alias and
 * `claude-haiku-4-5-20251001`; legacy Claude 3 models get no connectors rather than every schema in the window.
 */
export const supportsToolSearch = (model: string): boolean => !LEGACY_MODEL.test(model);
