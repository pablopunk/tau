const SQLITE_WARNING = /^SQLite is an experimental feature/;

type EmitWarning = typeof process.emitWarning;

export function withoutSqliteWarning(emitWarning: EmitWarning): EmitWarning {
  return ((warning: string | Error, ...rest: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    const isSqliteWarning =
      SQLITE_WARNING.test(message) && (type ?? "ExperimentalWarning") === "ExperimentalWarning";
    if (isSqliteWarning) return;
    return (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
  }) as EmitWarning;
}
