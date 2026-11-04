import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { hookNoticesLoaded } from "@fresnel/client/workbench";
import type { HookEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import { SafeModeContext } from "../../../src/views/safe-mode-context.ts";
import { runtimeEndTab } from "../../../src/views/workbench/index.tsx";
import { inContexts } from "../workbench/support.tsx";

// 런타임 탭(대화 영역의 "런타임"): 칸의 숫자는 훅 알림 수이고, 탭 안 맨 위에 훅 알림을 둔다. 안전 모드면 둘 다 0이다.

const ROW = { fold: "first", handlers: 1, registrations: ["a"], external: true } as const;
const ASKED: HookEntry = {
  ...ROW,
  hook: "no-rm-rf",
  keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
};
const OFF: HookEntry = { ...ROW, hook: "log-start", autoDisabled: true };
const QUIET: HookEntry = { ...ROW, hook: "quiet" };

const SAFE = { active: true, cause: null, startupFailures: 1, suggest: false };

function storeOf(hooks: readonly HookEntry[], safe = false): WorkbenchStore {
  return createWorkbenchStore((s) => hookNoticesLoaded(s, hooks, safe));
}

/** 탭 내용을 그린 글. 안전 모드면 안전 모드 값을 씌운다 */
function tabHtml(store: WorkbenchStore, safe = false): string {
  return renderToString(
    <SafeModeContext value={safe ? SAFE : null}>
      {inContexts(<>{runtimeEndTab(store).render()}</>, store)}
    </SafeModeContext>,
  );
}

const QUESTION = t("desktop.workbench.hookOff.title.consecutive", { hook: "no-rm-rf", count: 5 });
const LOCK_SECTION = `aria-label="${t("desktop.runtime.section.lock")}"`;

describe("런타임 탭: 칸의 숫자와 자리", () => {
  test("탭 id와 영역은 런타임 탭이고 이름표는 런타임이다", () => {
    const tab = runtimeEndTab(storeOf([]));
    expect(tab.id).toBe("runtime");
    expect(tab.area).toBe("chat");
    expect(tab.label).toBe("desktop.shell.tab.runtime");
  });

  test("칸의 숫자는 질문과 꺼짐이 있는 훅 수다(조용한 훅은 세지 않는다)", () => {
    expect(runtimeEndTab(storeOf([ASKED, OFF, QUIET])).badge?.read()).toBe(2);
    expect(runtimeEndTab(storeOf([QUIET])).badge?.read()).toBe(0);
  });

  test("안전 모드면 칸의 숫자는 0이고 탭 안에도 훅 알림이 없다", () => {
    expect(runtimeEndTab(storeOf([ASKED, OFF], true)).badge?.read()).toBe(0);
    expect(tabHtml(storeOf([ASKED, OFF], true), true)).not.toContain(QUESTION);
  });

  test("탭 안 맨 위에 훅 질문을 보이고, 그 자리는 첫 구역(주도 락)보다 앞이다", () => {
    const html = tabHtml(storeOf([ASKED]));
    const question = html.indexOf(QUESTION);
    expect(question).toBeGreaterThan(-1);
    expect(question).toBeLessThan(html.indexOf(LOCK_SECTION));
  });
});
