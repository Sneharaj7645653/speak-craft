import { describe, expect, it } from "vitest";

import { AiCoachService } from "@/backend/ai/ai-coach.service";

function fakeService(): AiCoachService {
  return new AiCoachService(
    {} as never,
    {} as never,
    {} as never,
  );
}

describe("AI coach", () => {
  it("reports provider configuration from environment", () => {
    process.env.GROQ_API_KEY = "";
    process.env.GEMINI_API_KEY = "";
    expect(fakeService().isConfigured()).toBe(false);
  });

  it("calculates deterministic delivery metrics", () => {
    const result = fakeService().computeMetrics(
      "I mean, um, this is basically a clear and specific example.",
    );
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.fillerWordCount).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("bounds empty and filler-heavy transcripts safely", () => {
    const empty = fakeService().computeMetrics("");
    expect(empty.wordCount).toBe(0);
    expect(empty.score).toBe(75);
  });

  it("uses separate timeout signals for Groq and Gemini fallback", async () => {
    const service = fakeService();
    const captured: AbortSignal[] = [];
    const testSurface = service as unknown as {
      streamFromGroq(
        system: string,
        turns: Array<{ role: "user" | "assistant"; content: string }>,
        signal?: AbortSignal,
      ): AsyncGenerator<string, void, void>;
      streamFromGemini(
        system: string,
        turns: Array<{ role: "user" | "assistant"; content: string }>,
        signal?: AbortSignal,
      ): AsyncGenerator<string, void, void>;
      streamWithFailover(
        system: string,
        turns: Array<{ role: "user" | "assistant"; content: string }>,
        state: { provider: "groq" | "gemini" },
        externalSignal?: AbortSignal,
      ): AsyncGenerator<string, void, void>;
    };

    testSurface.streamFromGroq = async function* (
      _system,
      _turns,
      signal,
    ): AsyncGenerator<string, void, void> {
      if (signal) captured.push(signal);
      throw new Error("Groq unavailable");
    };
    testSurface.streamFromGemini = async function* (
      _system,
      _turns,
      signal,
    ): AsyncGenerator<string, void, void> {
      if (signal) captured.push(signal);
      yield "fallback";
    };

    const state = { provider: "groq" as "groq" | "gemini" };
    const tokens: string[] = [];
    for await (const token of testSurface.streamWithFailover(
      "system",
      [{ role: "user", content: "hello" }],
      state,
    )) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["fallback"]);
    expect(state.provider).toBe("gemini");
    expect(captured).toHaveLength(2);
    expect(captured[0]).not.toBe(captured[1]);
  });

  it("does not start Gemini fallback after client cancellation", async () => {
    const service = fakeService();
    const testSurface = service as unknown as {
      streamFromGroq(
        system: string,
        turns: Array<{ role: "user" | "assistant"; content: string }>,
        signal?: AbortSignal,
      ): AsyncGenerator<string, void, void>;
      streamWithFailover(
        system: string,
        turns: Array<{ role: "user" | "assistant"; content: string }>,
        state: { provider: "groq" | "gemini" },
        externalSignal?: AbortSignal,
      ): AsyncGenerator<string, void, void>;
    };
    const controller = new AbortController();
    controller.abort();
    testSurface.streamFromGroq = async function* (): AsyncGenerator<string, void, void> {
      throw new Error("client cancelled");
    };
    let geminiCalled = false;
    (service as unknown as {
      streamFromGemini(): AsyncGenerator<string, void, void>;
    }).streamFromGemini = async function* (): AsyncGenerator<string, void, void> {
      geminiCalled = true;
      yield "unexpected";
    };

    const state = { provider: "groq" as "groq" | "gemini" };
    const tokens: string[] = [];
    for await (const token of testSurface.streamWithFailover(
      "system",
      [{ role: "user", content: "hello" }],
      state,
      controller.signal,
    )) {
      tokens.push(token);
    }
    expect(geminiCalled).toBe(false);
    expect(tokens).toEqual([]);
  });
});
