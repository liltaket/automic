import { DEFAULT_SETTINGS, type Settings } from "../core/types.js";
import { safeSettings, SETTINGS_STORAGE_KEY } from "./settings.js";

const form = document.querySelector<HTMLFormElement>("#settings-form")!;
const nameInput = document.querySelector<HTMLInputElement>("#name")!;
const aliasesInput = document.querySelector<HTMLInputElement>("#aliases")!;
const modeInput = document.querySelector<HTMLSelectElement>("#mode")!;
const thresholdInput = document.querySelector<HTMLInputElement>("#threshold")!;
const notifyInput = document.querySelector<HTMLInputElement>("#notify-before")!;
const debugInput = document.querySelector<HTMLInputElement>("#debug")!;
const backendInput = document.querySelector<HTMLSelectElement>("#backend")!;
const backendNote = document.querySelector<HTMLElement>("#backend-note")!;
const saveStatus = document.querySelector<HTMLElement>("#save-status")!;
const meetingStatus = document.querySelector<HTMLElement>("#meeting-status")!;

function settingsFromForm(): Settings {
  const aliases = aliasesInput.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return safeSettings({
    name: nameInput.value,
    aliases,
    mode: modeInput.value,
    threshold: Number(thresholdInput.value),
    notifyBeforeUnmute: notifyInput.checked,
    debug: debugInput.checked,
    backend: backendInput.value,
    endpoint: DEFAULT_SETTINGS.endpoint,
    model: DEFAULT_SETTINGS.model,
  });
}

function updateBackendNote(): void {
  const rules = backendInput.value === "rules";
  const autoOption = modeInput.querySelector<HTMLOptionElement>(
    'option[value="auto"]',
  );
  if (autoOption) autoOption.disabled = rules;
  if (rules && modeInput.value === "auto") modeInput.value = "shadow";
  backendNote.textContent = rules
    ? "Rules are for demos and evaluation; Auto-unmute is disabled with this backend."
    : "Ollaya requests go only to the configured loopback service at http://127.0.0.1:11435.";
}

function populate(settings: Settings): void {
  nameInput.value = settings.name;
  aliasesInput.value = settings.aliases.join(", ");
  modeInput.value = settings.mode;
  thresholdInput.value = String(Math.max(0.97, settings.threshold));
  notifyInput.checked = settings.notifyBeforeUnmute;
  debugInput.checked = settings.debug;
  backendInput.value = settings.backend;
  updateBackendNote();
}

async function save(): Promise<void> {
  const settings = settingsFromForm();
  populate(settings);
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
  saveStatus.textContent = "Saved locally.";
  await refreshMeetingStatus();
}

async function refreshMeetingStatus(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "GET_STATUS",
    })) as
      | {
          status?: {
            inMeeting?: boolean;
            muted?: boolean | null;
            listening?: boolean;
          } | null;
        }
      | undefined;
    const status = response?.status;
    meetingStatus.textContent = !status?.inMeeting
      ? "Open or join a Google Meet to start caption monitoring."
      : !status.listening
        ? "Meeting found · listening is paused."
        : status.muted === true
          ? "Meeting found · microphone muted · listening for captions."
          : status.muted === false
            ? "Meeting found · microphone is on."
            : "Meeting found · microphone state unknown, so auto-unmute is blocked.";
  } catch {
    meetingStatus.textContent = "Open Google Meet to connect Automic.";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save().catch(() => {
    saveStatus.textContent = "Could not save settings.";
  });
});
backendInput.addEventListener("change", updateBackendNote);
void chrome.storage.local
  .get(SETTINGS_STORAGE_KEY)
  .then((values) => {
    populate(safeSettings(values[SETTINGS_STORAGE_KEY] ?? DEFAULT_SETTINGS));
    return refreshMeetingStatus();
  })
  .catch(() => {
    populate(DEFAULT_SETTINGS);
    meetingStatus.textContent = "Could not load saved settings.";
  });
