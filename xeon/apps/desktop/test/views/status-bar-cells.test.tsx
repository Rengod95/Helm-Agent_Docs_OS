import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EngineMirror, EngineState } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import {
  engineDescriptionOf,
  engineDotOf,
  liveRowsOf,
  StatusBar,
} from "../../src/views/status-bar.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { emptyPluginUi } from "./plugin/support.tsx";
import { harness, summary, thr } from "../state/helpers.ts";

// 상태 표시줄의 칸(B-09, d02). 점과 글, Popover 설명과 진행 중 묶음을 값으로 본다.
// Popover의 본문은 열 때만 그려서 서버 렌더에는 나오지 않으므로, 본문의 묶음은 `liveRowsOf`로 시험한다.

const EXIT = { code: 1, signal: null, at: "2026-11-03T00:00:00.000Z" } as const;
const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const FAILED: EngineState = { kind: "failed", attempts: 3, lastExit: EXIT };
const RESTARTING: EngineState = {
  kind: "restarting",
  attempt: 1,
  retryAt: "2026-11-03T00:00:05.000Z",
  lastExit: EXIT,
};
const TEST_RUN = { profileId: null, target: null, paused: false } as const;

describe("status bar engine cell", () => {
  test("the dot follows the engine state", () => {
    expect(engineDotOf(RUNNING)).toBe("success");
    expect(engineDotOf(RESTARTING)).toBe("warning");
    expect(engineDotOf(FAILED)).toBe("danger");
    expect(engineDotOf({ kind: "stopped" })).toBe("neutral");
    expect(engineDotOf(null)).toBe("neutral");
    expect(engineDotOf(undefined)).toBe("neutral");
  });

  test("only a failed or restarting engine adds a sentence to its popover", () => {
    expect(engineDescriptionOf(FAILED)).toBe("desktop.status.cell.engine.failed");
    expect(engineDescriptionOf(RESTARTING)).toBe("desktop.status.cell.engine.restarting");
    expect(engineDescriptionOf(RUNNING)).toBeUndefined();
    expect(engineDescriptionOf(null)).toBeUndefined();
  });
});

describe("status bar in-progress cell", () => {
  test("running conversations split into conversations, test conversations and schedules, in list order", () => {
    const rows = liveRowsOf([
      summary(thr(1), { status: "running", title: "캐시 무효화 조사" }),
      summary(thr(2), { status: "idle", title: "끝난 대화" }),
      summary(thr(3), { status: "running", title: "렌즈 5개로 넓히기", testRun: TEST_RUN }),
      summary(thr(4), {
        status: "running",
        title: null,
        origin: { kind: "schedule", scheduleId: "daily" },
      }),
      summary(thr(5), { status: "closed", title: "닫은 대화" }),
    ]);
    expect(rows).toEqual([
      { kind: "thread", threadId: thr(1), title: "캐시 무효화 조사" },
      { kind: "trial", threadId: thr(3), title: "렌즈 5개로 넓히기" },
      { kind: "schedule", threadId: thr(4), title: null },
    ]);
  });

  test("no running conversation gives no rows, so the popover shows its empty line", () => {
    expect(liveRowsOf([summary(thr(1), { status: "idle" })])).toEqual([]);
  });
});

/** 상태가 바뀌지 않는 스토어. 서버 렌더가 읽는 처음 상태가 곧 이 상태다 */
function frozenStore(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

describe("status bar server render", () => {
  test("each cell draws its text, its dot, and its count from the mirror", () => {
    const h = harness();
    h.store.ingest({ type: "engine", state: FAILED });
    h.store.ingest({
      type: "threads",
      threads: [
        summary(thr(1), { status: "running", title: "캐시 무효화 조사" }),
        summary(thr(3), { status: "running", title: "렌즈 5개로 넓히기", testRun: TEST_RUN }),
        summary(thr(2), { status: "idle", title: "끝난 대화" }),
      ],
    });
    h.store.flush();
    const html = renderToString(
      <Providers
        engine={frozenStore(h.store.read.getState())}
        ui={createUiStore().read}
        commands={fakeCommands()}
      >
        <PluginUiProvider value={emptyPluginUi()}>
          <StatusBar />
        </PluginUiProvider>
      </Providers>,
    );
    expect(html).toContain('data-bar-cell="engine"');
    expect(html).toContain("엔진 시작 실패");
    expect(html).toContain('data-bar-dot="danger"');
    expect(html).toContain('data-bar-cell="link"');
    expect(html).toContain("연결 없음");
    expect(html).toContain('data-bar-cell="live"');
    expect(html).toContain("진행 중 2");
    expect(html).not.toContain("끝난 대화");
  });
});
