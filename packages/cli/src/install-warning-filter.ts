import { withoutSqliteWarning } from "./suppress-sqlite-warning";

process.emitWarning = withoutSqliteWarning(process.emitWarning.bind(process));
