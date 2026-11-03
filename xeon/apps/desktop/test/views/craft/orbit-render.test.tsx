import { describe, expect, test } from "bun:test";
import { FIXTURE_ORDER, buildFixture, type HookOrderPort } from "@fresnel/client/workbench/canvas";
import { renderToString } from "react-dom/server";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { Orbit } from "../../../src/views/craft/orbit.tsx";

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

/**
 * 서버 그리기 동안만 window를 흉내 낸다. 배경 셰이더의 프레임 고리는 첫 그리기 때 움직임 설정을 읽는다.
 * 실제 창에서는 있는 값이고, 시험 뒤에는 지워서 다른 시험 파일에 남지 않게 한다.
 */
const STUB_WINDOW = {
  devicePixelRatio: 1,
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
};

function render(): string {
  Object.defineProperty(globalThis, "window", {
    value: STUB_WINDOW,
    configurable: true,
    writable: true,
  });
  try {
    return renderToString(
      <CraftProvider source={fakeSource()}>
        <Orbit />
      </CraftProvider>,
    );
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
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
