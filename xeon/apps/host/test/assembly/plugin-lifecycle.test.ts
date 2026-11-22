import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { DependencyDecl } from "@fresnel/contracts/extensions";
import type { ExtensionLoader, LoadedExtensionInfo } from "@fresnel/ext-host";
import { pluginLifecycleOf } from "../../src/assembly/m4/plugin-lifecycle.ts";
import { partial } from "../fixtures/unsafe.ts";

// M5c §4.1.11: 승인은 적재가 아니다. 처음 대화의 집합에 들 때(0→1) 기록이 없는 이름은 검토본에서 싣고, 기록이 있으면 `ensureLoaded`가 싣는다.

const KIT = partial<LoadedExtensionInfo>({ name: "kit", state: "active" });

function lifecycleOf(loader: ExtensionLoader) {
  return pluginLifecycleOf({
    loader: () => loader,
    busy: () => false,
    signal: new AbortController().signal,
  });
}

test("a name the loader has no record of is loaded from its reviewed copy the first time a conversation uses it", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [],
      loadInstalled: (name) => {
        calls.push(`install:${name}`);
        return Promise.resolve(ok({ appliesAt: "now", info: KIT }));
      },
      ensureLoaded: () => Promise.reject(new Error("no record to ensure")),
    }),
  );
  expect(await lifecycle.ensureLoaded("kit")).toEqual(KIT);
  expect(calls).toEqual(["install:kit"]);
});

test("a name with a disabled record is loaded through ensureLoaded and never installed again", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [partial<LoadedExtensionInfo>({ name: "kit", state: "disabled" })],
      ensureLoaded: (name) => {
        calls.push(`ensure:${name}`);
        return Promise.resolve(KIT);
      },
      loadInstalled: () => Promise.reject(new Error("must not install twice")),
    }),
  );
  expect(await lifecycle.ensureLoaded("kit")).toEqual(KIT);
  expect(calls).toEqual(["ensure:kit"]);
});

test("a name without a reviewed copy is skipped", async () => {
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [],
      loadInstalled: () => Promise.resolve(err({ kind: "not_found", diagnostics: [] })),
    }),
  );
  expect(await lifecycle.ensureLoaded("core-unit")).toBeUndefined();
});

// AGE-33: 기대는 확장은 싣기 전에 그 hard 대상을 먼저 싣는다.

/** 로더 기록 한 개. `dependsOn`을 가진 매니페스트를 붙인다 */
function recordOf(name: string, dependsOn: readonly DependencyDecl[] = []): LoadedExtensionInfo {
  return partial<LoadedExtensionInfo>({
    name,
    state: "disabled",
    manifest: {
      schemaVersion: 2,
      name,
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [], dependsOn: [...dependsOn] }],
    },
  });
}

test("a hard target is ensured before the extension that depends on it", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [recordOf("aa-app", [{ plugin: "zz-lib", kind: "hard" }]), recordOf("zz-lib")],
      ensureLoaded: (name) => {
        calls.push(`ensure:${name}`);
        return Promise.resolve(partial<LoadedExtensionInfo>({ name, state: "active" }));
      },
    }),
  );
  await lifecycle.ensureLoaded("aa-app");
  expect(calls).toEqual(["ensure:zz-lib", "ensure:aa-app"]);
});

test("a soft target is not ensured first", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [recordOf("aa-app", [{ plugin: "zz-lib", kind: "soft" }]), recordOf("zz-lib")],
      ensureLoaded: (name) => {
        calls.push(`ensure:${name}`);
        return Promise.resolve(partial<LoadedExtensionInfo>({ name, state: "active" }));
      },
    }),
  );
  await lifecycle.ensureLoaded("aa-app");
  expect(calls).toEqual(["ensure:aa-app"]);
});

test("hard targets are followed through the chain, and a cycle is visited once", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [
        recordOf("aa-app", [{ plugin: "bb-mid", kind: "hard" }]),
        recordOf("bb-mid", [
          { plugin: "cc-base", kind: "hard" },
          { plugin: "aa-app", kind: "hard" },
        ]),
        recordOf("cc-base"),
      ],
      ensureLoaded: (name) => {
        calls.push(`ensure:${name}`);
        return Promise.resolve(partial<LoadedExtensionInfo>({ name, state: "active" }));
      },
    }),
  );
  await lifecycle.ensureLoaded("aa-app");
  expect(calls).toEqual(["ensure:cc-base", "ensure:bb-mid", "ensure:aa-app"]);
});

