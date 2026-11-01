import { expect, test } from "bun:test";
import type { ExtensionManifest } from "@fresnel/contracts/extensions";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeManifest } from "./fixtures/support.ts";

/** 엔트리 예외가 PrimitiveError면 코드와 Registration id를, 아니면 undefined를 돌려준다 */
function detailOf(error: unknown): { code: string; scopeId: string | undefined } | undefined {
  return error instanceof PrimitiveError ? { code: error.code, scopeId: error.scopeId } : undefined;
}

test("a multi-plugin extension lists one Registration per plugin, root first, on the default statuses", async () => {
  const t = await createTestHost();
  const outcome = await t.host.install({
    manifest: makeManifest({
      name: "rp-multi",
      extraPlugins: [{ id: "extra", layer: "plugin", hooks: [] }],
    }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-multi", {}, () => {});
      register("rp-multi/extra", {}, () => {});
    },
  });
  expect(outcome.registrations).toEqual(["rp-multi", "rp-multi/extra"]);
  expect(outcome.unregistered).toEqual([]);
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["rp-multi", "applied"],
    ["rp-multi/extra", "skipped"],
  ]);
  expect(t.host.registrations().map((info) => [info.id, info.extension, info.status])).toEqual([
    ["rp-multi", "rp-multi", "enabled"],
    ["rp-multi/extra", "rp-multi", "disabled"],
  ]);
});

test("a plugin with defaultEnabled starts enabled next to the root", async () => {
  const t = await createTestHost();
  const outcome = await t.host.install({
    manifest: makeManifest({
      name: "rp-on",
      extraPlugins: [{ id: "extra", layer: "plugin", hooks: [], defaultEnabled: true }],
    }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-on", {}, () => {});
      register("rp-on/extra", {}, () => {});
    },
  });
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["rp-on", "applied"],
    ["rp-on/extra", "applied"],
  ]);
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["rp-on", "enabled"],
    ["rp-on/extra", "enabled"],
  ]);
});

test("register of an id the manifest does not declare fails the entry with registration_unknown_plugin", async () => {
  const t = await createTestHost();
  const outcome = await t.host.install({
    manifest: makeManifest({ name: "rp-solo" }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-solo/ghost", {}, () => {});
    },
  });
  expect(detailOf(outcome.entryError)).toEqual({
    code: "registration_unknown_plugin",
    scopeId: "rp-solo/ghost",
  });
  expect(outcome.registrations).toEqual([]);
  expect(outcome.setups).toEqual([]);
  expect(t.host.registrations()).toEqual([]);
});

test("register of another extension's id fails the entry with registration_foreign_id", async () => {
  const t = await createTestHost();
  const outcome = await t.host.install({
    manifest: makeManifest({ name: "rp-foreign" }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("other-ext", {}, () => {});
    },
  });
  expect(detailOf(outcome.entryError)).toEqual({
    code: "registration_foreign_id",
    scopeId: "other-ext",
  });
  expect(outcome.registrations).toEqual([]);
  expect(t.host.registrations()).toEqual([]);
});

test("a declared plugin the entry never registers is reported as unregistered, and the install succeeds", async () => {
  const t = await createTestHost();
  const outcome = await t.host.install({
    manifest: makeManifest({
      name: "rp-part",
      extraPlugins: [{ id: "extra", layer: "plugin", hooks: [] }],
    }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-part", {}, () => {});
    },
  });
  expect(outcome.entryError).toBeUndefined();
  expect(outcome.registrations).toEqual(["rp-part"]);
  expect(outcome.unregistered).toEqual(["rp-part/extra"]);
  expect(t.host.registrations().map((info) => info.id)).toEqual(["rp-part"]);
});

/** 두 번째 구성원(`extra`, 기본 켜짐)의 setup이 던지는 확장. 첫 구성원(루트)은 정상이다 */
function failingSecondMember(name: string, group: boolean): ExtensionManifest {
  // 플러그인 그룹이면 모든 플러그인이 L3, 아니면 외부 plugin 층이어야 한다(층을 섞을 수 없다)
  const layer = group ? "L3" : "plugin";
  return makeManifest({
    name,
    ...(group ? { group: {} } : {}),
    extraPlugins: [{ id: "extra", layer, hooks: [], defaultEnabled: true }],
  });
}

test("a plugin group whose second member fails to start ends with every member disabled", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const outcome = await t.host.install({
    manifest: failingSecondMember("rp-grp", true),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-grp", {}, () => {});
      register("rp-grp/extra", {}, () => {
        throw new Error("extra broke");
      });
    },
  });
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["rp-grp", "applied"],
    ["rp-grp/extra", "failed"],
  ]);
  await t.settled();
  await t.boundary(thread).stepEnd();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["rp-grp", "disabled"],
    ["rp-grp/extra", "disabled"],
  ]);
});

test("the same two plugins in an extension without group keep the first member enabled", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const outcome = await t.host.install({
    manifest: failingSecondMember("rp-plain", false),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-plain", {}, () => {});
      register("rp-plain/extra", {}, () => {
        throw new Error("extra broke");
      });
    },
  });
  expect(outcome.setups.map((setup) => [setup.scopeId, setup.status])).toEqual([
    ["rp-plain", "applied"],
    ["rp-plain/extra", "failed"],
  ]);
  await t.settled();
  await t.boundary(thread).stepEnd();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["rp-plain", "enabled"],
    ["rp-plain/extra", "disabled"],
  ]);
});

test("a plugin group whose second member fails to start with no thread open is disabled at once", async () => {
  const t = await createTestHost();
  await t.host.install({
    manifest: failingSecondMember("rp-nothread", true),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("rp-nothread", {}, () => {});
      register("rp-nothread/extra", {}, () => {
        throw new Error("extra broke");
      });
    },
  });
  await t.settled();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["rp-nothread", "disabled"],
    ["rp-nothread/extra", "disabled"],
  ]);
});
