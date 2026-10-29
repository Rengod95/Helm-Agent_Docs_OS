import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { checkGroup } from "@xeon/group-kit/testing";
import group from "../src/index.ts";
import { initialState, stateSchema } from "../src/state.ts";

test("__ID__.initial-state-matches-its-schema", () => {
  expect(parse(stateSchema, initialState)).toEqual({ ok: true, value: { count: 0 } });
});

test("__ID__.setup-declares-every-point-and-effect", async () => {
  const errors = (await checkGroup(group)).filter((found) => found.severity === "error");
  expect(errors).toEqual([]);
});
