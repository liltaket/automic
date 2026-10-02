import { TurnEngine } from "../core/engine.js";
import { classify } from "../core/classifier.js";
import {
  DEFAULT_SETTINGS,
  type Caption,
  type DetectionEvent,
  type MeetingController,
  type Settings,
} from "../core/types.js";
import { safeSettings, SETTINGS_STORAGE_KEY } from "./settings.js";

type ContentMessage =
  | { type: "GET_SETTINGS" }
  | {
      type: "MEETING_STATE";
      state: { inMeeting: boolean; muted: boolean | null; listening: boolean };
    }
  | { type: "CAPTION"; caption: Caption }
  | { type: "LISTENING_STATE"; listening: boolean };

type PopupMessage = { type: "GET_STATUS" };

interface Session {
  tabId: number;
  documentId?: string;
  engine: TurnEngine;
  status: { inMeeting: boolean; muted: boolean | null; listening: boolean };
  settings: Settings;
}

const sessions = new Map<number, Session>();
let settingsPromise: Promise<Settings> | null = null;

function isMeetContentSender(sender: chrome.runtime.MessageSender): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    typeof sender.tab?.id !== "number"
  )
    return false;
  try {
    return new URL(sender.url ?? "").origin === "https://meet.google.com";
  } catch {
    return false;
  }
}

function isPopupSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    const url = new URL(sender.url ?? "");
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === chrome.runtime.id &&
      url.pathname.endsWith("/popup.html")
    );
  } catch {
    return false;
  }
}

async function readSettings(): Promise<Settings> {
  if (!settingsPromise) {
    settingsPromise = chrome.storage.local
      .get(SETTINGS_STORAGE_KEY)
      .then((values) =>
        safeSettings(values[SETTINGS_STORAGE_KEY] ?? DEFAULT_SETTINGS),
      );
  }
  return settingsPromise;
}

function sendToTab(tabId: number, message: unknown): void {
  const session = sessions.get(tabId);
  const send = session?.documentId
    ? chrome.tabs.sendMessage(tabId, message, {
        documentId: session.documentId,
      })
    : chrome.tabs.sendMessage(tabId, message);
  void send.catch(() => undefined);
}

function createSession(
  tabId: number,
  documentId: string | undefined,
  settings: Settings,
): Session {
  let session!: Session;
  const controller: MeetingController = {
    isMuted: () => (session.status.inMeeting ? session.status.muted : null),
    unmute: async (caption: Caption) => {
      if (
        sessions.get(tabId) !== session ||
        !session.status.inMeeting ||
        session.status.muted !== true ||
        !session.status.listening
      )
        return false;
      try {
        const reply = (await chrome.tabs.sendMessage(
          tabId,
          { type: "COMMAND_UNMUTE", caption },
          documentId ? { documentId } : undefined,
        )) as { unmuted?: unknown } | undefined;
        const unmuted = reply?.unmuted === true;
        if (unmuted) session.status.muted = false;
        return unmuted;
      } catch {
        return false;
      }
    },
  };

  const deliverEvent = (type: string, event: DetectionEvent) => {
    if (sessions.get(tabId) === session) sendToTab(tabId, { type, event });
  };
  const engine = new TurnEngine({
    classify,
    controller,
    onEvent: (event) => deliverEvent("TURN_EVENT", event),
    onNotify: (event) => deliverEvent("TURN_NOTICE", event),
  });
  engine.setSettings(settings);
  session = {
    tabId,
    documentId,
    engine,
    settings,
    status: { inMeeting: false, muted: null, listening: false },
  };
  sessions.set(tabId, session);
  return session;
}

async function ensureSession(
  tabId: number,
  documentId: string | undefined,
): Promise<Session> {
  const settings = await readSettings();
  let current = sessions.get(tabId);
  if (current && current.documentId !== documentId) {
    current.engine.destroy();
    sessions.delete(tabId);
    current = undefined;
  }
  if (current) {
    if (JSON.stringify(current.settings) !== JSON.stringify(settings)) {
      current.settings = settings;
      current.engine.setSettings(settings);
    }
    return current;
  }
  return createSession(tabId, documentId, settings);
}

