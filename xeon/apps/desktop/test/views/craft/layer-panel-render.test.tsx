import { describe, expect, test } from "bun:test";
import { FIXTURE_ORDER, buildFixture, type HookOrderPort } from "@fresnel/client/workbench/canvas";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { LayerPanel } from "../../../src/views/craft/layer-panel.tsx";
import { layerPlugins } from "../../../src/views/craft/orbit-model.ts";
import { describedTextOf, inStore } from "./render-support.tsx";

const unused = (): Promise<never> =>
  Promise.reject(new Error("the render test never calls the port"));

const port: HookOrderPort = {
  get: unused,
  set: unused,
  reset: unused,
  preview: unused,
};

function fakeSource(): CraftSource {
  return {
    snapshot: buildFixture(77),
    order: FIXTURE_ORDER,
    setOn: () => Promise.resolve(),
    orderPort: port,
    openBuilder: () => undefined,
    recentRuns: () => Promise.resolve(null),
    scope: { kind: "global" },
  };
}

function render(): string {
  return renderToString(
    inStore(
      <CraftProvider source={fakeSource()}>
        <LayerPanel layer="L2" />
      </CraftProvider>,
    ),
  );
}

/** 카드의 이름과 번호(`이름, n/전체`)를 나타난 순서대로 뽑는다 */
function cardLabels(html: string): { readonly name: string; readonly n: number }[] {
  return [...html.matchAll(/aria-label="([^"]*), (\d+)\/(\d+)"/g)].map((m) => ({
    name: m[1] ?? "",
    n: Number(m[2]),
  }));
}

describe("LayerPanel is read only", () => {
  test("cards render in load order, numbered 1..n, with the layer's own plugins", () => {
    const expected = layerPlugins(fakeSource().snapshot, "L2", []).map((p) => p.name);
    const labels = cardLabels(render());
    expect(labels.map((l) => l.name)).toEqual(expected);
    expect(labels.map((l) => l.n)).toEqual(expected.map((_, i) => i + 1));
    // 스냅샷에서 앞에 선언된 L2 플러그인 다섯 개가 그 순서로 온다
    expect(expected.slice(0, 5)).toEqual([
      "Explore feature",
      "Memory ledger",
      "Web",
      "Knowledge",
      "Work",
    ]);
  });

  test("there is no drag handle, no grab cursor, and no reorder key", () => {
    const html = render();
    expect(html).not.toContain("cursor-grab");
    expect(html).not.toContain("touch-none");
    // 끌기 손잡이(GripVertical)는 카드 왼쪽 가운데에 붙어 있었다
    expect(html).not.toContain("left-0.5 top-1/2 size-3.5");
    expect(html).not.toContain("data-no-drag");
    expect(html).not.toContain("Alt+");
  });

  test("the header keeps the load order line behind its info icon, out of view", () => {
    const html = render();
    expect(html).toContain(`aria-label="${t("desktop.craft.infoTip.label")}"`);
    expect(describedTextOf(html)).toBe(t("desktop.craft.orbit.layer.hint"));
    expect(html).not.toContain('data-slot="popover"');
  });
});
