import { writeFile } from "node:fs/promises";

export interface PinResult {
  readonly pin: string;
  readonly title: string;
  readonly pass: boolean;
  readonly evidence: string;
}

export interface PinReport {
  readonly results: PinResult[];
  /** Runs one pin; an error is a failed pin with the message as evidence, so the other pins still run. */
  run(pin: string, title: string, body: () => Promise<string>): Promise<boolean>;
  flush(): Promise<void>;
}

export function createPinReport(outFile: string | undefined): PinReport {
  const results: PinResult[] = [];
  return {
    results,
    async run(pin, title, body) {
      try {
        results.push({ pin, title, pass: true, evidence: await body() });
        return true;
      } catch (error) {
        results.push({
          pin,
          title,
          pass: false,
          evidence: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    async flush() {
      const text = JSON.stringify(results, null, 2);
      if (outFile) await writeFile(outFile, text);
      else console.log(text);
    },
  };
}
