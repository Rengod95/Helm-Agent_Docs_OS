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

test("web access and skill or memory write titles also become the card's sentences", () => {
  expect(
    approvalTitleOf({
      title: "Allow web access to example.com?",
      bodyKind: "tool",
      toolName: "web_fetch",
    }),
  ).toBe("example.com에 웹으로 접근하도록 허용할까요?");
  expect(
    approvalTitleOf({
      title: "Approve skill.create on skill deploy-notes?",
      bodyKind: "tool",
      toolName: "skill_manage",
    }),
  ).toBe("deploy-notes 스킬 쓰기: 만들기");
  expect(
    approvalTitleOf({
      title: "Approve memory.add on user memory?",
      bodyKind: "tool",
      toolName: "memory",
    }),
  ).toBe("user 기억 쓰기: 추가");
});

test("an unknown title stays as it is and an empty one gets the generic name", () => {
  expect(approvalTitleOf({ title: 'Allow tool "read"?', bodyKind: "tool", toolName: "bash" })).toBe(
    'Allow tool "read"?',
  );
  expect(approvalTitleOf({ title: "", bodyKind: "tool", toolName: "bash" })).not.toBe("");
});

test("a draft plugin's tool approval title becomes Korean and keeps the plugin and tool names (R-06)", () => {
  expect(
    approvalTitleOf({
      title: 'Draft plugin "kanban-board" asks. Allow tool "kanban_board_add_item"?',
      bodyKind: "tool",
      toolName: "kanban_board_add_item",
    }),
  ).toBe('드래프트 플러그인 "kanban-board"의 도구 "kanban_board_add_item" 실행을 허용할까요?');
});
