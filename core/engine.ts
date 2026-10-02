import { isExplicitDirectedLatestCaption } from "./classifier.js";
import { normalizeSettings } from "./settings.js";
import {
  DEFAULT_SETTINGS,
  type Caption,
  type Classification,
  type Classifier,
  type DetectionEvent,
  type MeetingController,
  type Settings,
} from "./types.js";

export interface TurnEngineOptions {
  classify: Classifier;
  controller: MeetingController;
  onEvent?: (event: DetectionEvent) => void;
  onNotify?: (event: DetectionEvent) => void;
  now?: () => number;
  delayMs?: number;
  cooldownMs?: number;
}

const MAX_CONTEXT = 4;
const MAX_EVENTS = 50;
const MAX_SEEN_IDS = 256;
const DEFAULT_DELAY_MS = 1_200;
const DEFAULT_COOLDOWN_MS = 5_000;
const MAX_CAPTION_AGE_MS = 12_000;
const MAX_FUTURE_SKEW_MS = 2_000;
const NOTIFY_THRESHOLD = 0.75;

/**
 * Holds only a short in-memory caption window and coordinates safe actions.
 * Every accepted caption supersedes pending inference and notification work.
 */
export class TurnEngine {
  private readonly classifyCaption: Classifier;
  private readonly controller: MeetingController;
  private readonly onEvent?: (event: DetectionEvent) => void;
  private readonly onNotify?: (event: DetectionEvent) => void;
  private readonly now: () => number;
  private readonly delayMs: number;
  private readonly cooldownMs: number;
  private currentSettings: Settings = normalizeSettings(DEFAULT_SETTINGS);
  private context: Caption[] = [];
  private seen = new Map<string, string>();
  private eventLog: DetectionEvent[] = [];
  private latestTimestamp = Number.NEGATIVE_INFINITY;
  private generation = 0;
  private pendingAbort?: AbortController;
  private pendingDelay?: {
    timer: ReturnType<typeof setTimeout>;
    resolve: (completed: boolean) => void;
  };
  private lastUnmuteAt = Number.NEGATIVE_INFINITY;
  private destroyed = false;

  constructor(options: TurnEngineOptions) {
    this.classifyCaption = options.classify;
    this.controller = options.controller;
    this.onEvent = options.onEvent;
    this.onNotify = options.onNotify;
    this.now = options.now ?? Date.now;
    this.delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  }

  get settings(): Settings {
    return {
      ...this.currentSettings,
      aliases: [...this.currentSettings.aliases],
    };
  }

  get events(): readonly DetectionEvent[] {
    return this.eventLog.map((event) => ({
      ...event,
      caption: { ...event.caption },
      result: cloneClassification(event.result),
    }));
  }

  setSettings(raw: unknown): Settings {
    const next = normalizeSettings(raw);
    if (JSON.stringify(next) !== JSON.stringify(this.currentSettings)) {
      this.currentSettings = next;
      this.cancelPending();
    }
    return this.settings;
  }

  async ingest(input: Caption): Promise<DetectionEvent> {
    const caption: Caption = {
      id: typeof input?.id === "string" ? input.id.trim() : "",
      speaker:
        typeof input?.speaker === "string" ? input.speaker.trim() : undefined,
      text: typeof input?.text === "string" ? input.text.trim() : "",
      timestamp:
        typeof input?.timestamp === "number" && Number.isFinite(input.timestamp)
          ? input.timestamp
          : this.now(),
    };
    if (this.destroyed)
      return this.ephemeral(caption, "ignored", "engine_destroyed");
    if (!caption.id || !caption.text)
      return this.record(caption, "ignored", "empty_caption");
    if (isSelfSpeaker(caption.speaker, this.currentSettings)) {
      this.cancelPending();
      return this.record(caption, "ignored", "self_caption");
    }

    const previousText = this.seen.get(caption.id);
    const isRevision =
      previousText !== undefined && previousText !== caption.text;
    if (previousText === caption.text)
      return this.record(caption, "ignored", "duplicate_caption");
    if (!isFreshTimestamp(caption.timestamp, this.now()))
      return this.record(caption, "ignored", "caption_timestamp_out_of_window");
    const contextIndex = this.context.findIndex(
      (item) => item.id === caption.id,
    );
    if (
      isRevision &&
      (contextIndex < 0 || contextIndex !== this.context.length - 1)
    ) {
      return this.record(caption, "ignored", "stale_caption_revision");
    }
    if (!isRevision && caption.timestamp < this.latestTimestamp)
      return this.record(caption, "ignored", "stale_caption");

    this.cancelPending();
    const accepted = { ...caption };
    if (contextIndex >= 0) this.context.splice(contextIndex, 1);
    this.context.push(accepted);
    if (this.context.length > MAX_CONTEXT)
      this.context.splice(0, this.context.length - MAX_CONTEXT);
    this.latestTimestamp = Math.max(this.latestTimestamp, accepted.timestamp);
    this.seen.delete(caption.id);
    this.seen.set(caption.id, caption.text);
    while (this.seen.size > MAX_SEEN_IDS)
      this.seen.delete(this.seen.keys().next().value as string);

    const token = this.generation;
    const settings = this.settings;
    if (settings.mode === "off")
      return this.record(accepted, "ignored", "mode_off");

    const abort = new AbortController();
    this.pendingAbort = abort;
    let result: Classification;
    try {
      result = await this.classifyCaption(
        this.context.map((item) => ({ ...item })),
        settings,
        abort.signal,
      );
    } catch (error) {
      if (!this.isCurrent(token, accepted) || abort.signal.aborted)
        return this.ephemeral(accepted, "ignored", "superseded");
      const message =
        error instanceof Error ? error.message : "Classification failed.";
      return this.record(
        accepted,
        "error",
        message,
        errorClassification(message, settings.backend),
      );
    }
    if (!this.isCurrent(token, accepted))
      return this.ephemeral(accepted, "ignored", "superseded", result);

    if (settings.mode === "shadow")
      return this.record(accepted, "shadow", undefined, result);
    if (settings.mode === "notify") {
      if (
        hasValidProbabilities(result) &&
        result.probabilities.UNMUTE >= NOTIFY_THRESHOLD
      ) {
        const event = this.record(accepted, "notify", undefined, result);
        this.notify(event);
        return event;
      }
      return this.record(
        accepted,
        "shadow",
        "notification_threshold_not_met",
        result,
      );
    }
    return this.handleAuto(accepted, result, settings, token);
  }

