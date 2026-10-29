import { expect, test } from "bun:test";
import { settingProblemOf } from "../src/settings-problems.ts";

// HS-80. 저장된 기본 모델 id가 카탈로그에 없으면 `unknownModel` 문제를 싣는다(F wire §4.10 11).

const KNOWN: Readonly<Record<string, readonly string[]>> = { anthropic: ["claude-sonnet-5-5"] };
const modelIds = (provider: string): readonly string[] => KNOWN[provider] ?? [];

test("a saved default model id the catalog lacks is an unknownModel problem carrying the saved value", () => {
  expect(settingProblemOf("l1.models.default", "anthropic/no-such-model-xyz", modelIds)).toEqual({
    kind: "unknownModel",
    args: { id: "anthropic/no-such-model-xyz" },
  });
  expect(settingProblemOf("l1.models.default", "nowhere/m", modelIds)).toEqual({
    kind: "unknownModel",
    args: { id: "nowhere/m" },
  });
});

test("a catalog model id has no problem, with or without a thinking level suffix", () => {
  expect(settingProblemOf("l1.models.default", "anthropic/claude-sonnet-5-5", modelIds)).toBe(
    undefined,
  );
  expect(settingProblemOf("l1.models.default", "anthropic/claude-sonnet-5-5:high", modelIds)).toBe(
    undefined,
  );
});

test("null, a non-string value, a malformed reference and other keys never get a problem", () => {
  expect(settingProblemOf("l1.models.default", null, modelIds)).toBe(undefined);
  expect(settingProblemOf("l1.models.default", 3, modelIds)).toBe(undefined);
  expect(settingProblemOf("l1.models.default", "claude-sonnet-5-5", modelIds)).toBe(undefined);
  expect(settingProblemOf("l1.models.routing.review", "nowhere/m", modelIds)).toBe(undefined);
});
