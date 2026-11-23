// 앱 뼈대가 만든 코드를 실제로 싣고, 대화 없이 연 목록의 읽기와 더하기가 값으로 주고받는지 본다. 대화가 없다는 이유로 no_thread가 나오지 않는다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import type { PluginStorePort } from "@fresnel/contracts/extensions";
import { createTestHost, memoryPluginStore } from "@fresnel/ext-host/testing";
import { appSkeletonFiles, type AppSkeletonValues } from "../src/app-skeleton.ts";
import { callMethod, cleanupStaged, installStaged, stageRoot } from "./support/staged-extension.ts";

const VALUES: AppSkeletonValues = { id: "kanban", title: "칸반", version: "0.1.0" };
const NAME = "kanban";

afterAll(cleanupStaged);

const pad = (n: number): string => String(n).padStart(2, "0");

/** 이 기기 시간대의 오늘 `YYYY-MM-DD`. 뼈대와 같은 식으로 값을 적어 둔다(UTC로 바꾸지 않는다) */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 뼈대 파일을 시험 공간에 쓰고 저장소를 붙인 호스트에 싣는다 */
async function skeletonHost(store: PluginStorePort) {
  const t = await createTestHost({ pluginStore: store });
  const root = stageRoot();
  for (const file of appSkeletonFiles(VALUES)) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.text);
  }
  await installStaged(t, root);
  return t;
}

test("with no conversation, the skeleton's list and add work through the plugin store, and each item keeps the local day it was made", async () => {
  const store = memoryPluginStore();
  const t = await skeletonHost(store);
  const day = localDay();
  expect(await callMethod(t, NAME, "list", {}, null)).toEqual({ ok: true, items: [] });
  expect(await callMethod(t, NAME, "add", { title: "첫 항목" }, null)).toEqual({
    ok: true,
    items: [{ title: "첫 항목", created: day }],
  });
  expect(await callMethod(t, NAME, "add", { title: "둘째" }, null)).toEqual({
    ok: true,
    items: [
      { title: "첫 항목", created: day },
      { title: "둘째", created: day },
    ],
  });
  expect(await callMethod(t, NAME, "list", {}, null)).toEqual({
    ok: true,
    items: [
      { title: "첫 항목", created: day },
      { title: "둘째", created: day },
    ],
  });
  const stored = await store.get(NAME, "items");
  if (!stored.ok || stored.value === null) throw new Error("no items in the plugin store");
  expect(parseJson(stored.value)).toEqual({
    ok: true,
    value: {
      items: [
        { title: "첫 항목", created: day },
        { title: "둘째", created: day },
      ],
    },
  });
});

test("adds at the same time with no conversation are all kept", async () => {
  const t = await skeletonHost(memoryPluginStore());
  await Promise.all(["가", "나", "다"].map((title) => callMethod(t, NAME, "add", { title }, null)));
  expect(await callMethod(t, NAME, "list", {}, null)).toEqual({
    ok: true,
    items: expect.arrayContaining([
      expect.objectContaining({ title: "가" }),
      expect.objectContaining({ title: "나" }),
      expect.objectContaining({ title: "다" }),
    ]),
  });
});

test("with an open conversation, the skeleton keeps its items in the plugin store, the same list as with no conversation", async () => {
  const store = memoryPluginStore();
  const t = await skeletonHost(store);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(await callMethod(t, NAME, "list", {}, thread)).toEqual({ ok: true, items: [] });
  expect(await callMethod(t, NAME, "add", { title: "대화 항목" }, thread)).toEqual({
    ok: true,
    items: [{ title: "대화 항목", created: localDay() }],
  });
  // 대화 없이 읽어도 같은 항목이 보이고, 다른 대화에서 읽어도 같다
  const same = { ok: true, items: [{ title: "대화 항목", created: localDay() }] };
  expect(await callMethod(t, NAME, "list", {}, null)).toEqual(same);
  expect(await callMethod(t, NAME, "list", {}, t.newThread())).toEqual(same);
  expect((await store.get(NAME, "items")).ok).toBe(true);
});

test("a failing plugin store comes back as a reason from list and add", async () => {
  const t = await skeletonHost(memoryPluginStore({ fail: true }));
  expect(await callMethod(t, NAME, "list", {}, null)).toEqual({
    ok: false,
    reason: "storage_unavailable",
  });
  expect(await callMethod(t, NAME, "add", { title: "항목" }, null)).toEqual({
    ok: false,
    reason: "storage_unavailable",
  });
});
