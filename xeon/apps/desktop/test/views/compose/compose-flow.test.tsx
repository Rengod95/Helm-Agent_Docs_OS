import { describe, expect, test } from "bun:test";
import type { FlowDraft } from "@fresnel/client/workbench";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { CommandsContext } from "../../../src/views/commands.ts";
import { FlowBody } from "../../../src/views/compose/compose-group.tsx";
import { FlowCanvas } from "../../../src/views/compose/compose-flow.tsx";
import { FlowEditor } from "../../../src/views/compose/compose-flow-edit.tsx";
import { announceOf, FlowOutline } from "../../../src/views/compose/compose-outline.tsx";
import { fakeCommands } from "../fake-commands.ts";

// 흐름 보기의 서버 렌더. 설치 그룹의 읽기 전용과 초안의 편집 자리, 고른 노드의 aria, 검사 이슈가 노드에 붙는 자리만 본다.
// 캔버스 선과 크기는 DOM을 재야 하므로 시험하지 않는다. 클릭과 입력도 시험하지 않는다.

const NOOP = (): void => {};

const PHASES: FlowDraft = {
  initial: "start",
  nodes: [
    { id: "start", kind: "phase", title: "분류" },
    { id: "review", kind: "human", title: "검토", askTitle: "찾은 변경을 적용할까요?" },
    { id: "done", kind: "end" },
  ],
  transitions: [
    { from: "start", to: "review", event: "found" },
    { from: "review", to: "done", event: "answered" },
  ],
};

const COMPOSITION: CompositionDecl = {
  blocks: [{ id: "drive", stage: "machine", op: "drive" }],
  phases: PHASES,
};

/** 명령이 필요한 흐름 본체를 명령 맥락 안에서 그린다 */
function flowHtml(draft: FlowDraft | null): string {
  return renderToString(
    <CommandsContext.Provider value={fakeCommands()}>
      <FlowBody composition={COMPOSITION} link="live" draft={draft} onDraft={NOOP} onMake={NOOP} />
    </CommandsContext.Provider>,
  );
}

describe("설치 그룹의 흐름 보기(읽기 전용)", () => {
  test("단계 제목, 종류 글, 시작 표지, 사람 확인 질문을 그린다", () => {
    const html = flowHtml(null);
    expect(html).toContain("분류");
    expect(html).toContain("검토");
    expect(html).toContain("done");
    expect(html).toContain("사람 확인");
    expect(html).toContain("찾은 변경을 적용할까요?");
    expect(html).toContain("시작");
  });

  test("읽기 전용 문장과 고치기 단추가 있고, 편집 자리는 없다", () => {
    const html = flowHtml(null);
    expect(html).toContain("설치된 그룹은 고칠 수 없어요. 복제해서 초안으로 고쳐요");
    expect(html).toContain("초안으로 고치기");
    expect(html).not.toContain("단계 더하기");
    expect(html).not.toContain("노드 지우기");
    expect(html).not.toContain("이 초안으로 새 그룹 만들기");
  });

  test("단계 선언이 없으면 안내 문장이고 고칠 것도 없다", () => {
    const html = renderToString(
      <CommandsContext.Provider value={fakeCommands()}>
        <FlowBody
          composition={{ blocks: COMPOSITION.blocks }}
          link="live"
          draft={null}
          onDraft={NOOP}
          onMake={NOOP}
        />
      </CommandsContext.Provider>,
    );
    expect(html).toContain("단계 선언이 없어요");
    expect(html).not.toContain("초안으로 고치기");
  });
});

