import type { Caption, DetectionEvent } from "../core/types.js";
import { MeetAdapter, readMeetState, type MeetState } from "./meet.js";
import { safeSettings } from "./settings.js";

const OVERLAY_ID = "automic-extension-host";
const SEND_DEBOUNCE_MS = 140;

interface RuntimeMessage {
  type?: string;
  settings?: unknown;
  event?: DetectionEvent;
  caption?: Caption;
  unmuted?: boolean;
}

class MeetContentApp {
  private readonly adapter: MeetAdapter;
  private settings = safeSettings(null);
  private listening = false;
  private manuallyPaused = false;
  private state: MeetState = { inMeeting: false, muted: null };
  private host: HTMLElement | null = null;
  private statusElement: HTMLElement | null = null;
  private detailElement: HTMLElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;
  private logElement: HTMLOListElement | null = null;
  private notices: string[] = [];
  private latestSummary = "";
  private noticeElement: HTMLElement | null = null;
  private captionQueue: Promise<void> = Promise.resolve();
  private latestCaption: Caption | null = null;
  private destroyed = false;

  constructor() {
    this.adapter = new MeetAdapter({
      onCaption: (caption) => this.handleCaption(caption),
      onState: (state) => this.handleMeetState(state),
      debounceMs: SEND_DEBOUNCE_MS,
    });
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    window.addEventListener("pagehide", this.destroy, { once: true });
    void this.initialize();
  }

  private initialize = async (): Promise<void> => {
    this.ensureOverlay();
    const reply = (await chrome.runtime.sendMessage({
      type: "GET_SETTINGS",
    })) as { mode?: unknown } | undefined;
    this.settings = safeSettings(reply);
    this.listening = this.settings.mode !== "off";
    this.adapter.refresh();
    if (this.listening) this.adapter.start();
    this.render();
    this.sendListeningState();
  };

