import { expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { OverlayRef } from "@fresnel/contracts/wire";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import {
  NO_DRAFTS,
  createOverlayPort,
  planOverlay,
  type DriveStartRefusal,
  type OverlayTarget,
} from "../../../src/assembly/plugins/overlay.ts";

// M5c §4.3.2, §4.3.4 (일회 Drive): 시작 Drive 항목(`kind: "drive"`, 이름 `start`)은 얹을 수 있다. 얹은 표지는 프레임이 풀릴 때까지
// 살아야 하므로 `until: "release"`로 간다. 시작 요청은 표지를 단 뒤(집합이 그 플러그인을 든 뒤)에 낸다. 시험은 값을 `toEqual`로 비교한다.

const HASH = "a".repeat(64);

function threadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

/** 시작 Drive 항목과 플러그인 항목을 가진 검토된 대상. 이름은 요청한 이름이다 */
function driverTarget(name: string): OverlayTarget {
  return {
    name,
    reviewedHash: HASH,
    entries: [
      { entry: "start", kind: "drive" },
      { entry: name, kind: "plugin" },
    ],
    addsTools: false,
  };
}

function targetOf(name: string): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> {
  return Promise.resolve(ok(driverTarget(name)));
}

test("planOverlay는 시작 Drive 항목을 받아 kind drive인 invoked 항목으로 적는다", async () => {
  const refs: readonly OverlayRef[] = [{ plugin: "driver", entry: "start" }];
  expect(await planOverlay(refs, targetOf, new Set())).toEqual(
    ok([
      {
        plugin: "driver",
        contentHash: HASH,
        alreadyInProfile: false,
        addsTools: false,
        invoked: [{ plugin: "driver", entry: "start", kind: "drive" }],
      },
    ]),
  );
});

test("planOverlay는 검토된 플러그인에 없는 항목 이름이면 여전히 no_entry다", async () => {
  expect(await planOverlay([{ plugin: "driver", entry: "other" }], targetOf, new Set())).toEqual(
    err({ kind: "no_entry", name: "driver" }),
  );
});

test("덧씌우기 포트는 시작 Drive를 release 표지로 집합에 올린 뒤에 시작을 요청하고, 시작한 항목을 싣는다", async () => {
  const order: string[] = [];
  const marks: unknown[] = [];
  const port = createOverlayPort({
    draftOf: NO_DRAFTS,
    loadDrafts: () => Promise.resolve(ok(undefined)),
    targetOf,
    inSet: () => [],
    ensureLoaded: (names) => {
      order.push(`load:${names.join(",")}`);
      return Promise.resolve();
    },
    pluginSet: {
      attachOverlay: (_threadId, attached) => {
        order.push("attach");
        marks.push(attached);
        return Promise.resolve();
      },
      cancelOverlay: () => {
        order.push("cancel");
        return Promise.resolve();
      },
    },
    startDrive: (_threadId, plugin): Result<void, DriveStartRefusal> => {
      order.push(`start:${plugin}`);
      return ok(undefined);
    },
  });
  const result = await port.attach(threadId(), [{ plugin: "driver", entry: "start" }]);
  expect(result).toEqual(
    ok({
      cacheImpact: "none",
      invoked: [{ plugin: "driver", entry: "start", kind: "drive" }],
    }),
  );
  expect(order).toEqual(["load:driver", "attach", "start:driver"]);
  expect(marks).toEqual([[{ plugin: "driver", contentHash: HASH, until: "release" }]]);
});

test("덧씌우기 포트는 시작 요청이 거절되면 얹은 표지를 되돌리고 drive_unavailable로 거절한다", async () => {
  const cancelled: string[] = [];
  const port = createOverlayPort({
    draftOf: NO_DRAFTS,
    loadDrafts: () => Promise.resolve(ok(undefined)),
    targetOf,
    inSet: () => [],
    ensureLoaded: () => Promise.resolve(),
    pluginSet: {
      attachOverlay: () => Promise.resolve(),
      cancelOverlay: (id) => {
        cancelled.push(id);
        return Promise.resolve();
      },
    },
    startDrive: () => err({ kind: "not_started", reason: "unknown_scope" }),
  });
  const id = threadId();
  expect(await port.attach(id, [{ plugin: "driver", entry: "start" }])).toEqual(
    err({ kind: "drive_unavailable", name: "driver" }),
  );
  expect(cancelled).toEqual([id]);
});

test("덧씌우기 포트는 등록이 없는 시작 Drive도 drive_unavailable로 거절한다", async () => {
  const port = createOverlayPort({
    draftOf: NO_DRAFTS,
    loadDrafts: () => Promise.resolve(ok(undefined)),
    targetOf,
    inSet: () => [],
    ensureLoaded: () => Promise.resolve(),
    pluginSet: {
      attachOverlay: () => Promise.resolve(),
      cancelOverlay: () => Promise.resolve(),
    },
    startDrive: () => err({ kind: "no_drive" }),
  });
  expect(await port.attach(threadId(), [{ plugin: "driver", entry: "start" }])).toEqual(
    err({ kind: "drive_unavailable", name: "driver" }),
  );
});

test("덧씌우기 포트는 이미 집합에 든 플러그인의 시작 Drive에는 표지를 달지 않고 시작만 요청한다", async () => {
  const loaded: string[][] = [];
  const attached: unknown[] = [];
  const started: string[] = [];
  const port = createOverlayPort({
    draftOf: NO_DRAFTS,
    loadDrafts: () => Promise.resolve(ok(undefined)),
    targetOf,
    inSet: () => ["driver"],
    ensureLoaded: (names) => {
      loaded.push([...names]);
      return Promise.resolve();
    },
    pluginSet: {
      attachOverlay: (_threadId, marks) => {
        attached.push(marks);
        return Promise.resolve();
      },
      cancelOverlay: () => Promise.resolve(),
    },
    startDrive: (_threadId, plugin) => {
      started.push(plugin);
      return ok(undefined);
    },
  });
  expect(await port.attach(threadId(), [{ plugin: "driver", entry: "start" }])).toEqual(
    ok({ cacheImpact: "none", invoked: [] }),
  );
  expect(loaded).toEqual([]);
  expect(attached).toEqual([]);
  expect(started).toEqual(["driver"]);
});
