import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { blockRowsOf } from "@fresnel/client/workbench";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import { renderToString } from "react-dom/server";
import {
  CodeBlocks,
  codeLineOf,
  ForwardStrip,
  forwardStateOf,
} from "../../../src/views/compose/compose-code.tsx";
import { COMPOSE_VIEWS, VIEW_TEXT } from "../../../src/views/compose/compose-text.ts";

// 코드 보기의 서버 렌더. "다음 길" 띠의 모양과 문장, 블록 줄의 글만 본다(읽기와 누르기는 DOM이 없어 시험하지 않는다).

const NOOP = (): void => {};

const COMPOSITION: CompositionDecl = {
  blocks: [
    { id: "detect", stage: "detect", op: "on", title: "신호 감지", hooks: ["tool.call.before"] },
    { id: "drive", stage: "machine", op: "drive" },
  ],
};

/** 글을 품은 단추 하나의 HTML. 여는 태그부터 그 단추의 내용까지 */
function buttonWith(html: string, text: string): string {
  const piece = html.split("<button").find((part) => part.includes(text));
  return piece === undefined ? "" : `<button${piece}`;
}

/** 글을 품은 단추가 잠겼는지. 여는 태그의 `disabled` 특성만 본다(클래스 이름의 글은 세지 않는다) */
function isDisabled(html: string, text: string): boolean {
  const open = buttonWith(html, text).match(/^<button[^>]*>/)?.[0] ?? "";
  return /\sdisabled(?=[\s=>])/.test(open);
}

const BUILDER_ON = { status: "enabled", lock: null } as const;
const BUILDER_OFF = { status: "disabled", lock: null } as const;

describe("forwardStateOf", () => {
  test("엔진에 연결되어 있지 않으면 어느 상태든 문장만이다", () => {
    expect(forwardStateOf("offline", BUILDER_ON)).toEqual({ kind: "offline" });
    expect(forwardStateOf("pending", BUILDER_OFF)).toEqual({ kind: "offline" });
  });

  test("연결되어 있고 플러그인 빌더가 켜져 있으면 만들기다", () => {
    expect(forwardStateOf("live", BUILDER_ON)).toEqual({ kind: "make" });
  });

  test("잠겨 있어도 이미 켜져 있으면 만들기다(만들기는 켜기·끄기를 바꾸지 않는다)", () => {
    expect(forwardStateOf("live", { status: "enabled", lock: "safe_mode" })).toEqual({
      kind: "make",
    });
  });

  test("꺼져 있거나 켜는 중이면 켜기다", () => {
    expect(forwardStateOf("live", BUILDER_OFF)).toEqual({ kind: "enable" });
    expect(forwardStateOf("live", { status: "enabling", lock: null })).toEqual({ kind: "enable" });
  });

  test("목록에 플러그인 빌더가 없으면 켤 수 없다", () => {
    expect(forwardStateOf("live", null)).toEqual({ kind: "missing" });
  });

  test("꺼져 있는데 잠겨 있으면 잠긴 까닭을 든 상태다", () => {
    expect(forwardStateOf("live", { status: "disabled", lock: "safe_mode" })).toEqual({
      kind: "locked",
      lock: "safe_mode",
    });
  });
});

describe("ForwardStrip", () => {
  test("플러그인 빌더가 켜져 있으면 파일 만들기 문장과 만들기 단추를 보인다", () => {
    const html = renderToString(
      <ForwardStrip state={{ kind: "make" }} busy={false} onMake={NOOP} onEnable={NOOP} />,
    );
    expect(html).toContain("아직 파일이 없어요. 대상 폴더에 만들고 검사해요");
    expect(buttonWith(html, "플러그인 빌더로 만들기")).toContain("플러그인 빌더로 만들기");
    expect(html).not.toContain("플러그인 빌더 켜기");
  });

  test("플러그인 빌더가 꺼져 있으면 켜면 된다는 문장과 켜기 단추를 보인다", () => {
    const html = renderToString(
      <ForwardStrip state={{ kind: "enable" }} busy={false} onMake={NOOP} onEnable={NOOP} />,
    );
    expect(html).toContain("켜면 여기서 바로 만들 수 있어요");
    expect(buttonWith(html, "플러그인 빌더 켜기")).toContain("플러그인 빌더 켜기");
    expect(isDisabled(html, "플러그인 빌더 켜기")).toBe(false);
    expect(html).not.toContain("플러그인 빌더로 만들기");
  });

  test("켜는 중이면 켜기 단추가 도는 표식을 단다", () => {
    const html = renderToString(
      <ForwardStrip state={{ kind: "enable" }} busy onMake={NOOP} onEnable={NOOP} />,
    );
    expect(buttonWith(html, "플러그인 빌더 켜기")).toContain('aria-busy="true"');
  });

  test("목록에 플러그인 빌더가 없으면 까닭 문장을 보이고 켜기 단추는 잠긴다", () => {
    const html = renderToString(
      <ForwardStrip state={{ kind: "missing" }} busy={false} onMake={NOOP} onEnable={NOOP} />,
    );
    expect(html).toContain("확장 목록에 플러그인 빌더가 없어서 여기서 켤 수 없어요");
    expect(buttonWith(html, "플러그인 빌더 켜기")).toContain("플러그인 빌더 켜기");
    expect(isDisabled(html, "플러그인 빌더 켜기")).toBe(true);
  });

  test("잠긴 플러그인 빌더는 잠긴 까닭을 문장에 이어 보이고 켜기 단추는 잠긴다", () => {
    const html = renderToString(
      <ForwardStrip
        state={{ kind: "locked", lock: "safe_mode" }}
        busy={false}
        onMake={NOOP}
        onEnable={NOOP}
      />,
    );
    expect(html).toContain("플러그인 빌더는 지금 켤 수 없어요. 안전 모드라 빠졌어요");
    expect(isDisabled(html, "플러그인 빌더 켜기")).toBe(true);
  });

  test("엔진에 연결되지 않았으면 문장만 있고 단추는 없다", () => {
    const html = renderToString(
      <ForwardStrip state={{ kind: "offline" }} busy={false} onMake={NOOP} onEnable={NOOP} />,
    );
    expect(html).toContain("연결되면 여기서 만들 수 있어요");
    expect(html).not.toContain("<button");
  });
});

describe("CodeBlocks", () => {
  test("블록 줄은 id, 연산, 단계, 훅 이름으로 적는다", () => {
    expect(blockRowsOf(COMPOSITION).map(codeLineOf)).toEqual([
      "detect · on · detect [tool.call.before]",
      "drive · drive · machine",
    ]);
  });

  test("블록마다 줄을 그리고 제목이 있으면 함께 보인다", () => {
    const html = renderToString(<CodeBlocks composition={COMPOSITION} />);
    expect(html).toContain('aria-label="블록"');
    expect(html).toContain("detect · on · detect [tool.call.before]");
    expect(html).toContain("drive · drive · machine");
    expect(html).toContain("신호 감지");
  });
});

describe("컴포즈 보기 묶음", () => {
  test("보기는 그룹, 흐름, 프로필, 코드 순서이고 코드의 글은 코드다", () => {
    expect(COMPOSE_VIEWS).toEqual(["group", "flow", "profile", "code"]);
    expect(t(VIEW_TEXT.code)).toBe("코드");
  });
});
