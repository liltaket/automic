import { describe, expect, it, vi } from "vitest";
import {
  classify,
  classifyWithRules,
  isExplicitDirectedLatestCaption,
} from "../core/classifier.js";
import { TurnEngine } from "../core/engine.js";
import { normalizeSettings } from "../core/settings.js";
import {
  DEFAULT_SETTINGS,
  type Caption,
  type Classification,
  type Settings,
} from "../core/types.js";

const configured = (overrides: Partial<Settings> = {}): Settings =>
  normalizeSettings({
    ...DEFAULT_SETTINGS,
    name: "Bruno Hjorth",
    aliases: ["Bruno", "Hjorth"],
    backend: "rules",
    ...overrides,
  });

const caption = (
  id: string,
  text: string,
  timestamp = 10_000,
  speaker = "Erik",
): Caption => ({ id, text, timestamp, speaker });

function ollayaPositive(confidence = 0.991): Classification {
  return {
    decision: "UNMUTE",
    confidence,
    probabilities: {
      UNMUTE: confidence,
      STAY_MUTED: (1 - confidence) * 0.6,
      UNCERTAIN: (1 - confidence) * 0.4,
    },
    source: "ollaya",
    reason: "native model probabilities",
    latencyMs: 2,
  };
}

describe("settings normalization", () => {
  it("keeps endpoints on the supported loopback origin and clamps auto to at least .97", () => {
    expect(
      normalizeSettings({
        mode: "auto",
        threshold: 0.4,
        endpoint: "https://example.com:11435",
      }),
    ).toMatchObject({
      mode: "auto",
      threshold: 0.97,
      endpoint: DEFAULT_SETTINGS.endpoint,
    });
    expect(
      normalizeSettings({ endpoint: "http://localhost:11435" }).endpoint,
    ).toBe("http://localhost:11435");
    expect(
      normalizeSettings({ endpoint: "http://127.0.0.1:11435/proxy" }).endpoint,
    ).toBe(DEFAULT_SETTINGS.endpoint);
  });
});

describe("conservative rules", () => {
  it.each([
    ["Bruno, what do you think?", "UNMUTE"],
    ["Bruno, vet du varför det händer?", "UNMUTE"],
    ["Hjorth, can you take this one?", "UNMUTE"],
    ["Bruno, go ahead.", "UNMUTE"],
    ["Överlämnar till Bruno.", "UNMUTE"],
    ["Bruno?", "UNCERTAIN"],
    ["Bruno nämnde det igår.", "STAY_MUTED"],
    ["Jag och Bruno diskuterade det.", "STAY_MUTED"],
    ["Anna said Bruno, can you answer?", "STAY_MUTED"],
    ["Bruno, don’t unmute yet; wait.", "STAY_MUTED"],
    ["Bruno, vad tycker ni?", "UNCERTAIN"],
    ["Vad tycker ni om det?", "UNCERTAIN"],
    ["What do you think?", "UNCERTAIN"],
  ] as const)("%s => %s", (text, expected) => {
    expect(
      classifyWithRules([caption("last", text)], configured()).decision,
    ).toBe(expected);
  });

  it("requires the latest caption itself to explicitly address the named participant", () => {
    expect(
      isExplicitDirectedLatestCaption(
        [
          caption("prior", "Erik: Bruno, what do you think?"),
          caption("last", "Vad tycker ni?"),
        ],
        configured(),
      ),
    ).toBe(false);
    expect(
      isExplicitDirectedLatestCaption(
        [caption("last", "Bruno, vad tycker du?")],
        configured(),
      ),
    ).toBe(true);
  });
});

