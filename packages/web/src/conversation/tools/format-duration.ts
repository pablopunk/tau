/** Human duration for tool execution times, from the harness's `durationMs`. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    if (seconds < 10) {
      const oneDecimal = (Math.round(seconds * 10) / 10).toFixed(1);
      return `${oneDecimal}s`;
    }
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const restSeconds = Math.round((ms % 60_000) / 1000);
  if (ms < 3_600_000) {
    return restSeconds === 0 ? `${minutes}m` : `${minutes}m ${restSeconds}s`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const restMinutes = Math.floor((ms % 3_600_000) / 60_000);
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}
