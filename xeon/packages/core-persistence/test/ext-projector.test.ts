import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventDraft, Projector, ProjectorFailure } from "@xeon/contracts/records";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { expectOk, newThread, openHarness, type Harness } from "./support/harness.ts";

const NOTE_KIND = "grp.alpha.note.recorded" as const;

function notesProjector(options: {
  readonly version?: number;
  readonly tables?: readonly string[];
  readonly name?: string;
  readonly fail?: boolean;
}): Projector {
  return {
    name: options.name ?? "ext.alpha",
    version: options.version ?? 1,
    tables: options.tables ?? ["x_alpha_notes"],
    ddl: [
      "CREATE TABLE x_alpha_notes (event_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, text TEXT NOT NULL) STRICT",
    ],
    kinds: [NOTE_KIND],
    apply(tx, event) {
      if (options.fail === true) throw new Error("alpha projector exploded");
      const payload = event.payload;
      const text =
        typeof payload === "object" && payload !== null && "payload" in payload
          ? JSON.stringify(payload.payload)
          : "";
      tx.run("INSERT INTO x_alpha_notes (event_id, thread_id, text) VALUES (?, ?, ?)", [
        event.id,
        event.threadId,
        text,
      ]);
    },
  };
}

function note(h: Harness, threadId: ThreadId, text: string): DurableEventDraft {
  return {
    id: h.ids.next("evt"),
    kind: NOTE_KIND,
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload: {
      groupId: "alpha",
      kind: NOTE_KIND,
      version: 1,
      subject: { type: "thread", id: threadId },
      payload: { text },
    },
    durable: true,
  };
}

function rows(h: Harness): readonly string[] {
  return h.store.raw
    .query<{ text: string }, []>("SELECT text FROM x_alpha_notes ORDER BY rowid")
    .all()
    .map((row) => row.text);
}

describe("projector registry", () => {
  test("register checks the name and table ownership", async () => {
    const h = await openHarness();
    const registry = h.service.projectors;
    expect(registry.register(notesProjector({ name: "core" }))).toEqual({
      ok: false,
      error: { kind: "name_reserved", name: "core" },
    });
    expect(registry.register(notesProjector({ name: "other" })).ok).toBe(false);
    // extension_cannot_write_foreign_prefix: 다른 확장 접두 테이블
    expect(registry.register(notesProjector({ tables: ["x_beta_notes"] }))).toEqual({
      ok: false,
      error: { kind: "table_not_owned", name: "ext.alpha", table: "x_beta_notes" },
    });
    // 지역 이름에 밑줄 금지
    expect(registry.register(notesProjector({ tables: ["x_alpha_note_rows"] })).ok).toBe(false);
    expect(registry.register(notesProjector({ name: "ext.alpha" })).ok).toBe(true);
    expect(registry.register(notesProjector({ name: "ext.alpha" }))).toEqual({
      ok: false,
      error: { kind: "name_taken", name: "ext.alpha" },
    });
    expect(registry.list().map((entry) => entry.name)).toEqual(["core", "ext.alpha"]);
  });

  test("extension_cannot_write_foreign_prefix: apply on a foreign table is rolled back under the guard", async () => {
    const h = await openHarness({ guardProjectors: true });
    const { threadId } = newThread(h);
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    const evil: Projector = {
      ...notesProjector({}),
      apply(tx) {
        tx.run("DELETE FROM p_threads");
      },
    };
    expectOk(h.service.projectors.register(evil));
    const before = h.store.rowCounts();
    expect(
      h.service.ext.commit({ threadId, requestId: "n1", drafts: [note(h, threadId, "x")] }),
    ).rejects.toThrow("store.prefix_not_owned");
    await Promise.resolve();
    expect(h.store.rowCounts()).toEqual(before);
    expect(failures).toHaveLength(1);
  });

  test("extension_projection_commits_with_core_event", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    expectOk(h.service.projectors.register(notesProjector({})));
    await h.service.ext.commit({ threadId, requestId: "n1", drafts: [note(h, threadId, "one")] });
    expect(rows(h)).toEqual(['{"text":"one"}']);
    const { eventCount } = h.store.raw
      .query<{ eventCount: number }, []>(
        "SELECT COUNT(*) AS eventCount FROM events WHERE kind = 'grp.alpha.note.recorded'",
      )
      .get() ?? { eventCount: -1 };
    expect(eventCount).toBe(1);
    const state = h.store.raw
      .query<{ last_seq: number }, []>(
        "SELECT last_seq FROM projector_state WHERE name = 'ext.alpha'",
      )
      .get();
    expect(state?.last_seq).toBe(2);
  });

  test("extension_projector_failure_notifies_and_rolls_back", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    expectOk(h.service.projectors.register(notesProjector({ fail: true })));
    const before = h.store.rowCounts();
    expect(
      h.service.ext.commit({ threadId, requestId: "n1", drafts: [note(h, threadId, "boom")] }),
    ).rejects.toThrow("store.projection_failed");
    await Promise.resolve();
    expect(h.store.rowCounts()).toEqual(before);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ projector: "ext.alpha", requestId: "n1" });
    expect(failures[0]?.event.kind).toBe(NOTE_KIND);
  });

  test("a changed projection version rebuilds only that projector, and dispose keeps the table", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const first = expectOk(h.service.projectors.register(notesProjector({})));
    await h.service.ext.commit({ threadId, requestId: "n1", drafts: [note(h, threadId, "one")] });
    first.dispose();
    // 등록하지 않은 동안 쌓인 이벤트
    await h.service.ext.commit({ threadId, requestId: "n2", drafts: [note(h, threadId, "two")] });
    expect(rows(h)).toEqual(['{"text":"one"}']);
    const second = expectOk(h.service.projectors.register(notesProjector({})));
    expect(rows(h)).toEqual(['{"text":"one"}', '{"text":"two"}']);
    second.dispose();
    // 규칙 버전이 오르면 다시 만든다
    expectOk(h.service.projectors.register(notesProjector({ version: 2 })));
    const state = h.store.raw
      .query<{ version: number }, []>(
        "SELECT version FROM projector_state WHERE name = 'ext.alpha'",
      )
      .get();
    expect(state?.version).toBe(2);
    expect(rows(h)).toEqual(['{"text":"one"}', '{"text":"two"}']);
  });
});

describe("rebuild", () => {
  test("a registered projector is rebuilt from events and matches the live table", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    expectOk(h.service.projectors.register(notesProjector({})));
    await h.service.ext.commit({ threadId, requestId: "n1", drafts: [note(h, threadId, "one")] });
    await h.service.ext.commit({ threadId, requestId: "n2", drafts: [note(h, threadId, "two")] });
    expectProjectionsRebuildable(h.store.db);
  });
});
