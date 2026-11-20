import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { checkOrchestration } from "@fresnel/group-sdk/testing";
import group from "../src/index.ts";
import { initialState, stateSchema } from "../src/state.ts";

test("__ID__.initial-state-matches-its-schema", () => {
  expect(parse(stateSchema, initialState)).toEqual({
    ok: true,
    value: { phase: "run", round: 0 },
  });
});

test("__ID__.setup-declares-every-point-and-effect", async () => {
  const errors = (await checkOrchestration(group)).filter((found) => found.severity === "error");
  expect(errors).toEqual([]);
});
