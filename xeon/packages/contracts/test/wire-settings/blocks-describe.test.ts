import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { BLOCK_MODEL } from "../../src/blocks/index.ts";
import { WIRE_METHODS, classifyMethodName } from "../../src/wire-settings/wire/index.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

describe("blocks.describe wire method", () => {
  const spec = WIRE_METHODS["blocks.describe"];

  test("it is an M4 core method next to hooks.order.*, with no params", () => {
    expect(classifyMethodName("blocks.describe")).toBe("core");
    expect(spec.stage).toBe("M4");
    expect(spec.status).toBe("active");
    expect(parse(spec.params, {}).ok).toBe(true);
    expect(parse(spec.params, { _meta: {} }).ok).toBe(true);
    expect(parse(spec.params, { threadId: "t" }).ok).toBe(false);
  });

  test("the result is the block model and round-trips unchanged", () => {
    roundTrip(spec.result, BLOCK_MODEL);
  });

  test("the result refuses a wrong version, an extra field, a missing record list, and a bad position kind", () => {
    const wrongVersion = { ...BLOCK_MODEL, version: 2 };
    const extra = { ...BLOCK_MODEL, note: "x" };
    // record의 before 목록을 빼면 생략이 아니라 빈 배열이어야 하므로 거절한다
    const noRecordBefore = {
      ...BLOCK_MODEL,
      blocks: BLOCK_MODEL.blocks.map((block) =>
        block.id === "record"
          ? { ...block, hooks: { after: block.hooks.after, events: block.hooks.events } }
          : block,
      ),
    };
    const badKind = {
      ...BLOCK_MODEL,
      positions: [{ ...BLOCK_MODEL.positions[0], positions: [{ kind: "tap" }] }],
    };
    expect([
      parse(spec.result, wrongVersion).ok,
      parse(spec.result, extra).ok,
      parse(spec.result, noRecordBefore).ok,
      parse(spec.result, badKind).ok,
    ]).toEqual([false, false, false, false]);
  });
});
