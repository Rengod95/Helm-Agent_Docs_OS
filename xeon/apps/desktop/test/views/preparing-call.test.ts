import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { itm } from "../state/helpers.ts";
import {
  PreparingCall,
  argsTailOf,
  partialTargetOf,
  preparingTailOf,
} from "../../src/views/convo/message-rows.tsx";

// 쓰는 중인 도구 호출 줄의 부분 인자(dzM2 시안 §3)와 꼬리 보임(DP-118, DP-125)

describe("반쯤 온 인자", () => {
  test("대상 칸은 아는 키의 값을 닫는 따옴표 전까지 읽는다", () => {
    expect(partialTargetOf('{"path":"src/mai')).toBe("src/mai");
    expect(partialTargetOf('{"command":"echo \\"hi\\"\\nls"}')).toBe('echo "hi" ls');
    expect(partialTargetOf('{"pat')).toBe("");
  });

  test("꼬리는 끝 줄 몇 개다", () => {
    expect(argsTailOf("a\nb\nc\nd\n", 3)).toBe("b\nc\nd");
    expect(argsTailOf("", 3)).toBe("");
  });
});

describe("꼬리 보임(모델)", () => {
  test("인자가 비었으면 꼬리를 보이지 않는다(null)", () => {
    expect(preparingTailOf("")).toBeNull();
    expect(preparingTailOf("  \n")).toBeNull();
  });

  test("인자가 있으면 끝 세 줄을 보인다", () => {
    expect(preparingTailOf('{"path":"a"}')).toBe('{"path":"a"}');
    expect(preparingTailOf("1\n2\n3\n4\n")).toBe("2\n3\n4");
  });
});

describe("꼬리 보임(부품)", () => {
  test("인자가 있으면 꼬리 칸을 그리고, 없으면 그리지 않는다", () => {
    const withArgs = renderToString(
      createElement(PreparingCall, { id: itm(1), name: "read", args: "src/a.ts\nbun" }),
    );
    const noArgs = renderToString(
      createElement(PreparingCall, { id: itm(1), name: "read", args: "" }),
    );
    expect(withArgs).toContain('<div class="convo-tail">src/a.ts\nbun</div>');
    expect(noArgs).not.toContain("convo-tail");
  });
});
