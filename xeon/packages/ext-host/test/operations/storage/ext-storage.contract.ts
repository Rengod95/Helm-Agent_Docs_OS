// 저장 영역 계약 시나리오(X.operations.plan O-15). 저장소 팩토리를 인자로 받는다.
// X 테스트는 자체 인메모리 대역(support/fake-session.ts)으로 돌리고, 실제 bun:sqlite 저장소로 같은 시나리오를
// 돌리는 일은 L0.store.plan ST-23이 한다(테스트 파일 교차 import, review.decisions-2 U-17).
import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  ProjectorRegistryPortKey,
  ScopedStorePortKey,
  type PortKey,
  type PortLookup,
} from "@xeon/contracts/extensions";
import type { DurableEventEnvelope, ProjectorRegistry, StoreDb } from "@xeon/contracts/records";
import { Type } from "typebox";
import { fixedIdFactory } from "../../../src/testing/index.ts";
import { optionalTextOf, recordOf, textOf } from "../../support/guards.ts";
import {
  createExtStorageManager,
  type ExtProjection,
  type ExtStorageManager,
} from "../../../src/operations/index.ts";

export interface ContractSession {
  readonly registry: Pick<ProjectorRegistry, "register" | "onFailure">;
  readonly store: { scoped(owner: string): StoreDb };
  /** 이벤트를 커밋한다. 투영기는 같은 트랜잭션에서 실행된다. 장애 지점이면 모두 되돌린다 */
  commit(
    events: readonly DurableEventEnvelope[],
    options?: { readonly fault?: "after_ext_projection:0" },
  ): { readonly committed: boolean };
  /** 테이블 행의 해시. 롤백 확인용 */
  hashOf(table: string): string;
  /** 이벤트 봉투 만들기 */
  event(
    threadId: ThreadId,
    kind: DurableEventEnvelope["kind"],
    payload: unknown,
  ): DurableEventEnvelope;
}

const PinRow = Type.Object({
  id: Type.String(),
  title: Type.String(),
  done: Type.Optional(Type.Boolean()),
  tags: Type.Optional(Type.Array(Type.String())),
});

const PIN_DEFS = {
  pins: { row: PinRow, key: ["id"], indexes: [["title"]], perThread: false },
} as const;

function portsOf(session: ContractSession): PortLookup {
  return {
    get<Api>(key: PortKey<Api>): Api | undefined {
      if (key.name === ProjectorRegistryPortKey.name) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 시험용 조회: 키 이름이 Api를 정한다
        return session.registry as unknown as Api;
      }
      if (key.name === ScopedStorePortKey.name) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 시험용 조회: 키 이름이 Api를 정한다
        return session.store as unknown as Api;
      }
      return undefined;
    },
  };
}

function managerOf(session: ContractSession): ExtStorageManager {
  return createExtStorageManager({
    ports: portsOf(session),
    now: () => 1_767_571_200_000,
    guard: true,
    onProjectionFailure: () => {},
  });
}

function projectionOf(
  version: number,
  titleOf: (title: string) => string,
): ExtProjection<typeof PIN_DEFS> {
  return {
    version,
    kinds: ["x.notes.pin.added", "x.notes.pin.removed"],
    apply(event, tables) {
      const payload = recordOf(event.payload);
      const id = textOf(payload.id);
      if (event.kind === "x.notes.pin.added") {
        tables.pins.upsert({ id, title: titleOf(optionalTextOf(payload.title) ?? "") });
      } else {
        tables.pins.delete({ id });
      }
    },
  };
}

