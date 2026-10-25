import { expect, test } from "bun:test";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  SECRET_REF,
  SECRET_TOOL,
  SECRET_VALUE,
  startSecretEnvScenario,
} from "../fixtures/secret-env.ts";

// U-19 종단 시험 (M2, 통합 검토): bash 호출이 `secretEnv`로 비밀을 쓰면, 사용자의 승인이 비밀 사용의 증거가 되어 lease까지 이어지고
// 감사 기록 `secret.approved`에 그 승인의 id가 남는다. 패키지별 시험은 모두 가짜 위에서 이 사슬을 나눠 보았다. 여기서는 한 엔진에서 잇는다:
// 모델 테이프 -> L1.tools 승인 요청 -> wire approval.respond -> cap-workspace 셸 -> platform-exec withEnv -> platform-secrets lease.
// 비밀 서비스만 `AssembleOptions.secretsRuntime`으로 메모리 대역(sops 제공자 없음)이고, 정책 판정과 감사 기록은 운영 구현이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "the user's approval of the tool call is the per-use evidence: respond, run with the secret in env, secret.approved audit record",
  async () => {
    const scenario = await startSecretEnvScenario();
    try {
      // 승인 카드가 보이는 제목에 비밀 참조가 있다: 사용자는 무엇을 내주는지 알고 허용한다
      const payload = scenario.asked.payload;
      expect(payload).toMatchObject({
        title: `Allow "${SECRET_TOOL}" to use ${SECRET_REF}?`,
        body: { kind: "tool", tool: { toolName: SECRET_TOOL, ruleId: "u.bash-env" } },
      });

      // 승인 전에는 명령이 돌지 않고 감사 기록도 없다
      expect(scenario.auditRecords().filter((record) => record.type === "secret.approved")).toEqual(
        [],
      );
      expect(scenario.texts()).not.toContain("secret-env-present");

      expect(await scenario.allow()).toEqual({ applied: true });

      expect(scenario.texts()).toContain("secret-env-present");
      const approved = scenario
        .auditRecords()
        .filter((record) => record.type === "secret.approved");
      expect(approved).toEqual([
        {
          type: "secret.approved",
          handle: SECRET_REF,
          scope: "per-use",
          approvalId: scenario.asked.id,
          expiresAt: null,
          threadId: scenario.threadId,
          at: expect.any(Number),
        },
      ]);

      // 값은 와이어 이벤트 어디에도 나오지 않는다
      expect(JSON.stringify(scenario.collector.events)).not.toContain(SECRET_VALUE);
    } finally {
      await scenario.close();
    }
  },
  60_000,
);

realTest(
  "when a rule already allows bash, the secret use is asked on its own and that approval is the evidence",
  async () => {
    const scenario = await startSecretEnvScenario({ allowBashByRule: true });
    try {
      expect(scenario.asked.payload).toMatchObject({
        title: `Allow "${SECRET_TOOL}" to use ${SECRET_REF}?`,
        body: { kind: "tool", tool: { toolName: SECRET_TOOL, ruleId: "secret.use" } },
        remember: ["once"],
      });
      expect(await scenario.allow()).toEqual({ applied: true });
      expect(scenario.texts()).toContain("secret-env-present");
      const approved = scenario
        .auditRecords()
        .filter((record) => record.type === "secret.approved");
      expect(approved).toHaveLength(1);
      expect(approved[0]).toMatchObject({ approvalId: scenario.asked.id, scope: "per-use" });
      expect(JSON.stringify(scenario.collector.events)).not.toContain(SECRET_VALUE);
    } finally {
      await scenario.close();
    }
  },
  60_000,
);

realTest(
  "a denied approval never leases the secret: no secret.approved record and the command does not run",
  async () => {
    const scenario = await startSecretEnvScenario();
    try {
      const answered = await scenario.connection.request("approval.respond", {
        approvalId: scenario.asked.id,
        decision: "deny",
      });
      expect(answered).toEqual({ applied: true });
      await scenario.collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === scenario.turnId,
      );
      expect(scenario.auditRecords().filter((record) => record.type === "secret.approved")).toEqual(
        [],
      );
      expect(scenario.texts()).not.toContain("secret-env-present");
    } finally {
      await scenario.close();
    }
  },
  60_000,
);

realTest(
  "approval.respond says why a response was not applied: wrong shape is answer_invalid and the request stays open, a repeat is already_resolved",
  async () => {
    const scenario = await startSecretEnvScenario();
    try {
      const wrong = await scenario.connection.request("approval.respond", {
        approvalId: scenario.asked.id,
        decision: "answer",
        answer: { q1: { selected: ["a"] } },
      });
      expect(wrong).toMatchObject({ applied: false, reason: "answer_invalid" });
      // 요청은 대기 그대로여서 올바른 응답이 적용된다
      expect(await scenario.allow()).toEqual({ applied: true });
      const again = await scenario.connection.request("approval.respond", {
        approvalId: scenario.asked.id,
        decision: "allow",
      });
      expect(again).toEqual({ applied: false, reason: "already_resolved" });
    } finally {
      await scenario.close();
    }
  },
  60_000,
);
