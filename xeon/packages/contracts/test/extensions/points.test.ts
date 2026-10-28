import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  CHAIN_RULES,
  FIRST_DENY,
  POINTS,
  POINT_NAMES,
  PointNameSchema,
} from "../../src/extensions/index.ts";
import { PAYLOAD_SAMPLES, RESULT_SAMPLES } from "./fixtures/payload-samples.ts";

/** pi ExtensionEvent 합집합(types.ts:1377-1409)을 펼친 41개 이름 */
const PI_EVENT_NAMES: readonly string[] = [
  "project_trust",
  "resources_discover",
  "mcp_servers_change",
  "session_start",
  "session_info_changed",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
  "session_shutdown",
  "session_before_tree",
  "session_tree",
  "context",
  "context_with_system",
  "cache_warming_decision",
  "before_provider_request",
  "before_provider_headers",
  "after_provider_response",
  "provider_stream_event",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "agent_before_settle",
  "agent_settled",
  "ui_prompt_start",
  "ui_prompt_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
  "user_bash",
  "input",
  "tool_call",
  "tool_result",
];

const rows = POINT_NAMES.map((name) => POINTS[name]);

function count(pick: (row: (typeof rows)[number]) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[pick(row)] = (out[pick(row)] ?? 0) + 1;
  return out;
}

describe("POINTS", () => {
  test("every row has fold and payload", () => {
    expect(rows).toHaveLength(41);
    for (const row of rows) {
      expect(row.fold).toBeDefined();
      expect(row.kind).toBeDefined();
      expect(row.payload).toBeDefined();
      expect(row.onError).toBeDefined();
      expect(row.dispatch).toBeDefined();
      expect(row.pi).toBeDefined();
    }
  });

  test("onError derived from fold", () => {
    for (const row of rows) {
      const expected = row.fold === "tap" ? "record" : row.fold === "first" ? "deny" : "skip";
      expect(row.onError).toBe(expected);
    }
  });

  test("names unique and complete", () => {
    expect(new Set(POINT_NAMES).size).toBe(POINT_NAMES.length);
    expect(new Set<string>(POINT_NAMES)).toEqual(new Set<string>(PI_EVENT_NAMES));
    expect(Object.keys(POINTS).toSorted()).toEqual([...POINT_NAMES].toSorted());
    for (const name of POINT_NAMES) expect(POINTS[name].name).toBe(name);
  });

  test("pi mapping complete", () => {
    for (const row of rows) {
      expect(row.pi.event).toBe(row.name);
      expect(row.pi.def.length).toBeGreaterThan(0);
      expect(row.pi.emit.length).toBeGreaterThan(0);
    }
  });

  test("kind and fold counts", () => {
    expect(count((r) => r.kind)).toEqual({
      input: 3,
      request: 9,
      tool: 5,
      boundary: 9,
      session: 15,
    });
    expect(count((r) => r.fold)).toEqual({ tap: 22, first: 7, chain: 12 });
  });

  test("pi fold distribution matches F-1", () => {
    const out: Record<string, number> = {};
    for (const row of rows) out[row.pi.piFold] = (out[row.pi.piFold] ?? 0) + 1;
    // tap 22, 제자리 변경 tap 1, first 7, chain 9, collect 2
    expect(out).toEqual({ tap: 22, "tap-mutate": 1, first: 7, chain: 9, collect: 2 });
  });

  test("first and chain tables", () => {
    const firsts = rows.filter((r) => r.fold === "first").map((r) => r.name);
    const chains = rows.filter((r) => r.fold === "chain").map((r) => r.name);
    expect(Object.keys(FIRST_DENY).toSorted()).toEqual(firsts.toSorted());
    expect(Object.keys(CHAIN_RULES).toSorted()).toEqual(chains.toSorted());
  });

  test("result schema only on first and chain", () => {
    for (const row of rows) {
      expect(row.result !== undefined).toBe(row.fold !== "tap");
    }
  });

  test("only project_trust fires without a thread", () => {
    // 폴더 신뢰는 thread를 만들기 전에 판정하므로 발화 문맥에 thread가 없다(F.extensions.spec §7)
    expect(rows.filter((r) => r.threadless === true).map((r) => r.name)).toEqual(["project_trust"]);
    expect(parse(POINTS.project_trust.payload, { cwd: "/work/app" }).ok).toBe(true);
    expect(parse(POINTS.project_trust.payload, { cwd: "/work/app", threadId: "thr_x" }).ok).toBe(
      false,
    );
  });

  test("detached only for tap", () => {
    const detached = rows.filter((r) => r.dispatch === "detached");
    expect(detached).toHaveLength(5);
    for (const row of detached) expect(row.fold).toBe("tap");
    expect(detached.map((r) => r.name).toSorted()).toEqual([
      "mcp_servers_change",
      "session_info_changed",
      "thinking_level_select",
      "ui_prompt_end",
      "ui_prompt_start",
    ]);
  });

  test("finalize only on boundary chain", () => {
    const finalized = rows.filter((r) => r.finalize !== undefined).map((r) => r.name);
    expect(finalized.toSorted()).toEqual(["agent_before_settle", "turn_end"]);
  });

  test("m1 marks the eleven smoke points", () => {
    const marked: string[] = rows.filter((r) => r.m1).map((r) => r.name);
    expect(marked.toSorted()).toEqual(
      [
        "input",
        "context",
        "before_provider_request",
        "tool_call",
        "tool_result",
        "turn_start",
        "turn_end",
        "agent_before_settle",
        "agent_settled",
        "session_start",
        "session_shutdown",
      ].toSorted(),
    );
  });
});

describe("point schemas", () => {
  test("PointNameSchema accepts exactly the point names", () => {
    for (const name of POINT_NAMES) expect(parse(PointNameSchema, name).ok).toBe(true);
    expect(parse(PointNameSchema, "tool.before").ok).toBe(false);
    expect(parse(PointNameSchema, "ToolCall").ok).toBe(false);
  });

  test("every payload sample is accepted by its payload schema", () => {
    for (const name of POINT_NAMES) {
      const result = parse(POINTS[name].payload, PAYLOAD_SAMPLES[name]);
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
    }
  });

  test("payload schemas are closed", () => {
    for (const name of POINT_NAMES) {
      const sample = PAYLOAD_SAMPLES[name];
      if (typeof sample !== "object" || sample === null) throw new Error(`no sample for ${name}`);
      const withExtra = { ...sample, unexpectedField: 1 };
      expect({ name, ok: parse(POINTS[name].payload, withExtra).ok }).toEqual({ name, ok: false });
    }
  });

  test("every result sample is accepted by its result schema", () => {
    for (const name of POINT_NAMES) {
      const schema = POINTS[name].result;
      if (schema === undefined) continue;
      const result = parse(schema, RESULT_SAMPLES[name]);
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
    }
  });

  test("FIRST_DENY values are valid decisions", () => {
    for (const [name, deny] of Object.entries(FIRST_DENY)) {
      const schema = rows.find((r) => r.name === name)?.result;
      if (schema === undefined) throw new Error(`no result schema for ${name}`);
      expect({ name, ok: parse(schema, deny).ok }).toEqual({ name, ok: true });
    }
  });

  test("tool_call denies by default and does not terminate", () => {
    expect(FIRST_DENY.tool_call).toEqual({
      block: true,
      reason: "extension handler failed",
      terminate: false,
    });
    expect(FIRST_DENY.project_trust).toEqual({ trusted: "no" });
  });
});
