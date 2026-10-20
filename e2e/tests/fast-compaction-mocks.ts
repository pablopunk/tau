import { createServer } from "node:http";
import { OPENAI_DECISIONS_MODEL } from "../../packages/core/src/decisions/openai";
import { TYPESAFE_MODEL } from "../../packages/core/src/decisions/typesafe";

export interface MockHit {
  backend: "typesafe" | "openai";
  input: string;
  instructions: string;
  probability: number;
}

export interface DecisionMock {
  url: string;
  hits: MockHit[];
  setFail: (fail: boolean) => void;
  close: () => Promise<void>;
}

interface MockOptions {
  backend: "typesafe" | "openai";
  /** Scripted probabilities, consumed FIFO per predicate call; the last repeats when exhausted. */
  probabilities: readonly number[];
  /** Programmatic fail switch; the mock also honors `MOCK_FAIL=500` per request. */
  fail?: boolean;
}

/** Per-request kill switch so one server covers fallback scenarios mid-spec. */
const failNow = (forced: boolean) => forced || process.env.MOCK_FAIL === "500";

/**
 * Localhost stand-in for a calibrated yes/no decision backend. Serves a
 * superset response shape (top-level `probability` plus nested copies) so the
 * hook's parser finds the score wherever it looks; the exact shape the hook
 * settles on is a MUST-AGREE seam, see NOTE-FOR-INTEGRATOR.md.
 */
export async function startDecisionMock(options: MockOptions): Promise<DecisionMock> {
  const hits: MockHit[] = [];
  const scripted = options.probabilities.length > 0 ? options.probabilities : [0.5];
  let index = 0;
  let forced = options.fail ?? false;

  const expectedPath = options.backend === "typesafe" ? "/v1/systemone" : "/v1/decisions";
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== expectedPath) {
      response.writeHead(request.method !== "POST" ? 405 : 404, { "content-type": "application/json" }).end("{}");
      return;
    }
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      if (failNow(forced)) {
        response
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message: `mock ${options.backend} failure`, code: "mock_fail" } }));
        return;
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      // TypeSafe nests input under questions.keep; OpenAI sends predicate + input flat.
      const keep = (body.questions as { keep?: { input?: unknown; instructions?: unknown } } | undefined)?.keep;
      const input = String(keep?.input ?? body.input ?? "");
      const instructions = String(keep?.instructions ?? body.instructions ?? body.predicate ?? "");
      const probability = scripted[Math.min(index, scripted.length - 1)] ?? 0.5;
      index += 1;
      hits.push({ backend: options.backend, input, instructions, probability });
      const payload =
        options.backend === "typesafe"
          ? {
              model: TYPESAFE_MODEL,
              probability,
              answers: { keep: { type: "noul", probability } },
              data: { keep: { probability } },
            }
          : {
              model: OPENAI_DECISIONS_MODEL,
              probability,
              output: [{ type: "predicate_result", probability }],
              data: { probability },
            };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
    });
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("mock server has no port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    url,
    hits,
    setFail: (fail: boolean) => {
      forced = fail;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** N copies of one probability: scripted drop-all / keep-all backends. */
export const repeat = (probability: number, count: number): number[] =>
  Array.from({ length: count }, () => probability);
