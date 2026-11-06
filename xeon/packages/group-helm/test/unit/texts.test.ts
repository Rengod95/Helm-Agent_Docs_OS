import { expect, test } from "bun:test";
import { statusText } from "../../src/commands.ts";
import { finishedNotice } from "../../src/prompts.ts";
import { LEASE_TEXT, LENS_STATUS_TEXT, OUTCOME_TEXT } from "../../src/texts.ts";
import type { HelmStatusView } from "../../src/commands.ts";

const base: HelmStatusView = {
  enabled: true,
  phase: "idle",
  inquiryId: null,
  topic: null,
  lenses: [],
  findings: 0,
  lease: "none",
};

test("status text: idle view reads as a resting state without raw values", () => {
  expect(statusText(base, [])).toBe("[helm] 쉬는 중이에요, 단계: 대기");
});

test("status text: held lease with lens statuses uses plain words", () => {
  const view: HelmStatusView = {
    ...base,
    phase: "explore",
    lease: "held",
    topic: "캐시",
    findings: 2,
    lenses: [
      { id: "a", title: "유추", status: "running" },
      { id: "b", title: "역사", status: "failed" },
      { id: "c", title: "표", status: "skipped" },
    ],
  };
  expect(statusText(view, [])).toBe(
    "[helm] 탐구하는 중이에요, 단계: 다른 분야 탐색, 주제: 캐시\n렌즈: 유추(진행 중), 역사(실패), 표(건너뜀)\n발견: 2개",
  );
});

test("text tables: no value leaks the stored English key", () => {
  for (const text of [
    ...Object.values(LEASE_TEXT),
    ...Object.values(LENS_STATUS_TEXT),
    ...Object.values(OUTCOME_TEXT),
  ]) {
    expect(text).toMatch(/^[가-힣 ]+$/u);
  }
});

test("finished notice: outcome and limit are plain Korean", () => {
  const text = JSON.stringify(
    finishedNotice({
      inquiryId: "habcdefghijklm",
      outcome: "limit",
      topic: "t",
      rounds: 1,
      lensCount: 2,
      failedLenses: 0,
      findingCount: 1,
      appliedTurnId: null,
      limit: "spawns",
    }),
  );
  expect(text).toContain("(상한에 걸림)");
  expect(text).toContain("하위 에이전트 수 상한에 닿았어요.");
  expect(text).not.toContain("임대");
});
