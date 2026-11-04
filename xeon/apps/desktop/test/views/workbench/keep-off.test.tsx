import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  hookNoticesLoaded,
  hookNoticesOf,
  listLoaded,
  openDetail,
  pickGroup,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import type { ExtListEntry, HookEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import { SafeModeContext } from "../../../src/views/safe-mode-context.ts";
import {
  firstNoticeOf,
  hookNoticeAfter,
  noticeAfter,
  noticeCountOf,
  noticeTotalOf,
  type HookNoticeMemo,
  type NoticeMemo,
} from "../../../src/views/workbench/craft-parts.tsx";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { asked, entry, inContexts, liveEngine } from "./support.tsx";

// 끌까요(2026-11-04 사용자) 질문의 알림 상태. 질문과 두 답은 플러그인 카드(선택 패널, 자세히 보기)와 오른쪽 "플러그인" 탭에 있고, 목록 위에는 없다.
// 두 답 단추는 연결이 살아 있고 확장이 잠기지 않았을 때만 누를 수 있다.

function storeWith(
  review: ExtListEntry,
  prepare: (s: WorkbenchState) => WorkbenchState = (s) => s,
): WorkbenchStore {
  return createWorkbenchStore((initial) =>
    prepare(listLoaded(initial, [entry("web", { displayName: "웹 검색" }), review])),
  );
}

function render(
  review: ExtListEntry,
  options: { live: boolean; prepare?: (s: WorkbenchState) => WorkbenchState },
): string {
  const engine = options.live ? liveEngine() : undefined;
  return renderToString(
    inContexts(<ExtensionsScreen />, storeWith(review, options.prepare), engine),
  );
}

/** 글이 `label`인 단추의 상태. 단추가 없으면 "missing"이라 잠김과 헷갈리지 않는다 */
function buttonState(html: string, label: string): "enabled" | "disabled" | "missing" {
  for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)) {
    if (!match[0].includes(label)) continue;
    const openTag = match[0].slice(0, match[0].indexOf(">") + 1);
    // 클래스의 `disabled:` 변형과 구분하려고 특성 모양(`disabled=""`)만 본다
    return /\sdisabled=""/.test(openTag) ? "disabled" : "enabled";
  }
  return "missing";
}

const KEEP_ON = t("desktop.workbench.keepOff.keepOn");
const KEEP_OFF = t("desktop.workbench.keepOff.keepOff");
const QUESTION = t("desktop.workbench.keepOff.question");
const COUNT = t("desktop.workbench.keepOff.consecutive", { name: "review", count: 5 });
const AUTO_OFF = t("desktop.workbench.autoDisabled", { name: "review" });
const REENABLE = t("desktop.workbench.reenable");
const SELECTION = t("desktop.workbench.selection.label");

/** 고른 확장의 선택 패널 마크업(다른 곳의 같은 글을 뺀다) */
function panelOf(html: string): string {
  return html.slice(html.indexOf(`aria-label="${SELECTION}"`));
}

/** review를 고른 채 그린 선택 패널 */
function pickedPanel(review: ExtListEntry, live = true): string {
  return panelOf(render(review, { live, prepare: (s) => pickGroup(s, "review") }));
}

describe("끌까요: 목록 위에는 알림이 없다", () => {
  test("묻는 확장이어도 고르기 전의 목록 위에는 실패 횟수 줄, 질문, 끄기 단추가 없다", () => {
    const html = render(asked(), { live: true });
    expect(html).not.toContain(COUNT);
    expect(html).not.toContain(QUESTION);
    expect(html).not.toContain(KEEP_OFF);
  });
});

