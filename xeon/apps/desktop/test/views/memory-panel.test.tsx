import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { MemoryStoreView } from "@fresnel/contracts/capabilities";
import { renderToString } from "react-dom/server";
import {
  DialogNotice,
  MemoryEditorBody,
  MemoryPanelView,
  remainingOf,
  type MemoryPanelViewProps,
} from "../../src/views/pages/settings/settings-memory-view.tsx";

// 설정 기억 구역(W-19, scE S7). 항목 행, 빈 상태 문장, 쓰기 막힘 경고, 오류 줄, 남은 글자 줄을 HTML로 본다.
// 대화 상자 본문은 포털이라 서버에서 그리지 않으므로 본문 컴포넌트를 따로 그린다(thread-export-dialog.test.tsx와 같은 방식).

const HASH = "a".repeat(64);
const FIRST_ID = "000000000000";

function store(
  name: "user" | "env",
  texts: readonly string[],
  writeBlocked = false,
): MemoryStoreView {
  return {
    store: name,
    entries: texts.map((text, index) => ({
      id: index.toString(16).padStart(12, "0"),
      text,
      chars: text.length,
    })),
    usedChars: texts.join("").length,
    limitChars: 1375,
    fileHash: HASH,
    writeBlocked,
  };
}

function propsOf(overrides: Partial<MemoryPanelViewProps>): MemoryPanelViewProps {
  return {
    load: { kind: "ready", stores: [store("user", []), store("env", [])] },
    notice: null,
    editor: { kind: "closed" },
    removing: null,
    busy: false,
    onOpenAdd: () => {},
    onOpenEdit: () => {},
    onText: () => {},
    onSave: () => {},
    onCloseEditor: () => {},
    onAskRemove: () => {},
    onConfirmRemove: () => {},
    onCloseRemove: () => {},
    ...overrides,
  };
}

function htmlOf(overrides: Partial<MemoryPanelViewProps>): string {
  return renderToString(<MemoryPanelView {...propsOf(overrides)} />);
}

function countOf(html: string, text: string): number {
  return html.split(text).length - 1;
}

/** 서버 렌더가 글을 옮긴 꼴. `설정 > 탭`의 `>`는 `&gt;`가 된다 */
function escapedOf(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

/** 표식이 든 여는 태그의 class 토큰. 토큰 단위로 맞춰 `min-w-0`이 다른 클래스의 일부로 맞는 것을 막는다 */
function classTokensOf(html: string, marker: string): readonly string[] {
  expect(html).toContain(marker);
  const at = html.indexOf(marker);
  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(">", at);
  const cls = /\sclass="([^"]*)"/.exec(html.slice(start, end))?.[1] ?? "";
  return cls.split(" ");
}

describe("memory entries", () => {
  test("each entry is a row with its text, and the size is shown per store", () => {
    const html = htmlOf({
      load: {
        kind: "ready",
        stores: [store("user", ["답은 짧게", "커밋은 사람이 확인한 뒤에"]), store("env", [])],
      },
    });
    expect(html).toContain("답은 짧게");
    expect(html).toContain("커밋은 사람이 확인한 뒤에");
    expect(html.match(/data-memory-entry=/g)).toHaveLength(2);
    expect(html).toContain(
      t("desktop.memory.used", {
        used: String("답은 짧게커밋은 사람이 확인한 뒤에".length),
        limit: "1375",
      }),
    );
  });

  test("an empty store says nothing is remembered yet and what gets remembered", () => {
    const html = htmlOf({});
    expect(html).toContain(t("desktop.memory.empty"));
    expect(html).toContain(t("desktop.memory.empty.hint"));
    expect(html.match(/data-memory-entry=/g)).toBeNull();
  });

  test("a damaged store shows the warning and disables its buttons", () => {
    const html = htmlOf({
      load: { kind: "ready", stores: [store("user", ["x"], true), store("env", [])] },
    });
    expect(html).toContain(t("desktop.memory.blocked"));
    const row = html.slice(html.indexOf('data-memory-entry="'), html.indexOf("</li>"));
    expect(row.match(/disabled=""/g)).toHaveLength(2);
  });

  test("a 300-character entry cannot widen its row: the wrappers can shrink and both buttons stay in the row", () => {
    const longText = "가".repeat(300);
    const html = htmlOf({
      load: { kind: "ready", stores: [store("user", [longText]), store("env", [])] },
    });
    expect(classTokensOf(html, 'data-memory-store="user"')).toContain("min-w-0");
    expect(classTokensOf(html, "<ul")).toContain("min-w-0");
    expect(classTokensOf(html, `data-memory-entry="${FIRST_ID}"`)).toContain("min-w-0");
    const row = html.slice(html.indexOf(`data-memory-entry="${FIRST_ID}"`), html.indexOf("</li>"));
    expect(row).toContain(longText);
    expect(row).toContain(t("desktop.memory.edit"));
    expect(row).toContain(t("desktop.memory.remove"));
  });
});

