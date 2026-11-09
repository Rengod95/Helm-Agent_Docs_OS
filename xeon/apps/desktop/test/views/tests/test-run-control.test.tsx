import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { err, ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  ALL_TESTS,
  INITIAL_TESTS_UI,
  testRowsOf,
  testsUiReducer,
  type TestsUiState,
} from "@fresnel/client/workbench";
import type { ExtTestRecord, ExtTestRunParams } from "@fresnel/contracts/wire";
import {
  phaseOf,
  runControl,
  sendTestPrompt,
  startTest,
} from "../../../src/views/tests/tests-actions.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { TestsView, type TestsViewHandlers } from "../../../src/views/tests/tests-view.tsx";
import { fakeCommands } from "../fake-commands.ts";

// Y9 화면 부분(m4-plan §2.0.1 T-TRIAL). 멈춤 뒤에는 멈춘 채 표시하고 "이어서"와 "한 경계씩"만 준다.
// 새 턴을 여는 동작은 화면에 없고, 명령 대역은 멈춤·단계 읽기 말고는 아무 것도 받지 않았어야 한다.

const NOOP = (): void => {};
function threadIdOf(raw: string): ThreadId {
  const parsed = parse(ThreadIdSchema, raw);
  if (!parsed.ok) throw new Error(`bad thread id ${raw}`);
  return parsed.value;
}
const handlers: TestsViewHandlers = {
  select: NOOP,
  filter: NOOP,
  openSheet: NOOP,
  retry: NOOP,
  dismissNotice: NOOP,
  sheet: { change: NOOP, submit: NOOP, close: NOOP },
  confirmRun: NOOP,
  cancelRun: NOOP,
  control: NOOP,
  copy: NOOP,
};

const running: ExtTestRecord = {
  testId: "t-run",
  kind: "testRun",
  target: "helm",
  state: "running",
  startedAt: "2026-11-04T09:00:00.000Z",
  durationMs: null,
  threadId: "thr_1",
  replay: null,
};

function viewOf(ui: TestsUiState, threadId: string) {
  const rows = testRowsOf([running], ALL_TESTS);
  const selected = rows[0] ?? null;
  return renderToString(
    <ShellStoreContext value={createShellStore(1400)}>
      <TestsView
        read={{ kind: "ready", value: [running], stale: false }}
        rows={rows}
        selected={selected}
        ui={ui}
        online
        selectedPaused={ui.paused[threadId] === true}
        selectedPhase={ui.phase[threadId] ?? null}
        targetNames={[]}
        handlers={handlers}
      />
    </ShellStoreContext>,
  );
}

describe("Y9 test-run pause", () => {
  test("Y9 test-run pause: a paused Test run shows the paused state with resume and one boundary, offers no new turn, and sends only the pause and phase reads", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      sendTurn: (threadId, text) => {
        calls.push(`sendTurn:${threadId}:${text}`);
        return Promise.resolve(ok(null));
      },
      tests: {
        ...base.tests,
        pause: (threadId) => {
          calls.push(`pause:${threadId}`);
          return Promise.resolve(ok(true));
        },
        resume: (threadId) => {
          calls.push(`resume:${threadId}`);
          return Promise.resolve(ok(false));
        },
        step: (threadId) => {
          calls.push(`step:${threadId}`);
          return Promise.resolve(ok(true));
        },
        phase: (threadId) => {
          calls.push(`phase:${threadId}`);
          return Promise.resolve(
            ok({
              phase: "tool",
              group: "review",
              seq: 3,
              paused: true,
              lock: { holder: "review", status: "active", epoch: 1 },
              guardHits: 0,
              traceEnabled: true,
              boundaries: [{ seq: 3, phase: "tool", paused: true }],
            }),
          );
        },
        run: () => {
          calls.push("run");
          return Promise.resolve(err({ kind: "unsupported" }));
        },
        createTestRun: () => {
          calls.push("createTestRun");
          return Promise.resolve(err({ kind: "unsupported" }));
        },
      },
    });

    const paused = await runControl(commands.tests, "pause", "thr_1");
    expect(paused).toEqual({ ok: true, value: true });
    const phase = await phaseOf(commands.tests, "thr_1");
    expect(phase).toBe("tool");

    const ui = testsUiReducer(
      testsUiReducer(INITIAL_TESTS_UI, { type: "controlDone", threadId: "thr_1", paused: true }),
      { type: "phaseDone", threadId: "thr_1", phase },
    );
    const markup = viewOf(ui, "thr_1");
    expect(markup).toContain("멈춘 채 있어요");
    expect(markup).toContain("이어서");
    expect(markup).toContain("한 경계씩");
    expect(markup).not.toContain(">멈춤<");
    expect(markup).not.toContain("턴");
    expect(calls).toEqual(["pause:thr_1", "phase:thr_1"]);
  });

  test("Y9 test-run pause: a rejected resume keeps the paused state as the last result and reports a failure, not a silent change", async () => {
    const commands = fakeCommands({
      tests: {
        ...fakeCommands().tests,
        resume: () => Promise.resolve(err({ kind: "rejected", code: 3313 })),
      },
    });
    const outcome = await runControl(commands.tests, "resume", "thr_1");
    expect(outcome).toEqual({ ok: false, failure: "rejected" });
    const ui = testsUiReducer(INITIAL_TESTS_UI, {
      type: "controlDone",
      threadId: "thr_1",
      paused: true,
    });
    expect(viewOf(ui, "thr_1")).toContain("이어서");
  });
});

describe("새 테스트 시작", () => {
  test("a Test run start sends ext.test.run with the testRun kind and the target, and returns the test id", async () => {
    const calls: ExtTestRunParams[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        run: (params) => {
          calls.push(params);
          return Promise.resolve(ok({ testId: "t-7", threadId: "thr_7" }));
        },
      },
    });
    const outcome = await startTest(commands.tests, { kind: "testRun", target: "demo-plugin" });
    expect(outcome).toEqual({ ok: true, value: { testId: "t-7", threadId: "thr_7" } });
    expect(calls).toEqual([{ kind: "testRun", target: "demo-plugin" }]);
  });

  test("a rejected Test run start reports the rejected failure and no test id", async () => {
    const commands = fakeCommands({
      tests: {
        ...fakeCommands().tests,
        run: () => Promise.resolve(err({ kind: "rejected", code: 3313 })),
      },
    });
    const outcome = await startTest(commands.tests, { kind: "testRun", target: "demo-plugin" });
    expect(outcome).toEqual({ ok: false, failure: "rejected" });
  });

  test("the Test run task opens the test conversation and is sent as its first turn, and a send failure is reported as a value", async () => {
    const calls: string[] = [];
    const sent = await sendTestPrompt(
      {
        selectThread: (id) => {
          calls.push(`select ${id}`);
        },
        sendTurn: (id, text, requestId) => {
          calls.push(`send ${id} ${text} ${requestId}`);
          return Promise.resolve(ok(null));
        },
      },
      threadIdOf("thr_00000000000000000000000007"),
      "1+1은?",
      "req-1",
    );
    expect(sent).toEqual({ ok: true, value: null });
    expect(calls).toEqual([
      "select thr_00000000000000000000000007",
      "send thr_00000000000000000000000007 1+1은? req-1",
    ]);
    const failed = await sendTestPrompt(
      {
        selectThread: NOOP,
        sendTurn: () => Promise.resolve(err({ kind: "offline" })),
      },
      threadIdOf("thr_00000000000000000000000007"),
      "1+1은?",
      "req-2",
    );
    expect(failed).toEqual({ ok: false, failure: "offline" });
  });
});
