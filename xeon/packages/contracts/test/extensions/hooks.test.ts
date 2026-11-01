import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  CHAIN_RULES,
  COLLECT_RULES,
  FIRST_DENY,
  GUARD_HOOKS,
  LIFECYCLE_HOOKS,
  HOOKS,
  HOOK_NAMES,
  HookNameSchema,
  type HookName,
} from "../../src/extensions/index.ts";
import { PAYLOAD_SAMPLES, RESULT_SAMPLES } from "./fixtures/payload-samples.ts";

/** pi ExtensionEvent 합집합(types.ts:1377-1409)을 펼친 41개 이름과 새 이름의 대응. 별칭은 두지 않는다 */
const RENAMES: readonly (readonly [string, HookName])[] = [
  ["input", "input.user.before"],
  ["user_bash", "input.bash.before"],
  ["before_agent_start", "input.agent.before"],
  ["context", "request.context.before"],
  ["context_with_system", "request.system.before"],
  ["cache_warming_decision", "request.cache.before"],
  ["before_provider_request", "request.provider.before"],
  ["before_provider_headers", "request.headers.before"],
  ["after_provider_response", "request.provider.after"],
  ["provider_stream_event", "request.stream"],
  ["model_select", "request.model.after"],
  ["thinking_level_select", "request.thinking.after"],
  ["tool_call", "tool.call.before"],
  ["tool_result", "tool.result"],
  ["tool_execution_start", "tool.execution.before"],
  ["tool_execution_update", "tool.execution.update"],
  ["tool_execution_end", "tool.execution.after"],
  ["agent_start", "boundary.turn.before"],
  ["turn_start", "boundary.step.before"],
  ["message_start", "boundary.message.before"],
  ["message_update", "boundary.message.update"],
  ["message_end", "boundary.message.after"],
  ["turn_end", "boundary.step.after"],
  ["agent_before_settle", "boundary.settle.before"],
  ["agent_end", "boundary.turn.after"],
  ["agent_settled", "boundary.settle.after"],
  ["project_trust", "thread.trust.before"],
  ["resources_discover", "thread.resources"],
  ["mcp_servers_change", "thread.mcp.after"],
  ["session_start", "thread.start"],
  ["session_info_changed", "thread.info.after"],
  ["session_before_switch", "thread.switch.before"],
  ["session_before_fork", "thread.fork.before"],
  ["session_before_compact", "thread.compact.before"],
  ["session_compact", "thread.compact.after"],
  ["session_compact_failed", "thread.compact.failed"],
  ["session_before_tree", "thread.tree.before"],
  ["session_tree", "thread.tree.after"],
  ["session_shutdown", "thread.shutdown"],
  ["ui_prompt_start", "thread.prompt.before"],
  ["ui_prompt_end", "thread.prompt.after"],
];

/** pi에서 온 지점. guard와 lifecycle 5행은 pi 출처가 없다 */
const NEW_HOOKS: readonly HookName[] = [
  "guard.model.before",
  "guard.tool.before",
  "guard.output.before",
  "lifecycle.agent.settled",
  "lifecycle.lease.rejected",
];

/** `<종류>.<대상>[.<시점>]`. 시점은 before, after, 명사형 대상은 아래 허용 목록의 마지막 마디를 쓴다 */
const NAME_RULE = /^(input|request|tool|boundary|thread|lifecycle|guard)(\.[a-z]+){1,2}$/;
const NOUN_WORDS: ReadonlySet<string> = new Set([
  "update",
  "failed",
  "start",
  "shutdown",
  "stream",
]);

const rows = HOOK_NAMES.map((name) => HOOKS[name]);

function count(pick: (row: (typeof rows)[number]) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[pick(row)] = (out[pick(row)] ?? 0) + 1;
  return out;
}

