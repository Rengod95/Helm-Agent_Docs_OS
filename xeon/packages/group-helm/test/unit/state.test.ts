import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import {
  HELM_STATE_BUDGET_BYTES,
  HelmStateSchema,
  INITIAL_HELM_STATE,
  fitState,
  helmStateDecl,
  updateState,
  type HelmFinding,
  type HelmState,
} from "../../src/state.ts";
import { fakeStateApi } from "../support/state-api.ts";

const bytes = (state: HelmState): number => new TextEncoder().encode(JSON.stringify(state)).length;

function finding(index: number, confidence: "low" | "medium" | "high"): HelmFinding {
  return {
    id: `analogy-${String(index)}`,
    lensId: "analogy",
    claim: "가".repeat(1000),
    sources: Array.from({ length: 4 }, () => ({
      origin: "web" as const,
      ref: `https://example.test/${"나".repeat(400)}`,
      title: "다".repeat(80),
    })),
    confidence,
  };
}

function worstCase(): HelmState {
  return {
    ...INITIAL_HELM_STATE,
    phase: "converge",
    inquiryId: "habcdefghijklm",
    topic: "가".repeat(500),
    lenses: Array.from({ length: 8 }, (_, index) => ({
      id: `lens-${String(index)}`,
      title: "라".repeat(120),
      status: "done" as const,
    })),
    findings: Array.from({ length: 24 }, (_, index) =>
      finding(index + 1, index % 3 === 0 ? "low" : index % 3 === 1 ? "medium" : "high"),
    ),
    round: 1,
    context: Array.from({ length: 8 }, () => ({
      origin: "knowledge" as const,
      ref: "마".repeat(512),
      title: "바".repeat(80),
    })),
  };
}

test("state.initial-valid", () => {
  expect(parse(HelmStateSchema, INITIAL_HELM_STATE).ok).toBe(true);
  expect(helmStateDecl.version).toBe(1);
  expect(helmStateDecl.initial).toBe(INITIAL_HELM_STATE);
});

test("state.worst-case-fits-64kib", () => {
  const input = worstCase();
  expect(parse(HelmStateSchema, input).ok).toBe(true);
  expect(bytes(input)).toBeGreaterThan(HELM_STATE_BUDGET_BYTES);
  const fitted = fitState(input);
  expect(bytes(fitted.state)).toBeLessThanOrEqual(HELM_STATE_BUDGET_BYTES);
  expect(parse(HelmStateSchema, fitted.state).ok).toBe(true);
  expect(fitState(input)).toEqual(fitted);
  // 줄이는 순서: context가 먼저, 다음 sources, 마지막 발견. 낮은 신뢰의 뒤쪽 발견부터 줄어든다
  expect(fitted.dropped.context).toBe(8);
  expect(fitted.dropped.findings).toBeGreaterThan(0);
  const survivors = fitted.state.findings.map((found) => found.confidence);
  expect(survivors.filter((value) => value === "high").length).toBeGreaterThanOrEqual(
    survivors.filter((value) => value === "low").length,
  );
  const small = { ...INITIAL_HELM_STATE, topic: "작은 상태" };
  expect(fitState(small).state).toBe(small);
  expect(fitState(small).dropped).toEqual({ context: 0, sources: 0, findings: 0 });
});

test("state.update-serializes-concurrent-commits", async () => {
  const api = fakeStateApi(INITIAL_HELM_STATE, { delay: true });
  const [first, second] = await Promise.all([
    updateState(api, (current) => ({ ...current, round: current.round + 1 })),
    updateState(api, (current) => ({ ...current, topic: "t", round: current.round + 10 })),
  ]);
  expect(first.ok && second.ok).toBe(true);
  expect(api.state().round).toBe(11);
  expect(api.state().topic).toBe("t");
  expect(api.commits).toHaveLength(2);
});

test("failures.state-conflict-retries-once", async () => {
  const once = fakeStateApi(INITIAL_HELM_STATE, { conflicts: 1 });
  const retried = await updateState(once, (current) => ({ ...current, round: 5 }));
  expect(retried).toEqual({ ok: true, value: { ...INITIAL_HELM_STATE, round: 5 } });
  const twice = fakeStateApi(INITIAL_HELM_STATE, { conflicts: 2 });
  const refused = await updateState(twice, (current) => ({ ...current, round: 5 }));
  expect(refused).toEqual({ ok: false, error: { kind: "state_conflict" } });
  expect(twice.state()).toBe(INITIAL_HELM_STATE);
});

test("updateState returns a state inside the budget even when the update is too large", async () => {
  const api = fakeStateApi();
  const big = worstCase();
  const result = await updateState(api, () => big);
  expect(result.ok).toBe(true);
  expect(bytes(api.state())).toBeLessThanOrEqual(HELM_STATE_BUDGET_BYTES);
});
