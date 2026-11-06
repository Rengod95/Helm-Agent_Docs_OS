import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { MemoryStoreView } from "@fresnel/contracts/capabilities";
import { renderToString } from "react-dom/server";
import {
  MemoryPanelView,
  type MemoryPanelViewProps,
} from "../../src/views/pages/settings/settings-memory-view.tsx";

// 설정 기억 구역(W-19, scE S7). 항목 행, 빈 상태 문장, 쓰기 막힘 경고, 오류 줄을 HTML로 본다.

const HASH = "a".repeat(64);

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

  test("a notice shows above the list", () => {
    expect(htmlOf({ notice: "desktop.memory.stale" })).toContain(t("desktop.memory.stale"));
  });
});
