import { expect, test } from "bun:test";
import type * as RealContractsModule from "@fresnel/contracts";
import {
  compareVersions,
  registerSdkModules,
  SDK_MODULE_SPECIFIERS,
} from "../../src/loading-trust/index.ts";
import { X_SDK_MODULES } from "../../src/loading-trust/virtual-modules.ts";
import { fakeGroupSdk, SDK } from "./support/plugin-fixture.ts";

test("the SDK specifiers are contracts with its subpaths, group-sdk and typebox", () => {
  expect([...SDK_MODULE_SPECIFIERS]).toEqual([
    "@fresnel/contracts",
    "@fresnel/contracts/capabilities",
    "@fresnel/contracts/conversation",
    "@fresnel/contracts/extensions",
    "@fresnel/contracts/records",
    "@fresnel/contracts/services",
    "@fresnel/contracts/settings",
    "@fresnel/contracts/wire",
    "@fresnel/group-sdk",
    "typebox",
  ]);
  // X가 직접 등록하는 모듈과 조립 루트가 넘기는 group-sdk이 지정자 전체가 된다
  expect([...Object.keys(X_SDK_MODULES), "@fresnel/group-sdk"].toSorted()).toEqual(
    [...SDK_MODULE_SPECIFIERS].toSorted(),
  );
  expect(Object.keys(SDK).toSorted()).toEqual([
    "@fresnel/contracts",
    "@fresnel/group-sdk",
    "typebox",
  ]);
});

test("registering the same objects again does nothing, another object is refused", () => {
  expect(registerSdkModules(SDK)).toEqual({ ok: true, value: undefined });
  expect(registerSdkModules(SDK)).toEqual({ ok: true, value: undefined });
  const other = registerSdkModules({ "@fresnel/group-sdk": { marker: Symbol("other") } });
  expect(other).toEqual({
    ok: false,
    error: { kind: "conflict", specifier: "@fresnel/group-sdk" },
  });
  // 충돌은 아무것도 바꾸지 않는다: 처음 객체는 그대로 등록된 상태다
  expect(registerSdkModules({ "@fresnel/group-sdk": fakeGroupSdk })).toEqual({
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

// 지정자가 아니라 파일 경로로 불러온다. 같은 프로세스에서 다른 시험 파일이 먼저 SDK를 등록했으면(파일 순서는 기기마다 다르다.
// macOS는 이름순, Linux는 디렉터리 순) 지정자 `@fresnel/contracts`는 이 파일에서 가상 모듈 껍데기를 돌려주기 때문이다
const realContracts: typeof RealContractsModule = await import(
  Bun.resolveSync("@fresnel/contracts", import.meta.dir)
);

test("registering the fixture leaves the real @fresnel/contracts module identity untouched", async () => {
  // 시험 설비가 등록하는 `@fresnel/contracts`는 이 프로세스의 실제 모듈 네임스페이스 자체다
  expect(SDK["@fresnel/contracts"]).toBe(realContracts);
  expect(registerSdkModules(SDK)).toEqual({ ok: true, value: undefined });
  const again: { readonly ok: unknown } = await import("@fresnel/contracts");
  expect(again.ok).toBe(realContracts.ok);
});