describe("HOOKS", () => {
  test("every row has fold, payload and failure", () => {
    expect(rows).toHaveLength(46);
    for (const row of rows) {
      expect(row.fold).toBeDefined();
      expect(row.kind).toBeDefined();
      expect(row.payload).toBeDefined();
      expect(row.failure).toBeDefined();
      expect(row.dispatch).toBeDefined();
    }
  });

  test("failure follows the fold default except the declared exception", () => {
    const defaults = { tap: "open", collect: "open", chain: "skip", first: "closed" } as const;
    const differing = rows.filter((row) => row.failure !== defaults[row.fold]).map((r) => r.name);
    expect(differing).toEqual(["thread.compact.before"]);
    expect(HOOKS["thread.compact.before"].failure).toBe("open");
    expect(count((r) => r.failure)).toEqual({ closed: 9, open: 27, skip: 10 });
  });

  test("names follow the rule, are unique and complete", () => {
    expect(new Set(HOOK_NAMES).size).toBe(HOOK_NAMES.length);
    const expected = [...RENAMES.map(([, next]) => next), ...NEW_HOOKS];
    expect(new Set<string>(HOOK_NAMES)).toEqual(new Set<string>(expected));
    expect(Object.keys(HOOKS).toSorted()).toEqual([...HOOK_NAMES].toSorted());
    for (const name of HOOK_NAMES) {
      expect(HOOKS[name].name).toBe(name);
      expect(NAME_RULE.test(name)).toBe(true);
      expect(name.startsWith(`${HOOKS[name].kind}.`)).toBe(true);
      const last = name.split(".").at(-1) ?? "";
      if (
        HOOKS[name].kind !== "lifecycle" &&
        !["before", "after"].includes(last) &&
        name.split(".").length === 3
      ) {
        expect({ name, noun: NOUN_WORDS.has(last) }).toEqual({ name, noun: true });
      }
    }
  });

  test("pi mapping gives the old name of each of the 41 renamed points", () => {
    for (const [old, next] of RENAMES) {
      const row = HOOKS[next];
      expect({ next, event: row.pi?.event }).toEqual({ next, event: old });
      expect(row.pi?.def.length).toBeGreaterThan(0);
      expect(row.pi?.emit.length).toBeGreaterThan(0);
    }
    for (const name of NEW_HOOKS) expect(HOOKS[name].pi).toBeUndefined();
  });

  test("kind and fold counts", () => {
    expect(count((r) => r.kind)).toEqual({
      input: 3,
      request: 9,
      tool: 5,
      boundary: 9,
      thread: 15,
      lifecycle: 2,
      guard: 3,
    });
    expect(count((r) => r.fold)).toEqual({ tap: 24, first: 10, chain: 10, collect: 2 });
  });

  test("pi fold distribution matches F-1", () => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      if (row.pi !== undefined) out[row.pi.piFold] = (out[row.pi.piFold] ?? 0) + 1;
    }
    // tap 22, 제자리 변경 tap 1, first 7, chain 9, collect 2
    expect(out).toEqual({ tap: 22, "tap-mutate": 1, first: 7, chain: 9, collect: 2 });
  });

  test("collect goes only to input.agent.before and session.resources", () => {
    const collects = rows.filter((r) => r.fold === "collect").map((r) => r.name);
    expect(collects.toSorted()).toEqual(["input.agent.before", "thread.resources"]);
    expect(Object.keys(COLLECT_RULES).toSorted()).toEqual(collects.toSorted());
  });

  test("first, chain and deny tables", () => {
    const firsts = rows.filter((r) => r.fold === "first");
    const chains = rows.filter((r) => r.fold === "chain").map((r) => r.name);
    const denied = firsts.filter((r) => r.failure === "closed").map((r) => r.name);
    expect(Object.keys(FIRST_DENY).toSorted()).toEqual(denied.toSorted());
    expect(Object.keys(FIRST_DENY)).not.toContain("thread.compact.before");
    expect(Object.keys(CHAIN_RULES).toSorted()).toEqual(chains.toSorted());
  });

  test("result schema only on first, chain and collect", () => {
    for (const row of rows) {
      expect(row.result !== undefined).toBe(row.fold !== "tap");
    }
  });

  test("guard points are the three fail-closed first points and nothing else", () => {
    const guards = rows.filter((r) => r.kind === "guard");
    expect(guards.map((r) => r.name)).toEqual(Object.values(GUARD_HOOKS));
    for (const row of guards) {
      expect({ name: row.name, fold: row.fold, failure: row.failure }).toEqual({
        name: row.name,
        fold: "first",
        failure: "closed",
      });
    }
    expect(Object.keys(GUARD_HOOKS).toSorted()).toEqual(["output", "request", "tool"]);
  });

  test("lifecycle points are tap and fail-open, mapped from durable kinds", () => {
    expect(LIFECYCLE_HOOKS).toEqual({
      "agent.settled": "lifecycle.agent.settled",
      "lease.rejected": "lifecycle.lease.rejected",
    });
    for (const name of Object.values(LIFECYCLE_HOOKS)) {
      expect({ name, fold: HOOKS[name].fold, failure: HOOKS[name].failure }).toEqual({
        name,
        fold: "tap",
        failure: "open",
      });
    }
  });

  test("only session.trust.before fires without a thread", () => {
    // 폴더 신뢰는 thread를 만들기 전에 판정하므로 발화 문맥에 thread가 없다(F.extensions.spec §7)
    expect(rows.filter((r) => r.threadless === true).map((r) => r.name)).toEqual([
      "thread.trust.before",
    ]);
    expect(parse(HOOKS["thread.trust.before"].payload, { cwd: "/work/app" }).ok).toBe(true);
    expect(
      parse(HOOKS["thread.trust.before"].payload, { cwd: "/work/app", threadId: "thr_x" }).ok,
    ).toBe(false);
  });

  test("detached only for tap", () => {
    const detached = rows.filter((r) => r.dispatch === "detached");
    expect(detached).toHaveLength(5);
    for (const row of detached) expect(row.fold).toBe("tap");
    expect(detached.map((r) => r.name).toSorted()).toEqual([
      "request.thinking.after",
      "thread.info.after",
      "thread.mcp.after",
      "thread.prompt.after",
      "thread.prompt.before",
    ]);
  });

  test("finalize only on boundary chain", () => {
    const finalized = rows.filter((r) => r.finalize !== undefined).map((r) => r.name);
    expect(finalized.toSorted()).toEqual(["boundary.settle.before", "boundary.step.after"]);
    for (const row of rows.filter((r) => r.finalize !== undefined)) expect(row.fold).toBe("chain");
  });

  test("m1 marks the eleven smoke points", () => {
    const marked: string[] = rows.filter((r) => r.m1).map((r) => r.name);
    expect(marked.toSorted()).toEqual(
      [
        "input.user.before",
        "request.context.before",
        "request.provider.before",
        "tool.call.before",
        "tool.result",
        "boundary.step.before",
        "boundary.step.after",
        "boundary.settle.before",
        "boundary.settle.after",
        "thread.start",
        "thread.shutdown",
      ].toSorted(),
    );
  });
});

