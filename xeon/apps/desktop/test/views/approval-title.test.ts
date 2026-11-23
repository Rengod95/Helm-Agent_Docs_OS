import { expect, test } from "bun:test";
import { approvalTitleOf } from "../../src/views/convo/intervention-model.ts";

// AGE-77 F-19: 승인 꼬리표의 제목(접근성 이름)이 엔진의 영어 고정 문장 그대로 나오던 것을 카드와 같은 한국어로 바꾼다.

test("the engine's English tool and question titles become the card's Korean sentences", () => {
  expect(approvalTitleOf({ title: 'Allow tool "bash"?', bodyKind: "tool", toolName: "bash" })).toBe(
    '도구 "bash" 실행을 허용할까요?',
  );
  expect(
    approvalTitleOf({ title: "Answer the questions", bodyKind: "question", toolName: null }),
  ).toBe("질문에 답해 주세요");
});

test("an unknown title stays as it is and an empty one gets the generic name", () => {
  expect(approvalTitleOf({ title: 'Allow tool "read"?', bodyKind: "tool", toolName: "bash" })).toBe(
    'Allow tool "read"?',
  );
  expect(approvalTitleOf({ title: "", bodyKind: "tool", toolName: "bash" })).not.toBe("");
});
