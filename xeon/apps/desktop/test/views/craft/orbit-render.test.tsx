import { describe, expect, test } from "bun:test";
import { FIXTURE_ORDER, buildFixture, type HookOrderPort } from "@fresnel/client/workbench/canvas";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { Orbit } from "../../../src/views/craft/orbit.tsx";
import { inStore, renderWithWindowStub } from "./render-support.tsx";

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
  return renderWithWindowStub(
    inStore(
      <CraftProvider source={fakeSource()}>
        <Orbit />
      </CraftProvider>,
    ),
  );
}

/** 점 버튼 하나의 여는 태그(속성 목록)를 모두 뽑는다 */
function dotTags(html: string): string[] {
  return [...html.matchAll(/<button[^>]*data-dot="[^"]*"[^>]*>/g)].map((m) => m[0]);
}

describe("Orbit with 77 plugins", () => {
  const html = render();
  const tags = dotTags(html);

  test("renders one dot button per plugin, 77 in all", () => {
    expect(tags.length).toBe(77);
    expect(new Set(tags.map((t) => t.match(/data-dot="([^"]*)"/)?.[1])).size).toBe(77);
  });

  test("every dot button has an accessible name that says its state", () => {
    for (const tag of tags) expect(tag).toMatch(/aria-label="[^"]+, [^"]+"/);
    // 시안의 헬름은 연속 실패 한 번이 있어 "실패"다. 탐색기 이름표와 같은 말을 쓴다
    expect(html).toContain('aria-label="Helm, 실패"');
    expect(html).toContain('aria-label="Explore feature, 켜짐"');
    expect(html).toContain('aria-label="Exa search, 꺼짐"');
  });

  test("canvas.no-edit-actions: no element can be dragged natively and the map has no edit control", () => {
    expect(html).not.toContain("draggable");
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain('role="slider"');
  });

  test("the four layer names open the layer panel, and each group has a named button", () => {
    expect(html.match(/층 보기"/g)?.length).toBe(4);
    expect(html.match(/data-group=""/g)?.length).toBe(11);
  });

  test("the zoom bar and the finder are on the map", () => {
    expect(html).toContain('aria-label="찾기"');
    expect(html).toContain('aria-label="확대"');
    expect(html).toContain('aria-label="축소"');
    expect(html).toContain('aria-label="전체 보기"');
  });
});
