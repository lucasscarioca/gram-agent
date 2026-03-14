import { describe, expect, it } from "vitest";

import { buildQuestionAnswerFromSelection, formatQuestionPrompt } from "./runtime";
import type { QuestionState } from "./types";

function createQuestion(overrides: Partial<QuestionState> = {}): QuestionState {
  return {
    id: "q1",
    prompt: "Pick a color",
    kind: "single_select",
    options: [
      { value: "red", label: "Red" },
      { value: "blue", label: "Blue" },
    ],
    allowOther: false,
    minSelections: 1,
    maxSelections: 1,
    submitLabel: undefined,
    cancelLabel: undefined,
    selectedIndexes: [],
    displayMessageId: null,
    ...overrides,
  };
}

describe("question helpers", () => {
  it("formats multi-select prompts with guidance", () => {
    expect(formatQuestionPrompt(createQuestion({ kind: "multi_select" }))).toContain("Pick one or more options");
  });

  it("builds answers from selected indexes", () => {
    expect(
      buildQuestionAnswerFromSelection({
        question: createQuestion(),
        selectedIndexes: [1],
      }),
    ).toEqual({
      prompt: "Pick a color",
      kind: "single_select",
      values: ["blue"],
      labels: ["Blue"],
      freeText: undefined,
      confirmed: undefined,
    });
  });
});