describe("초안의 흐름 보기(편집)", () => {
  test("편집 자리와 만들기, 되돌리기가 있고 고치기 단추와 읽기 전용 문장은 없다", () => {
    const html = flowHtml(PHASES);
    expect(html).toContain("단계 더하기");
    expect(html).toContain("단계를 고르면 여기서 고쳐요.");
    expect(html).toContain("이 초안으로 새 그룹 만들기");
    expect(html).toContain("되돌리기");
    expect(html).not.toContain("초안으로 고치기");
    expect(html).not.toContain("설치된 그룹은 고칠 수 없어요");
  });

  test("연결이 없으면 초안 검사를 하지 못한다는 문장이 보이고, 만들기는 눌리지 않는다", () => {
    const html = renderToString(
      <CommandsContext.Provider value={fakeCommands()}>
        <FlowBody
          composition={COMPOSITION}
          link="offline"
          draft={PHASES}
          onDraft={NOOP}
          onMake={NOOP}
        />
      </CommandsContext.Provider>,
    );
    expect(html).toContain("엔진에 연결되면 검사하고 만들 수 있어요.");
    const make = html.split("<button").find((part) => part.includes("이 초안으로 새 그룹 만들기"));
    expect(make).toContain("disabled");
  });
});

describe("캔버스 노드", () => {
  test("고른 노드만 aria-current가 true다", () => {
    const html = renderToString(
      <FlowCanvas draft={PHASES} selected="review" issues={new Map()} onSelect={NOOP} />,
    );
    expect(html.split('aria-current="true"').length - 1).toBe(1);
    expect(html).toContain('data-selected=""');
  });

  test("고른 노드가 없으면 aria-current가 없다", () => {
    const html = renderToString(
      <FlowCanvas draft={PHASES} selected={null} issues={new Map()} onSelect={NOOP} />,
    );
    expect(html).not.toContain("aria-current");
  });

  test("오류 이슈가 붙은 노드는 invalid이고 막혔다는 글이 그 노드에 보인다", () => {
    const issue: WireManifestIssue = {
      severity: "error",
      code: "phase_invalid",
      path: "/phases/nodes/1",
      message: "검토 단계가 도달하지 않아요",
    };
    const html = renderToString(
      <FlowCanvas
        draft={PHASES}
        selected={null}
        issues={new Map([["review", [issue]]])}
        onSelect={NOOP}
      />,
    );
    expect(html).toContain('data-state="invalid"');
    expect(html).toContain("검사에서 막혔어요");
  });
});

describe("고른 노드의 속성", () => {
  test("고른 단계는 제목, 질문, 잇기 자리와 나가는 선을 보인다", () => {
    const html = renderToString(
      <FlowEditor
        draft={PHASES}
        selected="review"
        issues={new Map()}
        onSelect={NOOP}
        onDraft={NOOP}
      />,
    );
    expect(html).toContain("사람 확인 질문");
    expect(html).toContain("시작 노드로");
    expect(html).toContain("노드 지우기");
    expect(html).toContain("잇기");
    expect(html).toContain("나가는 선");
    expect(html).toContain("→ done");
    expect(html).toContain("answered");
  });

  test("고른 단계가 없으면 안내 한 줄이다", () => {
    const html = renderToString(
      <FlowEditor
        draft={PHASES}
        selected={null}
        issues={new Map()}
        onSelect={NOOP}
        onDraft={NOOP}
      />,
    );
    expect(html).toContain("단계를 고르면 여기서 고쳐요.");
    expect(html).not.toContain("잇기");
  });
});

describe("좁은 폭의 개요", () => {
  test("노드 줄과 나가는 선 줄을 트리 항목으로 그린다", () => {
    const html = renderToString(<FlowOutline draft={PHASES} selected={null} onSelect={NOOP} />);
    expect(html).toContain("단계 목록");
    expect(html).toContain("분류");
    expect(html).toContain("→ 검토");
    expect(html).toContain("found");
    // 노드 3개와 나가는 선 2개
    expect(html.split("data-item-id=").length - 1).toBe(5);
  });

  test("읽기 알림은 고르기와 펼치기만 글로 말하고 나머지는 빈 글이다", () => {
    expect(announceOf({ type: "selected", names: ["분류"] })).toBe("분류 골랐어요");
    expect(announceOf({ type: "expanded", names: ["분류"] })).toBe("분류 펼쳤어요");
    expect(announceOf({ type: "collapsed", names: ["분류"] })).toBe("분류 접었어요");
    expect(announceOf({ type: "cancelled" })).toBe("");
    expect(announceOf({ type: "moved", names: ["분류"], position: "after", target: "검토" })).toBe(
      "",
    );
  });
});
