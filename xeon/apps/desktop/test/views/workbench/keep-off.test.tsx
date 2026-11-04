import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { listLoaded, openDetail, pickGroup, type WorkbenchState } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import {
  noticeAfter,
  noticeCountOf,
  type NoticeMemo,
} from "../../../src/views/workbench/craft-parts.tsx";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { askingEntry, entry, inContexts, liveEngine } from "./support.tsx";

// 계속 꺼 둘까요(B5) 질문과 자동 꺼짐 알림은 플러그인 카드(선택 패널, 자세히 보기)와 오른쪽 "플러그인" 탭에 있다. 목록 위에는 없다.
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
const COUNT = t("desktop.workbench.keepOff.count", { name: "review", count: 3 });
const AUTO_OFF = t("desktop.workbench.autoDisabled", { name: "review" });
const REENABLE = t("desktop.workbench.reenable");
const SELECTION = t("desktop.workbench.selection.label");

/** 고른 확장의 선택 패널 마크업(다른 곳의 같은 글을 뺀다) */
function panelOf(html: string): string {
  return html.slice(html.indexOf(`aria-label="${SELECTION}"`));
}

describe("계속 꺼 둘까요: 목록 위에는 알림이 없다", () => {
  test("묻는 확장이어도 고르기 전의 목록 위에는 질문과 시작 횟수 줄이 없다", () => {
    const html = render(askingEntry(), { live: true });
    expect(html).not.toContain(COUNT);
    expect(html).not.toContain(QUESTION);
    expect(html).not.toContain(KEEP_OFF);
  });
});

describe("계속 꺼 둘까요: 선택 패널(플러그인 카드)", () => {
  test("고른 확장의 선택 패널은 다시 켜기 단추 대신 질문과 두 답을 보인다", () => {
    const html = render(askingEntry(), {
      live: true,
      prepare: (s) => pickGroup(s, "review"),
    });
    const panel = panelOf(html);
    expect(panel).toContain(QUESTION);
    expect(panel).toContain(KEEP_ON);
    expect(panel).toContain(KEEP_OFF);
    expect(panel).not.toContain(REENABLE);
  });

  test("연결이 끊기면 선택 패널의 질문은 그대로 보이고 두 답 단추는 잠긴다", () => {
    const html = render(askingEntry(), {
      live: false,
      prepare: (s) => pickGroup(s, "review"),
    });
    const panel = panelOf(html);
    expect(panel).toContain(QUESTION);
    expect(buttonState(panel, KEEP_ON)).toBe("disabled");
    expect(buttonState(panel, KEEP_OFF)).toBe("disabled");
  });

  test("관리 위치로 잠긴 확장은 질문이 있어도 선택 패널의 두 답 단추가 잠긴다", () => {
    const html = render(askingEntry({ enabledSource: "managed" }), {
      live: true,
      prepare: (s) => pickGroup(s, "review"),
    });
    const panel = panelOf(html);
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
    const html = render(plain, { live: true, prepare: (s) => pickGroup(s, "review") });
    const panel = panelOf(html);
    expect(panel).toContain(REENABLE);
    expect(panel).not.toContain(QUESTION);
    expect(panel).not.toContain(KEEP_OFF);
  });
});

describe("계속 꺼 둘까요: 자세히 보기", () => {
  test("자세히 보기는 탭 위에 질문과 두 답을 보인다", () => {
    const html = render(askingEntry(), {
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

describe("계속 꺼 둘까요: 알림 수(오른쪽 탭 칸의 숫자)", () => {
  test("질문이 떠 있거나 자동으로 꺼진 확장만 센다", () => {
    const entries = [entry("web"), askingEntry(), entry("lint", { autoDisabled: true })];
    expect(noticeCountOf(entries)).toBe(2);
  });

  test("알림이 있는 확장이 없으면 0이다", () => {
    expect(noticeCountOf([entry("web"), entry("core-loop")])).toBe(0);
    expect(noticeCountOf([])).toBe(0);
  });

  test("질문이 떠 있는 확장은 자동 꺼짐과 겹쳐도 한 번만 센다", () => {
    expect(noticeCountOf([askingEntry()])).toBe(1);
  });
});

describe("계속 꺼 둘까요: 답한 결과는 질문 대신 한 줄로 남는다", () => {
  const asking: NoticeMemo = { asking: true, off: true, answer: null };

  test("질문이 사라지고 자동 꺼짐이 남으면 계속 꺼 둔 결과다", () => {
    expect(noticeAfter(asking, false, true)).toEqual({
      asking: false,
      off: true,
      answer: "kept-off",
    });
  });

  test("질문이 사라지고 켜졌으면 계속 켜 둔 결과다", () => {
    expect(noticeAfter(asking, false, false)).toEqual({
      asking: false,
      off: false,
      answer: "kept-on",
    });
  });

  test("바뀐 것이 없으면 같은 기억을 돌려준다(그리는 중에 고치지 않는다)", () => {
    expect(noticeAfter(asking, true, true)).toBe(asking);
  });

  test("결과 뒤에 질문이 다시 뜨면 지난 답 줄을 거둔다", () => {
    const answered = noticeAfter(asking, false, true);
    expect(noticeAfter(answered, true, true)).toEqual({
      asking: true,
      off: true,
      answer: null,
    });
  });

  test("계속 꺼 둔 뒤 다시 켜기로 자동 꺼짐이 풀리면 답 줄도 사라진다", () => {
    const answered = noticeAfter(asking, false, true);
    expect(noticeAfter(answered, false, false)).toEqual({
      asking: false,
      off: false,
      answer: null,
    });
  });
});
