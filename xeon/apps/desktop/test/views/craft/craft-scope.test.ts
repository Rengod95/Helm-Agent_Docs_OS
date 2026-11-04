import { describe, expect, test } from "bun:test";
import { GLOBAL_SCOPE } from "../../../src/state/workbench/index.ts";
import { scopeArg } from "../../../src/views/craft/craft-scope.ts";

describe("scopeArg: 전역 범위는 범위를 붙이기 전과 같은 인자다", () => {
  test("전역 범위 값은 {kind: 'global'}이다", () => {
    expect(GLOBAL_SCOPE).toStrictEqual({ kind: "global" });
  });

  test("목록은 대화 없이 읽고(undefined), 켜기·끄기는 사용자 범위다", () => {
    expect(scopeArg(GLOBAL_SCOPE)).toStrictEqual({
      listThreadId: undefined,
      settingsScope: "user",
    });
  });
});
