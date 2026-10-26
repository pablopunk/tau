import { importSdk } from "../../claude-cli/sdk-port";
import type { NativeQueryFn } from "./controller";

/** The same SDK the legacy provider loads (`<versionDir>/claude-sdk`, else the dev checkout). Missing means native is unavailable, never a failed start. */
export async function loadNativeQuery(sdkHome: string): Promise<NativeQueryFn | undefined> {
  try {
    const { sdk } = await importSdk(sdkHome);
    return ({ prompt, options }) => sdk.query({ prompt, options }) as ReturnType<NativeQueryFn>;
  } catch (error) {
    console.warn(
      "tau: Claude Code is installed but the Agent SDK could not load; native threads are unavailable",
      error,
    );
    return undefined;
  }
}
