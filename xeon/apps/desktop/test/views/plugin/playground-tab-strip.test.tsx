import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { AddonAttention, AddonRow } from "../../../src/views/plugin/addon-model.ts";
import { PlaygroundTab } from "../../../src/views/plugin/playground-tab-strip.tsx";

// 머리 줄 플레이그라운드 탭의 주의 구슬(DP-194a): 주의가 있는 탭만 구슬을 그린다. 탭 줄은 플러그인 문맥을 요구하므로 탭 하나씩 그려 본다.

const noop = (): void => undefined;
const ACTIONS = { open: noop, playground: noop, details: noop, move: noop, unpin: noop };

function rowOf(name: string, attention: AddonAttention | undefined): AddonRow {
  return {
    name,
    title: name,
    monogram: name.slice(0, 1),
    icon: undefined,
    summary: undefined,
    screens: 1,
    features: 0,
    version: "0.1.0",
    trust: "user",
    builtin: false,
    off: false,
    attention,
    errorCount: 0,
  };
}

function tabHtml(row: AddonRow, mode: "label" | "icon"): string {
  return renderToString(
    <PlaygroundTab
      row={row}
      mode={mode}
      current={false}
      index={0}
      count={1}
      dropBefore={false}
      actions={ACTIONS}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
    />,
  );
}

/** 탭마다 구슬을 그렸는지 */
function orbsOf(rows: readonly AddonRow[], mode: "label" | "icon"): boolean[] {
  return rows.map((row) => tabHtml(row, mode).includes('data-slot="attention-orb"'));
}

describe("playground tab attention orb", () => {
  test("only a tab with attention draws the orb, in both tab modes", () => {
    const rows = [rowOf("a", "warning"), rowOf("b", "danger"), rowOf("c", undefined)];
    expect(orbsOf(rows, "label")).toEqual([true, true, false]);
    expect(orbsOf(rows, "icon")).toEqual([true, true, false]);
  });

  test("the orb sits on the icon's top-end corner, is hidden from assistive tech, and the name carries the meaning", () => {
    const html = tabHtml(rowOf("a", "warning"), "label");
    expect(html).toMatch(/data-slot="tab-attention" class="absolute -end-1\.5 -top-2 flex"/);
    expect(html).toContain('aria-hidden="true" data-slot="attention-orb"');
    expect(html).toContain(`aria-label="a, ${t("desktop.playgroundTabs.attention.warning")}"`);
  });
});
