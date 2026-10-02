import type { Caption } from "../core/types.js";

export interface MeetState {
  inMeeting: boolean;
  muted: boolean | null;
}

export interface MeetAdapterOptions {
  document?: Document;
  onCaption(caption: Caption): void;
  onState(state: MeetState): void;
  debounceMs?: number;
}

const CAPTION_LABEL =
  /captions?|subtitles?|transcript|undertexter|textning|transkription|livetext/iu;
const LABEL_ATTRIBUTES = ["aria-label", "title", "data-tooltip"];
const MUTED_LABEL =
  /^(?:turn on|enable|unmute|activate) (?:your )?microphone(?:\b|$)|^(?:slå på|aktivera) (?:din )?mikrofon(?:en)?(?:\b|$)/iu;
const UNMUTED_LABEL =
  /^(?:turn off|disable|mute|deactivate) (?:your )?microphone(?:\b|$)|^(?:stäng av|inaktivera) (?:din )?mikrofon(?:en)?(?:\b|$)/iu;
const LEAVE_CALL_LABEL =
  /^(?:leave|end) (?:the )?(?:call|meeting)(?:\b|$)|^(?:lämna|avsluta) (?:samtalet|mötet|möte)(?:\b|$)/iu;

// Semantic labels and caption roles are preferred. Meet's fallback hooks are kept here
// because the caption DOM has no stable public API and classes/jsname values can change.
const FALLBACK_ROOT_SELECTORS = [
  "[data-caption-container]",
  "[data-live-caption]",
  '[jsname="tgaKEf"]',
  ".a4cQT",
];
const ROW_SELECTOR = [
  "[data-caption]",
  "[data-transcript-line]",
  '[role="listitem"]',
  '[role="row"]',
  '[jsname="tgaKEf"]',
  '[jsname="t4oc9b"]',
  ".iOzk7",
].join(",");
const ROW_SELECTOR_PARTS = ROW_SELECTOR.split(",");
const CAPTION_TEXT_SELECTOR =
  '[data-caption-text], [data-transcript-text], [class*="caption-text" i]';
const SPEAKER_SELECTOR =
  '[data-speaker], [aria-label^="Speaker:" i], [aria-label^="Talare:" i]';

interface CaptionRowState {
  id: string;
  text: string;
}

interface RecentCaption {
  id: string;
  text: string;
  lastSeen: number;
}

/**
 * Google Meet DOM adapter. It only reads a recognized caption region and semantic
 * microphone/leave buttons; it never serializes or scans the page's general text.
 */
export class MeetAdapter {
  private readonly documentRef: Document;
  private readonly onCaption: (caption: Caption) => void;
  private readonly onState: (state: MeetState) => void;
  private readonly debounceMs: number;
  private nodeCaptions = new WeakMap<Element, CaptionRowState>();
  private readonly recentBySignature = new Map<string, RecentCaption>();
  private readonly recentBySpeaker = new Map<string, RecentCaption>();
  private observer: MutationObserver | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRoot: Element | null = null;
  private lastState: MeetState | null = null;
  private baselineNeeded = true;
  private sequence = 0;
  private running = false;

