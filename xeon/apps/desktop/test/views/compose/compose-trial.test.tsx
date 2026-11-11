import { describe, expect, test } from "bun:test";
import type { TabRead, ThreadToggleRequest } from "@fresnel/client/workbench";
import type { TestRunPhaseResult } from "@fresnel/contracts/extensions";
import { err, ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import type { SettingsJump } from "../../../src/state/ui/index.ts";
import { CommandsContext } from "../../../src/views/commands.ts";
import {
  modeAfter,
  readPhaseOf,
  shortIdOf,
  startTrialRun,
  trialPhaseOf,
  TrialBar,
  type PhaseRead,
  type TrialController,
  type TrialRun,
} from "../../../src/views/compose/compose-trial.tsx";
import {
  DEV_MODE_JUMP,
  ReplayBar,
  replayTrialRun,
  requestDevModeSetting,
  type ReplayController,
} from "../../../src/views/compose/compose-trial-replay.tsx";
import { fakeCommands } from "../fake-commands.ts";

// 시험 실행의 서버 렌더와 명령 순서. 글, 단추의 잠김, 드라이브 락 줄, 가드 칩, 단계 사이 기록(새것이 위), 다시 돌려 검사의 잠김과 결과를 본다.
// 명령 순서는 명령 대역으로 시험한다(React 없이 `startTrialRun`, `replayTrialRun`). 클릭과 다시 읽기 타이머는 DOM이 없어 시험하지 않는다.

const NOOP = (): void => {};
const RUN_ID = "thr_0123456789ABCDEFGHJKMNPQRS";
const SHORT_ID = "thr_01234567";

/** 테스트 대화 id는 wire의 브랜드 값이다. 시험 입력은 스키마로 만든다 */
function threadOf(raw: string): ThreadId {
  const parsed = parse(ThreadIdSchema, raw);
  if (!parsed.ok) throw new Error(`시험 입력의 대화 id가 잘못됐어요: ${raw}`);
  return parsed.value;
}

/** `testRun.phase`의 결과. 시험마다 필요한 칸만 바꾼다 */
function resultOf(over: Partial<TestRunPhaseResult> = {}): TestRunPhaseResult {
  return {
    phase: "review",
    group: "helm",
    seq: 7,
    paused: false,
    lock: { holder: "helm", status: "active", epoch: 3 },
    guardHits: 0,
    traceEnabled: true,
    boundaries: [],
    ...over,
  };
}

/** 커밋 41개 가운데 40, 41번 절단이 다르다(통과 39) */
const CUTS: ReplayReport["cuts"] = Array.from({ length: 41 }, (_, index) => {
  const commitIndex = index + 1;
  const equal = commitIndex < 40;
  return { commitIndex, equal, firstDiff: equal ? null : 212 };
});

const REPORT: ReplayReport = {
  ok: false,
  commits: 41,
  passed: 39,
  firstDiff: 212,
  cuts: CUTS,
  effects: { turn: 0, spawn: 0, delegate: 0, post: 1 },
  failure: null,
};

function recordOf(over: Partial<ExtTestRecord> = {}): ExtTestRecord {
  return {
    testId: "t-1",
    kind: "replay",
    target: "helm",
    state: "failed",
    startedAt: "2026-11-03T09:00:00.000Z",
    durationMs: 1200,
    threadId: null,
    replay: REPORT,
    ...over,
  };
}

function trialOf(over: Partial<TrialController> = {}): TrialController {
  return {
    online: true,
    run: null,
    starting: false,
    notice: null,
    start: NOOP,
    control: NOOP,
    reread: NOOP,
    leave: NOOP,
    dismiss: NOOP,
    ...over,
  };
}

function runOf(over: Partial<TrialRun> = {}): TrialRun {
  return {
    threadId: threadOf(RUN_ID),
    mode: "running",
    busy: false,
    phase: { kind: "ready", result: resultOf() },
    ...over,
  };
}

/** 다시 돌려 검사 화면의 값. 기본은 배포 앱(개발 모드 아님)에서 열린 상태다 */
function replayOf(over: Partial<ReplayController> = {}): ReplayController {
  return {
    target: "helm",
    devMode: false,
    lock: "devMode",
    state: { kind: "idle" },
    results: { kind: "ready", value: [], stale: false },
    notice: null,
    run: NOOP,
    reread: NOOP,
    copy: NOOP,
    openDevMode: NOOP,
    dismiss: NOOP,
    ...over,
  };
}

interface Btn {
  readonly label: string;
  readonly disabled: boolean;
}

/** 서버 렌더 HTML의 단추마다 글과 잠김 여부. InfoTip의 빈 단추도 그대로 든다 */
function buttonsOf(html: string): readonly Btn[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    label: (match[2] ?? "").replace(/<[^>]+>/g, "").trim(),
    disabled: /\sdisabled(?=[\s=>])/.test(match[1] ?? ""),
  }));
}

