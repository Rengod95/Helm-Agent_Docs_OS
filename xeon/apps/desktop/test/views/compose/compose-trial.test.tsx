import { describe, expect, test } from "bun:test";
import type { ThreadToggleRequest } from "@fresnel/client/workbench";
import { err, ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { renderToString } from "react-dom/server";
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
import { fakeCommands } from "../fake-commands.ts";

// 시험 실행의 서버 렌더와 명령 순서. 글, 단추의 잠김, 실행 줄의 상태 문장과 지금 단계를 본다.
// 명령 순서는 명령 대역으로 시험한다(React 없이 `startTrialRun`). 클릭과 다시 읽기 타이머는 DOM이 없어 시험하지 않는다.

const NOOP = (): void => {};
const RUN_ID = "thr_0123456789ABCDEFGHJKMNPQRS";
const SHORT_ID = "thr_01234567";

/** 시험 대화 id는 wire의 브랜드 값이다. 시험 입력은 스키마로 만든다 */
function threadOf(raw: string): ThreadId {
  const parsed = parse(ThreadIdSchema, raw);
  if (!parsed.ok) throw new Error(`시험 입력의 대화 id가 잘못됐어요: ${raw}`);
  return parsed.value;
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
    phase: { kind: "ready", phase: "review" },
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
): string {
  return renderToString(
    <CommandsContext.Provider value={fakeCommands()}>
      <TrialBar link={link} installed={installed} trial={trial} />
    </CommandsContext.Provider>,
  );
}

describe("시험 시작 줄", () => {
  test("설치된 그룹은 시작 단추가 눌리고, 설명은 정보 아이콘 뒤에 있다", () => {
    const html = render(trialOf());
    expect(buttonNamed(html, "시험 대화에서 돌려 보기")?.disabled).toBe(false);
    expect(html).toContain("시험 대화를 새로 만들고 이 그룹을 그 대화에서 켜요.");
  });

  test("연결이 없으면 시작이 잠기고 연결하라는 줄이 보인다", () => {
    const html = render(trialOf({ online: false }), "offline");
    expect(buttonNamed(html, "시험 대화에서 돌려 보기")?.disabled).toBe(true);
    expect(html).toContain("엔진에 연결되면 시험을 돌릴 수 있어요.");
  });

  test("설치되지 않은 그룹은 잠기고, 이유가 보이고 설명이 정보 아이콘에 있다", () => {
    const html = render(trialOf(), "live", false);
    expect(buttonNamed(html, "시험 대화에서 돌려 보기")?.disabled).toBe(true);
    expect(html).toContain("설치되지 않은 그룹이라 지금은 돌릴 수 없어요.");
    expect(html).toContain("설치한 뒤 다시 열면 시험 대화에서 켤 수 있어요.");
  });

  test("시작하는 동안에는 시작 단추가 잠긴다", () => {
    expect(
      buttonNamed(render(trialOf({ starting: true })), "시험 대화에서 돌려 보기")?.disabled,
    ).toBe(true);
  });

  test("만들기가 실패하면 실패 문장을 보이고, 그룹을 못 켠 대화 id는 짧게 적는다", () => {
    const html = render(
      trialOf({
        notice: { text: "desktop.tests.notice.failed.unsupported", orphan: SHORT_ID },
      }),
    );
    expect(html).toContain("이 엔진에는 아직 없는 기능이에요.");
    expect(html).toContain("시험 대화 thr_01234567는 만들었지만 이 그룹을 켜지 못했어요.");
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
      [{ kind: "ready", phase: null }, "아직 없어요"],
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

  test("지금 단계 읽기는 실패를 단계 없음과 다르게 돌려준다", async () => {
    const base = fakeCommands();
    const reading = fakeCommands({
      tests: {
        ...base.tests,
        phase: () =>
          Promise.resolve(
            ok({
              phase: "review",
              group: "helm",
              seq: 3,
              paused: false,
              lock: { holder: "helm", status: "active", epoch: 1 },
              guardHits: 0,
              traceEnabled: true,
              boundaries: [],
            }),
          ),
      },
    });
    const failing = fakeCommands({
      tests: {
        ...base.tests,
        phase: () => Promise.resolve(err({ kind: "offline" })),
      },
    });
    expect(await readPhaseOf(reading.tests, RUN_ID)).toEqual({ kind: "ready", phase: "review" });
    expect(await readPhaseOf(failing.tests, RUN_ID)).toEqual({ kind: "failed" });
  });
});

describe("시험 실행의 순수 값", () => {
  test("결과가 멈춘 채면 멈춘 모습, 아니면 멈춤은 멈추는 중, 이어서와 한 경계씩은 달리는 중이다", () => {
    expect(modeAfter("pause", true)).toBe("paused");
    expect(modeAfter("pause", false)).toBe("pausing");
    expect(modeAfter("resume", false)).toBe("running");
    expect(modeAfter("step", true)).toBe("paused");
  });

  test("강조할 단계는 읽은 단계 이름이고, 읽지 못했거나 없으면 null이다", () => {
    expect(trialPhaseOf({ kind: "ready", phase: "review" })).toBe("review");
    expect(trialPhaseOf({ kind: "ready", phase: null })).toBeNull();
    expect(trialPhaseOf({ kind: "failed" })).toBeNull();
    expect(trialPhaseOf({ kind: "reading" })).toBeNull();
  });

  test("대화 id는 머리 글자 열두 자만 보인다", () => {
    expect(shortIdOf(RUN_ID)).toBe(SHORT_ID);
    expect(shortIdOf("thr_1")).toBe("thr_1");
  });
});
