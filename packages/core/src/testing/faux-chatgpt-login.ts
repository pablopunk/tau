import type { ApiKeyAuth, OAuthAuth, OAuthCredential, Provider } from "@earendil-works/pi-ai";

export const FAUX_AUTH_URL = "https://auth.faux.test/authorize?state=faux";
export const FAUX_CALLBACK_URL = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";

const CALLBACK_PREFIX = "http://127.0.0.1:1455/auth/callback";
const FAUX_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

function rejectionMessageFor(pasted: string): string {
  if (!URL.canParse(pasted)) return "Paste the full callback URL from the browser";
  if (!pasted.startsWith(CALLBACK_PREFIX))
    return `The pasted callback URL must start with ${CALLBACK_PREFIX}`;
  return "OAuth state mismatch";
}

const fauxCredential = (): OAuthCredential => ({
  type: "oauth",
  access: "faux-access",
  refresh: "faux-refresh",
  expires: Date.now() + FAUX_TOKEN_LIFETIME_MS,
});

const fauxChatGptAuth: OAuthAuth = {
  name: "OpenAI (ChatGPT subscription)",
  isSubscription: true,
  loginLabel: "Sign in with ChatGPT",
  async login(interaction) {
    interaction.notify({ type: "auth_url", url: FAUX_AUTH_URL });
    const pasted = (
      await interaction.prompt({ type: "manual_code", message: "Paste the callback URL" })
    ).trim();
    if (pasted !== FAUX_CALLBACK_URL) throw new Error(rejectionMessageFor(pasted));
    return fauxCredential();
  },
  refresh: async () => fauxCredential(),
  toAuth: async (credential) => ({ apiKey: credential.access }),
};

const fauxApiKeyAuth: ApiKeyAuth = {
  name: "OpenAI API key",
  resolve: async ({ credential }) =>
    credential?.key ? { auth: { apiKey: credential.key }, source: "stored credential" } : undefined,
};

/** Replaces pi's `openai` provider: same sign-in shape as ChatGPT, no network, no models of its own. */
export function withFauxChatGptLogin(base: Provider): Provider {
  return {
    ...base,
    id: "openai",
    name: "OpenAI",
    auth: { oauth: fauxChatGptAuth, apiKey: fauxApiKeyAuth },
    getModels: () => [],
    getAllModels: () => [],
  };
}
