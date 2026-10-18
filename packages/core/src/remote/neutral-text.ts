const GENERIC = "The tunnel service had a problem.";
const OFFLINE = "Cannot reach the tunnel service";

/** Relay error text never reaches the user: owner B maps the known failures here. */
export function neutralRemoteText(offline = false): string {
  if (offline) return OFFLINE;
  return GENERIC;
}
