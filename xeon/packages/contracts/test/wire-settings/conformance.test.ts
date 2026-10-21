import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  WIRE_CONFORMANCE_CASES,
  WIRE_METHODS,
  classifyMethodName,
  type ConformanceStep,
} from "../../src/wire-settings/wire/index.ts";
import { createFakeHost } from "./fake-host.ts";
import { runConformanceCase } from "./conformance-runner.ts";

const SPEC_ACCEPTANCE_IDS = new Set(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);

function requestSteps(): Extract<ConformanceStep, { type: "request" }>[] {
  return WIRE_CONFORMANCE_CASES.flatMap((c) => c.steps).filter(
    (step): step is Extract<ConformanceStep, { type: "request" }> => step.type === "request",
  );
}

describe("WIRE_CONFORMANCE_CASES data", () => {
  test("ids are unique and every case has steps", () => {
    const ids = WIRE_CONFORMANCE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of WIRE_CONFORMANCE_CASES) expect(c.steps.length).toBeGreaterThan(0);
  });

  test("covers only cite acceptance criteria of the spec", () => {
    for (const c of WIRE_CONFORMANCE_CASES) {
      for (const id of c.covers) expect(SPEC_ACCEPTANCE_IDS.has(id)).toBe(true);
    }
    const covered = new Set(WIRE_CONFORMANCE_CASES.flatMap((c) => c.covers));
    for (const id of ["A1", "A2", "A3", "A4", "A5", "A7"]) expect(covered.has(id)).toBe(true);
  });

  test("every M1 method and every M1 notification shows up in a case", () => {
    const methods = new Set(requestSteps().map((s) => s.method));
    for (const [name, spec] of Object.entries(WIRE_METHODS)) {
      if (spec.stage === "M1")
        expect({ name, used: methods.has(name) }).toEqual({ name, used: true });
    }
    const notifies = WIRE_CONFORMANCE_CASES.flatMap((c) => c.steps).filter(
      (s) => s.type === "notify",
    );
    expect(notifies.some((s) => s.method === "$/cancelRequest")).toBe(true);
    expect(
      WIRE_CONFORMANCE_CASES.flatMap((c) => c.steps).some((s) => s.type === "expectBatches"),
    ).toBe(true);
  });

  test("requests use valid method names and ids", () => {
    for (const step of requestSteps()) {
      expect(classifyMethodName(step.method)).toBeDefined();
      expect(step.id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    }
  });

  test("successful requests of registered methods carry valid params", () => {
    for (const step of requestSteps()) {
      const spec = Object.entries(WIRE_METHODS).find(([name]) => name === step.method)?.[1];
      if (spec === undefined || step.expect.outcome !== "result") continue;
      // 앞 단계 값을 받는 params는 실행기가 채운 뒤 검사한다(runner가 결과 스키마와 함께 확인한다)
      if (JSON.stringify(step.params).includes('"$capture"')) continue;
      expect({ id: step.id, method: step.method, ok: parse(spec.params, step.params).ok }).toEqual({
        id: step.id,
        method: step.method,
        ok: true,
      });
    }
  });

  test("error expectations name a known kind and code", () => {
    for (const step of requestSteps()) {
      if (step.expect.outcome === "error") {
        expect(step.expect.kind.length).toBeGreaterThan(0);
        expect(Number.isInteger(step.expect.code)).toBe(true);
      }
    }
  });
});

describe("conformance runner against the in-memory fake host", () => {
  test.each(WIRE_CONFORMANCE_CASES.map((c) => [c.id, c] as const))("%s", async (_id, testCase) => {
    const failure = await runConformanceCase(testCase, createFakeHost(), { timeoutMs: 500 });
    expect(failure).toBeUndefined();
  });

  test("the runner reports the failing step", async () => {
    const wrong = {
      id: "wrong",
      title: "expects the wrong error",
      covers: [],
      steps: [
        {
          type: "request",
          id: "r1",
          method: "turn.start",
          params: { threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV", input: "hi" },
          expect: { outcome: "error", code: 9999, kind: "nothing" },
        },
      ],
    } as const;
    const failure = await runConformanceCase(wrong, createFakeHost(), { timeoutMs: 500 });
    expect(failure?.caseId).toBe("wrong");
    expect(failure?.step).toBe(0);
    expect(failure?.message).toContain("1001");
  });

  test("the runner detects a missing capture", async () => {
    const broken = {
      id: "broken",
      title: "uses a capture that was never set",
      covers: [],
      steps: [
        {
          type: "request",
          id: "r1",
          method: "events.subscribe",
          params: { from: { storeId: { $capture: "never" }, seq: 0 } },
          expect: { outcome: "result" },
        },
      ],
    } as const;
    const failure = await runConformanceCase(broken, createFakeHost(), { timeoutMs: 500 });
    expect(failure?.message).toContain("never");
  });
});
