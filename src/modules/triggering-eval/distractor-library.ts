import { baselineDistractors } from "@/modules/baseline-corpus";
import type { Distractor } from "./triggering-eval.types";

/**
 * The distractor library — competing skills the user's skill is selected
 * against. The library is sourced from the baseline skill corpus so triggering
 * evals compete against realistic, versioned skill fixtures (ARCHITECTURE §9).
 */
export const distractorLibrary: readonly Distractor[] = baselineDistractors;
