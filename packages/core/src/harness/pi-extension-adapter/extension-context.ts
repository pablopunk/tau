const doNothing = () => undefined;

const noUi = new Proxy({}, { get: () => doNothing });

const emptyModelRegistry = {
  getAll: () => [],
  getAvailable: () => [],
  find: () => undefined,
  getApiKeyAndHeaders: async () => ({ ok: false, error: "no model access in this host" }),
};

const emptySessionManager = {
  getBranch: () => [],
  getEntries: () => [],
  getSessionId: () => undefined,
};

export function createExtensionContext(cwd: string, signal: AbortSignal | undefined) {
  return {
    cwd,
    signal,
    hasUI: false,
    ui: noUi,
    model: undefined,
    scopedModels: undefined,
    modelRegistry: emptyModelRegistry,
    sessionManager: emptySessionManager,
    isIdle: () => true,
    abort: doNothing,
    hasPendingMessages: () => false,
    shutdown: doNothing,
  };
}
