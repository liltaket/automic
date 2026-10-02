import type { Caption, Classification, Decision, Settings } from "./types.js";
import { normalizeSettings } from "./settings.js";

const LABELS: Decision[] = ["UNMUTE", "STAY_MUTED", "UNCERTAIN"];
const DECIDE_TIMEOUT_MS = 5_000;

/** Cheap lexical gate so routine captions do not invoke the local model. */
export function couldBeTurnCandidate(
  context: Caption[],
  settings: Settings,
): boolean {
  const latest = context.at(-1);
  if (!latest || !latest.text.trim()) return false;
  const text = fold(latest.text);
  if (
    !settings.name.trim() ||
    isNegativeCommand(text) ||
    isGroupQuestion(text) ||
    isThirdPersonMention(text, settings)
  )
    return false;

  const hasName = matchingAliases(settings).some((alias) =>
    containsWholePhrase(text, alias),
  );
  if (hasName) {
    if (isBareName(text, settings)) return false;
    return hasAddressShape(text, settings);
  }
  return hasHandoff(text) || hasDirectSecondPersonCue(text);
}

/** True only when the latest caption names the participant and addresses them. */
export function isExplicitDirectedLatestCaption(
  context: Caption[],
  settings: Settings,
): boolean {
  const latest = context.at(-1);
  if (!latest) return false;
  const text = fold(latest.text);
  if (
    !settings.name.trim() ||
    isNegativeCommand(text) ||
    isGroupQuestion(text) ||
    isThirdPersonMention(text, settings)
  )
    return false;
  if (
    !matchingAliases(settings).some((alias) => containsWholePhrase(text, alias))
  )
    return false;
  return hasAddressShape(text, settings);
}

/** Rules are intentionally conservative; a rule decision can never authorize auto mode. */
export function classifyWithRules(
  context: Caption[],
  settings: Settings,
): Classification {
  const started = performance.now();
  const latest = context.at(-1);
  const text = fold(latest?.text ?? "");

  if (!latest || !text.trim())
    return result("STAY_MUTED", "rules", "Caption is empty.", started);
  if (!settings.name.trim())
    return result(
      "UNCERTAIN",
      "rules",
      "Participant name is not configured.",
      started,
    );
  if (isNegativeCommand(text))
    return result(
      "STAY_MUTED",
      "rules",
      "The caption contains a negative or wait instruction.",
      started,
    );
  if (isGroupQuestion(text))
    return result(
      "UNCERTAIN",
      "rules",
      "The caption addresses a group or uses a plural audience.",
      started,
    );
  if (isThirdPersonMention(text, settings))
    return result(
      "STAY_MUTED",
      "rules",
      "The name is mentioned in third person, not addressed directly.",
      started,
    );

  const hasName = matchingAliases(settings).some((alias) =>
    containsWholePhrase(text, alias),
  );
  if (hasName && isBareName(text, settings)) {
    return result(
      "UNCERTAIN",
      "rules",
      "A name alone is not enough to infer a speaking turn.",
      started,
    );
  }
  if (hasName && hasAddressShape(text, settings)) {
    return result(
      "UNMUTE",
      "rules",
      "The latest caption explicitly addresses the configured participant.",
      started,
    );
  }
  if (hasName)
    return result(
      "STAY_MUTED",
      "rules",
      "The configured name appears without a clear direct handoff.",
      started,
    );

  if (hasHandoff(text) || hasDirectSecondPersonCue(text)) {
    return result(
      "UNCERTAIN",
      "rules",
      "A possible turn cue has no explicit configured name.",
      started,
    );
  }
  return result(
    "STAY_MUTED",
    "rules",
    "No direct speaking-turn cue was found.",
    started,
  );
}