describe("Ollaya native adapter", () => {
  it("sends participant and context, then returns raw answers.turn probabilities", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fakeFetch: typeof fetch = vi.fn(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        done_reason: "decide",
        state_truncated: false,
        answers: {
          turn: {
            type: "choice",
            choice: "UNMUTE",
            probabilities: { UNMUTE: 0.62, STAY_MUTED: 0.28, UNCERTAIN: 0.1 },
          },
        },
      });
    });
    const result = await classify(
      [caption("last", "Bruno, what do you think?")],
      configured({ backend: "ollaya" }),
      undefined,
      fakeFetch,
    );
    const bodyState = requestBody?.state as {
      participant: { name: string; aliases: string[] };
      recent_conversation: unknown[];
    };

    expect(result.decision).toBe("UNMUTE");
    expect(result.confidence).toBe(0.62);
    expect(result.probabilities.UNMUTE).toBe(0.62);
    expect(bodyState.participant).toEqual({
      name: "Bruno Hjorth",
      aliases: ["Bruno", "Hjorth"],
    });
    expect(bodyState.recent_conversation).toHaveLength(1);
    expect(fakeFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:11435/api/decide",
      expect.any(Object),
    );
    expect(
      (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.redirect,
    ).toBe("error");
  });

  it("sanitizes a remote endpoint passed directly to classify", async () => {
    const fakeFetch: typeof fetch = vi.fn(async () =>
      Response.json({
        done_reason: "decide",
        answers: {
          turn: {
            type: "choice",
            choice: "UNMUTE",
            probabilities: { UNMUTE: 0.98, STAY_MUTED: 0.01, UNCERTAIN: 0.01 },
          },
        },
      }),
    );
    const unsafe = {
      ...configured({ backend: "ollaya" }),
      endpoint: "https://example.com:11435",
    };
    await classify(
      [caption("last", "Bruno, what do you think?")],
      unsafe,
      undefined,
      fakeFetch,
    );
    expect(fakeFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:11435/api/decide",
      expect.any(Object),
    );
  });

  it("rejects truncated, malformed, and timed-out responses", async () => {
    const truncated: typeof fetch = vi.fn(async () =>
      Response.json({
        state_truncated: true,
        answers: {
          turn: {
            type: "choice",
            probabilities: { UNMUTE: 1, STAY_MUTED: 0, UNCERTAIN: 0 },
          },
        },
      }),
    );
    await expect(
      classify(
        [caption("last", "Bruno, what do you think?")],
        configured({ backend: "ollaya" }),
        undefined,
        truncated,
      ),
    ).rejects.toThrow("truncated");

    const malformed: typeof fetch = vi.fn(async () =>
      Response.json({
        answers: {
          turn: {
            type: "choice",
            choice: "UNMUTE",
            probabilities: { UNMUTE: 0.95, STAY_MUTED: 0.01, UNCERTAIN: 0.01 },
          },
        },
      }),
    );
    await expect(
      classify(
        [caption("last", "Bruno, what do you think?")],
        configured({ backend: "ollaya" }),
        undefined,
        malformed,
      ),
    ).rejects.toThrow("incomplete or malformed");

    vi.useFakeTimers();
    try {
      const slow: typeof fetch = vi.fn(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      );
      const pending = classify(
        [caption("last", "Bruno, what do you think?")],
        configured({ backend: "ollaya" }),
        undefined,
        slow,
      );
      const rejected = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TurnEngine safety and races", () => {
  it("never auto-unmutes from rules, below threshold, or unless mute state is exactly true", async () => {
    const unmute = vi.fn(() => true);
    let nextResult: Classification = { ...ollayaPositive(), source: "rules" };
    const engine = new TurnEngine({
      classify: async () => nextResult,
      controller: { isMuted: () => true, unmute },
      delayMs: 0,
      now: () => 10_000,
    });
    engine.setSettings(
      configured({ mode: "auto", backend: "rules", notifyBeforeUnmute: false }),
    );
    expect(
      (await engine.ingest(caption("rules", "Bruno, what do you think?")))
        .action,
    ).toBe("blocked");
    expect(unmute).not.toHaveBeenCalled();

    engine.setSettings(
      configured({
        mode: "auto",
        backend: "ollaya",
        notifyBeforeUnmute: false,
      }),
    );
    nextResult = ollayaPositive(0.96);
    expect(
      (
        await engine.ingest(
          caption("weak", "Bruno, what do you think?", 10_000),
        )
      ).action,
    ).toBe("blocked");
    expect(unmute).not.toHaveBeenCalled();

    const unknownMute = new TurnEngine({
      classify: async () => ollayaPositive(),
      controller: { isMuted: () => null, unmute },
      delayMs: 0,
      now: () => 10_000,
    });
    unknownMute.setSettings(
      configured({
        mode: "auto",
        backend: "ollaya",
        notifyBeforeUnmute: false,
      }),
    );
    expect(
      (
        await unknownMute.ingest(
          caption("unknown", "Bruno, what do you think?"),
        )
      ).action,
    ).toBe("blocked");
    expect(unmute).not.toHaveBeenCalled();
  });

  it("notifies before the delay and cancellation prevents auto-unmute", async () => {
    const unmute = vi.fn(() => true);
    const notified = vi.fn(() => engine.cancelPending());
    const engine = new TurnEngine({
      classify: async () => ollayaPositive(),
      controller: { isMuted: () => true, unmute },
      onNotify: notified,
      delayMs: 1_200,
      now: () => 10_000,
    });
    engine.setSettings(
      configured({ mode: "auto", backend: "ollaya", notifyBeforeUnmute: true }),
    );
    const event = await engine.ingest(
      caption("cancel", "Bruno, what do you think?"),
    );
    expect(event.action).toBe("ignored");
    expect(notified).toHaveBeenCalledOnce();
    expect(unmute).not.toHaveBeenCalled();
  });

  it("forwards the exact authorized caption to unmute and enforces cooldown", async () => {
    let now = 10_000;
    const unmute = vi.fn((_approvedCaption: Caption) => true);
    const engine = new TurnEngine({
      classify: async () => ollayaPositive(),
      controller: { isMuted: () => true, unmute },
      delayMs: 0,
      now: () => now,
    });
    engine.setSettings(
      configured({
        mode: "auto",
        backend: "ollaya",
        notifyBeforeUnmute: false,
      }),
    );
    const approved = caption("approved", "Bruno, what do you think?", now);
    expect((await engine.ingest(approved)).action).toBe("unmuted");
    expect(unmute).toHaveBeenCalledWith(approved);
    now += 1_000;
    expect(
      (await engine.ingest(caption("repeat", "Bruno, what do you think?", now)))
        .reason,
    ).toBe("unmute_cooldown_active");
    expect(unmute).toHaveBeenCalledOnce();
  });

  it("requires a fresh explicit latest caption and rechecks freshness after the delay", async () => {
    let now = 10_000;
    const unmute = vi.fn(() => true);
    const notifies = vi.fn(() => {
      now += 13_000;
    });
    const engine = new TurnEngine({
      classify: async () => ollayaPositive(),
      controller: { isMuted: () => true, unmute },
      onNotify: notifies,
      delayMs: 0,
      now: () => now,
    });
    engine.setSettings(
      configured({ mode: "auto", backend: "ollaya", notifyBeforeUnmute: true }),
    );
    const old = await engine.ingest(
      caption("old", "Bruno, what do you think?", now - 13_000),
    );
    expect(old.action).toBe("ignored");

    const notExplicit = await engine.ingest(
      caption("group", "Vad tycker ni?", now),
    );
    expect(notExplicit.action).toBe("blocked");
    expect(notifies).not.toHaveBeenCalled();

    const expired = await engine.ingest(
      caption("expired", "Bruno, what do you think?", now),
    );
    expect(expired.action).toBe("blocked");
    expect(expired.reason).toBe("caption_expired_before_unmute");
    expect(unmute).not.toHaveBeenCalled();
  });

  it("keeps last four rows, deduplicates ids, replaces current revisions, and rejects old revisions", async () => {
    const seenContexts: Caption[][] = [];
    const engine = new TurnEngine({
      classify: async (context) => {
        seenContexts.push(context);
        return classifyWithRules(context, configured());
      },
      controller: { isMuted: () => true, unmute: () => true },
      now: () => 10_000,
    });
    engine.setSettings(configured());
    for (let i = 0; i < 6; i++)
      await engine.ingest(caption(`id-${i}`, `ordinary line ${i}`, 9_990 + i));
    expect(seenContexts.at(-1)).toHaveLength(4);
    expect(seenContexts.at(-1)?.map((item) => item.id)).toEqual([
      "id-2",
      "id-3",
      "id-4",
      "id-5",
    ]);
    expect(
      (await engine.ingest(caption("id-5", "ordinary line 5", 9_995))).reason,
    ).toBe("duplicate_caption");
    await engine.ingest(caption("id-5", "Bruno, what do you think?", 10_000));
    expect(seenContexts.at(-1)?.at(-1)?.text).toBe("Bruno, what do you think?");
    const staleRevision = await engine.ingest(
      caption("id-3", "Bruno, what do you think?", 10_000),
    );
    expect(staleRevision.reason).toBe("stale_caption_revision");
  });

  it("invalidates in-flight results when a newer caption or settings arrive, and bounds its event log", async () => {
    let release: ((value: Classification) => void) | undefined;
    let first = true;
    const classifyMock = vi.fn(
      (_context: Caption[], _settings: Settings, _signal?: AbortSignal) => {
        if (first) {
          first = false;
          return new Promise<Classification>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(classifyWithRules(_context, configured()));
      },
    );
    const engine = new TurnEngine({
      classify: classifyMock,
      controller: { isMuted: () => true, unmute: () => true },
      now: () => 10_000,
    });
    engine.setSettings(configured());
    const pending = engine.ingest(caption("pending", "first turn", 10_000));
    engine.setSettings(configured({ threshold: 0.98 }));
    release?.(ollayaPositive());
    expect((await pending).action).toBe("ignored");

    for (let i = 0; i < 55; i++)
      await engine.ingest(caption(`event-${i}`, `line ${i}`, 10_000 + i));
    expect(engine.events).toHaveLength(50);
    engine.destroy();
    expect(engine.events).toHaveLength(0);
  });
});

describe("Meet self-speaker labels", () => {
  it.each(["You", "Du", "Someone (You)", "Someone (Du)"])(
    "ignores %s before inference",
    async (speaker) => {
      const classify = vi.fn(async () => ollayaPositive());
      const unmute = vi.fn(() => true);
      const engine = new TurnEngine({
        classify,
        controller: { isMuted: () => true, unmute },
        now: () => 10000,
      });
      engine.setSettings(
        configured({
          backend: "ollaya",
          mode: "auto",
          notifyBeforeUnmute: false,
        }),
      );
      await engine.ingest(
        caption("self", "Bruno, can you answer?", 10000, speaker),
      );
      expect(classify).not.toHaveBeenCalled();
      expect(unmute).not.toHaveBeenCalled();
    },
  );
});
