import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { SelectionPanel } from "../../../src/views/workbench/selection-panel.tsx";
import { asked, entry, inContexts, liveEngine, screenStore } from "./support.tsx";
import type { ExtListEntry } from "@fresnel/contracts/wire";

// 확장 화면의 선택 패널이 크래프트 선택 패널과 같은 알림 부품(`AutoOffNotice`)을 쓴다: 질문과 두 답, 질문 없는 자동 꺼짐 줄.
// 답한 뒤 결과 줄은 같은 부품의 기억(`noticeAfter`)이 맡고 `craft-parts` 시험이 본다.

const noop = (): void => undefined;

function html(target: ExtListEntry): string {
  const store = screenStore();
  return renderToString(
    inContexts(
      <SelectionPanel
        state={store.actions.snapshot()}
        entry={target}
        onToggle={noop}
        onDetail={noop}
        onClear={noop}
        onReenable={noop}
        onKeepOff={noop}
      />,
      store,
      liveEngine(),
    ),
  );
}

describe("확장 화면 선택 패널의 알림", () => {
  test("질문이 있으면 질문과 두 답을 보인다", () => {
    const out = html(asked());
    expect(out).toContain(t("desktop.workbench.keepOff.question"));
    expect(out).toContain(t("desktop.workbench.keepOff.keepOn"));
    expect(out).toContain(t("desktop.workbench.keepOff.keepOff"));
  });

  test("질문 없이 자동으로 꺼졌으면 자동 꺼짐 줄과 다시 켜기를 보인다", () => {
    const out = html(
      entry("lint", { displayName: "린트", status: "disabled", autoDisabled: true }),
    );
    expect(out).toContain(t("desktop.workbench.autoDisabled", { name: "린트" }));
    expect(out).toContain(t("desktop.workbench.reenable"));
    expect(out).not.toContain(t("desktop.workbench.keepOff.question"));
  });

  test("알림이 없으면 알림 글을 보이지 않는다", () => {
    const out = html(entry("web"));
    expect(out).not.toContain(t("desktop.workbench.keepOff.question"));
    expect(out).not.toContain(t("desktop.workbench.reenable"));
  });
});
