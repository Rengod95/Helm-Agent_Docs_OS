import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { listLoaded, openDetail, pickGroup, type WorkbenchState } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { entry, inContexts, liveEngine } from "./support.tsx";

// 계속 꺼 둘까요(B5) 질문의 알림 상태. 목록 위 알림, 선택 패널, 자세히 보기에서 같은 질문을 그린다.
// 두 답 단추는 연결이 살아 있고 확장이 잠기지 않았을 때만 누를 수 있다.

/** 여러 번 시작하며 자동으로 꺼져 묻는 확장 하나 */
function asked(over: Partial<ExtListEntry> = {}): ExtListEntry {
  return entry("review", {
    layer: "L3",
    isGroup: true,
    status: "disabled",
    autoDisabled: true,
    keepOffQuestion: { disabledStarts: 3 },
    ...over,
  });
}

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

describe("계속 꺼 둘까요: 목록 위 알림", () => {
  test("묻는 확장은 시작 횟수, 질문, 두 답 단추를 보이고 연결이 살아 있으면 누를 수 있다", () => {
    const html = render(asked(), { live: true });
    expect(html).toContain(COUNT);
    expect(html).toContain(QUESTION);
    expect(buttonState(html, KEEP_ON)).toBe("enabled");
    expect(buttonState(html, KEEP_OFF)).toBe("enabled");
  });

  test("연결이 끊기면 질문은 그대로 보이고 두 답 단추는 잠긴다", () => {
    const html = render(asked(), { live: false });
    expect(html).toContain(QUESTION);
    expect(buttonState(html, KEEP_ON)).toBe("disabled");
    expect(buttonState(html, KEEP_OFF)).toBe("disabled");
  });

  test("관리 위치로 잠긴 확장은 질문이 있어도 두 답 단추가 잠긴다", () => {
    const html = render(asked({ enabledSource: "managed" }), { live: true });
    expect(html).toContain(QUESTION);
    expect(buttonState(html, KEEP_ON)).toBe("disabled");
    expect(buttonState(html, KEEP_OFF)).toBe("disabled");
  });

  test("질문이 없는 자동 꺼짐은 질문 없이 다시 켜기 알림을 보인다", () => {
    const plain = entry("review", {
      layer: "L3",
      isGroup: true,
      status: "disabled",
      autoDisabled: true,
    });
    const html = render(plain, { live: true });
    expect(html).not.toContain(QUESTION);
    expect(html).not.toContain(KEEP_OFF);
    expect(html).toContain(t("desktop.workbench.autoDisabled", { name: "review" }));
    expect(html).toContain(t("desktop.workbench.reenable"));
  });
});

describe("계속 꺼 둘까요: 선택 패널과 자세히 보기", () => {
  test("고른 확장의 선택 패널은 다시 켜기 단추 대신 질문과 두 답을 보인다", () => {
    const html = render(asked(), {
      live: true,
      prepare: (s) => pickGroup(s, "review"),
    });
    const panel = html.slice(
      html.indexOf(`aria-label="${t("desktop.workbench.selection.label")}"`),
    );
    expect(panel).toContain(QUESTION);
    expect(panel).toContain(KEEP_ON);
    expect(panel).toContain(KEEP_OFF);
    expect(panel).not.toContain(t("desktop.workbench.reenable"));
  });

  test("자세히 보기는 탭 위에 질문과 두 답을 보인다", () => {
    const html = render(asked(), {
      live: true,
      prepare: (s) => openDetail(s, "review"),
    });
    expect(html).toContain(t("desktop.workbench.detail.back"));
    expect(html).toContain(QUESTION);
    expect(buttonState(html, KEEP_OFF)).toBe("enabled");
  });
});
