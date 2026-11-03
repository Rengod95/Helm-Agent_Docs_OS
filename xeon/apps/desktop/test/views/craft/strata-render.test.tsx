import { describe, expect, test } from "bun:test";
import {
  FIXTURE_ORDER,
  HOOKS,
  OTHER_HOOKS,
  buildFixture,
  type HookOrderPort,
} from "@fresnel/client/workbench/canvas";
import { renderToString } from "react-dom/server";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { Strata } from "../../../src/views/craft/strata.tsx";

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
  };
}

function render(): string {
  return renderToString(
    <CraftProvider source={fakeSource()}>
      <Strata />
    </CraftProvider>,
  );
}

/** 마크업에서 훅 줄의 id를 나타난 순서대로 뽑는다 */
function hookRowIds(html: string): string[] {
  return [...html.matchAll(/data-hook="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("Strata render", () => {
  test("renders the 13 visible hook rows in HOOKS order, then the 33 others", () => {
    const html = render();
    const ids = hookRowIds(html);
    const detailsAt = html.indexOf("<details");
    expect(detailsAt).toBeGreaterThan(0);
    const visible = hookRowIds(html.slice(0, detailsAt));
    const others = hookRowIds(html.slice(detailsAt));
    expect(visible).toEqual(HOOKS.map((h) => h.id));
    expect(others).toEqual(OTHER_HOOKS.map((o) => o.id));
    expect(ids.length).toBe(46);
    expect(visible.length).toBe(13);
    expect(others.length).toBe(33);
  });

  test("handler pills of a lane follow the applied order (tool.call.before: secret-scan before helm)", () => {
    const html = render();
    const start = html.indexOf('data-hook="tool.call.before"');
    const end = html.indexOf('data-hook="tool.result"', start);
    expect(start).toBeGreaterThan(0);
    const row = html.slice(start, end);
    const first = row.indexOf('data-chip="secret-scan"');
    const second = row.indexOf('data-chip="helm"');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  test("a builtin compaction row and the three core steps sit in the flow", () => {
    const html = render();
    expect(html).toContain('data-core="core.context.assemble"');
    expect(html).toContain('data-core="core.model.call"');
    expect(html).toContain('data-core="core.tools.run"');
    // 대화 압축 줄에는 내장 압축 칩이 있다
    const compact = html.indexOf('data-hook="thread.compact.before"');
    const next = html.indexOf('data-hook="request.provider.before"', compact);
    expect(html.slice(compact, next)).toContain("내장 압축");
  });
});