export function runExtStorageContract(label: string, makeSession: () => ContractSession): void {
  const ids = fixedIdFactory(7000);

  describe(`${label}: ExtStorage contract`, () => {
    test("projection writes commit with core and are readable", () => {
      const session = makeSession();
      const thread = ids.next("thr");
      const storage = managerOf(session).storageFor("notes", { isolated: false });
      const defined = storage.defineTables(
        PIN_DEFS,
        projectionOf(1, (title) => title),
      );
      expect(defined.ok).toBe(true);
      if (!defined.ok) return;
      expect(defined.value.names.pins).toBe("x_notes_pins");
      session.commit([
        session.event(thread, "x.notes.pin.added", { id: "a", title: "first" }),
        session.event(thread, "x.notes.pin.added", { id: "b", title: "second" }),
      ]);
      const listed = defined.value.read((tables) =>
        tables.pins.list({ orderBy: [{ column: "id" }] }),
      );
      expect(listed).toEqual({
        ok: true,
        value: [
          { id: "a", title: "first" },
          { id: "b", title: "second" },
        ],
      });
      const one = defined.value.read((tables) => ({
        got: tables.pins.get({ id: "b" }),
        missing: tables.pins.get({ id: "zzz" }),
        count: tables.pins.count(),
        byTitle: tables.pins.count({ title: "first" }),
      }));
      expect(one).toEqual({
        ok: true,
        value: { got: { id: "b", title: "second" }, missing: undefined, count: 2, byTitle: 1 },
      });
      session.commit([session.event(thread, "x.notes.pin.removed", { id: "a" })]);
      const after = defined.value.read((tables) => tables.pins.count());
      expect(after).toEqual({ ok: true, value: 1 });
    });

    test("rollback discards extension writes", () => {
      const session = makeSession();
      const thread = ids.next("thr");
      const storage = managerOf(session).storageFor("notes", { isolated: false });
      const defined = storage.defineTables(
        PIN_DEFS,
        projectionOf(1, (title) => title),
      );
      expect(defined.ok).toBe(true);
      session.commit([session.event(thread, "x.notes.pin.added", { id: "keep", title: "kept" })]);
      const before = session.hashOf("x_notes_pins");
      const failed = session.commit(
        [session.event(thread, "x.notes.pin.added", { id: "lost", title: "lost" })],
        { fault: "after_ext_projection:0" },
      );
      expect(failed.committed).toBe(false);
      expect(session.hashOf("x_notes_pins")).toBe(before);
    });

    test("a projection version bump rebuilds the tables from the events", () => {
      const session = makeSession();
      const thread = ids.next("thr");
      const first = managerOf(session);
      const defined = first.storageFor("notes", { isolated: false }).defineTables(
        PIN_DEFS,
        projectionOf(1, (title) => title),
      );
      expect(defined.ok).toBe(true);
      session.commit([session.event(thread, "x.notes.pin.added", { id: "a", title: "lower" })]);
      // 프로세스를 내렸다 다시 올린다: 투영기 등록만 해제되고 테이블과 이벤트는 남는다
      first.release("notes");
      const second = managerOf(session);
      const redefined = second.storageFor("notes", { isolated: false }).defineTables(
        PIN_DEFS,
        projectionOf(2, (title) => title.toUpperCase()),
      );
      expect(redefined.ok).toBe(true);
      if (!redefined.ok) return;
      expect(redefined.value.read((tables) => tables.pins.list())).toEqual({
        ok: true,
        value: [{ id: "a", title: "LOWER" }],
      });
    });

    test("writers: update, delete and typed columns round-trip", () => {
      const session = makeSession();
      const thread = ids.next("thr");
      const defs = {
        pins: {
          row: Type.Object({
            id: Type.String(),
            done: Type.Boolean(),
            tags: Type.Array(Type.String()),
            note: Type.Union([Type.String(), Type.Null()]),
            score: Type.Optional(Type.Number()),
          }),
          key: ["id"],
          perThread: false,
        },
      } as const;
      const results: number[] = [];
      const projection: ExtProjection<typeof defs> = {
        version: 1,
        kinds: ["x.notes.pin.added"],
        apply(_event, tables) {
          tables.pins.insert({ id: "a", done: false, tags: ["x", "y"], note: null });
          tables.pins.insert({ id: "b", done: true, tags: [], note: "n", score: 1.5 });
          results.push(tables.pins.update({ id: "a" }, { done: true, note: "set" }));
          results.push(tables.pins.update({ id: "none" }, { done: true }));
          results.push(tables.pins.delete({ id: "b" }));
          results.push(tables.pins.delete({ id: "b" }));
        },
      };
      const defined = managerOf(session)
        .storageFor("notes", { isolated: false })
        .defineTables(defs, projection);
      expect(defined.ok).toBe(true);
      if (!defined.ok) return;
      session.commit([session.event(thread, "x.notes.pin.added", {})]);
      expect(results).toEqual([1, 0, 1, 0]);
      expect(defined.value.read((tables) => tables.pins.list())).toEqual({
        ok: true,
        value: [{ id: "a", done: true, tags: ["x", "y"], note: "set" }],
      });
    });

    test("perThread tables carry thread_id and read per thread", () => {
      const session = makeSession();
      const first = ids.next("thr");
      const second = ids.next("thr");
      const defs = {
        marks: {
          row: Type.Object({ id: Type.String(), label: Type.String() }),
          key: ["id"],
          perThread: true,
        },
      } as const;
      const projection: ExtProjection<typeof defs> = {
        version: 1,
        kinds: ["x.notes.pin.added"],
        apply(event, tables) {
          tables.marks.insert({ id: "m", label: String(event.threadId).slice(-3) });
        },
      };
      const defined = managerOf(session)
        .storageFor("notes", { isolated: false })
        .defineTables(defs, projection);
      expect(defined.ok).toBe(true);
      if (!defined.ok) return;
      session.commit([session.event(first, "x.notes.pin.added", {})]);
      session.commit([session.event(second, "x.notes.pin.added", {})]);
      expect(defined.value.read((tables) => tables.marks.count(), { threadId: first })).toEqual({
        ok: true,
        value: 1,
      });
      expect(defined.value.read((tables) => tables.marks.count())).toEqual({ ok: true, value: 2 });
    });
  });
}
