import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
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
