import { describe, expect, test } from "bun:test";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import {
  authoringRowOf,
  trialAskedOf,
  trialThreadFromTests,
  trialThreadOf,
} from "../../src/views/authoring-row-model.ts";

// 제작 대화 도구 행: 내부 이름과 JSON 대신 단계 이름과 결과에서 읽은 숫자·상태를 보인다.

describe("authoringRowOf", () => {
  test("제작 도구가 아니면 null", () => {
    expect(authoringRowOf("bash", "{}")).toBeNull();
  });

  test("결과가 없으면 단계 이름만, 만든 파일과 검사 결과는 숫자로 말한다", () => {
    expect(authoringRowOf("authoring_scaffold", undefined)).toEqual({
      name: "파일 만들기",
      detail: "",
    });
    expect(
      authoringRowOf("authoring_scaffold", JSON.stringify({ ok: true, files: ["a", "b", "c"] })),
    ).toEqual({ name: "파일 만들기", detail: "파일 3개를 만들었어요" });
    expect(authoringRowOf("authoring_validate", JSON.stringify({ ok: true, report: {} }))).toEqual({
      name: "검사",
      detail: "검사를 통과했어요",
    });
    expect(
      authoringRowOf(
        "authoring_validate",
        JSON.stringify({
          ok: false,
          report: {
            issues: [{ severity: "error" }, { severity: "warning" }, { severity: "error" }],
          },
        }),
      ),
    ).toEqual({ name: "검사", detail: "오류 2개가 남아 있어요" });
  });

  test("폴더가 없어 열지 못한 것과 열린 대화를 닫은 것을 말한다", () => {
    expect(
      authoringRowOf(
        "authoring_start",
        JSON.stringify({ ok: false, error: { kind: "needs_folder", message: "x" } }),
      ),
    ).toEqual({ name: "제작 대화 열기", detail: "만들 폴더를 먼저 정해야 해요" });
    expect(
      authoringRowOf("authoring_stop", JSON.stringify({ ok: true, status: "closed" })),
    ).toEqual({ name: "제작 대화 닫기", detail: "제작 대화를 닫았어요" });
    expect(
      authoringRowOf(
        "authoring_package",
        JSON.stringify({ ok: true, status: "awaiting_confirmation" }),
      ),
    ).toEqual({ name: "묶기", detail: "확인을 기다리는 중" });
  });
});

describe("trialThreadOf", () => {
  const done = JSON.stringify({
    ok: true,
    status: "done",
    action: "trial",
    result: { threadId: "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ" },
  });
  test("returns the trial thread of a confirmed Test run", () => {
    expect(trialThreadOf("authoring_trial", done)).toBe("thr_01HZZZZZZZZZZZZZZZZZZZZZZZ");
  });
  test("returns null while the confirmation card waits, for other tools, and for odd text", () => {
    expect(
      trialThreadOf(
        "authoring_trial",
        JSON.stringify({ ok: true, status: "awaiting_confirmation", action: "trial" }),
      ),
    ).toBeNull();
    expect(trialThreadOf("authoring_package", done)).toBeNull();
    expect(trialThreadOf("authoring_trial", "not json")).toBeNull();
    expect(trialThreadOf("authoring_trial", undefined)).toBeNull();
  });
});

const rec = (
  testId: string,
  kind: "replay" | "testRun",
  startedAt: string,
  threadId: string | null,
): ExtTestRecord => ({
  testId,
  kind,
  target: "todo",
  state: "running",
  startedAt,
  durationMs: null,
  threadId,
  replay: null,
});

describe("trialThreadFromTests", () => {
  const since = Date.parse("2026-11-24T10:00:00.000Z");
  test("picks the first Test run thread opened after the call", () => {
    expect(
      trialThreadFromTests(
        [
          rec("t1", "testRun", "2026-11-24T09:00:00.000Z", "thr_01HAAAAAAAAAAAAAAAAAAAAAAA"),
          rec("t2", "testRun", "2026-11-24T10:05:00.000Z", "thr_01HBBBBBBBBBBBBBBBBBBBBBBB"),
          rec("t3", "testRun", "2026-11-24T10:09:00.000Z", "thr_01HCCCCCCCCCCCCCCCCCCCCCCC"),
        ],
        since,
      ),
    ).toBe("thr_01HBBBBBBBBBBBBBBBBBBBBBBB");
  });
  test("is null before approval, for replays and for runs without a thread", () => {
    expect(trialThreadFromTests([], since)).toBeNull();
    expect(
      trialThreadFromTests(
        [
          rec("t1", "replay", "2026-11-24T10:05:00.000Z", null),
          rec("t2", "testRun", "2026-11-24T10:06:00.000Z", null),
        ],
        since,
      ),
    ).toBeNull();
  });
});

describe("trialAskedOf", () => {
  test("is true only for the trial tool waiting on its card", () => {
    const asked = JSON.stringify({ ok: true, status: "awaiting_confirmation", action: "trial" });
    expect(trialAskedOf("authoring_trial", asked)).toBe(true);
    expect(trialAskedOf("authoring_package", asked)).toBe(false);
    expect(trialAskedOf("authoring_trial", JSON.stringify({ ok: true, status: "done" }))).toBe(
      false,
    );
    expect(trialAskedOf("authoring_trial", "nope")).toBe(false);
  });
});