test("a target that fails to load does not throw, and the dependent is still asked to load", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [recordOf("aa-app", [{ plugin: "zz-lib", kind: "hard" }]), recordOf("zz-lib")],
      ensureLoaded: (name) => {
        calls.push(`ensure:${name}`);
        if (name === "zz-lib") return Promise.reject(new Error("target failed"));
        return Promise.resolve(partial<LoadedExtensionInfo>({ name, state: "error" }));
      },
    }),
  );
  expect(await lifecycle.ensureLoaded("aa-app")).toEqual(
    partial<LoadedExtensionInfo>({ name: "aa-app", state: "error" }),
  );
  expect(calls).toEqual(["ensure:zz-lib", "ensure:aa-app"]);
});

test("a hard target without a record is not loaded first", async () => {
  const calls: string[] = [];
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [recordOf("aa-app", [{ plugin: "zz-lib", kind: "hard" }])],
      ensureLoaded: (name) => {
        calls.push(`ensure:${name}`);
        return Promise.resolve(partial<LoadedExtensionInfo>({ name, state: "error" }));
      },
    }),
  );
  await lifecycle.ensureLoaded("aa-app");
  expect(calls).toEqual(["ensure:aa-app"]);
});

test("a target that is already loading is awaited and loaded only once", async () => {
  const calls: string[] = [];
  const gate = Promise.withResolvers<void>();
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [recordOf("aa-app", [{ plugin: "zz-lib", kind: "hard" }]), recordOf("zz-lib")],
      ensureLoaded: async (name) => {
        calls.push(`ensure:${name}`);
        if (name === "zz-lib") await gate.promise;
        calls.push(`done:${name}`);
        return partial<LoadedExtensionInfo>({ name, state: "active" });
      },
    }),
  );
  // 대상이 먼저 진행 중이다. 기대는 쪽의 적재는 그 대상을 기다리고 두 번 부르지 않는다
  const target = lifecycle.ensureLoaded("zz-lib");
  const dependent = lifecycle.ensureLoaded("aa-app");
  gate.resolve();
  await Promise.all([target, dependent]);
  expect(calls).toEqual(["ensure:zz-lib", "done:zz-lib", "ensure:aa-app", "done:aa-app"]);
});

// AGE-33 enDep 5b: 덧씌우기의 적재도 같은 길을 쓴다. 호출마다 주는 신호가 대상과 기대는 쪽에 그대로 가고, 같은 로더의 두 수명(대화와 덧씌우기)은 진행 중인 적재를 함께 쓴다.

test("the signal given to ensureLoaded reaches the target and the dependent", async () => {
  const seen: string[] = [];
  const mine = new AbortController().signal;
  const lifecycle = lifecycleOf(
    partial<ExtensionLoader>({
      list: () => [recordOf("aa-app", [{ plugin: "zz-lib", kind: "hard" }]), recordOf("zz-lib")],
      ensureLoaded: (name, signal) => {
        seen.push(`ensure:${name}:${signal === mine ? "given" : "engine"}`);
        return Promise.resolve(partial<LoadedExtensionInfo>({ name, state: "active" }));
      },
    }),
  );
  await lifecycle.ensureLoaded("aa-app", mine);
  expect(seen).toEqual(["ensure:zz-lib:given", "ensure:aa-app:given"]);
});

test("two lifecycles over one loader load a shared hard target once while it is in flight", async () => {
  const calls: string[] = [];
  const gate = Promise.withResolvers<void>();
  const loader = partial<ExtensionLoader>({
    list: () => [
      recordOf("aa-app", [{ plugin: "zz-lib", kind: "hard" }]),
      recordOf("bb-app", [{ plugin: "zz-lib", kind: "hard" }]),
      recordOf("zz-lib"),
    ],
    ensureLoaded: async (name) => {
      calls.push(`ensure:${name}`);
      if (name === "zz-lib") await gate.promise;
      return partial<LoadedExtensionInfo>({ name, state: "active" });
    },
  });
  const conversation = lifecycleOf(loader);
  const overlay = lifecycleOf(loader);
  const pending = Promise.all([
    conversation.ensureLoaded("aa-app"),
    overlay.ensureLoaded("bb-app"),
  ]);
  gate.resolve();
  await pending;
  expect(calls.filter((call) => call === "ensure:zz-lib")).toEqual(["ensure:zz-lib"]);
  expect(
    calls.filter((call) => call.startsWith("ensure:") && call !== "ensure:zz-lib").toSorted(),
  ).toEqual(["ensure:aa-app", "ensure:bb-app"]);
});
