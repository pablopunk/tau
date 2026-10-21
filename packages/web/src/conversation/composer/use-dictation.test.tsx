import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "./use-dictation";

interface FiredResult {
  readonly transcript: string;
  readonly isFinal: boolean;
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult:
    | ((event: {
        resultIndex: number;
        results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  readonly stopped = vi.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {}
  stop() {
    this.stopped();
  }

  fire(results: readonly FiredResult[]) {
    this.onresult?.({
      resultIndex: 0,
      results: results.map((result) => ({
        isFinal: result.isFinal,
        0: { transcript: result.transcript },
      })),
    });
  }

  fail(error: string) {
    this.onerror?.({ error });
  }
}

const tracks = () => [{ stop: vi.fn() }];

function Harness({ onError = () => undefined }: { onError?: (message: string) => void }) {
  const [text, setText] = useState("");
  const dictation = useDictation(
    (spoken) => setText((previous) => (previous ? `${previous} ${spoken}` : spoken)),
    onError,
  );
  return (
    <>
      <output data-testid="text">{text}</output>
      <output data-testid="preview">{dictation.preview}</output>
      <div data-testid="card">
        <div ref={dictation.glowRef} data-testid="glow" />
      </div>
      <button
        type="button"
        aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
        onClick={dictation.toggle}
      >
        mic
      </button>
    </>
  );
}

describe("useDictation", () => {
  const getUserMedia = vi.fn();
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    FakeRecognition.instances = [];
    rafCallbacks = [];
    getUserMedia.mockResolvedValue({ getTracks: tracks });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    window.SpeechRecognition = FakeRecognition as unknown as typeof window.SpeechRecognition;
    const analyser = { fftSize: 0, getByteTimeDomainData: (array: Uint8Array) => array.fill(128) };
    vi.stubGlobal(
      "AudioContext",
      class {
        createMediaStreamSource() {
          return { connect: () => undefined };
        }
        createAnalyser() {
          return analyser;
        }
        close() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.SpeechRecognition;
  });

  it("toggles the mic, appends final transcripts and paints the glow", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Dictate" }));
    expect(await screen.findByRole("button", { name: "Stop dictation" })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledOnce();

    FakeRecognition.instances[0]?.fire([{ transcript: "hello world", isFinal: true }]);
    expect(await screen.findByTestId("text")).toHaveTextContent("hello world");

    for (const callback of rafCallbacks.splice(0)) callback(0);
    expect(Number(screen.getByTestId("glow").style.opacity)).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Stop dictation" }));
    expect(await screen.findByRole("button", { name: "Dictate" })).toBeInTheDocument();
    expect(screen.getByTestId("glow").style.opacity).toBe("0");
    expect(FakeRecognition.instances[0]?.stopped).toHaveBeenCalled();
  });

  it("shows interim transcripts as preview without committing them", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Dictate" }));
    await screen.findByRole("button", { name: "Stop dictation" });
    FakeRecognition.instances[0]?.fire([{ transcript: "half a", isFinal: false }]);
    expect(screen.getByTestId("text")).toHaveTextContent("");
    expect(await screen.findByTestId("preview")).toHaveTextContent("half a");
    FakeRecognition.instances[0]?.fire([{ transcript: "half a sentence", isFinal: true }]);
    expect(await screen.findByTestId("text")).toHaveTextContent("half a sentence");
    expect(screen.getByTestId("preview")).toHaveTextContent("");
  });

  it("reports a recognition start failure and stays idle", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    vi.spyOn(FakeRecognition.prototype, "start").mockImplementationOnce(() => {
      throw new Error("not allowed");
    });
    render(<Harness onError={onError} />);
    await user.click(screen.getByRole("button", { name: "Dictate" }));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("button", { name: "Dictate" })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reports a speech service failure and stops", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<Harness onError={onError} />);
    await user.click(screen.getByRole("button", { name: "Dictate" }));
    await screen.findByRole("button", { name: "Stop dictation" });
    FakeRecognition.instances[0]?.fail("network");
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(await screen.findByRole("button", { name: "Dictate" })).toBeInTheDocument();
  });

  it("reports a blocked microphone and stays idle", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    render(<Harness onError={onError} />);
    await user.click(screen.getByRole("button", { name: "Dictate" }));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("button", { name: "Dictate" })).toBeInTheDocument();
  });
});
