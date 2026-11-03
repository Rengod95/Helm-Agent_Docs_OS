import { describe, expect, test } from "bun:test";
import {
  FIXTURE_ORDER,
  buildFixture,
  type CanvasSnapshot,
  type HookOrderPort,
} from "@fresnel/client/workbench/canvas";
import { renderToString } from "react-dom/server";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { LinkView } from "../../../src/views/craft/link.tsx";
import { inStore } from "./render-support.tsx";

const unused = (): Promise<never> =>
  Promise.reject(new Error("the render test never calls the port"));

const port: HookOrderPort = {
  get: unused,
  set: unused,
  reset: unused,
  preview: unused,
};

function sourceOf(snapshot: CanvasSnapshot): CraftSource {
  return {
    snapshot,
    order: FIXTURE_ORDER,
    setOn: () => Promise.resolve(),
    orderPort: port,
    openBuilder: () => undefined,
    recentRuns: () => Promise.resolve(null),
  };
}

function render(snapshot: CanvasSnapshot): string {
  return renderToString(
    inStore(
      <CraftProvider source={sourceOf(snapshot)}>
        <LinkView />
      </CraftProvider>,
    ),
  );
}

describe("LinkView render", () => {
  test("with no selection the drive holder (Helm) is the focus card, with related plugins listed", () => {
    const html = render(buildFixture(77));
    // 고른 것이 없으면 주도 보유자(Helm)가 초점이다
    expect(html).toContain("Helm 연결");
    expect(html).toContain('aria-label="연결된 플러그인"');
    // 관계 하나마다 종류 점이 하나 이상 나온다
    expect(html.split('class="craft-link-dot"').length - 1).toBeGreaterThan(0);
    expect(html).toContain("craft-link-strand");
  });

  test("an empty snapshot shows the empty message and no card", () => {
    const html = render({ plugins: [], groups: [] });
    expect(html).toContain("보여 줄 플러그인이 없어요");
    expect(html).not.toContain("craft-link-root");
  });
});
