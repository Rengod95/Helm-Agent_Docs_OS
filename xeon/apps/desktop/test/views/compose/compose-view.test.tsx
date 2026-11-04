import { describe, expect, test } from "bun:test";
import type { TabRead } from "@fresnel/client/workbench";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import { renderToString } from "react-dom/server";
import { CommandsContext } from "../../../src/views/commands.ts";
import {
  FlowBody,
  GroupBlocks,
  NoComposition,
  ReadGate,
} from "../../../src/views/compose/compose-group.tsx";
import { fakeCommands } from "../fake-commands.ts";

// 구성기 그림의 서버 렌더. 글과 상태 가르기만 본다(읽기와 클릭은 DOM이 없어 시험하지 않는다).

const COMPOSITION: CompositionDecl = {
  blocks: [
    { id: "detect", stage: "detect", op: "on", title: "신호 감지", hooks: ["tool.call.before"] },
    { id: "drive", stage: "machine", op: "drive" },
  ],
  phases: {
    initial: "start",
    nodes: [
      { id: "start", kind: "phase", title: "시작" },
      { id: "done", kind: "end" },
    ],
    transitions: [{ from: "start", to: "done", event: "finished" }],
  },
};

const NOOP = (): void => {};

describe("GroupBlocks", () => {
  test("블록마다 제목, 연산, 훅 이름을 그린다", () => {
    const html = renderToString(
      <GroupBlocks composition={COMPOSITION} check={{ kind: "done", issues: [] }} />,
    );
    expect(html).toContain("신호 감지");
    expect(html).toContain("tool.call.before");
    expect(html).toContain(">drive<");
    expect(html).not.toContain('role="alert"');
  });

  test("검사 오류는 띠에 개수로, 해당 블록에 코드와 문장으로 보인다", () => {
    const html = renderToString(
      <GroupBlocks
        composition={COMPOSITION}
        check={{
          kind: "done",
          issues: [
            {
              severity: "error",
              code: "drive_duplicate",
              path: "blocks[1]",
              message: "drive는 그룹마다 하나예요",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("검사에서 막힌 곳이 1개 있어요.");
    expect(html).toContain("drive_duplicate");
    expect(html).toContain("drive는 그룹마다 하나예요");
  });

  test("검사를 못 하면 경고 한 줄이다", () => {
    const html = renderToString(
      <GroupBlocks composition={COMPOSITION} check={{ kind: "failed" }} />,
    );
    expect(html).toContain("구성 검사를 하지 못했어요.");
  });
});

describe("NoComposition과 FlowBody", () => {
  test("구성 정보가 없으면 한 블록으로 알린다", () => {
    expect(renderToString(<NoComposition />)).toContain("구성 정보 없음");
  });
  test("단계 선언이 있으면 캔버스에 단계를 그리고 읽기 전용 문장을 보인다", () => {
    const html = renderToString(
      <CommandsContext.Provider value={fakeCommands()}>
        <FlowBody
          composition={COMPOSITION}
          link="offline"
          name="helm"
          installed
          draft={null}
          onDraft={NOOP}
          onMake={NOOP}
        />
      </CommandsContext.Provider>,
    );
    expect(html).toContain("시작");
    expect(html).toContain("done");
    expect(html).toContain("끝");
    expect(html).toContain("설치된 그룹은 고칠 수 없어요. 복제해서 초안으로 고쳐요");
  });
  test("단계 선언이 없으면 안내 문장이다", () => {
    const html = renderToString(
      <CommandsContext.Provider value={fakeCommands()}>
        <FlowBody
          composition={{ blocks: COMPOSITION.blocks }}
          link="offline"
          name="helm"
          installed
          draft={null}
          onDraft={NOOP}
          onMake={NOOP}
        />
      </CommandsContext.Provider>,
    );
    expect(html).toContain("단계 선언이 없어요");
  });
});

const gate = (read: TabRead<string>): string =>
  renderToString(
    <ReadGate read={read} onRetry={NOOP}>
      {(value) => value}
    </ReadGate>,
  );

describe("ReadGate", () => {
  test("읽는 중, 오프라인, 오류를 가른다", () => {
    expect(gate({ kind: "loading" })).toContain("읽는 중이에요");
    expect(gate({ kind: "offline" })).toContain("엔진에 연결되어 있지 않아 읽지 못해요.");
    expect(gate({ kind: "error" })).toContain("구성을 읽지 못했어요.");
  });
  test("값이 있으면 본문을 그리고 낡은 값이면 표시한다", () => {
    expect(gate({ kind: "ready", value: "본문", stale: false })).toContain("본문");
    const stale = gate({ kind: "ready", value: "본문", stale: true });
    expect(stale).toContain("마지막으로 읽은 값이에요.");
    expect(stale).toContain("본문");
  });
});
