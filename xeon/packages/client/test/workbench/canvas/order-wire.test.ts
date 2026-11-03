import { describe, expect, test } from "bun:test";
import { HOOK_ORDER_METHODS } from "../../../src/workbench/canvas/order-wire.ts";

describe("HOOK_ORDER_METHODS", () => {
  test("wire 메서드 이름 넷", () => {
    expect(HOOK_ORDER_METHODS).toEqual({
      get: "hooks.order.get",
      set: "hooks.order.set",
      reset: "hooks.order.reset",
      preview: "hooks.order.preview",
    });
  });
});
