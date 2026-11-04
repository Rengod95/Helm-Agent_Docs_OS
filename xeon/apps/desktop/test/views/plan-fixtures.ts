import { Bug, parse } from "@fresnel/contracts";
import { PlanVersionsOutput } from "@fresnel/contracts/capabilities";
import type { PlanVersionWire } from "../../src/views/pages/work/work-model.ts";

// 계획 판 시험의 값. 계획 id는 브랜드 값이라 `PlanVersionsOutput` 스키마로 만든다(as 없이).

type Status = PlanVersionWire["status"];

export interface VersionOverrides {
  readonly title?: string;
  readonly body?: string;
  readonly status?: Status;
  readonly feedback?: string | null;
}

/** 계획 p1의 판 하나. 제목과 본문은 번호로 정해진다 */
export function version(n: number, overrides: VersionOverrides = {}): PlanVersionWire {
  const parsed = parse(PlanVersionsOutput, {
    versions: [
      {
        planId: "p1",
        version: n,
        title: overrides.title ?? `계획 ${String(n)}`,
        body: overrides.body ?? `본문 ${String(n)}`,
        status: overrides.status ?? "submitted",
        artifact: null,
        approvalId: null,
        feedback: overrides.feedback ?? null,
      },
    ],
  });
  if (!parsed.ok) throw new Bug("the plan version fixture does not match its schema");
  const first = parsed.value.versions[0];
  if (first === undefined) throw new Bug("the plan version fixture is empty");
  return first;
}

/** 번호 1부터 `count`개의 판 */
export function versionsUpTo(count: number): readonly PlanVersionWire[] {
  return Array.from({ length: count }, (_, index) => version(index + 1));
}