describe("끌까요: 선택 패널(플러그인 카드)", () => {
  test("고른 확장의 선택 패널은 실패 횟수, 질문, 두 답을 보이고 연결이 살아 있으면 누를 수 있다", () => {
    const panel = pickedPanel(asked());
    expect(panel).toContain(COUNT);
    expect(panel).toContain(QUESTION);
    expect(buttonState(panel, KEEP_ON)).toBe("enabled");
    expect(buttonState(panel, KEEP_OFF)).toBe("enabled");
    expect(panel).not.toContain(REENABLE);
  });

  test("연결이 끊기면 선택 패널의 질문은 그대로 보이고 두 답 단추는 잠긴다", () => {
    const panel = pickedPanel(asked(), false);
    expect(panel).toContain(QUESTION);
    expect(buttonState(panel, KEEP_ON)).toBe("disabled");
    expect(buttonState(panel, KEEP_OFF)).toBe("disabled");
  });

  test("관리 위치로 잠긴 확장은 질문이 있어도 선택 패널의 두 답 단추가 잠긴다", () => {
    const panel = pickedPanel(asked({ enabledSource: "managed" }));
    expect(panel).toContain(QUESTION);
    expect(buttonState(panel, KEEP_ON)).toBe("disabled");
    expect(buttonState(panel, KEEP_OFF)).toBe("disabled");
  });

  test("질문이 없는 자동 꺼짐은 선택 패널에 다시 켜기 단추를 보이고 질문은 보이지 않는다", () => {
    const plain = entry("review", {
      layer: "L3",
      isGroup: true,
      status: "disabled",
      autoDisabled: true,
    });
    const panel = pickedPanel(plain);
    expect(panel).toContain(REENABLE);
    expect(panel).not.toContain(QUESTION);
    expect(panel).not.toContain(KEEP_OFF);
  });
});

describe("끌까요: 자세히 보기", () => {
  test("자세히 보기는 탭 위에 질문과 두 답을 보인다", () => {
    const html = render(asked(), {
      live: true,
      prepare: (s) => openDetail(s, "review"),
    });
    expect(html).toContain(t("desktop.workbench.detail.back"));
    expect(html).toContain(QUESTION);
    expect(buttonState(html, KEEP_OFF)).toBe("enabled");
  });

  test("질문이 없는 자동 꺼짐은 자동으로 꺼졌다는 글과 다시 켜기를 보인다", () => {
    const plain = entry("review", {
      layer: "L3",
      isGroup: true,
      status: "disabled",
      autoDisabled: true,
    });
    const html = render(plain, { live: true, prepare: (s) => openDetail(s, "review") });
    expect(html).toContain(AUTO_OFF);
    expect(html).toContain(REENABLE);
    expect(html).not.toContain(QUESTION);
  });
});

describe("끌까요: 알림 수(오른쪽 탭 칸의 숫자)", () => {
  test("질문이 떠 있거나 자동으로 꺼진 확장만 센다", () => {
    const entries = [entry("web"), asked(), entry("lint", { autoDisabled: true })];
    expect(noticeCountOf(entries)).toBe(2);
  });

  test("알림이 있는 확장이 없으면 0이다", () => {
    expect(noticeCountOf([entry("web"), entry("core-loop")])).toBe(0);
    expect(noticeCountOf([])).toBe(0);
  });

  test("질문과 자동 꺼짐이 한 확장에 같이 있으면 한 번만 센다", () => {
    expect(noticeCountOf([asked({ autoDisabled: true })])).toBe(1);
  });
});

describe("끌까요: 답한 결과는 질문 대신 한 줄로 남는다", () => {
  // 질문 동안 확장은 켜져 있다(자동 꺼짐 아님)
  const asking: NoticeMemo = { asking: true, off: false, answer: null };

  test("질문이 사라지고 자동 꺼짐이 남으면 끈 결과다", () => {
    expect(noticeAfter(asking, false, true)).toEqual({
      asking: false,
      off: true,
      answer: "kept-off",
    });
  });

  test("질문이 사라지고 켜진 채면 켜 둔 결과다", () => {
    expect(noticeAfter(asking, false, false)).toEqual({
      asking: false,
      off: false,
      answer: "kept-on",
    });
  });

  test("바뀐 것이 없으면 같은 기억을 돌려준다(그리는 중에 고치지 않는다)", () => {
    expect(noticeAfter(asking, true, false)).toBe(asking);
  });

  test("결과 뒤에 질문이 다시 뜨면 지난 답 줄을 거둔다", () => {
    const answered = noticeAfter(asking, false, true);
    expect(noticeAfter(answered, true, false)).toEqual({
      asking: true,
      off: false,
      answer: null,
    });
  });

  test("끈 뒤 다시 켜기로 자동 꺼짐이 풀리면 답 줄도 사라진다", () => {
    const answered = noticeAfter(asking, false, true);
    expect(noticeAfter(answered, false, false)).toEqual({
      asking: false,
      off: false,
      answer: null,
    });
  });
});