  constructor(options: MeetAdapterOptions) {
    this.documentRef = options.document ?? document;
    this.onCaption = options.onCaption;
    this.onState = options.onState;
    this.debounceMs = options.debounceMs ?? 140;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const target = this.documentRef.documentElement;
    const Observer = this.documentRef.defaultView?.MutationObserver;
    if (target && Observer) {
      this.observer = new Observer(() => this.scheduleRefresh());
      this.observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "aria-label",
          "aria-live",
          "title",
          "class",
          "jsname",
          "data-caption",
        ],
      });
    }
    this.refresh();
  }

  stop(): void {
    this.running = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.currentRoot = null;
    this.baselineNeeded = true;
  }

  /** Click the unique, semantically labelled "enable microphone" control only. */
  unmute(): boolean {
    const state = readMeetState(this.documentRef);
    if (!state.inMeeting || state.muted !== true) return false;
    const controls = Array.from(
      this.documentRef.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ).filter(
      (button) =>
        isUsableControl(button) &&
        accessibleLabels(button).some((label) =>
          MUTED_LABEL.test(normalizeLabel(label)),
        ),
    );
    if (controls.length !== 1) return false;
    controls[0]!.click();
    return true;
  }

  /** Public for deterministic DOM adapter checks and explicit refresh after UI state changes. */
  refresh(): void {
    const state = readMeetState(this.documentRef);
    if (
      !this.lastState ||
      state.inMeeting !== this.lastState.inMeeting ||
      state.muted !== this.lastState.muted
    ) {
      if (!state.inMeeting || !this.lastState?.inMeeting)
        this.resetCaptionBaseline();
      this.lastState = state;
      this.onState(state);
    }

    const root = findCaptionRoot(this.documentRef);
    if (root !== this.currentRoot) {
      this.currentRoot = root;
      this.baselineNeeded = true;
    }
    if (!state.inMeeting || !root) return;
    const now = Date.now();
    pruneRecent(this.recentBySignature, now);
    pruneRecent(this.recentBySpeaker, now);
    const rows = extractCaptionRows(root);
    if (this.baselineNeeded) {
      for (const row of rows) this.seedRow(row, now);
      this.baselineNeeded = false;
      return;
    }
    for (const row of rows) this.acceptRow(row, now);
  }

  private scheduleRefresh(): void {
    if (!this.running) return;
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.refresh();
    }, this.debounceMs);
  }

  private resetCaptionBaseline(): void {
    this.baselineNeeded = true;
    this.nodeCaptions = new WeakMap<Element, CaptionRowState>();
    this.recentBySignature.clear();
    this.recentBySpeaker.clear();
  }

  private seedRow(row: ParsedRow, now: number): void {
    const id =
      this.nodeCaptions.get(row.element)?.id ??
      `meet-caption-${++this.sequence}`;
    this.nodeCaptions.set(row.element, { id, text: row.text });
    this.remember(row, id, now);
  }

  private acceptRow(row: ParsedRow, now: number): void {
    const existing = this.nodeCaptions.get(row.element);
    if (existing) {
      if (existing.text === row.text) return;
      existing.text = row.text;
      this.remember(row, existing.id, now);
      this.emit(row, existing.id, now);
      return;
    }

    const signature = `${row.speaker.toLocaleLowerCase("sv-SE")}\u241f${row.text.toLocaleLowerCase("sv-SE")}`;
    const exact = this.recentBySignature.get(signature);
    if (exact && now - exact.lastSeen <= 1800) {
      this.nodeCaptions.set(row.element, { id: exact.id, text: row.text });
      exact.lastSeen = now;
      return;
    }

    const speakerKey = row.speaker.toLocaleLowerCase("sv-SE");
    const recentSpeaker = speakerKey
      ? this.recentBySpeaker.get(speakerKey)
      : undefined;
    const revision =
      recentSpeaker &&
      now - recentSpeaker.lastSeen <= 5000 &&
      isLikelyRevision(recentSpeaker.text, row.text)
        ? recentSpeaker
        : undefined;
    const id = revision?.id ?? `meet-caption-${++this.sequence}`;
    this.nodeCaptions.set(row.element, { id, text: row.text });
    this.remember(row, id, now);
    this.emit(row, id, now);
  }

  private remember(row: ParsedRow, id: string, now: number): void {
    const signature = `${row.speaker.toLocaleLowerCase("sv-SE")}\u241f${row.text.toLocaleLowerCase("sv-SE")}`;
    this.recentBySignature.set(signature, {
      id,
      text: row.text,
      lastSeen: now,
    });
    const speakerKey = row.speaker.toLocaleLowerCase("sv-SE");
    if (speakerKey)
      this.recentBySpeaker.set(speakerKey, {
        id,
        text: row.text,
        lastSeen: now,
      });
  }

  private emit(row: ParsedRow, id: string, now: number): void {
    this.onCaption({
      id,
      speaker: row.speaker || undefined,
      text: row.text,
      timestamp: now,
    });
  }
}

export function readMeetState(root: ParentNode): MeetState {
  const buttons = Array.from(
    root.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ).filter(isUsableControl);
  const leaveCall = buttons.some((button) =>
    accessibleLabels(button).some((label) =>
      LEAVE_CALL_LABEL.test(normalizeLabel(label)),
    ),
  );
  if (!leaveCall) return { inMeeting: false, muted: null };

  const mutedControls = buttons.filter((button) =>
    accessibleLabels(button).some((label) =>
      MUTED_LABEL.test(normalizeLabel(label)),
    ),
  );
  const unmutedControls = buttons.filter((button) =>
    accessibleLabels(button).some((label) =>
      UNMUTED_LABEL.test(normalizeLabel(label)),
    ),
  );
  if (mutedControls.length === 1 && unmutedControls.length === 0)
    return { inMeeting: true, muted: true };
  if (mutedControls.length === 0 && unmutedControls.length === 1)
    return { inMeeting: true, muted: false };
  return { inMeeting: true, muted: null };
}

/** Find only labelled caption regions or documented Meet-specific fallback hooks. */
export function findCaptionRoot(root: ParentNode): Element | null {
  const semantic = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[aria-label], [aria-labelledby], [role="log"], [aria-live]',
    ),
  ).filter(
    (element) =>
      !element.matches('button, [role="button"]') &&
      CAPTION_LABEL.test(accessibleRegionLabel(element)),
  );
  if (semantic.length) {
    semantic.sort((a, b) => textLength(b) - textLength(a));
    // Prefer the outer caption region when Meet labels both a region and its live child.
    return (
      semantic.find(
        (candidate) =>
          !semantic.some(
            (other) => other !== candidate && other.contains(candidate),
          ),
      ) ?? semantic[0]!
    );
  }

  for (const selector of FALLBACK_ROOT_SELECTORS) {
    const candidate = root.querySelector(selector);
    if (candidate) {
      const knownContainer = candidate.closest(
        "[data-caption-container], .a4cQT",
      );
      return knownContainer ?? candidate;
    }
  }
  return null;
}

