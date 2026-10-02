export type Decision = "UNMUTE" | "STAY_MUTED" | "UNCERTAIN";
export type Mode = "off" | "shadow" | "notify" | "auto";
export interface Settings {
  name: string;
  aliases: string[];
  mode: Mode;
  threshold: number;
  notifyBeforeUnmute: boolean;
  debug: boolean;
  backend: "rules" | "ollaya";
  endpoint: string;
  model: string;
}
export interface Caption {
  id: string;
  speaker?: string;
  text: string;
  timestamp: number;
}
export interface Classification {
  decision: Decision;
  confidence: number;
  probabilities: Record<Decision, number>;
  source: "rules" | "ollaya";
  reason: string;
  latencyMs: number;
}
export interface DetectionEvent {
  caption: Caption;
  result: Classification;
  action: "ignored" | "shadow" | "notify" | "unmuted" | "blocked" | "error";
  reason?: string;
  timestamp: number;
}
export interface MeetingController {
  isMuted(): boolean | null;
  unmute(caption: Caption): boolean | Promise<boolean>;
}
export type Classifier = (
  context: Caption[],
  settings: Settings,
  signal?: AbortSignal,
) => Promise<Classification>;
export const DEFAULT_SETTINGS: Settings = {
  name: "",
  aliases: [],
  mode: "shadow",
  threshold: 0.97,
  notifyBeforeUnmute: true,
  debug: false,
  backend: "ollaya",
  endpoint: "http://127.0.0.1:11435",
  model: "laya:multilingual",
};
