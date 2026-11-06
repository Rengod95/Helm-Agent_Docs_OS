import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  ALL_TESTS,
  INITIAL_TESTS_UI,
  NEW_TEST_DEFAULT,
  submitPlanOf,
  testRowsOf,
  type TabRead,
  type TestRowVM,
  type TestsUiState,
} from "@fresnel/client/workbench";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { NewTestForm } from "../../../src/views/tests/new-test-sheet.tsx";
import { TestsView, type TestsViewHandlers } from "../../../src/views/tests/tests-view.tsx";

// 테스트 화면의 서버 렌더. 상태와 핸들러는 아무것도 하지 않는 것으로 두고 그림의 글만 본다(클릭은 DOM이 없어 시험하지 않는다).

const NOOP = (): void => {};
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

/** 커밋 41개 가운데 40, 41번 절단이 다르다(통과 39) */
const CUTS: ReplayReport["cuts"] = Array.from({ length: 41 }, (_, index) => {
  const commitIndex = index + 1;
  const equal = commitIndex < 40;
  return { commitIndex, equal, firstDiff: equal ? null : 212 };
});

const report = (over: Partial<ReplayReport> = {}): ReplayReport => ({
  ok: false,
  commits: 41,
  passed: 39,
  firstDiff: 212,
  cuts: CUTS,
  effects: { turn: 0, spawn: 0, delegate: 0, post: 1 },
  failure: null,
  ...over,
});

const record = (over: Partial<ExtTestRecord> = {}): ExtTestRecord => ({
  testId: "t-replay",
  kind: "replay",
  target: "review",
  state: "failed",
  startedAt: "2026-11-03T09:00:00.000Z",
  durationMs: 9000,
  threadId: null,
  replay: report(),
  ...over,
});

const UI: TestsUiState = INITIAL_TESTS_UI;

interface ViewOptions {
  readonly read?: TabRead<readonly ExtTestRecord[]>;
  readonly ui?: TestsUiState;
  readonly online?: boolean;
  readonly selected?: TestRowVM | null;
  readonly paused?: boolean;
  readonly phase?: string | null;
}

function html(options: ViewOptions = {}): string {
  const read: TabRead<readonly ExtTestRecord[]> = options.read ?? {
    kind: "ready",
    value: [record()],
    stale: false,
  };
  const value = read.kind === "ready" ? read.value : [];
  const rows = testRowsOf(value, ALL_TESTS, null);
  return renderToString(
    <TestsView
      read={read}
      rows={rows}
      selected={options.selected ?? null}
      ui={options.ui ?? UI}
      online={options.online ?? true}
      scoped={false}
      selectedPaused={options.paused ?? false}
      selectedPhase={options.phase ?? null}
      handlers={handlers}
    />,
  );
}

/** 주어진 글을 가진 단추 한 개의 여는 태그. 없으면 빈 문자열 */
function buttonTagOf(markup: string, label: string): string {
  const pattern = new RegExp(
    `<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`,
    "s",
  );
  return markup.match(pattern)?.[0].split(">")[0] ?? "";
}

/** 단추가 잠겨 있나. 스타일 클래스의 `disabled:` 글자가 아니라 `disabled` 속성을 본다 */
function isDisabled(tag: string): boolean {
  return / disabled=""/.test(tag);
}

describe("테스트 화면 목록 상태", () => {
  test("a list that is still loading shows the skeleton, not the empty line", () => {
    const markup = html({ read: { kind: "loading" } });
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain("아직 돌린 테스트이 없어요");
  });

  test("offline says the list could not be read and locks the new test button", () => {
    const markup = html({ read: { kind: "offline" }, online: false });
    expect(markup).toContain("엔진에 연결되어 있지 않아 목록을 읽지 못해요.");
    expect(isDisabled(buttonTagOf(markup, "새 테스트"))).toBe(true);
  });

  test("an error offers a retry and says the list could not be read", () => {
    const markup = html({ read: { kind: "error" } });
    expect(markup).toContain("목록을 읽지 못했어요");
    expect(markup).toContain("다시 읽기");
  });

  test("an empty list that has loaded says there are no tests yet", () => {
    const markup = html({ read: { kind: "ready", value: [], stale: false } });
    expect(markup).toContain("아직 돌린 테스트이 없어요");
    expect(markup).not.toContain('data-slot="skeleton"');
  });

  test("test-run.dev-only-locked: with the engine connected the list reads and the new test button is open", () => {
    const markup = html();
    expect(markup).toContain("review");
    expect(isDisabled(buttonTagOf(markup, "새 테스트"))).toBe(false);
  });
});