  private onRuntimeMessage = (
    message: RuntimeMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | void => {
    if (_sender.id !== chrome.runtime.id) return;
    if (!message || typeof message.type !== "string") return;
    if (message.type === "COMMAND_UNMUTE") {
      void this.unmuteAndVerify(message.caption).then(sendResponse, () =>
        sendResponse({ unmuted: false }),
      );
      return true;
    }
    if (message.type === "SETTINGS_UPDATED") {
      if (this.noticeElement) this.noticeElement.hidden = true;
      this.latestSummary = "";
      this.settings = safeSettings(message.settings);
      if (this.settings.mode === "off") {
        this.setListening(false, false);
      } else if (!this.manuallyPaused) {
        this.setListening(true, false);
      }
      this.render();
      return;
    }
    if (message.type === "TURN_EVENT" || message.type === "TURN_NOTICE") {
      if (message.event)
        this.handleEvent(message.event, message.type === "TURN_NOTICE");
    }
  };

  private async unmuteAndVerify(
    authorization: Caption | undefined,
  ): Promise<{ unmuted: boolean }> {
    if (
      !this.listening ||
      this.manuallyPaused ||
      this.settings.mode !== "auto" ||
      this.settings.backend !== "ollaya" ||
      !this.state.inMeeting ||
      this.state.muted !== true
    ) {
      return { unmuted: false };
    }
    if (!authorization || !this.isLatestCaption(authorization))
      return { unmuted: false };
    const current = readMeetState(document);
    if (!current.inMeeting || current.muted !== true) {
      this.handleMeetState(current);
      return { unmuted: false };
    }
    if (
      !this.isLatestCaption(authorization) ||
      !this.listening ||
      this.manuallyPaused
    )
      return { unmuted: false };
    if (!this.adapter.unmute()) return { unmuted: false };
    await new Promise((resolve) => setTimeout(resolve, 220));
    const state = readMeetState(document);
    this.handleMeetState(state);
    return { unmuted: state.inMeeting && state.muted === false };
  }

  private isLatestCaption(authorization: Caption): boolean {
    return Boolean(
      this.latestCaption &&
        this.latestCaption.id === authorization.id &&
        this.latestCaption.text === authorization.text &&
        this.latestCaption.timestamp === authorization.timestamp,
    );
  }

  private ensureOverlay(): void {
    if (this.host?.isConnected) return;
    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "2147483647";
    host.style.font = "13px/1.4 system-ui, -apple-system, sans-serif";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .card { width: 280px; color: #263831; background: #fffef9; border: 1px solid #c8d0c2; border-radius: 12px; box-shadow: 0 8px 30px #18271e33; padding: 12px; }
      header { display:flex; align-items:center; justify-content:space-between; gap:12px; font-weight:650; }
      .status { margin-top:8px; color:#263831; }
      .detail { margin-top:4px; color:#52665b; overflow-wrap:anywhere; }
      button { margin-top:10px; padding:6px 10px; color:#fffef9; background:#244f39; border:1px solid #244f39; border-radius:7px; cursor:pointer; font:inherit; }
      button:focus-visible { outline:3px solid #76a887; outline-offset:2px; }
      button:disabled { opacity:.55; cursor:not-allowed; }
      ol { max-height:120px; overflow:auto; margin:10px 0 0; padding-left:20px; color:#52665b; }
      li { margin:4px 0; }
      .notice { margin-top:8px; color:#244f39; font-weight:700; }
      [hidden] { display:none !important; }
    `;
    const card = document.createElement("section");
    card.className = "card";
    card.setAttribute("aria-label", "Automic meeting assistant");
    const header = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = "Automic";
    const badge = document.createElement("span");
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "●";
    badge.style.color = "#244f39";
    header.append(title, badge);
    const status = document.createElement("div");
    status.className = "status";
    status.setAttribute("role", "status");
    const detail = document.createElement("div");
    detail.className = "detail";
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    notice.hidden = true;
    this.noticeElement = notice;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      if (this.listening) {
        this.setListening(false, true);
      } else if (this.settings.mode !== "off") {
        this.setListening(true, true);
      }
    });
    const log = document.createElement("ol");
    log.setAttribute("aria-label", "Temporary decision log");
    log.hidden = true;
    card.append(header, status, detail, notice, toggle, log);
    shadow.append(style, card);
    (document.body ?? document.documentElement).append(host);
    this.host = host;
    this.statusElement = status;
    this.detailElement = detail;
    this.toggleButton = toggle;
    this.logElement = log;
  }

  private setListening(listening: boolean, userInitiated: boolean): void {
    if (this.settings.mode === "off" && listening) return;
    if (userInitiated) this.manuallyPaused = !listening;
    this.listening = listening;
    if (listening) this.adapter.start();
    else {
      this.adapter.stop();
      this.latestCaption = null;
      this.notices = [];
      this.latestSummary = "";
      this.clearNotice();
      this.renderLog();
    }
    this.sendListeningState();
    this.render();
  }

  private sendListeningState(): void {
    void chrome.runtime
      .sendMessage({ type: "LISTENING_STATE", listening: this.listening })
      .catch(() => undefined);
  }

  private handleMeetState(state: MeetState): void {
    this.state = state;
    if (!state.inMeeting) {
      this.latestCaption = null;
      this.notices = [];
      this.latestSummary = "";
      this.clearNotice();
      this.renderLog();
    }
    void chrome.runtime
      .sendMessage({
        type: "MEETING_STATE",
        state: { ...state, listening: this.listening },
      })
      .catch(() => undefined);
    this.render();
  }

  private handleCaption(caption: Caption): void {
    this.latestCaption = caption;
    if (
      !this.listening ||
      !this.state.inMeeting ||
      this.state.muted !== true ||
      this.settings.mode === "off"
    )
      return;
    this.captionQueue = this.captionQueue
      .then(async () => {
        if (
          !this.listening ||
          !this.state.inMeeting ||
          this.state.muted !== true ||
          this.settings.mode === "off"
        )
          return;
        // Refresh the service worker's volatile session before every caption. MV3 can
        // suspend the worker between turns, so this status message must be awaited.
        await chrome.runtime.sendMessage({
          type: "MEETING_STATE",
          state: { ...this.state, listening: this.listening },
        });
        if (
          !this.listening ||
          !this.state.inMeeting ||
          this.state.muted !== true
        )
          return;
        await chrome.runtime.sendMessage({ type: "CAPTION", caption });
      })
      .catch(() => undefined);
  }

  private handleEvent(event: DetectionEvent, notice: boolean): void {
    if (!notice && event.action !== "notify" && this.noticeElement)
      this.noticeElement.hidden = true;
    if (notice) {
      this.showNotice(
        event.result.source === "rules"
          ? "Possible turn cue · rules demo"
          : `Your turn? ${Math.round(event.result.confidence * 100)}%`,
      );
    }
    if (event.action === "error") {
      this.latestSummary =
        event.result.source === "ollaya"
          ? `Ollaya unavailable: ${event.result.reason} Check that the local service is running at ${this.settings.endpoint}.`
          : `Decision error: ${event.result.reason}`;
    } else if (event.result.source === "rules") {
      this.latestSummary = `Rules demo · ${event.result.decision} · ${event.action}`;
    } else {
      this.latestSummary = `${event.result.decision} · ${Math.round(event.result.confidence * 100)}% · ${Math.round(event.result.latencyMs)} ms · ${event.action}`;
    }
    if (this.settings.debug) {
      const confidence =
        event.result.source === "rules"
          ? "rules demo"
          : `${Math.round(event.result.confidence * 100)}%`;
      const line = `${event.result.decision} · ${confidence} · ${event.action} · ${event.caption.text}`;
      this.notices = [line, ...this.notices].slice(0, 10);
      this.renderLog();
    }
    this.render();
  }

  private showNotice(text: string): void {
    if (!this.noticeElement) return;
    this.noticeElement.textContent = text;
    this.noticeElement.hidden = false;
    this.render();
  }

  private clearNotice(): void {
    if (!this.noticeElement) return;
    this.noticeElement.textContent = "";
    this.noticeElement.hidden = true;
  }

  private renderLog(): void {
    const list = this.logElement;
    if (!list) return;
    list.replaceChildren();
    for (const text of this.notices) {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    }
    list.hidden = !this.settings.debug || this.notices.length === 0;
  }

  private render(): void {
    this.ensureOverlay();
    if (!this.statusElement || !this.detailElement || !this.toggleButton)
      return;
    this.statusElement.textContent =
      this.settings.mode === "off"
        ? "Listening is off in settings."
        : !this.state.inMeeting
          ? "Waiting to join a meeting."
          : !this.listening
            ? "Paused."
            : this.state.muted === true
              ? "Listening for live captions."
              : this.state.muted === false
                ? "Your microphone is already on."
                : "Meeting found; microphone state is unknown.";
    this.detailElement.textContent =
      this.latestSummary ||
      (this.settings.backend === "rules"
        ? "Rules demo mode · automatic unmute is disabled."
        : this.settings.mode === "shadow"
          ? "Shadow mode · decisions never change your microphone."
          : "Local classifier · strict confidence threshold.");
    this.toggleButton.textContent = this.listening
      ? "Pause listening"
      : "Resume listening";
    this.toggleButton.disabled = this.settings.mode === "off";
    if (this.noticeElement && !this.noticeElement.hidden && this.listening) {
      this.toggleButton.textContent = "Cancel / pause listening";
    }
    this.renderLog();
  }

  private destroy = (): void => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listening = false;
    this.adapter.stop();
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    void chrome.runtime
      .sendMessage({ type: "LISTENING_STATE", listening: false })
      .catch(() => undefined);
    this.host?.remove();
  };
}

const app = new MeetContentApp();
void app;
