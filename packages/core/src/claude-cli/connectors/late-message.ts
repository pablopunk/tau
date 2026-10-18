export const lateConnectorsMessage = (notes: readonly string[]): string =>
  `Connectors late to start: ${notes.join("; ")}`;
