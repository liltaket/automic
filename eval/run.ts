import { readFile } from "node:fs/promises";
import {
  classify,
  classifyWithRules,
  couldBeTurnCandidate,
  isExplicitDirectedLatestCaption,
} from "../core/classifier.js";
import { normalizeSettings } from "../core/settings.js";
import {
  DEFAULT_SETTINGS,
  type Caption,
  type Classification,
  type Decision,
} from "../core/types.js";

interface Case {
  id: string;
  text: string;
  expected: Decision;
}

const cases = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
) as Case[];
const useOllaya = process.argv.includes("--ollaya");
const settings = normalizeSettings({
  ...DEFAULT_SETTINGS,
  name: "Bruno Hjorth",
  aliases: ["Bruno", "Hjorth"],
  backend: useOllaya ? "ollaya" : "rules",
});
const confusion: Record<Decision, Record<Decision, number>> = {
  UNMUTE: { UNMUTE: 0, STAY_MUTED: 0, UNCERTAIN: 0 },
  STAY_MUTED: { UNMUTE: 0, STAY_MUTED: 0, UNCERTAIN: 0 },
  UNCERTAIN: { UNMUTE: 0, STAY_MUTED: 0, UNCERTAIN: 0 },
};
const falseUnmuteCases: string[] = [];
const falseAutoCases: string[] = [];
const perCase: Array<{
  id: string;
  expected: Decision;
  decision: Decision | "ERROR";
  source: string;
  p_unmute: number | null;
  reason: string;
}> = [];
let correct = 0;
let positiveTruth = 0;
let truePositive = 0;
let autoTruePositive = 0;
let negativeOrUncertainTruth = 0;
let candidateSkips = 0;

for (const [index, testCase] of cases.entries()) {
  const caption: Caption = {
    id: testCase.id,
    speaker: "Participant",
    text: testCase.text,
    timestamp: Date.now(),
  };
  const context = [caption];
  if (useOllaya && !couldBeTurnCandidate(context, settings)) candidateSkips++;
  let result: Classification | undefined;
  let errorMessage = "";
  try {
    result = useOllaya
      ? await classify(context, settings)
      : classifyWithRules(context, settings);
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Classification failed.";
  }
  if (!result) {
    perCase.push({
      id: testCase.id,
      expected: testCase.expected,
      decision: "ERROR",
      source: "error",
      p_unmute: null,
      reason: errorMessage,
    });
    continue;
  }
  confusion[testCase.expected][result.decision]++;
  if (testCase.expected === result.decision) correct++;
  if (testCase.expected === "UNMUTE") {
    positiveTruth++;
    if (result.decision === "UNMUTE") {
      truePositive++;
      if (
        result.source === "ollaya" &&
        result.probabilities.UNMUTE >= 0.97 &&
        isExplicitDirectedLatestCaption(context, settings)
      )
        autoTruePositive++;
    }
  } else {
    negativeOrUncertainTruth++;
    if (result.decision === "UNMUTE") falseUnmuteCases.push(testCase.id);
    if (
      result.source === "ollaya" &&
      result.probabilities.UNMUTE >= 0.97 &&
      isExplicitDirectedLatestCaption(context, settings)
    )
      falseAutoCases.push(testCase.id);
  }
  perCase.push({
    id: testCase.id,
    expected: testCase.expected,
    decision: result.decision,
    source: result.source,
    p_unmute: result.probabilities.UNMUTE,
    reason: result.reason,
  });
}

const predictedPositive = Object.values(confusion).reduce(
  (sum, row) => sum + row.UNMUTE,
  0,
);
console.log(
  JSON.stringify(
    {
      backend: useOllaya ? "ollaya" : "rules",
      cases: cases.length,
      accuracy: ratio(correct, cases.length),
      false_unmute_rate: ratio(
        falseUnmuteCases.length,
        negativeOrUncertainTruth,
      ),
      unmute_precision: ratio(truePositive, predictedPositive),
      unmute_recall: ratio(truePositive, positiveTruth),
      auto_threshold_recall_at_0_97: ratio(autoTruePositive, positiveTruth),
      false_auto_unmute_rate_at_0_97: ratio(
        falseAutoCases.length,
        negativeOrUncertainTruth,
      ),
      candidate_filtered_cases: candidateSkips,
      false_unmute_case_ids: falseUnmuteCases,
      false_auto_unmute_case_ids: falseAutoCases,
      confusion,
      results: perCase,
    },
    null,
    2,
  ),
);

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Number((numerator / denominator).toFixed(4));
}
