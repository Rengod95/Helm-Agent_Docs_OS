import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import type { CallerInfo } from "../../src/capabilities/index.ts";
import { APPROVAL_CALLER_PATTERN, ApprovalOriginJsonSchema } from "../../src/records/index.ts";
import { approvalCallerOf, type ApprovalCaller } from "../../src/services/index.ts";
import { rawId } from "../helpers/ids.ts";

// F.records.spec ApprovalOriginJson 공급 규칙: 승인 origin의 caller는 approvalCallerOf 하나가 만든다 [결정: m2c G1-09].

const ORIGIN = {
  threadId: rawId("thr", 1),
  turnId: rawId("trn", 1),
  stepId: null,
  toolCallId: "call-1",
};

describe("approvalCallerOf", () => {
  const cases: readonly (readonly [string, CallerInfo, ApprovalCaller])[] = [
    ["main conversation", { kind: "model", agent: "main" }, "main"],
    ["model without an agent field is the main conversation", { kind: "model" }, "main"],
    [
      "subagent carries its definition name",
      { kind: "model", agent: "subagent", agentName: "explore" },
      "subagent:explore",
    ],
    ["subagent without a name", { kind: "model", agent: "subagent" }, "subagent:unknown"],
    ["background fork", { kind: "model", agent: "background" }, "background"],
    ["extension code", { kind: "extension", extension: "grp-helm" }, "ext:grp-helm"],
    ["extension without a name", { kind: "extension" }, "ext:unknown"],
    ["host call", { kind: "host" }, "host"],
  ];

  for (const [label, caller, expected] of cases) {
    test(label, () => {
      expect(approvalCallerOf(caller)).toBe(expected);
    });
  }

  test("the extension field never names a subagent, and agentName never names an extension", () => {
    // 1647cdd는 extension 한 칸에 서브에이전트 이름을 실었다. 이제 두 뜻이 섞이지 않는다
    expect(approvalCallerOf({ kind: "model", agent: "subagent", extension: "grp-helm" })).toBe(
      "subagent:unknown",
    );
    expect(
      approvalCallerOf({ kind: "extension", extension: "grp-helm", agentName: "explore" }),
    ).toBe("ext:grp-helm");
  });

  test("every result is a value the origin record accepts", () => {
    for (const [, caller] of cases) {
      const value = approvalCallerOf(caller);
      expect({
        value,
        ok: parse(ApprovalOriginJsonSchema, { ...ORIGIN, caller: value }).ok,
      }).toEqual({ value, ok: true });
    }
  });
});

describe("origin.caller format", () => {
  test("accepts the five forms and rejects anything else", () => {
    const pattern = new RegExp(APPROVAL_CALLER_PATTERN);
    for (const ok of ["main", "background", "host", "subagent:review", "ext:grp-helm"]) {
      expect({ ok, matches: pattern.test(ok) }).toEqual({ ok, matches: true });
    }
    for (const bad of ["model:main", "subagent:", "ext:", "Main", "robot", "subagent", ""]) {
      expect({ bad, matches: pattern.test(bad) }).toEqual({ bad, matches: false });
    }
    expect(parse(ApprovalOriginJsonSchema, { ...ORIGIN, caller: "model:main" }).ok).toBe(false);
  });
});
