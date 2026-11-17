import { describe, expect, test } from "bun:test";
import { BLOCK_MODEL, type BlockDescription } from "../../src/blocks/index.ts";
import { HOOK_NAMES, HOOK_POSITIONS, type BlockId } from "../../src/extensions/index.ts";

function blockOf(id: BlockId): BlockDescription {
  const found = BLOCK_MODEL.blocks.find((block) => block.id === id);
  if (found === undefined) throw new Error(`no block ${id}`);
  return found;
}

const keyIn = (id: BlockId): boolean =>
  blockOf(id).settings.some((ref) => ref.key === "l1.models.routing.summary");

describe("block model", () => {
  test("six blocks and three boundaries, in spec order, version 1", () => {
    expect(BLOCK_MODEL.version).toBe(1);
    expect(BLOCK_MODEL.blocks.map((block) => block.id)).toEqual([
      "context",
      "model",
      "tools",
      "ask",
      "agents",
      "record",
    ]);
    expect(BLOCK_MODEL.boundaries.map((boundary) => boundary.id)).toEqual([
      "conversation-start",
      "input-received",
      "before-turn-end",
    ]);
  });

  test("positions are the whole HOOK_POSITIONS table in HOOK_NAMES order", () => {
    expect(BLOCK_MODEL.positions.map((row) => row.hook)).toEqual([...HOOK_NAMES]);
    expect(BLOCK_MODEL.positions).toHaveLength(50);
    for (const row of BLOCK_MODEL.positions) {
      expect(row).toEqual(HOOK_POSITIONS[row.hook]);
    }
  });

  test("the record block has empty before and after lists and keeps them, it only subscribes to events", () => {
    const record = blockOf("record");
    expect(Object.hasOwn(record.hooks, "before")).toBe(true);
    expect(Object.hasOwn(record.hooks, "after")).toBe(true);
    expect(record.hooks.before).toEqual([]);
    expect(record.hooks.after).toEqual([]);
    expect(record.hooks.events).toEqual([
      "boundary.turn.before",
      "boundary.step.before",
      "boundary.turn.after",
      "boundary.settle.after",
      "thread.mcp.after",
      "thread.info.after",
      "thread.tree.after",
      "thread.shutdown",
      "lifecycle.lease.rejected",
    ]);
  });

  test("the block hook lists come from the positions, over all 50 hooks", () => {
    expect(blockOf("context").hooks).toEqual({
      before: [
        "input.agent.before",
        "request.context.before",
        "request.system.before",
        "thread.compact.before",
      ],
      after: [],
      events: ["thread.compact.after", "thread.compact.failed"],
    });
    expect(blockOf("model").hooks).toEqual({
      before: ["request.provider.before", "request.headers.before", "guard.model.before"],
      after: ["boundary.message.after", "guard.output.before"],
      events: [
        "request.provider.after",
        "request.stream",
        "request.model.after",
        "request.thinking.after",
        "boundary.message.before",
        "boundary.message.update",
      ],
    });
    expect(blockOf("tools").hooks).toEqual({
      before: ["tool.call.before", "guard.tool.before", "guard.output.before"],
      after: ["tool.result"],
      events: ["tool.execution.before", "tool.execution.update", "tool.execution.after"],
    });
    expect(blockOf("ask").hooks).toEqual({
      before: ["ask.human.before"],
      after: [],
      events: ["thread.prompt.before", "thread.prompt.after", "ask.human.after"],
    });
    expect(blockOf("agents").hooks).toEqual({
      before: ["agent.spawn.before"],
      after: ["agent.spawn.after"],
      events: ["lifecycle.agent.settled"],
    });
  });

  test("each boundary lists its hooks from the positions", () => {
    const hooks = Object.fromEntries(
      BLOCK_MODEL.boundaries.map((boundary) => [boundary.id, boundary.hooks]),
    );
    expect(hooks).toEqual({
      "conversation-start": ["thread.resources", "thread.start"],
      "input-received": ["input.user.before", "input.bash.before"],
      "before-turn-end": ["boundary.step.after", "boundary.settle.before"],
    });
  });

  test("every block hook is placed at that block in HOOK_POSITIONS", () => {
    for (const block of BLOCK_MODEL.blocks) {
      for (const name of block.hooks.before) {
        expect(
          HOOK_POSITIONS[name].positions.some(
            (p) => p.kind === "block" && p.block === block.id && p.side === "before",
          ),
        ).toBe(true);
      }
      for (const name of block.hooks.after) {
        expect(
          HOOK_POSITIONS[name].positions.some(
            (p) => p.kind === "block" && p.block === block.id && p.side === "after",
          ),
        ).toBe(true);
      }
    }
  });

  test("the guarantees are the spec's list, six blocks with 14 in all", () => {
    const counts = BLOCK_MODEL.blocks.map((block) => [block.id, block.guarantees.length]);
    expect(counts).toEqual([
      ["context", 2],
      ["model", 3],
      ["tools", 5],
      ["ask", 2],
      ["agents", 1],
      ["record", 1],
    ]);
    const ids = BLOCK_MODEL.blocks.flatMap((block) => block.guarantees.map((g) => g.id));
    expect(new Set(ids).size).toBe(14);
  });

  test("every label has a Korean and an English text", () => {
    const labels = [
      ...BLOCK_MODEL.blocks.map((block) => block.label),
      ...BLOCK_MODEL.boundaries.map((boundary) => boundary.label),
      ...BLOCK_MODEL.blocks.flatMap((block) => block.guarantees.map((g) => g.text)),
    ];
    for (const label of labels) {
      expect(label.ko.length).toBeGreaterThan(0);
      expect(label.en.length).toBeGreaterThan(0);
    }
  });

  test("no setting scope is thread, and each key's owner follows its prefix", () => {
    const refs = BLOCK_MODEL.blocks.flatMap((block) => block.settings);
    const scopes: readonly string[] = refs.flatMap((ref) => ref.scope);
    expect(scopes.filter((scope) => scope === "thread")).toEqual([]);
    const ownerRule: Record<string, string> = {
      l0: "platform-",
      l1: "core-",
      l2: "cap-",
      x: "ext-host",
    };
    const misplaced = refs.filter((ref) => {
      const prefix = ref.key.split(".")[0] ?? "";
      const expected = ownerRule[prefix];
      if (expected === undefined) return true;
      return expected === "ext-host" ? ref.owner !== expected : !ref.owner.startsWith(expected);
    });
    expect(misplaced).toEqual([]);
  });

  test("the reused summary routing key appears under both context and model", () => {
    expect([keyIn("context"), keyIn("model")]).toEqual([true, true]);
  });

  test("the summarizer and the five builtin tools are the replaceable parts, cap-workspace by default", () => {
    expect(blockOf("context").parts.map((part) => part.id)).toEqual(["summarizer"]);
    expect(blockOf("tools").parts.map((part) => [part.id, part.how, part.default])).toEqual([
      ["tool:read", "replaces", "cap-workspace"],
      ["tool:write", "replaces", "cap-workspace"],
      ["tool:edit", "replaces", "cap-workspace"],
      ["tool:grep", "replaces", "cap-workspace"],
      ["tool:bash", "replaces", "cap-workspace"],
      ["web-search-provider", "provider", "cap-web"],
    ]);
  });
});
