import { expect, test } from "bun:test";
import { ok, type Result } from "@fresnel/contracts";
import { WireError } from "@fresnel/contracts/wire";
import type { PluginPortFailure } from "../../src/handlers/m5/plugins.ts";
import { createOverlayPort, type OverlayTarget } from "../../src/assembly/plugins/overlay.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS, requestTurn } from "../fixtures/wire-client.ts";

// M5c §3.4 `turn.start.overlay`: 검사는 입력 처리 앞에서 하고, 거절은 와이어 오류로, 통과하면 얹고 `cacheImpact`를 싣는다.

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

const HASH = "sha256:" + "d".repeat(64);

/** 검토된 도구 플러그인 하나와 검토본이 없는 후보 하나를 가진 대상 조회 */
function targetsOf(name: string): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> {
  if (name === "tools" || name === "core-thing") {
    return Promise.resolve(
      ok({
        name,
        reviewedHash: HASH,
        entries: [{ entry: "tools", kind: "plugin" }],
        addsTools: true,
      }),
    );
  }
  if (name === "pending") {
    return Promise.resolve(ok({ name, reviewedHash: null, entries: [], addsTools: false }));
  }
  return Promise.resolve(ok(undefined));
}

test("turn.start의 덧씌우기가 다섯 개면 overlay.limit이고 입력을 접수하지 않는다", async () => {
  const host = createFakeHost({
    overrides: {
      overlay: createOverlayPort({
        targetOf: targetsOf,
        inSet: () => [],
        ensureLoaded: () => Promise.resolve(),
        pluginSet: {
          attachOverlay: () => Promise.resolve(),
          cancelOverlay: () => Promise.resolve(),
        },
        startDrive: () => ok(undefined),
      }),
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(
    requestTurn(connection, {
      threadId,
      input: "hi",
      overlay: [
        { plugin: "plug-a" },
        { plugin: "plug-b" },
        { plugin: "plug-c" },
        { plugin: "plug-d" },
        { plugin: "plug-e" },
      ],
    }),
  );
  expect(error.data.kind).toBe("overlay.limit");
  // 입력은 접수되지 않았다
  expect(host.fake.submitted).toEqual([]);
  await connection.close();
});

test("turn.start의 덧씌우기는 없는 이름과 검토본이 없는 후보를 각각 거절하고 입력을 접수하지 않는다", async () => {
  const host = createFakeHost({
    overrides: {
      overlay: createOverlayPort({
        targetOf: targetsOf,
        inSet: () => [],
        ensureLoaded: () => Promise.resolve(),
        pluginSet: {
          attachOverlay: () => Promise.resolve(),
          cancelOverlay: () => Promise.resolve(),
        },
        startDrive: () => ok(undefined),
      }),
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const missing = await wireErrorOf(
    requestTurn(connection, { threadId, input: "hi", overlay: [{ plugin: "nobody" }] }),
  );
  expect(missing.data.kind).toBe("overlay.notFound");
  const notReviewed = await wireErrorOf(
    requestTurn(connection, { threadId, input: "hi", overlay: [{ plugin: "pending" }] }),
  );
  expect(notReviewed.data.kind).toBe("overlay.notReviewed");
  expect(host.fake.submitted).toEqual([]);
  await connection.close();
});

test("turn.start가 검토된 도구 플러그인을 얹으면 턴을 시작하고 cacheImpact로 도구 덧붙이기를 알린다", async () => {
  const attached: { readonly threadId: string; readonly marks: unknown }[] = [];
  const host = createFakeHost({
    overrides: {
      overlay: createOverlayPort({
        targetOf: targetsOf,
        inSet: () => ["core-thing"],
        ensureLoaded: () => Promise.resolve(),
        pluginSet: {
          attachOverlay: (threadId, marks) => {
            attached.push({ threadId, marks });
            return Promise.resolve();
          },
          cancelOverlay: () => Promise.resolve(),
        },
        startDrive: () => ok(undefined),
      }),
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const started = await connection.request("turn.start", {
    threadId,
    input: "use it",
    overlay: [{ plugin: "tools", entry: "tools" }, { plugin: "core-thing" }],
  });
  expect("turnId" in started && started.cacheImpact).toBe("tool_change_append");
  // 집합에 이미 든 플러그인은 얹지 않는다. 얹는 것은 도구 플러그인 하나다
  expect(attached).toEqual([
    { threadId, marks: [{ plugin: "tools", contentHash: HASH, until: "turn" }] },
  ]);
  // 턴 입력에는 얹은 항목만 실린다. 집합에 이미 든 `core-thing`은 얹은 것이 없어 빠진다
  expect(host.fake.submitted).toEqual([
    {
      threadId,
      requestId: undefined,
      invoked: [{ plugin: "tools", entry: "tools", kind: "plugin" }],
    },
  ]);
  await connection.close();
});