/** 외부 훅 알림 기억의 질문 동안 값(확장과 달리 성공 표 `sent`를 따로 든다) */
const HOOK_ASKING: HookNoticeMemo = { asking: true, off: false, sent: false, answer: null };

describe("외부 훅 알림의 기억: 질문이 사라진 결과는 이 자리의 답이면 끈·켜 둔 결과, 아니면 다른 곳에서 답한 것이다", () => {
  test("이 자리의 답이 성공했고 자동 꺼짐이 남았으면 끈 결과다", () => {
    expect(
      hookNoticeAfter({ ...HOOK_ASKING, sent: true }, { asking: false, off: true, busy: false }),
    ).toEqual({ asking: false, off: true, sent: false, answer: "kept-off" });
  });

  test("이 자리의 답이 성공했고 켜진 채면 켜 둔 결과다", () => {
    expect(
      hookNoticeAfter({ ...HOOK_ASKING, sent: true }, { asking: false, off: false, busy: false }),
    ).toEqual({ asking: false, off: false, sent: false, answer: "kept-on" });
  });

  test("이 자리의 답 없이 질문이 사라지면 다른 곳에서 답한 것이고, 꺼졌는지는 그대로 본다", () => {
    expect(hookNoticeAfter(HOOK_ASKING, { asking: false, off: true, busy: false })).toEqual({
      asking: false,
      off: true,
      sent: false,
      answer: "elsewhere",
    });
    expect(hookNoticeAfter(HOOK_ASKING, { asking: false, off: false, busy: false })).toEqual({
      asking: false,
      off: false,
      sent: false,
      answer: "elsewhere",
    });
  });

  test("답을 보내는 중에 질문이 사라지면 기다린다(같은 기억을 돌려준다)", () => {
    expect(hookNoticeAfter(HOOK_ASKING, { asking: false, off: true, busy: true })).toBe(
      HOOK_ASKING,
    );
  });

  test("기다리던 답이 성공하면 성공 표가 서고, 그다음 결과는 끈 결과다", () => {
    const waiting = hookNoticeAfter(HOOK_ASKING, { asking: false, off: true, busy: true });
    const sent = { ...waiting, sent: true };
    expect(hookNoticeAfter(sent, { asking: false, off: true, busy: false })).toEqual({
      asking: false,
      off: true,
      sent: false,
      answer: "kept-off",
    });
  });

  test("바뀐 것이 없으면 같은 기억이다", () => {
    expect(hookNoticeAfter(HOOK_ASKING, { asking: true, off: false, busy: false })).toBe(
      HOOK_ASKING,
    );
  });

  test("결과 뒤에 질문이 다시 뜨면 답 줄을 거두고 성공 표도 지운다", () => {
    const done = hookNoticeAfter(
      { ...HOOK_ASKING, sent: true },
      { asking: false, off: false, busy: false },
    );
    expect(done.answer).toBe("kept-on");
    expect(hookNoticeAfter(done, { asking: true, off: false, busy: false })).toEqual({
      asking: true,
      off: false,
      sent: false,
      answer: null,
    });
  });

  test("다른 곳에서 답한 결과 뒤 다시 켜기로 자동 꺼짐이 풀리면 결과 줄도 사라진다", () => {
    const elsewhere: HookNoticeMemo = {
      asking: false,
      off: true,
      sent: false,
      answer: "elsewhere",
    };
    expect(hookNoticeAfter(elsewhere, { asking: false, off: false, busy: false })).toEqual({
      asking: false,
      off: false,
      sent: false,
      answer: null,
    });
  });
});

