import { expect, test } from "bun:test";
import { defineSettings, type ScopeStack, type SettingCatalog } from "@fresnel/contracts/settings";
import { Type } from "typebox";
import { launchStatusOf } from "../../src/assembly/m4/ext-read-sources.ts";

// 다시 시작한 뒤 연 대화: 확장 호스트에 대화 상태가 없어도 대화 범위(launch)에 저장된 켜짐 값이 이 대화의 상태다.

const group = defineSettings("ext.viewdemo", {
  enabled: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "launch"],
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

test("a launch-scope off is this thread's disabled status even though the user scope is on", () => {
  expect(launchStatusOf(catalog, stack(false, true), "viewdemo")).toBe("disabled");
});

test("a launch-scope on is enabled", () => {
  expect(launchStatusOf(catalog, stack(true, false), "viewdemo")).toBe("enabled");
});

test("without a launch value the thread follows the global state", () => {
  expect(launchStatusOf(catalog, stack(undefined, false), "viewdemo")).toBeUndefined();
  expect(launchStatusOf(catalog, stack(undefined, undefined), "viewdemo")).toBeUndefined();
});

test("an extension with no enabled definition has no launch status", () => {
  expect(launchStatusOf(catalog, stack(false, true), "other")).toBeUndefined();
});
