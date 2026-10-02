import { normalizeSettings } from "../core/settings.js";
import { DEFAULT_SETTINGS, type Settings } from "../core/types.js";

export const SETTINGS_STORAGE_KEY = "automic.settings";
export const OLLAYA_ENDPOINT = DEFAULT_SETTINGS.endpoint;

/** Read settings from extension-owned storage and pin model requests to loopback. */
export function safeSettings(raw: unknown): Settings {
  const settings = normalizeSettings(raw);
  return {
    ...settings,
    endpoint: OLLAYA_ENDPOINT,
    // Rules are a demo signal only. It cannot authorize a real microphone action.
    mode:
      settings.backend === "rules" && settings.mode === "auto"
        ? "shadow"
        : settings.mode,
  };
}
