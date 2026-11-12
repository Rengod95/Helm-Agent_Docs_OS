import { describe, expect, test } from "bun:test";
import { argsTailOf, partialTargetOf } from "../../src/views/convo/message-rows.tsx";

// 쓰는 중인 도구 호출 줄의 부분 인자(dzM2 시안 §3)

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