describe("states", () => {
  test("a failed read shows the engine-unsupported sentence or the plain failure", () => {
    expect(htmlOf({ load: { kind: "failed", unsupported: true } })).toContain(
      t("desktop.memory.unsupported"),
    );
    expect(htmlOf({ load: { kind: "failed", unsupported: false } })).toContain(
      t("desktop.memory.loadFailed"),
    );
  });

  test("a notice with no dialog open shows once above the list", () => {
    const html = htmlOf({ notice: "desktop.memory.stale" });
    expect(countOf(html, t("desktop.memory.stale"))).toEqual(1);
    expect(html).toContain('data-tone="warning"');
  });
});

describe("errors belong inside the dialog", () => {
  test("while the editor is open the save error is not repeated on the page", () => {
    const html = htmlOf({
      notice: "desktop.memory.saveFailed",
      editor: { kind: "open", store: "user", entryId: null, text: "새 기억" },
    });
    expect(countOf(html, t("desktop.memory.saveFailed"))).toEqual(0);
  });

  test("while the remove dialog is open the error is not repeated on the page", () => {
    const html = htmlOf({
      notice: "desktop.memory.saveFailed",
      removing: { store: "user", entryId: FIRST_ID, text: "지울 기억" },
    });
    expect(countOf(html, t("desktop.memory.saveFailed"))).toEqual(0);
  });

  test("a save failure is a danger alert and a stale read is a warning alert", () => {
    const failed = renderToString(<DialogNotice notice="desktop.memory.saveFailed" />);
    expect(failed).toContain(t("desktop.memory.saveFailed"));
    expect(failed).toContain('data-tone="danger"');
    expect(failed).toContain('role="alert"');
    const stale = renderToString(<DialogNotice notice="desktop.memory.stale" />);
    expect(stale).toContain('data-tone="warning"');
  });

  test("the editor body puts the error above the text box", () => {
    const html = renderToString(
      <MemoryEditorBody
        notice="desktop.memory.saveFailed"
        view={store("user", [])}
        entryId={null}
        text="새 기억"
        onText={() => {}}
      />,
    );
    const alertAt = html.indexOf(t("desktop.memory.saveFailed"));
    expect(alertAt).toBeGreaterThanOrEqual(0);
    expect(alertAt).toBeLessThan(html.indexOf("<textarea"));
  });
});