describe("point schemas", () => {
  test("HookNameSchema accepts exactly the point names", () => {
    for (const name of HOOK_NAMES) expect(parse(HookNameSchema, name).ok).toBe(true);
    expect(parse(HookNameSchema, "tool.before").ok).toBe(false);
    expect(parse(HookNameSchema, "ToolCall").ok).toBe(false);
  });

  test("every payload sample is accepted by its payload schema", () => {
    for (const name of HOOK_NAMES) {
      const result = parse(HOOKS[name].payload, PAYLOAD_SAMPLES[name]);
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
    }
  });

  test("payload schemas are closed", () => {
    for (const name of HOOK_NAMES) {
      const sample = PAYLOAD_SAMPLES[name];
      if (typeof sample !== "object" || sample === null) throw new Error(`no sample for ${name}`);
      const withExtra = { ...sample, unexpectedField: 1 };
      expect({ name, ok: parse(HOOKS[name].payload, withExtra).ok }).toEqual({ name, ok: false });
    }
  });

  test("every result sample is accepted by its result schema", () => {
    for (const name of HOOK_NAMES) {
      const schema = HOOKS[name].result;
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

  test("tool.call.before denies by default and does not terminate", () => {
    expect(FIRST_DENY["tool.call.before"]).toEqual({
      block: true,
      reason: "extension handler failed",
      terminate: false,
    });
    expect(FIRST_DENY["thread.trust.before"]).toEqual({ trusted: "no" });
  });
});