describe("테스트 화면 상세", () => {
  test("a replay that differs shows the digest verdict, the one-line limit, the cut count and the JSON copy button in dev mode", () => {
    const row = testRowsOf([record()], ALL_TESTS, null)[0];
    const markup = html({ selected: row ?? null, ui: { ...UI, devMode: true } });
    expect(markup).toContain("digest 다름");
    expect(markup).toContain("테이프 재생은 응답이 고정되어");
    expect(markup).toContain("41개 중 39개가 같아요");
    expect(markup).toContain("첫 차이 seq 212");
    expect(markup).toContain("JSON 복사");
  });

  test("outside dev mode a replay detail shows only the read-only verdict and cut count", () => {
    const row = testRowsOf([record()], ALL_TESTS, null)[0];
    const markup = html({ selected: row ?? null });
    expect(markup).toContain("digest 다름");
    expect(markup).toContain("41개 중 39개가 같아요");
    expect(markup).not.toContain("테이프 재생은 응답이 고정되어");
    expect(markup).not.toContain("첫 차이 seq 212");
    expect(markup).not.toContain("JSON 복사");
  });

  test("a running Test run that is paused shows resume and one boundary, and no pause button or new turn", () => {
    const row = testRowsOf(
      [
        record({
          testId: "t-run",
          kind: "testRun",
          target: "helm",
          state: "running",
          replay: null,
          threadId: "thr_1",
        }),
      ],
      ALL_TESTS,
      null,
    )[0];
    const markup = html({ selected: row ?? null, paused: true, phase: "tool" });
    expect(markup).toContain("멈춘 채 있어요");
    expect(markup).toContain("이어서");
    expect(markup).toContain("한 경계씩");
    expect(markup).not.toContain(">멈춤<");
    expect(markup).toContain("단계 tool");
  });
});

describe("새 테스트 시트", () => {
  test("a Test run draft shows the target field, asks for a target before it can start, and has no replay commit limit", () => {
    const empty = renderToString(
      <NewTestForm
        id="new-test"
        draft={NEW_TEST_DEFAULT}
        devMode={false}
        onChange={NOOP}
        onSubmit={NOOP}
      />,
    );
    expect(empty).toContain("대상 이름을 적어 주세요.");
    expect(empty).not.toContain("최대 커밋 수");
    expect(submitPlanOf(NEW_TEST_DEFAULT, false).kind).toBe("invalid");
    const named = { ...NEW_TEST_DEFAULT, target: "demo-plugin", prompt: "1+1은?" };
    const filled = renderToString(
      <NewTestForm id="new-test" draft={named} devMode={false} onChange={NOOP} onSubmit={NOOP} />,
    );
    expect(filled).not.toContain("대상 이름을 적어 주세요.");
    expect(submitPlanOf(named, false)).toEqual({
      kind: "run",
      params: { kind: "testRun", target: "demo-plugin" },
      prompt: "1+1은?",
      confirm: false,
    });
  });

  test("test-run.dev-only-locked: outside dev mode a replay draft shows the developer-mode badge", () => {
    const markup = renderToString(
      <NewTestForm
        id="new-test"
        draft={{ ...NEW_TEST_DEFAULT, kind: "replay", target: "review" }}
        devMode={false}
        onChange={NOOP}
        onSubmit={NOOP}
      />,
    );
    expect(markup).toContain("개발 모드에서만");
    expect(
      submitPlanOf({ ...NEW_TEST_DEFAULT, kind: "replay", target: "review" }, false).kind,
    ).toBe("locked");
  });

  test("test-run.dev-only-locked: inside dev mode the replay draft has no lock badge and can start", () => {
    const draft = { ...NEW_TEST_DEFAULT, kind: "replay" as const, target: "review" };
    const markup = renderToString(
      <NewTestForm id="new-test" draft={draft} devMode onChange={NOOP} onSubmit={NOOP} />,
    );
    expect(markup).not.toContain("개발 모드에서만");
    expect(submitPlanOf(draft, true).kind).toBe("run");
  });

  test("test-run.dev-only-locked: the on/off comparison stays locked by the missing isolation", () => {
    const markup = renderToString(
      <NewTestForm
        id="new-test"
        draft={NEW_TEST_DEFAULT}
        devMode
        onChange={NOOP}
        onSubmit={NOOP}
      />,
    );
    expect(markup).toContain("작업 폴더를 격리하는 기능이 아직 없어요");
  });
});

describe("테스트 화면 알림", () => {
  test("a created Test run notice names the conversation after its target", () => {
    const markup = html({ ui: { ...UI, notice: { kind: "created", name: "demo-plugin" } } });
    expect(markup).toContain("demo-plugin 테스트 대화를 만들었어요.");
  });
});
