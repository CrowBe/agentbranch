/**
 * safety-review — LLM-judge backstop for the skill publication gate
 * (ARCHITECTURE §9.1).
 *
 * An evaluation capability on the seam. It reads the full skill folder as
 * structurally untrusted data and scores injection / exfiltration / deception.
 * The review is **opt-in — never automatic**: the caller declares the
 * accounting tag on the input (`account` for the user's manual safety rating,
 * `platform` for the future publication gate), so a user never spends credits
 * on a rating they didn't ask for. The persisted record is the **safety
 * rating** behind the `SafetyRatingRepository` port.
 */
import { defineEvaluation } from "@/modules/skill-analysis";
import type { Evaluator, Insight, Renderer } from "@/modules/skill-analysis";
import { runSafetyReview } from "./run-safety-review";
import type {
  SafetyReviewBreakdown,
  SafetyReviewInput,
  SafetyReviewResult,
} from "./safety-review.types";

export type {
  SafetyRating,
  SafetyReviewBreakdown,
  SafetyReviewClass,
  SafetyReviewInput,
  SafetyReviewReferenceFile,
  SafetyReviewResult,
  SafetyReviewScore,
  SafetyReviewVerdict,
} from "./safety-review.types";
export type { SafetyRatingRepository } from "./safety-rating.repository";
export { runSafetyReview } from "./run-safety-review";

const safetyReviewEvaluator: Evaluator<SafetyReviewInput, SafetyReviewResult> = {
  kind: "safety-review",
  evaluate: (input, gateway) => runSafetyReview(input, gateway),
};

const insightsRenderer: Renderer<SafetyReviewResult, Insight> = {
  target: "insights",
  render: (artifact) => artifact.insight,
};

const breakdownRenderer: Renderer<SafetyReviewResult, SafetyReviewBreakdown> = {
  target: "breakdown",
  render: (artifact) => ({
    verdict: artifact.verdict,
    scores: artifact.scores,
  }),
};

export const safetyReviewCapability = defineEvaluation({
  name: "safety review",
  evaluator: safetyReviewEvaluator,
  renderers: {
    insights: insightsRenderer,
    breakdown: breakdownRenderer,
  },
});
