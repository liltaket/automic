import { TurnEngine } from "../core/engine";
import { classify } from "../core/classifier";
import {
  DEFAULT_SETTINGS,
  type Caption,
  type DetectionEvent,
  type Settings,
} from "../core/types";
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
let muted = true;
let serial = 0;
let settings: Settings = {
  ...DEFAULT_SETTINGS,
  name: "Bruno Hjorth",
  aliases: ["Bruno", "Hjorth"],
  backend: "rules",
};
let session = 0;
const controller = {
  isMuted: () => muted,
  unmute: () => {
    muted = false;
    renderMic();
    return true;
  },
};
// The dev server proxies the fixed loopback Ollaya API; no remote endpoint is accepted.
const localFetch: typeof fetch = (url, init) =>
  fetch(String(url).endsWith("/api/decide") ? "/api/decide" : url, init);
const engine = new TurnEngine({
  controller,
  classify: (context, prefs, signal) =>
    classify(context, prefs, signal, localFetch),
  onEvent: showEvent,
  onNotify: (event) => {
    el("notice-box").hidden = false;
    el("notice-text").textContent =
      settings.mode === "auto"
        ? "Opening the simulated mic shortly. Cancel to stay muted."
        : event.caption.text;
  },
});
engine.setSettings(settings);
function renderMic() {
  el("mic-display").classList.toggle("live", !muted);
  el("mic-status").textContent = muted ? "Mic muted" : "Mic open";
  el("mic-symbol").textContent = muted ? "◉" : "◎";
  el("toggle-mic").textContent = muted ? "Unmute manually" : "Mute manually";
  el("mobile-mic").textContent = muted
    ? "Mic muted · simulated"
    : "Mic open · simulated";
}
function showEvent(event: DetectionEvent) {
  el("decision").textContent = {
    UNMUTE: "Your turn",
    STAY_MUTED: "Stay muted",
    UNCERTAIN: "Not sure yet",
  }[event.result.decision];
  if (
    event.result.source === "ollaya" &&
    event.result.decision === "UNMUTE" &&
    event.result.probabilities.UNMUTE < settings.threshold
  )
    el("decision").textContent = "Possible turn · below threshold";
  el("mobile-decision").textContent = el("decision").textContent;
  el("reason").textContent = event.reason || event.result.reason;
  el("confidence").textContent =
    event.result.source === "rules"
      ? "Rule heuristic"
      : `${(event.result.probabilities.UNMUTE * 100).toFixed(1)}%`;
  el("latency").textContent = `${Math.round(event.result.latencyMs)} ms`;
  el("action").textContent = event.action;
  el("engine-status").textContent =
    event.action === "error" ? "Model unavailable" : "Ready";
  if (event.action !== "notify") el("notice-box").hidden = true;
  const row = document.createElement("li");
  row.textContent = `${event.result.source} · ${event.result.decision} · ${event.action} — ${event.caption.text}`;
  el("events").prepend(row);
  while (el("events").children.length > 50)
    el("events").lastElementChild?.remove();
  renderMic();
}
function reset() {
  session++;
  engine.clear();
  muted = true;
  renderMic();
  el("transcript").replaceChildren();
  el("events").replaceChildren();
  el("mobile-decision").textContent = "Waiting for a caption";
  el("decision").textContent = "Waiting for a caption";
  el("reason").textContent = "Only a direct invitation should open the mic.";
  for (const id of ["confidence", "latency", "action"])
    el(id).textContent = "—";
  el("notice-box").hidden = true;
  el("engine-status").textContent = "Ready";
}
async function send(text: string, speaker = "Anna") {
  el("empty")?.remove();
  const caption: Caption = {
    id: `sim-${++serial}`,
    text,
    speaker,
    timestamp: Date.now(),
  };
  const row = document.createElement("div");
  row.className = "utterance";
  const name = document.createElement("span");
  name.className = "speaker";
  name.textContent = speaker;
  const body = document.createElement("p");
  body.textContent = text;
  row.append(name, body);
  el("transcript").append(row);
  while (el("transcript").children.length > 30)
    el("transcript").firstElementChild?.remove();
  el("transcript").scrollTop = el("transcript").scrollHeight;
  el("engine-status").textContent = "Deciding…";
  await engine.ingest(caption);
}
el("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  session++;
  settings = engine.setSettings({
    ...settings,
    name: input("name").value,
    aliases: input("aliases")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    mode: input("mode").value,
    backend: input("backend").value,
    threshold: Number(input("threshold").value) / 100,
    notifyBeforeUnmute: input("notice").checked,
  });
  input("mode").value = settings.mode;
  input("threshold").value = String(settings.threshold * 100);
  el("notice-box").hidden = true;
  el("saved").textContent =
    settings.backend === "rules" && settings.mode === "auto"
      ? "Rules cannot auto-unmute. Choose Laya for automatic action."
      : "Settings applied to this session.";
});
el("backend").addEventListener("change", () => {
  el("backend-note").textContent =
    input("backend").value === "rules"
      ? "Rules demonstrate the pipeline. They cannot automatically unmute."
      : "Requires Ollaya on 127.0.0.1:11435 with laya:multilingual. Captions stay on this computer.";
});
el("caption-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input("caption").value.trim();
  if (!text) return;
  input("caption").value = "";
  await send(text, input("speaker").value.trim() || "Anna");
});
el("toggle-mic").addEventListener("click", () => {
  engine.cancelPending();
  muted = !muted;
  el("notice-box").hidden = true;
  renderMic();
});
el("cancel").addEventListener("click", () => {
  engine.cancelPending();
  el("notice-box").hidden = true;
  el("action").textContent = "Cancelled";
});
el("reset").addEventListener("click", reset);
el("clear-log").addEventListener("click", () => el("events").replaceChildren());
const scenarios: Record<string, string[]> = {
  direct: [
    "I think the second option is simpler.",
    "Bruno, what do you think?",
  ],
  mention: ["Bruno mentioned this yesterday."],
  group: ["What do you all think?"],
  handoff: ["Let’s move on to the technical details.", "Bruno, over to you."],
  torture: [
    "Bruno nämnde det igår.",
    "Jag och Bruno diskuterade det.",
    "Could Bruno and Anna have discussed it yesterday?",
    "Vad tycker ni?",
    "Do not unmute Bruno.",
    "Bruno, vet du varför den gör så?",
  ],
};
document
  .querySelectorAll<HTMLButtonElement>("[data-scenario]")
  .forEach((button) =>
    button.addEventListener("click", async () => {
      reset();
      const current = session;
      for (const text of scenarios[button.dataset.scenario!]) {
        if (current !== session) break;
        await send(text);
        if (current !== session) break;
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }),
  );
window.addEventListener("pagehide", () => engine.destroy());
renderMic();