describe("remaining characters", () => {
  test("remaining is the limit minus what is used minus the new text, trimmed and counted in code points", () => {
    expect(
      remainingOf({ limitChars: 1375, usedChars: 1300, oldChars: 0, text: "  abc \n" }),
    ).toEqual(72);
    expect(remainingOf({ limitChars: 10, usedChars: 0, oldChars: 0, text: "😀😀" })).toEqual(8);
  });

  test("editing gives back the old entry's characters", () => {
    expect(remainingOf({ limitChars: 1375, usedChars: 1300, oldChars: 10, text: "abc" })).toEqual(
      82,
    );
  });

  test("a text over the limit gives a negative remainder", () => {
    expect(
      remainingOf({ limitChars: 100, usedChars: 95, oldChars: 0, text: "0123456789" }),
    ).toEqual(-5);
  });

  test("the line shows the remainder in tertiary text while plenty is left", () => {
    const view = { ...store("user", ["가".repeat(1000)]), limitChars: 1375 };
    const html = renderToString(
      <MemoryEditorBody notice={null} view={view} entryId={null} text="abc" onText={() => {}} />,
    );
    expect(html).toContain(t("desktop.memory.remaining", { n: "372" }));
    expect(classTokensOf(html, "data-memory-remaining")).toContain("text-text-tertiary");
    expect(classTokensOf(html, "data-memory-remaining")).not.toContain("text-warning-text");
  });

  test("under a tenth of the limit the remainder is in warning colour", () => {
    const view = { ...store("user", ["가".repeat(1300)]), limitChars: 1375 };
    const html = renderToString(
      <MemoryEditorBody notice={null} view={view} entryId={null} text="abc" onText={() => {}} />,
    );
    expect(html).toContain(t("desktop.memory.remaining", { n: "72" }));
    expect(classTokensOf(html, "data-memory-remaining")).toContain("text-warning-text");
  });

  test("editing counts the entry's own characters back in", () => {
    const view = { ...store("user", ["0123456789"]), limitChars: 20 };
    const add = renderToString(
      <MemoryEditorBody notice={null} view={view} entryId={null} text="abc" onText={() => {}} />,
    );
    const edit = renderToString(
      <MemoryEditorBody
        notice={null}
        view={view}
        entryId={FIRST_ID}
        text="abc"
        onText={() => {}}
      />,
    );
    expect(add).toContain(t("desktop.memory.remaining", { n: "7" }));
    expect(edit).toContain(t("desktop.memory.remaining", { n: "17" }));
  });

  test("over the limit a warning sentence names the overage and the limit setting, and the line is replaced", () => {
    const view = { ...store("user", ["가".repeat(95)]), limitChars: 100 };
    const html = renderToString(
      <MemoryEditorBody
        notice={null}
        view={view}
        entryId={null}
        text="0123456789"
        onText={() => {}}
      />,
    );
    expect(html).toContain(
      escapedOf(
        t("desktop.memory.overLimit", {
          over: "5",
          tab: t("client.settings.tabs.sessions"),
          limit: t("settings.l2.knowledge.memory.userLimitChars.label"),
        }),
      ),
    );
    expect(html).toContain('data-tone="warning"');
    expect(html).not.toContain("data-memory-remaining");
    expect(html).toContain(t("desktop.memory.limit.info"));
  });

  test("the environment store names the environment limit setting", () => {
    const view = { ...store("env", ["가".repeat(95)]), limitChars: 100 };
    const html = renderToString(
      <MemoryEditorBody
        notice={null}
        view={view}
        entryId={null}
        text="0123456789"
        onText={() => {}}
      />,
    );
    expect(html).toContain(t("settings.l2.knowledge.memory.envLimitChars.label"));
  });

  test("a store over its limit shows the used figure in warning colour", () => {
    const over = htmlOf({
      load: {
        kind: "ready",
        stores: [{ ...store("user", ["x".repeat(30)]), limitChars: 20 }, store("env", [])],
      },
    });
    expect(classTokensOf(over, "data-memory-used")).toContain("text-warning-text");
    const under = htmlOf({});
    expect(classTokensOf(under, "data-memory-used")).not.toContain("text-warning-text");
  });
});

describe("memory card", () => {
  test("the section is one setting card with a title, like the other sections", () => {
    const html = htmlOf({});
    expect(html).toContain('data-slot="settings-memory"');
    expect(html).toContain("rounded-2xl");
    expect(html).toContain(`>${t("desktop.memory.label")}<`);
  });
});
