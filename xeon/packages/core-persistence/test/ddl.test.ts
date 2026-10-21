import { expect, test } from "bun:test";
import { SESSION_TABLE_COLUMNS } from "../src/index.ts";
import { newThread, openHarness } from "./support/harness.ts";

function columnsOf(h: ReturnType<typeof openHarness>, table: string): readonly string[] {
  return h.store.raw
    .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .map((row) => row.name);
}

// 스펙 §3.10 코어 투영 테이블 표의 주요 열. p_approvals, p_scopes, p_settings, p_agents, p_parts, p_blob_refs는 M2 이후다
const PROJECTION_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  p_threads: [
    "thread_id",
    "title",
    "status",
    "workspace",
    "created_at",
    "updated_at",
    "first_seq",
    "head_seq",
    "leaf_event_id",
    "forked_from_thread",
    "forked_from_event",
    "closed_reason",
    "open_turn_id",
    "running_since",
    "resume_attempts",
  ],
  p_items: [
    "item_id",
    "thread_id",
    "event_id",
    "parent_event_id",
    "seq",
    "turn_id",
    "step_id",
    "kind",
    "status",
    "stop_reason",
    "effect_id",
  ],
  p_effects: [
    "effect_id",
    "thread_id",
    "tool_call_id",
    "item_id",
    "tool_name",
    "replay",
    "intent_seq",
    "exec_count",
    "last_exec_seq",
    "result_seq",
    "result_status",
    "synthesized",
  ],
  p_turns: [
    "turn_id",
    "thread_id",
    "status",
    "started_seq",
    "started_at",
    "completed_seq",
    "abort_requested_seq",
    "step_count",
    "request_id",
    "scope_id",
  ],
  p_inputs: [
    "input_id",
    "thread_id",
    "seq",
    "mode",
    "state",
    "source_key",
    "request_id",
    "placed_item_id",
    "placed_turn_id",
  ],
  step_checkpoints: [
    "thread_id",
    "checkpoint_id",
    "seq",
    "turn_id",
    "step_index",
    "next",
    "schema_version",
    "record",
  ],
};

test("ddl_matches_spec_table: non-projection tables", () => {
  const h = openHarness();
  for (const [table, columns] of Object.entries(SESSION_TABLE_COLUMNS)) {
    expect(columnsOf(h, table)).toEqual([...columns]);
  }
});

test("ddl_matches_spec_table: core projection tables", () => {
  const h = openHarness();
  for (const [table, columns] of Object.entries(PROJECTION_COLUMNS)) {
    expect(columnsOf(h, table)).toEqual([...columns]);
  }
});

test("every table is STRICT", () => {
  const h = openHarness();
  const names = h.store.raw
    .query<{ name: string }, []>(
      "SELECT name FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sys_%'",
    )
    .all()
    .map((row) => row.name);
  expect(names.length).toBeGreaterThan(10);
  for (const name of names) {
    const row = h.store.raw
      .query<{ strict: number }, [string]>("SELECT strict FROM pragma_table_list WHERE name = ?")
      .get(name);
    expect(row?.strict).toBe(1);
  }
});

// spec §9.21
test("events_update_and_stray_delete_blocked_by_trigger", () => {
  const h = openHarness();
  const { threadId } = newThread(h);
  const run =
    (sql: string, params: string[] = []) =>
    () =>
      h.store.raw.run(sql, params);
  expect(run("UPDATE events SET kind = 'thread.closed' WHERE thread_id = ?", [threadId])).toThrow(
    "events are immutable",
  );
  expect(run("DELETE FROM events WHERE thread_id = ?", [threadId])).toThrow("events are immutable");
  // remove 경로의 표지(thread_delete_guard) 아래에서만 지울 수 있다
  h.store.raw.run("INSERT INTO thread_delete_guard (thread_id) VALUES (?)", [threadId]);
  expect(() => h.store.raw.run("DELETE FROM events WHERE thread_id = ?", [threadId])).not.toThrow();
});

test("event_seq starts at 1 and the migration is applied once", () => {
  const h = openHarness();
  const row = h.store.raw
    .query<{ next_seq: number }, []>("SELECT next_seq FROM event_seq WHERE singleton = 1")
    .get();
  expect(row?.next_seq).toBe(1);
  const versions = h.store.raw
    .query<{ version: number }, []>(
      "SELECT version FROM sys_migrations WHERE owner = 'core.persistence'",
    )
    .all();
  expect(versions).toEqual([{ version: 1 }]);
});