function buttonNamed(html: string, label: string): Btn | undefined {
  return buttonsOf(html).find((button) => button.label === label);
}

function render(
  trial: TrialController,
  link: "live" | "offline" = "live",
  installed = true,
  replay: ReplayController = replayOf(),
  draft = false,
): string {
  return renderToString(
    <CommandsContext.Provider value={fakeCommands()}>
      <TrialBar link={link} installed={installed} draft={draft} trial={trial} replay={replay} />
    </CommandsContext.Provider>,
  );
}

/** 초안을 고치는 중에 시험이 설치된 그룹을 돌린다는 경고. 정보 아이콘 글과 따로 보인다 */
const DRAFT_WARNING =
  "지금 고치는 초안은 테스트에 들어가지 않아요. 테스트 대화는 설치된 그룹을 돌려요.";

describe("시험 시작 줄", () => {
  test("설치된 그룹은 시작 단추가 눌리고, 설명은 정보 아이콘 뒤에 있다", () => {
    const html = render(trialOf());
    expect(buttonNamed(html, "테스트 대화에서 돌려 보기")?.disabled).toBe(false);
    expect(html).toContain("테스트 대화를 새로 만들고 이 그룹을 그 대화에서 켜요.");
  });

  test("초안을 고치는 중이면 설치된 그룹을 돈다는 경고가 단추 옆에 글로 보인다", () => {
    const html = render(trialOf(), "live", true, replayOf(), true);
    expect(html).toContain(DRAFT_WARNING);
    // 경고는 설명 아이콘의 글에 들어가지 않는다(정보 아이콘 글은 시험 방식만 적는다)
    expect(html).not.toContain("고친 초안은 아직 돌지 않아요");
    expect(buttonNamed(html, "테스트 대화에서 돌려 보기")?.disabled).toBe(false);
  });

  test("초안이 아니면 그 경고는 보이지 않는다", () => {
    expect(render(trialOf())).not.toContain(DRAFT_WARNING);
  });

  test("연결이 없으면 시작이 잠기고 연결하라는 줄이 보인다", () => {
    const html = render(trialOf({ online: false }), "offline");
    expect(buttonNamed(html, "테스트 대화에서 돌려 보기")?.disabled).toBe(true);
    expect(html).toContain("엔진에 연결되면 테스트를 돌릴 수 있어요.");
  });

  test("설치되지 않은 그룹은 잠기고, 이유가 보이고 설명이 정보 아이콘에 있다", () => {
    const html = render(trialOf(), "live", false);
    expect(buttonNamed(html, "테스트 대화에서 돌려 보기")?.disabled).toBe(true);
    expect(html).toContain("설치되지 않은 그룹이라 지금은 돌릴 수 없어요.");
    expect(html).toContain("설치한 뒤 다시 열면 테스트 대화에서 켤 수 있어요.");
  });

  test("시작하는 동안에는 시작 단추가 잠긴다", () => {
    expect(
      buttonNamed(render(trialOf({ starting: true })), "테스트 대화에서 돌려 보기")?.disabled,
    ).toBe(true);
  });

  test("만들기가 실패하면 실패 문장을 보이고, 그룹을 못 켠 대화 id는 짧게 적는다", () => {
    const html = render(
      trialOf({
        notice: { text: "desktop.tests.notice.failed.unsupported", orphan: SHORT_ID },
      }),
    );
    expect(html).toContain("이 엔진에는 아직 없는 기능이에요.");
    expect(html).toContain("테스트 대화 thr_01234567는 만들었지만 이 그룹을 켜지 못했어요.");
  });
});