/** 훅 하나의 질문(연속 5번 실패). 알림 개수 시험에 쓴다 */
const HOOK_ASKED: HookEntry = {
  hook: "no-rm-rf",
  fold: "first",
  handlers: 1,
  registrations: ["a"],
  external: true,
  keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
};

describe("확장 화면 위 경고 줄: 개수는 알림 있는 확장과 훅을 합치고, 안전 모드면 훅은 빠진다", () => {
  const hooks = hookNoticesOf([HOOK_ASKED]);

  test("확장 알림과 훅 알림을 합친 수다", () => {
    expect(noticeTotalOf([asked(), entry("lint", { autoDisabled: true })], hooks, false)).toBe(3);
  });

  test("안전 모드면 훅은 세지 않는다", () => {
    expect(noticeTotalOf([asked(), entry("lint", { autoDisabled: true })], hooks, true)).toBe(2);
    expect(noticeTotalOf([], hooks, true)).toBe(0);
  });

  test("알림이 없으면 0이다", () => {
    expect(noticeTotalOf([entry("web")], [], false)).toBe(0);
  });

  test("알림이 있는 첫 확장은 목록 순서로 고른다. 알림이 없으면 null이다", () => {
    expect(
      firstNoticeOf([entry("web"), asked(), entry("lint", { autoDisabled: true })])?.name,
    ).toBe("review");
    expect(firstNoticeOf([entry("lint", { autoDisabled: true }), asked()])?.name).toBe("lint");
    expect(firstNoticeOf([entry("web")])).toBeNull();
  });
});

/** 확장 화면을 그린 글. 훅 알림과 안전 모드 값을 받는다 */
function screenHtml(
  entries: readonly ExtListEntry[],
  hooks: readonly HookEntry[],
  safe: boolean,
): string {
  const store = createWorkbenchStore((initial) =>
    hookNoticesLoaded(listLoaded(initial, entries), hooks, safe),
  );
  const safeMode = safe ? { active: true, cause: null, startupFailures: 1, suggest: false } : null;
  return renderToString(
    <SafeModeContext value={safeMode}>
      {inContexts(<ExtensionsScreen />, store, liveEngine())}
    </SafeModeContext>,
  );
}

/** 경고 줄의 글(개수를 넣은 것) */
const countText = (count: number): string => t("desktop.workbench.notices.count", { count });

describe("확장 화면 위 경고 줄의 글과 '보기'", () => {
  const VIEW = t("desktop.workbench.notices.view");

  test("알림이 있으면 개수를 적은 위험 경고와 '보기'를 보인다", () => {
    const html = screenHtml([entry("web"), asked()], [], false);
    expect(html).toContain(countText(1));
    expect(html).toContain(VIEW);
  });

  test("훅 알림만 있으면 개수는 훅 수이고 '보기'는 없다(고를 확장이 없다)", () => {
    const html = screenHtml([entry("web")], [HOOK_ASKED], false);
    expect(html).toContain(countText(1));
    expect(html).not.toContain(VIEW);
  });

  test("알림이 없으면 경고 줄도 없다", () => {
    const html = screenHtml([entry("web")], [], false);
    expect(html).not.toContain(countText(0));
    expect(html).not.toContain(VIEW);
  });

  test("안전 모드면 훅은 개수에서 빠진다(훅만 있으면 경고 줄도 없다)", () => {
    expect(screenHtml([entry("web")], [HOOK_ASKED], true)).not.toContain(countText(1));
    expect(screenHtml([asked()], [HOOK_ASKED], true)).toContain(countText(1));
    expect(screenHtml([asked()], [HOOK_ASKED], true)).not.toContain(countText(2));
  });
});