interface ParsedRow {
  element: Element;
  speaker: string;
  text: string;
}

export function extractCaptionRows(root: Element): ParsedRow[] {
  const explicit = [
    ...(matchesAnyRowSelector(root) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(ROW_SELECTOR)),
  ];
  let candidates = uniqueElements(explicit);
  // An outer row already includes its nested speaker/text nodes; avoid double ingestion.
  candidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => other !== candidate && other.contains(candidate),
      ),
  );

  if (!candidates.length) {
    candidates = Array.from(root.children).filter(
      (child) => normalizeText(child.textContent ?? "") !== "",
    );
  }
  if (!candidates.length && normalizeText(root.textContent ?? ""))
    candidates = [root];

  const rows: ParsedRow[] = [];
  for (const element of candidates) {
    const parsed = parseCaptionRow(element);
    if (parsed) rows.push({ element, ...parsed });
  }
  return rows;
}

function parseCaptionRow(element: Element): Omit<ParsedRow, "element"> | null {
  if (element.querySelector('button, [role="button"]')) return null;
  const dedicatedText = element.matches(CAPTION_TEXT_SELECTOR)
    ? element.textContent
    : element.querySelector(CAPTION_TEXT_SELECTOR)?.textContent;
  let speaker = "";
  const speakerElement = element.matches(SPEAKER_SELECTOR)
    ? element
    : element.querySelector(SPEAKER_SELECTOR);
  if (speakerElement) {
    speaker = normalizeText(
      speakerElement.getAttribute("data-speaker") ??
        speakerElement.textContent ??
        "",
    ).replace(/^(?:speaker|talare):\s*/iu, "");
  }

  const raw = normalizeText((dedicatedText ?? element.textContent) || "");
  if (!raw) return null;
  let text = raw;
  if (!speaker) {
    const lines = visibleText(element)
      .split("\n")
      .map(normalizeText)
      .filter(Boolean);
    if (lines.length > 1) {
      speaker = lines[0]!;
      text = normalizeText(lines.slice(1).join(" "));
    } else {
      const separated = /^([^:：]{1,80})\s*[:：]\s*(.+)$/u.exec(raw);
      if (separated) {
        speaker = normalizeText(separated[1]!);
        text = normalizeText(separated[2]!);
      }
    }
  } else if (!dedicatedText) {
    const lines = visibleText(element)
      .split("\n")
      .map(normalizeText)
      .filter(Boolean);
    text =
      normalizeText(lines.filter((line) => line !== speaker).join(" ")) ||
      raw.replace(speaker, "").trim();
  }

  if (!text || text.length > 1200) return null;
  return { speaker: speaker.slice(0, 100), text };
}

function visibleText(element: Element): string {
  const htmlElement = element as HTMLElement;
  return typeof htmlElement.innerText === "string"
    ? htmlElement.innerText
    : (element.textContent ?? "");
}

function accessibleLabels(element: HTMLElement): string[] {
  const labels = LABEL_ATTRIBUTES.map((attribute) =>
    element.getAttribute(attribute),
  ).filter((value): value is string => Boolean(value));
  const text = normalizeText(element.innerText || element.textContent || "");
  if (text) labels.push(text);
  return labels;
}

function isUsableControl(element: HTMLElement): boolean {
  if (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    element.hidden ||
    element.closest('[hidden], [aria-hidden="true"]')
  )
    return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.visibility !== "collapse"
  );
}

function accessibleRegionLabel(element: HTMLElement): string {
  const direct = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
  ]
    .filter(Boolean)
    .join(" ");
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/u) ?? [];
  const labelledBy = ids
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
  return `${direct} ${labelledBy}`.trim();
}

function normalizeLabel(value: string): string {
  return normalizeText(
    value.replace(
      /\s*\([^)]*(?:⌘|ctrl|control|alt|option|shift)[^)]*\)\s*$/iu,
      "",
    ),
  );
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/gu, " ")
    .replace(/[\t\r\f\v ]+/gu, " ")
    .replace(/\n+/gu, "\n")
    .trim();
}

function matchesAnyRowSelector(element: Element): boolean {
  return ROW_SELECTOR_PARTS.some((selector) => element.matches(selector));
}

function uniqueElements(elements: Element[]): Element[] {
  return [...new Set(elements)];
}

function textLength(element: Element): number {
  return normalizeText(element.textContent ?? "").length;
}

function pruneRecent(map: Map<string, RecentCaption>, now: number): void {
  for (const [key, item] of map) {
    if (now - item.lastSeen > 30_000) map.delete(key);
  }
  while (map.size > 250) map.delete(map.keys().next().value!);
}

function isLikelyRevision(previous: string, next: string): boolean {
  const a = previous.toLocaleLowerCase("sv-SE");
  const b = next.toLocaleLowerCase("sv-SE");
  return a !== b && (a.startsWith(b) || b.startsWith(a));
}
