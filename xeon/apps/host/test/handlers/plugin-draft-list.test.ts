import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError, type DraftInfo, type WireRequestContext } from "@fresnel/contracts/wire";
import { partial } from "../fixtures/unsafe.ts";
import { createPluginHandlers, type PluginPort } from "../../src/handlers/m5/plugins.ts";

// M5c §3.4, §4.9.2: `plugin.draft.list`은 포트가 준 초안 목록을 그대로 옮기고, 이름을 포트에 그대로 넘기며, 실패를 wire 오류로 바꾼다.

/** 처리기가 요청 문맥으로 쓰는 값. 시험은 신호만 채운다(다른 처리기 시험과 같다) */
const CONTEXT = partial<WireRequestContext>({ signal: new AbortController().signal });

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected a wire error, the call succeeded");
}

const NEWER: DraftInfo = {
  draftId: "drf_newer",
  name: "kit",
  contentHash: `sha256:${"b".repeat(64)}`,
  parent: "drf_older",
  createdAt: "2026-11-18T01:00:00.000Z",
  originThreadId: "thr_one",
  label: "두 번째",
  submittedItemId: null,
};

const OLDER: DraftInfo = {
  draftId: "drf_older",
  name: "kit",
  contentHash: `sha256:${"a".repeat(64)}`,
  parent: null,
  createdAt: "2026-11-18T00:00:00.000Z",
  originThreadId: null,
  label: null,
  submittedItemId: "rvw_one",
};

test("the drafts of a plugin answer the port's list unchanged, newest first, and the name reaches the port as given", async () => {
  const asked: string[] = [];
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      draftList: (name) => {
        asked.push(name);
        return Promise.resolve(ok({ drafts: name === "kit" ? [NEWER, OLDER] : [] }));
      },
    }),
  );
  expect(await handlers["plugin.draft.list"]({ name: "kit" }, CONTEXT)).toEqual({
    drafts: [NEWER, OLDER],
  });
  // 초안이 없는 플러그인은 빈 목록이다
  expect(await handlers["plugin.draft.list"]({ name: "other" }, CONTEXT)).toEqual({ drafts: [] });
  expect(asked).toEqual(["kit", "other"]);
});

test("an unknown plugin answers extension.notFound (3401) with its name", async () => {
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      draftList: (name) => Promise.resolve(err({ kind: "unknown_plugin", name })),
    }),
  );
  const error = await wireErrorOf(handlers["plugin.draft.list"]({ name: "ghost" }, CONTEXT));
  expect(error.code).toBe(3401);
  expect(error.data.kind).toBe("extension.notFound");
  expect(error.data.details).toEqual({ name: "ghost" });
});

test("a store that cannot be read answers store.io with the code, cut to 64 characters", async () => {
  const longCode = "E".repeat(80);
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      draftList: () => Promise.resolve(err({ kind: "store", code: longCode })),
    }),
  );
  const error = await wireErrorOf(handlers["plugin.draft.list"]({ name: "kit" }, CONTEXT));
  expect(error.data.kind).toBe("store.io");
  expect(error.data.details).toEqual({ code: "E".repeat(64) });
});
