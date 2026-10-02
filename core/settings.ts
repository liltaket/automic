import { DEFAULT_SETTINGS, type Settings } from "./types.js";

const MODES = new Set(["off", "shadow", "notify", "auto"]);
const BACKENDS = new Set(["rules", "ollaya"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** Normalize untrusted persisted/UI settings into a safe runtime configuration. */
export function normalizeSettings(raw: unknown): Settings {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const name = cleanText(input.name, DEFAULT_SETTINGS.name, 80);
  const aliases = Array.isArray(input.aliases)
    ? [
        ...new Set(
          input.aliases
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim().slice(0, 80))
            .filter(Boolean),
        ),
      ].slice(0, 16)
    : [...DEFAULT_SETTINGS.aliases];

  const mode =
    typeof input.mode === "string" && MODES.has(input.mode)
      ? (input.mode as Settings["mode"])
      : DEFAULT_SETTINGS.mode;
  const backend =
    typeof input.backend === "string" && BACKENDS.has(input.backend)
      ? (input.backend as Settings["backend"])
      : DEFAULT_SETTINGS.backend;
  const requestedThreshold =
    typeof input.threshold === "number" && Number.isFinite(input.threshold)
      ? Math.max(0, Math.min(1, input.threshold))
      : DEFAULT_SETTINGS.threshold;

  return {
    name,
    aliases,
    mode,
    // Auto-unmute must never be configured below the strict MVP floor.
    threshold:
      mode === "auto" ? Math.max(0.97, requestedThreshold) : requestedThreshold,
    notifyBeforeUnmute:
      typeof input.notifyBeforeUnmute === "boolean"
        ? input.notifyBeforeUnmute
        : DEFAULT_SETTINGS.notifyBeforeUnmute,
    debug:
      typeof input.debug === "boolean" ? input.debug : DEFAULT_SETTINGS.debug,
    backend,
    endpoint: normalizeLoopbackEndpoint(input.endpoint),
    model: cleanText(input.model, DEFAULT_SETTINGS.model, 120),
  };
}

function cleanText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().slice(0, maxLength);
  return clean || fallback;
}

function normalizeLoopbackEndpoint(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.endpoint;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
      url.port !== "11435"
    ) {
      return DEFAULT_SETTINGS.endpoint;
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return DEFAULT_SETTINGS.endpoint;
    }
    return `http://${url.hostname.toLowerCase()}:11435`;
  } catch {
    return DEFAULT_SETTINGS.endpoint;
  }
}
