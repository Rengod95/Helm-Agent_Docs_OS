import { describe, expect, test } from "bun:test";
import type { ApprovalEvidence, KnowledgeActor } from "@xeon/contracts/capabilities";
import { decideGate, isEvidenceValid, type GateInput } from "../src/approval/gate.ts";

type Action = "apply:user" | "apply:evidence" | "apply:policy" | "apply:approval" | "ask" | "queue";

const MAIN: KnowledgeActor = { kind: "agent", sessionId: "thr", agent: "main" };
const SUB: KnowledgeActor = { kind: "agent", sessionId: "thr", agent: "subagent" };
const BACKGROUND: KnowledgeActor = { kind: "agent", sessionId: "thr", agent: "background" };
const EXTENSION: KnowledgeActor = { kind: "extension", extension: "test-group" };

function actionOf(input: GateInput): Action {
  const decision = decideGate(input);
  return decision.action === "apply" ? `apply:${decision.approvedBy}` : decision.action;
}

function gate(
  actor: GateInput["actor"],
  destructive: boolean,
  approvalRequired: boolean,
  extra: Partial<GateInput> = {},
): Action {
  return actionOf({
    actor,
    hasSession: true,
    destructive,
    approvalRequired,
    evidenceValid: false,
    afterUntrusted: false,
    ...extra,
  });
}

describe("write gate table (L2.knowledge.spec §4.5.1)", () => {
  test("gate table", () => {
    // [이름, 행위자, 파괴적, 설정 켬 결과, 설정 끔 결과, 추가 입력]
    const rows: readonly (readonly [
      string,
      GateInput["actor"],
      boolean,
      Action,
      Action,
      Partial<GateInput>?,
    ])[] = [
      ["user create", { kind: "user" }, false, "apply:user", "apply:user"],
      ["user destructive", { kind: "user" }, true, "apply:user", "apply:user"],
      [
        "extension + evidence",
        EXTENSION,
        true,
        "apply:evidence",
        "apply:evidence",
        { evidenceValid: true },
      ],
      ["extension no evidence, session, create", EXTENSION, false, "ask", "apply:policy"],
      ["extension no evidence, session, destructive", EXTENSION, true, "ask", "ask"],
      [
        "extension no evidence, no session, create",
        EXTENSION,
        false,
        "queue",
        "apply:policy",
        { hasSession: false },
      ],
      [
        "extension no evidence, no session, destructive",
        EXTENSION,
        true,
        "queue",
        "queue",
        { hasSession: false },
      ],
      ["main create", MAIN, false, "ask", "apply:policy"],
      ["main destructive", MAIN, true, "ask", "ask"],
      ["subagent create", SUB, false, "queue", "apply:policy"],
      ["subagent destructive", SUB, true, "queue", "queue"],
      ["background create", BACKGROUND, false, "queue", "apply:policy"],
      ["background destructive", BACKGROUND, true, "queue", "queue"],
    ];
    for (const [name, actor, destructive, whenOn, whenOff, extra] of rows) {
      expect({ name, action: gate(actor, destructive, true, extra) }).toEqual({
        name,
        action: whenOn,
      });
      expect({ name, action: gate(actor, destructive, false, extra) }).toEqual({
        name,
        action: whenOff,
      });
    }
  });

  test("a main agent with no session queues instead of asking", () => {
    expect(gate(MAIN, false, true, { hasSession: false })).toBe("queue");
  });

  test("after untrusted forces approval for agents even when the setting is off", () => {
    expect(gate(MAIN, false, false, { afterUntrusted: true })).toBe("ask");
    expect(gate(SUB, false, false, { afterUntrusted: true })).toBe("queue");
    expect(gate(BACKGROUND, false, false, { afterUntrusted: true })).toBe("queue");
    // 사용자와 확장 증거는 영향이 없다
    expect(gate({ kind: "user" }, false, false, { afterUntrusted: true })).toBe("apply:user");
  });
});

const evidence = (source: string): ApprovalEvidence => ({ source, ref: "p1:1", decidedAt: 1 });

describe("evidence validity", () => {
  test("evidence validity", () => {
    const trusted = ["test-group.queue"];
    // 신뢰 목록에 있고 첫 마디가 호출 확장 이름과 같으면 유효하다
    expect(isEvidenceValid(evidence("test-group.queue"), EXTENSION, trusted)).toBe(true);
    // 다른 확장이 같은 source를 쓰면 무효다
    expect(
      isEvidenceValid(
        evidence("test-group.queue"),
        { kind: "extension", extension: "other" },
        trusted,
      ),
    ).toBe(false);
    // 신뢰 목록에 없으면 무효다. 기본값 []에서는 모두 무효다
    expect(isEvidenceValid(evidence("test-group.other"), EXTENSION, trusted)).toBe(false);
    expect(isEvidenceValid(evidence("test-group.queue"), EXTENSION, [])).toBe(false);
    // 확장이 아닌 행위자나 증거가 없는 호출은 무효다
    expect(isEvidenceValid(evidence("test-group.queue"), MAIN, trusted)).toBe(false);
    expect(isEvidenceValid(undefined, EXTENSION, trusted)).toBe(false);
  });
});