describe("실행 줄", () => {
  test("실행 중이면 멈춤이 눌리고, 한 경계씩은 잠기고, 지금 단계와 대화 id가 보인다", () => {
    const html = render(trialOf({ run: runOf() }));
    expect(html).toContain("실행 중이에요");
    expect(html).toContain(SHORT_ID);
    expect(html).toContain("review");
    expect(buttonNamed(html, "멈춤")?.disabled).toBe(false);
    expect(buttonNamed(html, "한 경계씩")?.disabled).toBe(true);
    expect(buttonNamed(html, "새로 읽기")?.disabled).toBe(false);
    expect(buttonNamed(html, "끝내기")?.disabled).toBe(false);
    expect(buttonNamed(html, "이어서")).toBeUndefined();
  });

  test("멈추는 중(결과가 아직 멈춘 채가 아님)이면 멈추는 중 단추가 잠기고 이어서로 되돌릴 수 있다", () => {
    const html = render(trialOf({ run: runOf({ mode: "pausing" }) }));
    expect(html).toContain('role="status"');
    expect(buttonNamed(html, "멈추는 중")?.disabled).toBe(true);
    expect(buttonNamed(html, "이어서")?.disabled).toBe(false);
    expect(buttonNamed(html, "한 경계씩")?.disabled).toBe(true);
  });

  test("멈춘 채면 주도 유지 문장이 보이고, 이어서와 한 경계씩이 눌린다", () => {
    const html = render(trialOf({ run: runOf({ mode: "paused" }) }));
    expect(html).toContain("단계 경계에서 멈춤 · 주도 유지");
    expect(buttonNamed(html, "이어서")?.disabled).toBe(false);
    expect(buttonNamed(html, "한 경계씩")?.disabled).toBe(false);
    expect(buttonsOf(html).some((button) => button.label === "멈춤")).toBe(false);
  });

  test("명령이 가는 동안 모든 조종 단추가 잠긴다", () => {
    for (const mode of ["running", "pausing", "paused"] as const) {
      const buttons = buttonsOf(render(trialOf({ run: runOf({ mode, busy: true }) })));
      const controls = buttons.filter((button) =>
        ["멈춤", "멈추는 중", "이어서", "한 경계씩", "새로 읽기", "끝내기"].includes(button.label),
      );
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((button) => button.disabled)).toBe(true);
    }
  });

  test("단계는 없음, 읽지 못함, 읽는 중을 각각 다르게 보인다", () => {
    const cases: readonly (readonly [PhaseRead, string])[] = [
      [{ kind: "ready", result: resultOf({ phase: null }) }, "아직 없어요"],
      [{ kind: "failed" }, "읽지 못했어요"],
      [{ kind: "reading" }, "읽는 중이에요"],
    ];
    for (const [phase, text] of cases) {
      expect(render(trialOf({ run: runOf({ phase }) }))).toContain(text);
    }
  });

  test("연결이 없으면 조종 단추가 모두 잠기고 연결하라는 줄이 보인다", () => {
    const html = render(trialOf({ online: false, run: runOf({ mode: "paused" }) }), "offline");
    expect(html).toContain("엔진에 연결되면 조종할 수 있어요.");
    expect(buttonNamed(html, "이어서")?.disabled).toBe(true);
    expect(buttonNamed(html, "새로 읽기")?.disabled).toBe(true);
    expect(buttonNamed(html, "끝내기")?.disabled).toBe(true);
  });

  test("조종 실패는 실패 종류의 문장으로 보인다", () => {
    const html = render(
      trialOf({
        run: runOf({ mode: "paused" }),
        notice: { text: "desktop.tests.notice.failed.rejected", orphan: null },
      }),
    );
    expect(html).toContain("요청이 거절됐어요.");
  });
});

