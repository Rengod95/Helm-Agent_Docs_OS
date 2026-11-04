import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { listLoaded } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import { tabTitleOf } from "../../../src/views/shell/end-panel.tsx";
import { createShellRegistry } from "../../../src/views/shell/registry.ts";
import { Shell } from "../../../src/views/shell/shell.tsx";
import { pluginPagesEndTab } from "../../../src/views/workbench/index.tsx";
import { askingEntry, entry, inContexts } from "./support.tsx";

// 오른쪽 "플러그인" 탭(`plugin-pages`): 칸의 숫자는 알림 수, 탭 안 맨 위는 알림(질문과 두 답)이다.

const QUESTION = t("desktop.workbench.keepOff.question");
const KEEP_ON = t("desktop.workbench.keepOff.keepOn");
const KEEP_OFF = t("desktop.workbench.keepOff.keepOff");
const COUNT = t("desktop.workbench.keepOff.count", { name: "review", count: 3 });
const EMPTY = t("desktop.plugin.state.empty");
const LABEL = t("desktop.plugin.tab.pages");

function storeOf(entries: readonly ExtListEntry[]): WorkbenchStore {
  return createWorkbenchStore((initial) => listLoaded(initial, entries));
}

/** 탭 내용을 그린 글. 워크벤치 스토어와 엔진·명령·플러그인 문맥을 씌운다 */
function tabHtml(store: WorkbenchStore): string {
  return renderToString(inContexts(<>{pluginPagesEndTab(store).render()}</>, store));
}

const noop = (): void => undefined;

/** 셸을 그린 글. `open`이면 well이 펼쳐진 채 탭 내용까지 그린다 */
function shellHtml(store: WorkbenchStore, open: boolean): string {
  const shell = createShellStore(1400, (model) => (open ? { ...model, endOpen: true } : model));
  const registry = createShellRegistry();
  registry.registerEndTab(pluginPagesEndTab(store));
  return renderToString(
    inContexts(
      <ShellStoreContext value={shell}>
        <Shell
          registry={registry}
          mac
          settingsOpen={false}
          onSettingsOpenChange={noop}
          settingsScreen={<p />}
          threadList={<p />}
          statusBar={<p />}
          onGoToThread={noop}
        />
      </ShellStoreContext>,
      store,
    ),
  );
}

/** 알림이 둘인 목록: 질문이 떠 있는 review와 질문 없이 자동으로 꺼진 lint */
const TWO_NOTICES = [
  entry("web"),
  askingEntry(),
  entry("lint", { displayName: "린트", autoDisabled: true }),
];

describe("플러그인 탭의 칸 숫자와 이름표", () => {
  test("알림이 없으면 칸 숫자는 0이고 이름표는 탭 이름만이다", () => {
    expect(pluginPagesEndTab(storeOf([entry("web")])).badge?.read()).toBe(0);
    expect(tabTitleOf(LABEL, 0)).toBe(LABEL);
    expect(tabTitleOf(LABEL, undefined)).toBe(LABEL);
  });

  test("알림이 둘이면 칸 숫자는 2이고 이름표는 '플러그인 2'다", () => {
    expect(pluginPagesEndTab(storeOf(TWO_NOTICES)).badge?.read()).toBe(2);
    expect(tabTitleOf(LABEL, 2)).toBe(`${LABEL} 2`);
  });

  test("막대 칸의 이름표가 알림 수를 붙인다(0이면 붙이지 않는다)", () => {
    expect(shellHtml(storeOf([entry("web")]), false)).toContain(`aria-label="${LABEL}"`);
    expect(shellHtml(storeOf(TWO_NOTICES), false)).toContain(`aria-label="${LABEL} 2"`);
  });

  test("펼친 well 머리도 같은 글을 쓴다", () => {
    expect(shellHtml(storeOf(TWO_NOTICES), true)).toContain(`${LABEL} 2</h2>`);
    expect(shellHtml(storeOf([entry("web")]), true)).toContain(`${LABEL}</h2>`);
  });
});

describe("플러그인 탭 맨 위의 알림", () => {
  test("질문이 있는 확장은 알림 줄, 질문, 두 답을 탭 맨 위에 보인다", () => {
    const html = tabHtml(storeOf([entry("web"), askingEntry()]));
    expect(html).toContain(COUNT);
    expect(html).toContain(QUESTION);
    expect(html).toContain(KEEP_ON);
    expect(html).toContain(KEEP_OFF);
    // 알림이 목록(플러그인 화면 목록)보다 앞에 온다
    expect(html.indexOf(QUESTION)).toBeLessThan(html.indexOf(EMPTY));
  });

  test("질문이 없고 알림도 없으면 질문 글을 보이지 않는다", () => {
    const html = tabHtml(storeOf([entry("web")]));
    expect(html).not.toContain(QUESTION);
    expect(html).not.toContain(KEEP_OFF);
    expect(html).toContain(EMPTY);
  });

  test("질문 없이 자동으로 꺼진 확장은 다시 켜기만 보인다", () => {
    const html = tabHtml(storeOf([entry("lint", { displayName: "린트", autoDisabled: true })]));
    expect(html).toContain(t("desktop.workbench.autoDisabled", { name: "린트" }));
    expect(html).toContain(t("desktop.workbench.reenable"));
    expect(html).not.toContain(QUESTION);
  });
});
