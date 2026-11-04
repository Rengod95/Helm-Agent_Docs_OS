import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { hookNoticesLoaded } from "@fresnel/client/workbench";
import type { HookEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { HookAnswersContext, HookNoticeList } from "../../../src/views/workbench/hook-notice.tsx";
import { inContexts, liveEngine } from "./support.tsx";

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
  const store = createWorkbenchStore((s) => hookNoticesLoaded(s, hooks));
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
