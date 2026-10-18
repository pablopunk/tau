const PROVIDER_KEY_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
];

/** Provider keys that exist only as shell variables: the service cannot see them. */
export const shellOnlyProviderKeys = (env: NodeJS.ProcessEnv): string[] =>
  PROVIDER_KEY_VARIABLES.filter((name) => Boolean(env[name]));

export const providerKeyNotice = (names: readonly string[]): string | undefined =>
  names.length === 0
    ? undefined
    : `Not copied to the service: ${names.join(", ")}. Save these in Settings → Providers.`;
