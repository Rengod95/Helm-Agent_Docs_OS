import { expect, test } from "bun:test";
import * as realContracts from "@xeon/contracts";
import {
  compareVersions,
  registerSdkModules,
  SDK_MODULE_SPECIFIERS,
} from "../../src/loading-trust/index.ts";
import { X_SDK_MODULES } from "../../src/loading-trust/virtual-modules.ts";
import { fakeGroupKit, SDK } from "./support/plugin-fixture.ts";

test("the SDK specifiers are contracts with its subpaths, group-kit and typebox", () => {
  expect([...SDK_MODULE_SPECIFIERS]).toEqual([
    "@xeon/contracts",
    "@xeon/contracts/capabilities",
    "@xeon/contracts/conversation",
    "@xeon/contracts/extensions",
    "@xeon/contracts/records",
    "@xeon/contracts/services",
    "@xeon/contracts/settings",
    "@xeon/contracts/wire",
    "@xeon/group-kit",
    "typebox",
  ]);
  // X가 직접 등록하는 모듈과 조립 루트가 넘기는 group-kit이 지정자 전체가 된다
  expect([...Object.keys(X_SDK_MODULES), "@xeon/group-kit"].toSorted()).toEqual(
    [...SDK_MODULE_SPECIFIERS].toSorted(),
  );
  expect(Object.keys(SDK).toSorted()).toEqual(["@xeon/contracts", "@xeon/group-kit", "typebox"]);
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

test("registering the fixture leaves the real @xeon/contracts module identity untouched", async () => {
  // 시험 설비가 등록하는 `@xeon/contracts`는 이 프로세스의 실제 모듈 네임스페이스 자체다
  expect(SDK["@xeon/contracts"]).toBe(realContracts);
  expect(registerSdkModules(SDK)).toEqual({ ok: true, value: undefined });
  const again: { readonly ok: unknown } = await import("@xeon/contracts");
  expect(again.ok).toBe(realContracts.ok);
});