describe("드라이브 락 줄", () => {
  test("활성 임대는 쥔 그룹을 mono로 보이고 주도 유지라고 적는다", () => {
    const html = render(trialOf({ run: runOf() }));
    expect(html).toContain('<span class="font-mono text-text-primary">helm</span>');
    expect(html).toContain("주도 유지");
  });

  test("반납이 정해진 임대는 반납 중이라고 적는다", () => {
    const html = render(
      trialOf({
        run: runOf({
          phase: {
            kind: "ready",
            result: resultOf({ lock: { holder: "helm", status: "releasing", epoch: 3 } }),
          },
        }),
      }),
    );
    expect(html).toContain("반납 중");
    expect(html).not.toContain("주도 없음");
  });

  test("쥔 것이 없으면 주도 없음이고, 이름 자리는 대시다", () => {
    const html = render(
      trialOf({
        run: runOf({
          phase: {
            kind: "ready",
            result: resultOf({ lock: { holder: null, status: "none", epoch: null } }),
          },
        }),
      }),
    );
    expect(html).toContain("주도 없음");
    expect(html).toContain('<span class="font-mono text-text-primary">—</span>');
  });

  test("읽지 못한 단계에서는 락 줄을 그리지 않는다", () => {
    const html = render(trialOf({ run: runOf({ phase: { kind: "failed" } }) }));
    expect(html).not.toContain("주도 유지");
    expect(html).not.toContain("주도 없음");
  });
});

describe("가드 글", () => {
  test("막은 횟수가 있으면 N번 막았어요를 경고 색 글로 보인다", () => {
    const html = render(
      trialOf({
        run: runOf({
          phase: { kind: "ready", result: resultOf({ guardHits: 3, traceEnabled: true }) },
        }),
      }),
    );
    expect(html).toContain("3번 막았어요");
  });

  test("측정이 켜져 있고 0이면 가드 글이 없다", () => {
    const html = render(trialOf({ run: runOf() }));
    expect(html).not.toContain("막았어요");
    expect(html).not.toContain("측정이 꺼져 있어요");
  });

  test("측정이 꺼져 있으면 흐린 글로 측정이 꺼졌다고 보이고, 설명은 정보 아이콘에 있다", () => {
    const html = render(
      trialOf({
        run: runOf({
          phase: { kind: "ready", result: resultOf({ guardHits: 0, traceEnabled: false }) },
        }),
      }),
    );
    expect(html).toContain("측정이 꺼져 있어요");
    expect(html).toContain("설정에서 측정을 켜면 막은 횟수를 셀 수 있어요.");
    expect(html).not.toContain("막았어요");
  });
});

describe("단계 사이 기록", () => {
  test("기록은 새것이 위이고, 단계 이름, 멈춤, seq를 보이며 목록에 aria-label을 준다", () => {
    const html = render(
      trialOf({
        run: runOf({
          phase: {
            kind: "ready",
            result: resultOf({
              boundaries: [
                { seq: 5, phase: "classify", paused: false },
                { seq: 6, phase: null, paused: true },
                { seq: 7, phase: "review", paused: false },
              ],
            }),
          },
        }),
      }),
    );
    expect(html).toContain('aria-label="단계 사이 기록 목록"');
    const at = (text: string): number => html.indexOf(text);
    expect(at("seq 7")).toBeGreaterThan(-1);
    expect(at("seq 7")).toBeLessThan(at("seq 6"));
    expect(at("seq 6")).toBeLessThan(at("seq 5"));
    expect(html).toContain("여기서 멈춰 기다렸어요");
    expect(html).toContain("단계 이름 없음");
  });

  test("기록이 없으면 빈 글을 보인다", () => {
    const html = render(trialOf({ run: runOf() }));
    expect(html).toContain("아직 단계 사이 기록이 없어요");
    expect(html).not.toContain("seq ");
  });
});

