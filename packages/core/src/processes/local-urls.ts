const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)\]]*)?/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, "");

export const extractLocalUrls = (text: string): string[] => stripAnsi(text).match(LOCAL_URL) ?? [];
