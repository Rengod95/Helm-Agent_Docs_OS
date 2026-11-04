import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { hookNoticesLoaded } from "@fresnel/client/workbench";
import type { HookEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { INITIAL_MIRROR, type EngineMirror } from "../../../src/state/engine/state.ts";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { SafeModeContext } from "../../../src/views/safe-mode-context.ts";
import { HookAnswersContext, HookNoticeList } from "../../../src/views/workbench/hook-notice.tsx";
import { inContexts, liveEngine, seededEngine } from "./support.tsx";

// 외부 훅의 끌까요 질문(2026-11-04 사용자). 질문은 경고로 바로 보이고, 두 답은 연결이 살아 있을 때만 누를 수 있다.

const ROW = { fold: "first", handlers: 1, registrations: ["a"], external: true } as const;
const ASKED: HookEntry = {
  ...ROW,
  hook: "no-rm-rf",
  keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
};
const OFF: HookEntry = { ...ROW, hook: "log-start", autoDisabled: true };
const QUIET: HookEntry = { ...ROW, hook: "quiet" };

const answers = {
  keepOn: () => Promise.resolve(true),
  keepOff: () => Promise.resolve(true),
};

function render(hooks: readonly HookEntry[], live: boolean): string {
  const store = createWorkbenchStore((s) => hookNoticesLoaded(s, hooks, false));
  return renderToString(
    inContexts(
      <HookAnswersContext value={answers}>
        <HookNoticeList />
      </HookAnswersContext>,
      store,
      live ? liveEngine() : undefined,
    ),
  );
}

/** 엔진 거울에 실패 기록을 담은 화면. `safe`면 안전 모드 값을 준다 */
function renderOff(
  hooks: readonly HookEntry[],
  failures: EngineMirror["handlerFailures"],
  safe: boolean,
): string {
  const store = createWorkbenchStore((s) => hookNoticesLoaded(s, hooks, safe));
  const engine = seededEngine({ ...INITIAL_MIRROR, handlerFailures: failures });
  const safeMode = safe ? { active: true, cause: null, startupFailures: 1, suggest: false } : null;
  return renderToString(
    <SafeModeContext value={safeMode}>
      {inContexts(
        <HookAnswersContext value={answers}>
          <HookNoticeList />
        </HookAnswersContext>,
        store,
        engine,
      )}
    </SafeModeContext>,
  );
}

/** 최근 실패 목록(`aria-label`)의 줄마다 태그와 주석을 뺀 글 */
function recentLinesOf(html: string): string[] {
  const start = html.indexOf(`aria-label="${t("desktop.workbench.hookOff.recent")}"`);
  if (start === -1) return [];
  const end = html.indexOf("</ul>", start);
  const list = html.slice(start, end);
  return [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
    (m[1] ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""),
  );
}

/** 기록 한 건(시각은 지역 시각으로 만든다). 어느 시간대에서도 같은 HH:MM:SS를 읽는다 */
const failureAt = (at: string, message: string) => ({
  owner: "hook:log-start",
  point: "tool.call.before",
  result: "error",
  message,
  consecutive: 1,
  afterSeq: 3,
  at,
});
const OFF_HOOK: readonly HookEntry[] = [OFF];

function buttonState(html: string, label: string): "enabled" | "disabled" | "missing" {
  for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)) {
    if (!match[0].includes(label)) continue;
    const openTag = match[0].slice(0, match[0].indexOf(">") + 1);
    return /\sdisabled=""/.test(openTag) ? "disabled" : "enabled";
  }
  return "missing";
}

const KEEP_ON = t("desktop.workbench.keepOff.keepOn");
const KEEP_OFF = t("desktop.workbench.keepOff.keepOff");
const REENABLE = t("desktop.workbench.reenable");

describe("외부 훅 끌까요 알림", () => {
  test("질문이 있는 훅은 실패 횟수와 지금은 켜져 있다는 문장, 두 답을 보인다", () => {
    const html = render([ASKED, QUIET], true);
    expect(html).toContain(
      t("desktop.workbench.hookOff.title.consecutive", { hook: "no-rm-rf", count: 5 }),
    );
    expect(html).toContain(t("desktop.workbench.hookOff.body"));
    expect(buttonState(html, KEEP_ON)).toBe("enabled");
    expect(buttonState(html, KEEP_OFF)).toBe("enabled");
    expect(html).not.toContain("quiet");
  });

  test("연결이 끊기면 질문은 그대로 보이고 두 답은 잠긴다", () => {
    const html = render([ASKED], false);
    expect(html).toContain(t("desktop.workbench.hookOff.body"));
    expect(buttonState(html, KEEP_ON)).toBe("disabled");
    expect(buttonState(html, KEEP_OFF)).toBe("disabled");
  });

  test("이미 꺼진 훅은 꺼짐 문장과 다시 켜기 단추를 보이고 질문 단추는 없다", () => {
    const html = render([OFF], true);
    expect(html).toContain(t("desktop.workbench.hookOff.off", { hook: "log-start" }));
    expect(buttonState(html, REENABLE)).toBe("enabled");
    expect(buttonState(html, KEEP_OFF)).toBe("missing");
  });

  test("질문도 꺼짐도 없으면 아무것도 그리지 않는다", () => {
    expect(render([QUIET], true)).not.toContain("hookOff");
    expect(render([QUIET], true)).not.toContain(KEEP_OFF);
  });
});

/** 지역 시각으로 만든 `at`. 어느 시간대에서도 같은 HH:MM:SS를 읽는다 */
const at = (h: number, m: number, s: number): string =>
  new Date(2026, 10, 4, h, m, s).toISOString();

describe("외부 훅 최근 실패: 기록 시각은 지역 HH:MM:SS로 점 앞에 온다", () => {
  test("시각이 있으면 `시각 · 훅 · 메시지` 순서이고, 여러 줄은 기록 순서대로다", () => {
    const html = renderOff(
      OFF_HOOK,
      [failureAt(at(14, 3, 22), "first"), failureAt(at(9, 5, 7), "second")],
      false,
    );
    expect(recentLinesOf(html)).toEqual([
      "14:03:22 · tool.call.before · first",
      "09:05:07 · tool.call.before · second",
    ]);
  });

  test("시각이 날짜로 읽히지 않으면 시각 없이 점과 메시지만 남는다", () => {
    const html = renderOff(OFF_HOOK, [failureAt("not-a-date", "boom")], false);
    expect(recentLinesOf(html)).toEqual(["tool.call.before · boom"]);
  });
});

describe("외부 훅 알림: 안전 모드에서는 질문도 꺼짐도 그리지 않는다", () => {
  test("안전 모드면 질문과 꺼짐 알림이 모두 빈 그림이다", () => {
    expect(renderOff([ASKED, OFF], [], true)).toBe("");
  });

  test("안전 모드가 꺼져 있으면 같은 훅 알림을 그린다", () => {
    expect(renderOff([OFF], [], false)).toContain(
      t("desktop.workbench.hookOff.off", { hook: "log-start" }),
    );
  });
});