describe("다시 돌려 검사", () => {
  test("배포 앱에서는 눌리는 모양의 단추(aria-disabled)이고 이유가 적혀 있다. 옆에 개발 모드 켜기가 있다", () => {
    const html = renderToString(<ReplayBar replay={replayOf()} />);
    const button = buttonNamed(html, "다시 돌려 검사");
    expect(button?.disabled).toBe(false);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(
      "배포 앱이라 잠겨 있어요. 개발 모드를 켜면 저장소의 테스트 도구로 돌려요.",
    );
    expect(buttonNamed(html, "개발 모드 켜기…")?.disabled).toBe(false);
  });

  test("개발 모드가 켜져 있으면 눌리고 보고 있지 않은 것은 개발 모드 켜기뿐이다", () => {
    const html = renderToString(<ReplayBar replay={replayOf({ devMode: true, lock: null })} />);
    expect(buttonNamed(html, "다시 돌려 검사")?.disabled).toBe(false);
    expect(html).not.toContain('aria-disabled="true"');
    expect(buttonNamed(html, "개발 모드 켜기…")).toBeUndefined();
  });

  test("연결이 없으면 모두 잠기고 연결하라는 글이 이유가 된다. 개발 모드 켜기는 없다", () => {
    const html = renderToString(<ReplayBar replay={replayOf({ lock: "offline" })} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("엔진에 연결되면 테스트를 돌릴 수 있어요.");
    expect(buttonNamed(html, "개발 모드 켜기…")).toBeUndefined();
  });

  test("실행 중에는 진행 막대가 불확실 모양이고 단추는 눌리지 않는다", () => {
    const html = renderToString(
      <ReplayBar replay={replayOf({ devMode: true, lock: null, state: { kind: "running" } })} />,
    );
    expect(html).toContain("다시 돌리는 중이에요");
    expect(html).toContain('data-state="indeterminate"');
    expect(buttonNamed(html, "다시 돌려 검사")?.disabled).toBe(true);
  });

  test("끝나면 판정과 절단 띠, 첫 차이, JSON 복사를 보인다", () => {
    const html = renderToString(
      <ReplayBar
        replay={replayOf({ devMode: true, lock: null, state: { kind: "done", report: REPORT } })}
      />,
    );
    expect(html).toContain("digest 다름");
    expect(html).toContain("41개 중 39개가 같아요");
    expect(html).toContain("첫 차이 seq 212");
    expect(buttonNamed(html, "JSON 복사")).toBeDefined();
    // 한계 한 줄은 줄로 보이지 않고 설명 아이콘 뒤(숨은 글)에 있다
    expect(html).not.toContain('<p class="m-0 text-ui text-text-tertiary">테이프 재생은');
    expect(html).toContain("테이프 재생은 응답이 고정되어");
  });

  test("끝났지만 보고서를 못 찾으면 그 글을 보인다", () => {
    const html = renderToString(
      <ReplayBar
        replay={replayOf({ devMode: true, lock: null, state: { kind: "done", report: null } })}
      />,
    );
    expect(html).toContain("보고서를 찾지 못했어요");
  });

  test("거절되면 실패 알림이 위험 색으로 보이고, 복사 성공은 성공 알림이다", () => {
    const failed = renderToString(
      <ReplayBar
        replay={replayOf({
          devMode: true,
          lock: null,
          notice: { text: "desktop.tests.notice.failed.rejected", failed: true },
        })}
      />,
    );
    expect(failed).toContain("요청이 거절됐어요.");
    const copied = renderToString(
      <ReplayBar
        replay={replayOf({ notice: { text: "desktop.tests.notice.copied", failed: false } })}
      />,
    );
    expect(copied).toContain("JSON을 복사했어요.");
  });

  test("시험 실행 줄과 시작 줄 모두에 다시 돌려 검사가 보인다", () => {
    expect(buttonNamed(render(trialOf()), "다시 돌려 검사")).toBeDefined();
    expect(buttonNamed(render(trialOf({ run: runOf() })), "다시 돌려 검사")).toBeDefined();
  });
});

describe("테스트 결과 목록", () => {
  test("개발 모드면 테스트 결과, 배포 앱이면 읽기 전용 지난 결과와 까닭이 설명 아이콘 뒤에 있다", () => {
    const dev = renderToString(<ReplayBar replay={replayOf({ devMode: true, lock: null })} />);
    expect(dev).toContain("테스트 결과");
    expect(dev).not.toContain("배포 앱에서는 지난 결과를 읽기만 해요.");
    const released = renderToString(<ReplayBar replay={replayOf()} />);
    expect(released).toContain("지난 결과");
    expect(released).toContain("배포 앱에서는 지난 결과를 읽기만 해요.");
  });

  test("이 그룹의 replay만 새것이 위로 보이고, 다른 그룹과 Test run은 빠진다", () => {
    const html = renderToString(
      <ReplayBar
        replay={replayOf({
          results: {
            kind: "ready",
            stale: false,
            value: [
              recordOf({
                testId: "old",
                startedAt: "2026-11-01T09:00:00.000Z",
                replay: null,
                state: "passed",
              }),
              recordOf({ testId: "other", target: "review" }),
              recordOf({ testId: "new", startedAt: "2026-11-03T09:00:00.000Z" }),
              recordOf({ testId: "run", kind: "testRun", replay: null, state: "running" }),
            ],
          },
        })}
      />,
    );
    expect(html.indexOf("digest 다름")).toBeGreaterThan(-1);
    expect(html.indexOf("통과")).toBeGreaterThan(html.indexOf("digest 다름"));
    expect(html.split("가장 최근").length - 1).toBe(1);
    expect(html).toContain("1초");
    expect(html).not.toContain("실행 중");
  });

  test("기록이 없으면 빈 글이고, 읽는 중·오프라인·읽기 실패를 각각 보인다", () => {
    const cases: readonly (readonly [TabRead<readonly ExtTestRecord[]>, string])[] = [
      [{ kind: "ready", value: [], stale: false }, "아직 이 그룹의 테스트 결과가 없어요"],
      [{ kind: "loading" }, "불러오는 중…"],
      [{ kind: "offline" }, "엔진에 연결되어 있지 않아 목록을 읽지 못해요."],
      [{ kind: "error" }, "테스트 결과를 불러오지 못했어요."],
    ];
    for (const [results, text] of cases) {
      const html = renderToString(
        <ReplayBar replay={replayOf({ devMode: true, lock: null, results })} />,
      );
      expect(html).toContain(text);
    }
    const failed = renderToString(
      <ReplayBar replay={replayOf({ devMode: true, lock: null, results: { kind: "error" } })} />,
    );
    expect(buttonNamed(failed, "다시 읽기")).toBeDefined();
  });
});

describe("명령 순서(시작)", () => {
  test("프로필을 싣고 대화를 만든 뒤, 그 대화에서 그룹을 켠다", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        createTestRun: (profileId?: string) => {
          calls.push(`create:${profileId ?? "-"}`);
          return Promise.resolve(ok(RUN_ID));
        },
      },
      workbench: {
        ...base.workbench,
        toggleForThread: (request: ThreadToggleRequest) => {
          calls.push(`toggle:${request.key}:${request.value}:${request.scope}:${request.threadId}`);
          return Promise.resolve(ok(null));
        },
      },
    });
    const outcome = await startTrialRun(commands, { group: "helm", profileId: "quiet" });
    expect(calls).toEqual(["create:quiet", `toggle:ext.helm.enabled:true:launch:${RUN_ID}`]);
    expect(outcome).toEqual({ ok: true, threadId: threadOf(RUN_ID) });
  });

  test("프로필이 없으면 프로필 인자 없이 대화를 만든다", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        createTestRun: (profileId?: string) => {
          calls.push(`create:${profileId ?? "-"}`);
          return Promise.resolve(ok(RUN_ID));
        },
      },
    });
    await startTrialRun(commands, { group: "helm", profileId: undefined });
    expect(calls).toEqual(["create:-"]);
  });

  test("대화 만들기가 거절되면 그룹을 켜지 않고 실패 종류만 돌려준다", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        createTestRun: () => {
          calls.push("create");
          return Promise.resolve(err({ kind: "rejected", code: null }));
        },
      },
      workbench: {
        ...base.workbench,
        toggleForThread: () => {
          calls.push("toggle");
          return Promise.resolve(ok(null));
        },
      },
    });
    const outcome = await startTrialRun(commands, { group: "helm", profileId: "quiet" });
    expect(calls).toEqual(["create"]);
    expect(outcome).toEqual({ ok: false, failure: "rejected", threadId: null });
  });

  test("대화는 만들었지만 켜지 못하면 그 대화 id를 함께 돌려준다", async () => {
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: { ...base.tests, createTestRun: () => Promise.resolve(ok(RUN_ID)) },
      workbench: {
        ...base.workbench,
        toggleForThread: () => Promise.resolve(err({ kind: "unsupported" })),
      },
    });
    const outcome = await startTrialRun(commands, { group: "helm", profileId: undefined });
    expect(outcome).toEqual({ ok: false, failure: "unsupported", threadId: threadOf(RUN_ID) });
  });

  test("호스트가 대화 id가 아닌 값을 주면 켜기를 보내지 않고 실패로 본다", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: { ...base.tests, createTestRun: () => Promise.resolve(ok("not-a-thread")) },
      workbench: {
        ...base.workbench,
        toggleForThread: () => {
          calls.push("toggle");
          return Promise.resolve(ok(null));
        },
      },
    });
    const outcome = await startTrialRun(commands, { group: "helm", profileId: undefined });
    expect(calls).toEqual([]);
    expect(outcome).toEqual({ ok: false, failure: "failed", threadId: null });
  });

  test("지금 단계 읽기는 읽은 결과 전체를 주고, 실패를 단계 없음과 다르게 돌려준다", async () => {
    const base = fakeCommands();
    const reading = fakeCommands({
      tests: {
        ...base.tests,
        phase: () =>
          Promise.resolve(
            ok(
              resultOf({
                boundaries: [{ seq: 6, phase: "classify", paused: false }],
              }),
            ),
          ),
      },
    });
    const failing = fakeCommands({
      tests: {
        ...base.tests,
        phase: () => Promise.resolve(err({ kind: "offline" })),
      },
    });
    expect(await readPhaseOf(reading.tests, RUN_ID)).toEqual({
      kind: "ready",
      result: resultOf({ boundaries: [{ seq: 6, phase: "classify", paused: false }] }),
    });
    expect(await readPhaseOf(failing.tests, RUN_ID)).toEqual({ kind: "failed" });
  });
});

