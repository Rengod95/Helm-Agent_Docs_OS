import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  keepsDialogOpen,
  removeOutcomeOfError,
} from "../../../src/views/workbench/remove-model.ts";
import {
  RemoveDialogBody,
  removeConfirmDisabled,
  type RemoveImpact,
} from "../../../src/views/workbench/remove-dialog.tsx";

// 지우기 확인 상자의 판단: 지우기 단추가 꺼지는 조건과, 지우기 결과에 따라 상자를 열어 두는 조건.
// 저장 데이터 경고 한 줄은 `hasData`가 참일 때만 본문에 보이며, 그림은 본문 서버 렌더로 본다.

const EMPTY_IMPACT: RemoveImpact = { profiles: { kind: "ready", titles: [] }, views: [] };
const DATA_WARNING = "저장한 데이터도 같이 지워져요";

describe("지우기 상자의 저장 데이터 경고", () => {
  test("hasData가 참이면 경고 빛깔의 한 줄을 보이고, 거짓이거나 없으면 보이지 않는다", () => {
    const warned = renderToString(<RemoveDialogBody impact={EMPTY_IMPACT} hasData={true} />);
    const plain = renderToString(<RemoveDialogBody impact={EMPTY_IMPACT} hasData={false} />);
    const unknown = renderToString(<RemoveDialogBody impact={EMPTY_IMPACT} />);
    expect([
      warned.includes(DATA_WARNING),
      plain.includes(DATA_WARNING),
      unknown.includes(DATA_WARNING),
    ]).toEqual([true, false, false]);
    expect(warned).toContain('data-tone="warning"');
    expect(plain).not.toContain('data-tone="warning"');
  });
});

describe("지우기 단추", () => {
  test("의존 거절 까닭이 보이는 동안과 지우는 중에는 꺼지고, 그 밖에는 켜진다", () => {
    const refusal = { reason: "required_by", plugin: "members-kit", items: [] } as const;
    expect([
      removeConfirmDisabled(false, null),
      removeConfirmDisabled(true, null),
      removeConfirmDisabled(false, refusal),
    ]).toEqual([false, true, true]);
  });
});

describe("지우기 결과 판단", () => {
  test("이미 없는 이름(3401)은 gone이고 그 밖의 거절과 오류는 failed다", () => {
    expect(removeOutcomeOfError({ kind: "rejected", code: 3401 })).toBe("gone");
    expect(removeOutcomeOfError({ kind: "rejected", code: 3402 })).toBe("failed");
    expect(removeOutcomeOfError({ kind: "offline" })).toBe("failed");
    expect(
      removeOutcomeOfError({
        kind: "rejected",
        code: 3627,
        dependency: { reason: "required_by", plugin: "web", items: [] },
      }),
    ).toBe("refused");
  });

  test("의존 거절이면 상자를 열어 두고, 그 밖의 결과(요청됨, 이미 없음, 실패)는 닫는다", () => {
    expect(keepsDialogOpen("refused")).toBe(true);
    expect(keepsDialogOpen("removed")).toBe(false);
    expect(keepsDialogOpen("gone")).toBe(false);
    expect(keepsDialogOpen("failed")).toBe(false);
  });
});
