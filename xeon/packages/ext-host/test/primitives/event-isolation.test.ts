import { expect, test } from "bun:test";
import { hostOf, type PlatformContext } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { rejectionOf, makeUnit, type ManifestInput } from "./fixtures/support.ts";

// X.primitives.spec §4.9, P-26, M3-REQ-26. 확장 사이의 통신은 그룹 레코드와 능력 서비스뿐이다(범용 이벤트 버스 없음, ADR-0017 §3.7).
// 그룹 사이 격리는 kind 접두 필터다: 자기 접두는 읽고, 다른 접두는 readsRecordKinds가 덮을 때만 읽는다

/** Cordis 이벤트·컨텍스트 API의 이름. 확장에 주는 어떤 객체에도 없어야 한다 */
const CORDIS_NAMES = [
  "emit",
  "parallel",
  "serial",
  "bail",
  "waterfall",
  "broadcast",
  "ctx",
  "root",
  "reflect",
  "fiber",
  "lifecycle",
  "plugin",
];

function leaked(target: object): string[] {
  const names = new Set([...Object.keys(target), ...Object.getOwnPropertyNames(target)]);
  return CORDIS_NAMES.filter((name) => names.has(name));
}

test("no Cordis event or context API reaches extension code", async () => {
  const t = await createTestHost();
  const seen: string[] = [];
  let platform: PlatformContext | undefined;
  await t.host.registerPlatform({
    name: "iso-platform",
    setup(ctx) {
      platform = ctx;
    },
  });
  await t.host.install(
    makeUnit({ name: "iso-ext" }, (g) => {
      seen.push(...leaked(g), ...leaked(hostOf(g)));
    }),
  );
  expect(seen).toEqual([]);
  expect(leaked(t.host)).toEqual([]);
  expect(platform === undefined ? [] : leaked(platform)).toEqual([]);
  expect(leaked(t.host.resources)).toEqual([]);
});

test("group isolation is the kind prefix filter on records", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const kinds: ManifestInput["recordKinds"] = [
    {
      kind: "grp.iso-a.note.made",
      version: 1,
      description: "n",
      payload: {
        type: "object",
        properties: { n: { type: "integer" } },
        required: ["n"],
        additionalProperties: false,
      },
    },
  ];
  const rows: Record<string, unknown> = {};
  let writer: (() => Promise<void>) | undefined;
  await t.host.install(
    makeUnit(
      { name: "iso-a", kind: "group", recordKinds: kinds, points: ["boundary.settle.after"] },
      (g) => {
        writer = () => g.record("grp.iso-a.note.made", { type: "thread", id: thread }, { n: 1 });
        g.on("boundary.settle.after", async () => {
          await writer?.();
        });
      },
    ),
  );
  await t.host.install(
    makeUnit(
      {
        name: "iso-b",
        kind: "group",
        loadIndex: 1,
        readsRecordKinds: ["grp.iso-a.*"],
        points: ["boundary.settle.after"],
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          rows.declared = (await g.readRecords({ kind: "grp.iso-a.*" })).length;
        });
      },
    ),
  );
  await t.host.install(
    makeUnit(
      { name: "iso-c", kind: "group", loadIndex: 2, points: ["boundary.settle.after"] },
      (g) => {
        g.on("boundary.settle.after", async () => {
          const failure = await rejectionOf(() => g.readRecords({ kind: "grp.iso-a.*" }));
          rows.undeclared = failure instanceof Error ? failure.message : "readable";
        });
      },
    ),
  );
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "iso" },
  );
  expect(rows).toEqual({ declared: 1, undeclared: "reading grp.iso-a.* is not declared" });
});
