import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { EMPTY_THREAD_SUGGESTIONS } from "../../src/views/empty-thread.tsx";

test("the empty-thread chips carry the mock's three starting sentences", () => {
  expect(EMPTY_THREAD_SUGGESTIONS.map((id) => t(id))).toEqual([
    "이 저장소 구조 설명",
    "실패하는 테스트 찾기",
    "최근 변경 요약",
  ]);
  expect(t("desktop.emptyThread.prompt")).toBe("무엇부터 할까요?");
});
