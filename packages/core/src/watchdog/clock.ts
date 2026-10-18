export const monotonicNow = (): number => Number(process.hrtime.bigint() / 1_000_000n);