function validCaption(value: unknown): value is Caption {
  if (!value || typeof value !== "object") return false;
  const caption = value as Record<string, unknown>;
  return (
    typeof caption.id === "string" &&
    caption.id.length > 0 &&
    caption.id.length <= 200 &&
    typeof caption.text === "string" &&
    caption.text.trim().length > 0 &&
    caption.text.length <= 1200 &&
    (caption.speaker === undefined ||
      (typeof caption.speaker === "string" && caption.speaker.length <= 100)) &&
    typeof caption.timestamp === "number" &&
    Number.isFinite(caption.timestamp)
  );
}

async function handleContentMessage(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isMeetContentSender(sender)) return undefined;
  const tabId = sender.tab!.id!;
  const documentId = sender.documentId;

  if (message.type === "GET_SETTINGS") return readSettings();

  const session = await ensureSession(tabId, documentId);
  if (message.type === "MEETING_STATE") {
    const state = message.state;
    if (
      !state ||
      typeof state.inMeeting !== "boolean" ||
      typeof state.listening !== "boolean" ||
      (state.muted !== null && typeof state.muted !== "boolean")
    )
      return undefined;
    session.status = {
      inMeeting: state.inMeeting,
      muted: state.muted,
      listening: state.listening,
    };
    if (!state.inMeeting || !state.listening) {
      session.engine.cancelPending();
      session.engine.clear();
    }
    return { ok: true };
  }
  if (message.type === "LISTENING_STATE") {
    if (typeof message.listening !== "boolean") return undefined;
    session.status.listening = message.listening;
    if (!message.listening) {
      session.engine.cancelPending();
      session.engine.clear();
    }
    return { ok: true };
  }
  if (message.type === "CAPTION") {
    if (
      !validCaption(message.caption) ||
      !session.status.inMeeting ||
      !session.status.listening ||
      session.status.muted !== true
    )
      return undefined;
    // Acknowledge receipt without waiting for the model or auto-unmute grace period.
    // Newer captions must keep flowing so the engine can invalidate stale candidates.
    void session.engine.ingest(message.caption).catch((error) => {
      if (sessions.get(tabId) !== session) return;
      const event: DetectionEvent = {
        caption: message.caption,
        result: {
          decision: "UNCERTAIN",
          confidence: 0,
          probabilities: { UNMUTE: 0, STAY_MUTED: 0, UNCERTAIN: 1 },
          source: session.settings.backend,
          reason:
            error instanceof Error ? error.message : "Classification failed.",
          latencyMs: 0,
        },
        action: "error",
        timestamp: Date.now(),
      };
      sendToTab(tabId, { type: "TURN_EVENT", event });
    });
    return { ok: true };
  }
  return undefined;
}

async function handlePopupMessage(message: PopupMessage): Promise<unknown> {
  if (message.type !== "GET_STATUS") return undefined;
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const session =
    typeof tab?.id === "number" ? sessions.get(tab.id) : undefined;
  return { settings: await readSettings(), status: session?.status ?? null };
}

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, sender, sendResponse) => {
    const message = rawMessage as { type?: unknown };
    const trustedContent = isMeetContentSender(sender);
    const trustedPopup = isPopupSender(sender);
    if (!message || typeof message.type !== "string") return false;
    if (trustedPopup && message.type === "GET_STATUS") {
      void handlePopupMessage(rawMessage as PopupMessage).then(
        sendResponse,
        () => sendResponse({ settings: DEFAULT_SETTINGS, status: null }),
      );
      return true;
    }
    if (trustedContent) {
      void handleContentMessage(rawMessage as ContentMessage, sender).then(
        sendResponse,
        () => sendResponse(undefined),
      );
      return true;
    }
    return false;
  },
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SETTINGS_STORAGE_KEY]) return;
  const settings = safeSettings(
    changes[SETTINGS_STORAGE_KEY].newValue ?? DEFAULT_SETTINGS,
  );
  settingsPromise = Promise.resolve(settings);
  for (const session of sessions.values()) {
    session.settings = settings;
    session.engine.setSettings(settings);
    sendToTab(session.tabId, { type: "SETTINGS_UPDATED", settings });
    if (settings.mode === "off") {
      session.engine.cancelPending();
      session.engine.clear();
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = sessions.get(tabId);
  session?.engine.destroy();
  sessions.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading" && !changeInfo.url) return;
  const session = sessions.get(tabId);
  session?.engine.destroy();
  sessions.delete(tabId);
});
