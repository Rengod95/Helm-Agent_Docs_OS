import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { DurableFact } from "../../src/state/engine/input.ts";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import type { Commands } from "../../src/views/commands.ts";
import { Providers } from "../../src/views/providers.tsx";
import { QueuedInputs } from "../../src/views/queued-inputs.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { SUB, evt, openedHarness, thr } from "../state/helpers.ts";

// 입력창 위 대기 입력 칩의 서버 렌더. 칩의 글, 모드 말, 철회 단추, 정보 아이콘을 본다.
// 누르기와 철회 상태 전이는 DOM이 없어 시험하지 못한다. 그 전이는 composer-model.test.ts가 본다.

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

const T = thr(1);
const AT = "2026-11-04T00:00:00.000Z";

function queuedFact(
  seq: number,
  preview: string,
  over: {
    readonly mode?: "steer" | "followUp" | "next" | "aside";
    readonly sourceType?: "user" | "delegation";
  } = {},
): DurableFact {
  return {
    type: "input.queued",
    seq,
    eventId: evt(seq),
    threadId: T,
    turnId: null,
    at: AT,
    input: {
      mode: over.mode ?? "steer",
      requestId: `req-${String(seq)}`,
      sourceType: over.sourceType ?? "user",
      preview: { kind: "text", text: preview },
    },
  };
}

/** 열린 대화(thr(1))에 대기 입력을 넣은 거울. 연결의 시작 위치는 5라서 사실은 6부터 붙인다 */
function mirrorWith(facts: readonly DurableFact[]): EngineMirror {
  const h = openedHarness(5);
  h.store.ingest({ type: "batch", sub: SUB, from: 5, to: 5 + facts.length, caughtUp: true, facts });
  h.store.flush();
  return h.store.read.getState();
}

function html(
  facts: readonly DurableFact[],
  options: {
    readonly disabledReason?: string | null;
    readonly commands?: Commands;
    readonly steerable?: (requestId: string) => boolean;
  } = {},
): string {
  const engine = frozen(mirrorWith(facts));
  const ui = frozen<UiState>(createUiStore().read.getState());
  return renderToString(
    <Providers engine={engine} ui={ui} commands={options.commands ?? fakeCommands()}>
      <QueuedInputs
        threadId={T}
        disabledReason={options.disabledReason ?? null}
        steerable={options.steerable ?? (() => false)}
        onSteerNow={() => Promise.resolve({ status: "idle" })}
      />
    </Providers>,
  );
}

/** 철회 단추 여는 태그. 같은 글의 칩을 찾으려고 aria-label로 고른다. 꺼짐은 `disabled` 특성으로 본다(클래스의 `disabled:` 변형은 셈하지 않는다) */
function withdrawButtonTag(markup: string, preview: string): string {
  const match = markup.match(new RegExp(`<button[^>]*aria-label="${preview} 철회"[^>]*>`));
  if (match === null) throw new Error(`no withdraw button for ${preview}`);
  return match[0];
}

describe("queued input chips above the composer", () => {
  test("a user input shows its mode words, its text, a withdraw button, and the info note", () => {
    const markup = html([queuedFact(6, "이 파일도 봐 줘", { mode: "steer" })]);
    expect(markup).toContain("대기 중인 메시지");
    expect(markup).toContain("다음 도구 라운드 뒤 들어가요");
    expect(markup).toContain("이 파일도 봐 줘");
    expect(withdrawButtonTag(markup, "이 파일도 봐 줘")).not.toContain(' disabled=""');
    expect(markup).toContain("철회");
    expect(markup).toContain("아직 모델에 전달되지 않은 입력만 철회하거나 지금 반영할 수 있어요.");
  });

  test("a followUp chip says it goes in when the turn ends", () => {
    const markup = html([queuedFact(6, "나중에", { mode: "followUp" })]);
    expect(markup).toContain("이번 턴이 끝나면 들어가요");
  });

  test("an after-the-turn chip this composer sent has an apply-now button; others do not", () => {
    const facts = [
      queuedFact(6, "나중에", { mode: "followUp" }),
      queuedFact(7, "이미 바로", { mode: "steer" }),
    ];
    const known = html(facts, { steerable: () => true });
    expect(known).toContain('aria-label="나중에 지금 반영"');
    expect(known).not.toContain('aria-label="이미 바로 지금 반영"');
    expect(html(facts)).not.toContain('지금 반영"');
    expect(html(facts)).not.toContain("data-queued-steer-now");
  });

  test("a delegation input is not drawn as a chip", () => {
    const markup = html([queuedFact(6, "위임 보고", { sourceType: "delegation" })]);
    expect(markup).toBe("");
  });

  test("with no queued input nothing is drawn", () => {
    expect(html([])).toBe("");
  });

  test("the withdraw buttons are disabled while the composer is locked (offline or syncing)", () => {
    const markup = html([queuedFact(6, "이 파일도 봐 줘")], {
      disabledReason: "연결을 맞추는 중이에요.",
    });
    expect(withdrawButtonTag(markup, "이 파일도 봐 줘")).toContain(' disabled=""');
  });
});
