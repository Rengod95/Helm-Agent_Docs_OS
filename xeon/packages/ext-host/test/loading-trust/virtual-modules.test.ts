import { expect, test } from "bun:test";
import {
  compareVersions,
  registerSdkModules,
  SDK_MODULE_SPECIFIERS,
} from "../../src/loading-trust/index.ts";
import { fakeGroupKit, SDK } from "./support/plugin-fixture.ts";

test("the SDK specifiers are the three modules the spec names", () => {
  expect([...SDK_MODULE_SPECIFIERS]).toEqual(["@xeon/contracts", "@xeon/group-kit", "typebox"]);
  expect(Object.keys(SDK).toSorted()).toEqual([...SDK_MODULE_SPECIFIERS].toSorted());
});

test("registering the same objects again does nothing, another object is refused", () => {
  expect(registerSdkModules(SDK)).toEqual({ ok: true, value: undefined });
  expect(registerSdkModules(SDK)).toEqual({ ok: true, value: undefined });
  const other = registerSdkModules({ "@xeon/group-kit": { marker: Symbol("other") } });
  expect(other).toEqual({ ok: false, error: { kind: "conflict", specifier: "@xeon/group-kit" } });
  // 충돌은 아무것도 바꾸지 않는다: 처음 객체는 그대로 등록된 상태다
  expect(registerSdkModules({ "@xeon/group-kit": fakeGroupKit })).toEqual({
    ok: true,
    value: undefined,
  });
});

test("an empty registration is a no-op", () => {
  expect(registerSdkModules({})).toEqual({ ok: true, value: undefined });
});

test("compareVersions orders core versions and puts pre-releases below releases", () => {
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBeLessThan(0);
  expect(compareVersions("2.0.0", "2.0.0-beta.1")).toBeGreaterThan(0);
  expect(compareVersions("x", "1.0.0")).toBeUndefined();
});
