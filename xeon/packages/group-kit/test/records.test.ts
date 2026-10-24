import { expect, test } from "bun:test";
import { PrimitiveError } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { checkRecordKind, checkPostItem, defineGroup, kindVisibleTo } from "../src/index.ts";
import { fireSettled, install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const DONE_KIND = "grp.writer.note.done";

const manifest = groupManifestOf({
  name: "writer",
  points: ["agent_settled"],
  usesPost: true,
  recordKinds: [
    {
      kind: DONE_KIND,
      version: 1,
      description: "A note the writer group leaves.",
      payload: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  ],
});

async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : String(error);
  }
  return undefined;
}

test("records.write-requires-declared-kind", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const codes: (string | undefined)[] = [];
  await install(
    t,
    defineGroup({
      manifest,
      setup(g) {
        g.on("agent_settled", async () => {
          codes.push(
            await codeOf(() =>
              g.record("grp.writer.note.other", { type: "thread", id: "t1" }, { text: "x" }),
            ),
          );
          codes.push(
            await codeOf(() => g.record(DONE_KIND, { type: "thread", id: "t1" }, { text: "ok" })),
          );
        });
      },
    }),
  );
  await fireSettled(t, thread, "k1");
  expect(codes).toEqual(["record_kind_undeclared", undefined]);
  // 선언하지 않은 kind는 이벤트를 쓰지 않았고, 선언한 kind는 한 번 썼다
  const kinds = t.records.events(thread).map((event) => event.kind);
  expect(kinds.filter((kind) => kind === "grp.writer.note.other")).toEqual([]);
  expect(kinds.filter((kind) => kind === DONE_KIND)).toHaveLength(1);
});

test("records.rejects-foreign-prefix", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const codes: (string | undefined)[] = [];
  await install(
    t,
    defineGroup({
      manifest,
      setup(g) {
        g.on("agent_settled", async () => {
          codes.push(
            await codeOf(() =>
              g.record("grp.helm.signal.detected", { type: "thread", id: "t1" }, { text: "x" }),
            ),
          );
          codes.push(
            await codeOf(() =>
              g.post(
                {
                  kind: "context",
                  customType: "grp.helm.signal.detected",
                  content: "x",
                  display: false,
                },
                { when: "next", requestId: "foreign" },
              ),
            ),
          );
          codes.push(
            await codeOf(() =>
              g.post(
                {
                  kind: "context",
                  customType: "grp.writer.note.done",
                  content: "x",
                  display: false,
                },
                { when: "next", requestId: "own" },
              ),
            ),
          );
        });
      },
    }),
  );
  await fireSettled(t, thread, "k1");
  expect(codes).toEqual(["record_invalid", "record_invalid", undefined]);
  expect(t.queue.items.map((item) => item.requestId)).toEqual(["own"]);
});

test("records.checks-are-pure", () => {
  expect(checkRecordKind(manifest, DONE_KIND)).toEqual({ ok: true });
  expect(checkRecordKind(manifest, "grp.writer.note.nope")).toMatchObject({
    ok: false,
    code: "record_kind_undeclared",
  });
  expect(checkRecordKind(manifest, "x.writer.note.done")).toMatchObject({
    ok: false,
    code: "record_invalid",
  });
  expect(checkPostItem(manifest, { kind: "user", content: "hi" })).toEqual({ ok: true });
});

test("records.kind-filter-hides-undeclared-groups", () => {
  const reader = groupManifestOf({
    name: "reader",
    readsRecordKinds: ["grp.writer.note.*", "grp.other.*", "grp.third.skill.proposed"],
  });
  // 자기 접두
  expect(kindVisibleTo(reader, "grp.reader.state.committed")).toBe(true);
  // 선언한 읽기 대상
  expect(kindVisibleTo(reader, DONE_KIND)).toBe(true);
  expect(kindVisibleTo(reader, "grp.other.area.name")).toBe(true);
  expect(kindVisibleTo(reader, "grp.third.skill.proposed")).toBe(true);
  // 선언하지 않은 그룹과 플러그인의 kind
  expect(kindVisibleTo(reader, "grp.writer.other.thing")).toBe(false);
  expect(kindVisibleTo(reader, "grp.third.skill.applied")).toBe(false);
  expect(kindVisibleTo(reader, "x.plugin.area.name")).toBe(false);
  // 코어 kind는 지점 페이로드로 가는 값이라 항상 보인다
  expect(kindVisibleTo(reader, "turn.completed")).toBe(true);
});