  /** Abort current inference or delayed unmute. This is also the UI cancel hook. */
  cancelPending(): void {
    this.generation++;
    this.pendingAbort?.abort();
    this.pendingAbort = undefined;
    if (this.pendingDelay) {
      clearTimeout(this.pendingDelay.timer);
      this.pendingDelay.resolve(false);
      this.pendingDelay = undefined;
    }
  }

  /** Clear current meeting captions, deduplication state, event history and cooldown. */
  clear(): void {
    this.cancelPending();
    this.context = [];
    this.seen.clear();
    this.eventLog = [];
    this.latestTimestamp = Number.NEGATIVE_INFINITY;
    this.lastUnmuteAt = Number.NEGATIVE_INFINITY;
  }

  destroy(): void {
    this.cancelPending();
    this.destroyed = true;
    this.context = [];
    this.seen.clear();
    this.eventLog = [];
  }

  private async handleAuto(
    caption: Caption,
    result: Classification,
    settings: Settings,
    token: number,
  ): Promise<DetectionEvent> {
    if (!isTurnPrediction(result, Math.max(0.97, settings.threshold))) {
      return this.record(
        caption,
        "blocked",
        "confidence_below_auto_threshold",
        result,
      );
    }
    if (!settings.name.trim())
      return this.record(
        caption,
        "blocked",
        "participant_name_required",
        result,
      );
    if (result.source !== "ollaya" || settings.backend !== "ollaya") {
      return this.record(caption, "blocked", "auto_requires_ollaya", result);
    }
    if (!isExplicitDirectedLatestCaption(this.context, settings)) {
      return this.record(
        caption,
        "blocked",
        "latest_caption_not_explicitly_directed",
        result,
      );
    }
    if (this.now() - this.lastUnmuteAt < this.cooldownMs) {
      return this.record(caption, "blocked", "unmute_cooldown_active", result);
    }
    if (!this.isMuted())
      return this.record(
        caption,
        "blocked",
        "meeting_is_not_confirmed_muted",
        result,
      );

    if (settings.notifyBeforeUnmute) {
      const notice = this.record(
        caption,
        "notify",
        "unmute_pending_user_cancel_window",
        result,
      );
      this.notify(notice);
      if (!this.isCurrent(token, caption))
        return this.ephemeral(
          caption,
          "ignored",
          "cancelled_or_superseded",
          result,
        );
      const completed = await this.waitBeforeUnmute();
      if (!completed)
        return this.ephemeral(
          caption,
          "ignored",
          "cancelled_or_superseded",
          result,
        );
    }

    if (!this.isCurrent(token, caption))
      return this.ephemeral(
        caption,
        "ignored",
        "cancelled_or_superseded",
        result,
      );
    if (!isFreshTimestamp(caption.timestamp, this.now()))
      return this.record(
        caption,
        "blocked",
        "caption_expired_before_unmute",
        result,
      );
    if (this.now() - this.lastUnmuteAt < this.cooldownMs) {
      return this.record(caption, "blocked", "unmute_cooldown_active", result);
    }
    if (!this.isMuted())
      return this.record(
        caption,
        "blocked",
        "meeting_is_not_confirmed_muted",
        result,
      );

    try {
      const success = await this.controller.unmute(caption);
      if (!success)
        return this.record(caption, "blocked", "unmute_action_failed", result);
      this.lastUnmuteAt = this.now();
      return this.record(caption, "unmuted", undefined, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unmute action failed.";
      return this.record(caption, "error", message, result);
    }
  }

  private waitBeforeUnmute(): Promise<boolean> {
    if (this.delayMs === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const pending = {
        timer: setTimeout(() => {
          if (this.pendingDelay === pending) this.pendingDelay = undefined;
          resolve(true);
        }, this.delayMs),
        resolve,
      };
      this.pendingDelay = pending;
    });
  }