/** Ollaya native /api/decide adapter. Probabilities remain the model's raw values. */
export async function classify(
  context: Caption[],
  settings: Settings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Classification> {
  const started = performance.now();
  if (signal?.aborted) throw abortError();

  const safeSettings = normalizeSettings(settings);

  if (!safeSettings.name.trim())
    return result(
      "UNCERTAIN",
      "rules",
      "Participant name is not configured.",
      started,
    );
  if (
    safeSettings.backend === "rules" ||
    !couldBeTurnCandidate(context, safeSettings)
  ) {
    return classifyWithRules(context, safeSettings);
  }

  const combined = new AbortController();
  const abortFromCaller = () => combined.abort(signal?.reason ?? abortError());
  if (signal) signal.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => combined.abort(new Error("Ollaya request timed out.")),
    DECIDE_TIMEOUT_MS,
  );

  try {
    const endpoint = safeSettings.endpoint.replace(/\/$/, "");
    const response = await fetchImpl(`${endpoint}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({
        model: safeSettings.model,
        state: {
          participant: {
            name: safeSettings.name,
            aliases: safeSettings.aliases,
          },
          recent_conversation: context.slice(-4).map((caption) => ({
            speaker: caption.speaker ?? "Unknown participant",
            text: caption.text,
          })),
          latest_caption: context.at(-1)
            ? {
                speaker: context.at(-1)!.speaker ?? "Unknown participant",
                text: context.at(-1)!.text,
              }
            : null,
          task: "Determine whether the named participant is directly being given the speaking turn in the latest caption.",
        },
        questions: {
          turn: {
            type: "choice",
            instructions:
              "Is the configured participant being directly given the turn to speak right now? Use UNCERTAIN if the caption is ambiguous, addresses a group, or only mentions the participant.",
            criteria: {
              UNMUTE:
                "A clear, explicit direct question or handoff to this participant in the latest caption.",
              STAY_MUTED:
                "The participant is mentioned in third person, the question is for someone else, or there is no turn handoff.",
              UNCERTAIN:
                "There may be a handoff, but the latest caption does not clearly address this participant alone.",
            },
          },
        },
      }),
      signal: combined.signal,
    });
    if (!response.ok)
      throw new Error(`Ollaya returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const probabilities = readNativeProbabilities(payload);
    const decision = LABELS.reduce(
      (best, label) =>
        probabilities[label] > probabilities[best] ? label : best,
      LABELS[0]!,
    );
    return {
      decision,
      confidence: probabilities[decision],
      probabilities,
      source: "ollaya",
      reason: `Ollaya selected ${decision} from native turn probabilities.`,
      latencyMs: Math.max(0, performance.now() - started),
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (combined.signal.aborted) {
      if (
        combined.signal.reason instanceof Error &&
        combined.signal.reason.message.includes("timed out")
      ) {
        throw new Error("Ollaya request timed out.");
      }
      throw abortError();
    }
    throw error instanceof Error
      ? error
      : new Error("Ollaya returned an invalid response.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function readNativeProbabilities(payload: unknown): Record<Decision, number> {
  if (!payload || typeof payload !== "object")
    throw new Error("Ollaya response is not an object.");
  const root = payload as Record<string, unknown>;
  if (root.state_truncated === true)
    throw new Error("Ollaya truncated the caption context.");
  if (root.done_reason !== undefined && root.done_reason !== "decide")
    throw new Error("Ollaya response was not a completed decision.");
  const answers = root.answers;
  if (!answers || typeof answers !== "object")
    throw new Error("Ollaya response is missing answers.");
  const turn = (answers as Record<string, unknown>).turn;
  if (!turn || typeof turn !== "object")
    throw new Error("Ollaya response is missing answers.turn.");
  const answer = turn as Record<string, unknown>;
  if (
    answer.type !== "choice" ||
    typeof answer.choice !== "string" ||
    !LABELS.includes(answer.choice as Decision) ||
    !answer.probabilities ||
    typeof answer.probabilities !== "object"
  ) {
    throw new Error(
      "Ollaya answers.turn does not contain choice probabilities.",
    );
  }
  const raw = answer.probabilities as Record<string, unknown>;
  const probabilities = {} as Record<Decision, number>;
  for (const label of LABELS) {
    const probability = raw[label];
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error(`Ollaya returned an invalid ${label} probability.`);
    }
    probabilities[label] = probability;
  }
  const total = LABELS.reduce((sum, label) => sum + probabilities[label], 0);
  if (Math.abs(total - 1) > 0.005)
    throw new Error("Ollaya turn probabilities are incomplete or malformed.");
  const mostLikely = LABELS.reduce(
    (best, label) =>
      probabilities[label] > probabilities[best] ? label : best,
    LABELS[0]!,
  );
  if (answer.choice !== mostLikely)
    throw new Error("Ollaya turn choice disagrees with its probabilities.");
  return probabilities;
}

function result(
  decision: Decision,
  source: "rules",
  reason: string,
  started: number,
): Classification {
  const probabilities: Record<Decision, number> =
    decision === "UNMUTE"
      ? { UNMUTE: 0.99, STAY_MUTED: 0.005, UNCERTAIN: 0.005 }
      : decision === "STAY_MUTED"
        ? { UNMUTE: 0.005, STAY_MUTED: 0.99, UNCERTAIN: 0.005 }
        : { UNMUTE: 0.05, STAY_MUTED: 0.15, UNCERTAIN: 0.8 };
  return {
    decision,
    confidence: probabilities[decision],
    probabilities,
    source,
    reason,
    latencyMs: Math.max(0, performance.now() - started),
  };
}

function matchingAliases(settings: Settings): string[] {
  return [
    ...new Set([settings.name, ...settings.aliases].map(fold).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
}

function hasAddressShape(text: string, settings: Settings): boolean {
  if (isGroupQuestion(text) || isThirdPersonMention(text, settings))
    return false;
  const aliases = matchingAliases(settings);
  for (const alias of aliases) {
    const escaped = escapeRegExp(alias);
    // Vocatives at the start, including a short greeting, and named vocatives at the end.
    const leading = new RegExp(
      `^(?:(?:hey|hi|hej|hallå)\\s+)?${escaped}(?:\\s*[,!:—-]\\s*|\\s+)(.*)$`,
      "u",
    ).exec(text);
    if (
      leading &&
      (hasDirectSecondPersonCue(leading[1]!) || hasHandoff(leading[1]!))
    )
      return true;
    const trailing = new RegExp(`(?:[,—-]\\s*)${escaped}[.!?]*$`, "u").test(
      text,
    );
    if (
      trailing &&
      hasDirectSecondPersonCue(
        text.slice(0, Math.max(0, text.lastIndexOf(alias))),
      )
    )
      return true;
    if (hasHandoff(text) && containsWholePhrase(text, alias)) return true;
  }
  return false;
}

function isBareName(text: string, settings: Settings): boolean {
  return matchingAliases(settings).some(
    (alias) =>
      fold(text)
        .replace(/[.!?…,:;]+$/u, "")
        .trim() === alias,
  );
}

function hasDirectSecondPersonCue(text: string): boolean {
  return hasAnyPhrase(text, [
    "you",
    "your",
    "you're",
    "you’re",
    "do you",
    "did you",
    "can you",
    "could you",
    "would you",
    "will you",
    "are you",
    "what do you",
    "how do you",
    "your take",
    "du",
    "dig",
    "din",
    "ditt",
    "dina",
    "tycker du",
    "tänker du",
    "tror du",
    "kan du",
    "skulle du",
    "vill du",
    "vet du",
    "hur ser du",
    "vad säger du",
    "vad tycker du",
    "vad tänker du",
  ]);
}

function hasHandoff(text: string): boolean {
  return hasAnyPhrase(text, [
    "your turn",
    "go ahead",
    "over to",
    "take it away",
    "floor is yours",
    "you're up",
    "you’re up",
    "handing over to",
    "turnen går till",
    "ordet går till",
    "överlämnar till",
    "lämnar över till",
    "varsågod",
    "kör på",
  ]);
}

function isGroupQuestion(text: string): boolean {
  return hasAnyPhrase(text, [
    "you all",
    "all of you",
    "you guys",
    "everyone",
    "everybody",
    "anyone",
    "all of us",
    "alla",
    "ni",
    "er alla",
    "någon av er",
  ]);
}

function isThirdPersonMention(text: string, settings: Settings): boolean {
  return matchingAliases(settings).some((alias) => {
    if (!containsWholePhrase(text, alias)) return false;
    const escaped = escapeRegExp(alias);
    const thirdPersonVerb =
      "(?:said|mentioned|thinks|thought|told|asked|discussed|nämnde|sa|sade|tycker|tror|frågade|diskuterade|berättade)";
    const attributedBefore = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${thirdPersonVerb}\\s+(?:(?:that|att)\\s+)?${escaped}(?=$|[^\\p{L}\\p{N}_])`,
      "u",
    );
    const after = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${escaped}\\s+(?:said|mentioned|thinks|thought|told|asked|discussed|nämnde|sa|sade|tycker|tror|frågade|diskuterade)(?=$|[^\\p{L}\\p{N}_])`,
      "u",
    );
    const withPerson = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])(?:and|with|och|med)\\s+${escaped}(?=$|[^\\p{L}\\p{N}_])`,
      "u",
    );
    return (
      attributedBefore.test(text) || after.test(text) || withPerson.test(text)
    );
  });
}

function isNegativeCommand(text: string): boolean {
  return hasAnyPhrase(text, [
    "don't speak",
    "don’t speak",
    "do not speak",
    "don't unmute",
    "don’t unmute",
    "do not unmute",
    "don't answer",
    "don’t answer",
    "do not answer",
    "not your turn",
    "not yet",
    "wait",
    "hold on",
    "stay muted",
    "please stay muted",
    "vänta",
    "inte än",
    "säg inget",
    "prata inte",
    "avvakta",
  ]);
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    let start = text.indexOf(phrase);
    while (start >= 0) {
      const end = start + phrase.length;
      const before = start === 0 ? "" : text[start - 1]!;
      const after = end >= text.length ? "" : text[end]!;
      if (!isWordChar(before) && !isWordChar(after)) return true;
      start = text.indexOf(phrase, start + 1);
    }
    return false;
  });
}

function isWordChar(value: string): boolean {
  return !!value && /[\p{L}\p{N}_]/u.test(value);
}

function containsWholePhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = escapeRegExp(phrase);
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    "u",
  ).test(text);
}

function fold(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("sv-SE").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
