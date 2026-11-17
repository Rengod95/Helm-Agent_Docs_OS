import { expect, test } from "bun:test";
import { defineSettings, type ScopeStack, type SettingCatalog } from "@fresnel/contracts/settings";
import { Type } from "typebox";
import { launchStatusOf } from "../../src/assembly/m4/ext-read-sources.ts";

// 다시 시작한 뒤 연 대화: 확장 호스트에 대화 상태가 없어도 대화 범위(launch)에 저장된 켜짐 값이 이 대화의 상태다.
// 주의: `ext.<이름>.enabled`는 관리 범위만 허용한다(M5c §4.1.10). 그래서 실제 조립에서는 launch 값이 생기지 않고, 이 함수는
// 시험 대역의 값만 본다. 대화 상태를 E(T)로 바꾸면 이 함수와 시험을 함께 지운다 [미결].

const group = defineSettings("ext.viewdemo", {
  enabled: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed"],
    since: "0.1.0",
  },
});
const catalog: SettingCatalog = new Map([[group.defs.enabled.key, group.defs.enabled]]);

function stack(launch: boolean | undefined, user: boolean | undefined): ScopeStack {
  return [
    ...(launch === undefined
      ? []
      : [
          {
            scope: "launch" as const,
            values: new Map<string, unknown>([["ext.viewdemo.enabled", launch]]),
          },
        ]),
    ...(user === undefined
      ? []
      : [
          {
            scope: "user" as const,
            values: new Map<string, unknown>([["ext.viewdemo.enabled", user]]),
          },
        ]),
  ];
}

// 키가 관리 범위만 허용하므로 대화 범위 값은 해석되지 않는다(resolveSetting이 허용 범위 밖 층을 건너뛴다). 그래서 대화 상태가 되지 않는다
test("a launch-scope off is not this thread's status: the enabled key allows only the managed scope", () => {
  expect(launchStatusOf(catalog, stack(false, true), "viewdemo")).toBeUndefined();
});

test("a launch-scope on is not a status either, and the user scope never decides it", () => {
  expect(launchStatusOf(catalog, stack(true, false), "viewdemo")).toBeUndefined();
});

test("without a launch value the thread follows the global state", () => {
  expect(launchStatusOf(catalog, stack(undefined, false), "viewdemo")).toBeUndefined();
  expect(launchStatusOf(catalog, stack(undefined, undefined), "viewdemo")).toBeUndefined();
});

test("an extension with no enabled definition has no launch status", () => {
  expect(launchStatusOf(catalog, stack(false, true), "other")).toBeUndefined();
});