describe("다시 돌려 검사의 명령 순서", () => {
  test("replay를 시작하고, 끝나면 목록을 읽어 보고서를 찾는다(시험 id로)", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        run: (params) => {
          calls.push(`run:${params.kind}:${params.target}`);
          return Promise.resolve(ok({ testId: "t-new", threadId: null }));
        },
        list: () => {
          calls.push("list");
          return Promise.resolve(ok([recordOf({ testId: "t-new" })]));
        },
      },
    });
    const outcome = await replayTrialRun(commands.tests, "helm");
    expect(calls).toEqual(["run:replay:helm", "list"]);
    expect(outcome).toEqual({ ok: true, report: REPORT });
  });

  test("거절되면 목록을 읽지 않고 실패 종류를 돌려준다", async () => {
    const calls: string[] = [];
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        run: () => {
          calls.push("run");
          return Promise.resolve(err({ kind: "rejected", code: null }));
        },
        list: () => {
          calls.push("list");
          return Promise.resolve(ok([]));
        },
      },
    });
    const outcome = await replayTrialRun(commands.tests, "helm");
    expect(calls).toEqual(["run"]);
    expect(outcome).toEqual({ ok: false, failure: "rejected" });
  });

  test("끝났지만 목록에 보고서가 없거나 목록을 못 읽으면 보고서는 null이다", async () => {
    const base = fakeCommands();
    const missing = fakeCommands({
      tests: {
        ...base.tests,
        run: () => Promise.resolve(ok({ testId: "t-gone", threadId: null })),
        list: () => Promise.resolve(ok([])),
      },
    });
    expect(await replayTrialRun(missing.tests, "helm")).toEqual({ ok: true, report: null });
    const unreadable = fakeCommands({
      tests: {
        ...base.tests,
        run: () => Promise.resolve(ok({ testId: "t-1", threadId: null })),
        list: () => Promise.resolve(err({ kind: "offline" })),
      },
    });
    expect(await replayTrialRun(unreadable.tests, "helm")).toEqual({ ok: true, report: null });
  });

  test("끝난 뒤 목록을 다시 읽으면 새 보고서의 줄이 보인다(개발 모드)", async () => {
    const base = fakeCommands();
    const commands = fakeCommands({
      tests: {
        ...base.tests,
        run: () => Promise.resolve(ok({ testId: "t-new", threadId: null })),
        list: () =>
          Promise.resolve(
            ok([recordOf({ testId: "t-new", startedAt: "2026-11-04T10:00:00.000Z" })]),
          ),
      },
    });
    const outcome = await replayTrialRun(commands.tests, "helm");
    const reread = await commands.tests.list();
    const html = renderToString(
      <ReplayBar
        replay={replayOf({
          devMode: true,
          lock: null,
          state: { kind: "done", report: outcome.ok ? outcome.report : null },
          results: reread.ok
            ? { kind: "ready", value: reread.value, stale: false }
            : { kind: "error" },
        })}
      />,
    );
    expect(html).toContain("가장 최근");
    expect(html).toContain("digest 다름");
  });

  test("잠긴 상태에서는 개발 모드 켜기가 설정 화면의 플러그인 탭 개발 모드 항목으로 옮긴다", () => {
    const jumps: SettingsJump[] = [];
    requestDevModeSetting({
      requestSettingsJump: (jump) => {
        jumps.push(jump);
      },
    });
    expect(jumps).toEqual([{ tab: "plugins", key: "l3.authoring.devMode" }]);
    expect(DEV_MODE_JUMP).toEqual({ tab: "plugins", key: "l3.authoring.devMode" });
  });
});

describe("시험 실행의 순수 값", () => {
  test("결과가 멈춘 채면 멈춘 모습, 아니면 멈춤은 멈추는 중, 이어서와 한 경계씩은 달리는 중이다", () => {
    expect(modeAfter("pause", true)).toBe("paused");
    expect(modeAfter("pause", false)).toBe("pausing");
    expect(modeAfter("resume", false)).toBe("running");
    expect(modeAfter("step", true)).toBe("paused");
  });

  test("강조할 단계는 읽은 결과의 단계 이름이고, 읽지 못했거나 없으면 null이다", () => {
    expect(trialPhaseOf({ kind: "ready", result: resultOf({ phase: "review" }) })).toBe("review");
    expect(trialPhaseOf({ kind: "ready", result: resultOf({ phase: null }) })).toBeNull();
    expect(trialPhaseOf({ kind: "failed" })).toBeNull();
    expect(trialPhaseOf({ kind: "reading" })).toBeNull();
  });

  test("대화 id는 머리 글자 열두 자만 보인다", () => {
    expect(shortIdOf(RUN_ID)).toBe(SHORT_ID);
    expect(shortIdOf("thr_1")).toBe("thr_1");
  });
});