  private isCurrent(token: number, caption: Caption): boolean {
    if (this.destroyed || token !== this.generation) return false;
    const latest = this.context.at(-1);
    return latest?.id === caption.id && latest.text === caption.text;
  }

  private isMuted(): boolean {
    try {
      return this.controller.isMuted() === true;
    } catch {
      return false;
    }
  }

  private notify(event: DetectionEvent): void {
    try {
      this.onNotify?.(event);
    } catch {
      // UI notification errors must not bypass the action safety checks.
    }
  }

  private record(
    caption: Caption,
    action: DetectionEvent["action"],
    reason?: string,
    result = neutralClassification(reason),
  ): DetectionEvent {
    const event: DetectionEvent = {
      caption: { ...caption },
      result: cloneClassification(result),
      action,
      reason,
      timestamp: this.now(),
    };
    this.eventLog.push(event);
    if (this.eventLog.length > MAX_EVENTS)
      this.eventLog.splice(0, this.eventLog.length - MAX_EVENTS);
    try {
      this.onEvent?.(event);
    } catch {
      // A logging callback cannot be allowed to interrupt safe turn handling.
    }
    return event;
  }

  private ephemeral(
    caption: Caption,
    action: DetectionEvent["action"],
    reason?: string,
    result = neutralClassification(reason),
  ): DetectionEvent {
    return {
      caption: { ...caption },
      result: cloneClassification(result),
      action,
      reason,
      timestamp: this.now(),
    };
  }
}

function isTurnPrediction(result: Classification, threshold: number): boolean {
  return (
    result.decision === "UNMUTE" &&
    hasValidProbabilities(result) &&
    Number.isFinite(result.confidence) &&
    Math.abs(result.confidence - result.probabilities.UNMUTE) <= 0.0001 &&
    result.probabilities.UNMUTE >= threshold
  );
}

function hasValidProbabilities(result: Classification): boolean {
  const values = [
    result.probabilities?.UNMUTE,
    result.probabilities?.STAY_MUTED,
    result.probabilities?.UNCERTAIN,
  ];
  return (
    values.every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1,
    ) && Math.abs(values.reduce((sum, value) => sum + value!, 0) - 1) <= 0.005
  );
}

function isFreshTimestamp(timestamp: number, now: number): boolean {
  const ageMs = now - timestamp;
  return ageMs <= MAX_CAPTION_AGE_MS && ageMs >= -MAX_FUTURE_SKEW_MS;
}

function isSelfSpeaker(
  speaker: string | undefined,
  settings: Settings,
): boolean {
  if (!speaker?.trim()) return false;
  if (
    /^(?:you|du|me|jag)$/iu.test(speaker.trim()) ||
    /\((?:you|du|me|jag)\)\s*$/iu.test(speaker)
  )
    return true;
  const normalizedSpeaker = fold(
    speaker.replace(/\s*\((?:you|me)\)\s*$/iu, ""),
  );
  const aliases = [settings.name, ...settings.aliases]
    .map(fold)
    .filter(Boolean);
  return aliases.some(
    (alias) =>
      normalizedSpeaker === alias ||
      ` ${normalizedSpeaker} `.includes(` ${alias} `),
  );
}

function fold(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .replace(/\s+/gu, " ")
    .trim();
}

function cloneClassification(result: Classification): Classification {
  return { ...result, probabilities: { ...result.probabilities } };
}

function neutralClassification(
  reason = "No classification was produced.",
): Classification {
  return {
    decision: "UNCERTAIN",
    confidence: 1,
    probabilities: { UNMUTE: 0, STAY_MUTED: 0, UNCERTAIN: 1 },
    source: "rules",
    reason,
    latencyMs: 0,
  };
}

function errorClassification(
  reason: string,
  source: Classification["source"],
): Classification {
  return {
    ...neutralClassification(reason),
    source,
    confidence: 0,
    probabilities: { UNMUTE: 0, STAY_MUTED: 0, UNCERTAIN: 0 },
  };
}
