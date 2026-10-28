import { afterEach, expect, test } from "bun:test";
import { t } from "@xeon/core-models/testing";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, modelsOf, type RealCli, type TapeStep } from "./support/real-host.ts";
import { scriptedInput } from "./support/script.ts";

// G2-10: 실제 호스트 위의 승인 카드와 응답. test/approval-consent.test.ts와 test/chat-approval.test.ts의 가짜 호스트 사례 가운데
// 실제 도구 승인(bash)으로 만들 수 있는 것을 같은 값으로 다시 확인한다: 명령 전체 표시, 기억 범위, 거부 이유, print 모드의 자동 거부.
// secretEnv 카드와 answer_invalid·commit_failed 재질문은 운영 도구가 모델에 내지 않거나 호스트가 만들기 어려워 가짜 호스트 시험이 맡는다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;
const LONG = `echo ${"abcdefghij".repeat(20)} && echo whole-command-ran`;

function bashCall(command: string, id: string): TapeStep {
  return {
    role: "main",
    label: `bash ${id}`,
    response: {
      type: "message",
      content: [t.toolCall("bash", { command }, id)],
      stopReason: "toolUse",
    },
  };
}

function say(text: string): TapeStep {
  return {
    role: "main",
    label: "final answer",
    response: { type: "message", content: [t.text(text)], stopReason: "stop" },
  };
}

function start(steps: readonly TapeStep[], lines: readonly string[]) {
  const input = scriptedInput([...lines, "/quit"]);
  const cli = createRealCli({
    models: modelsOf("approval-consent-host", steps),
    harness: { terminal: TTY, readLine: (prompt, signal) => input.readLine(prompt, signal) },
  });
  clis.push(cli);
  return { cli, prompts: input.prompts };
}

test("the card shows the whole command, and t remembers it for the session so the next call is not asked", async () => {
  const { cli, prompts } = start(
    [bashCall(LONG, "call_1"), bashCall("echo second-call", "call_2"), say("끝났다")],
    ["실행해 줘", "t"],
  );
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  // 인자 줄은 120자에서 잘리지만 명령 줄은 전체다
  expect(cli.harness.stderrText()).toContain(`  명령:\n    ${LONG}\n`);
  expect(cli.sent("approval.respond")).toEqual([
    {
      method: "approval.respond",
      params: { approvalId: expect.stringMatching(/^evt_/), decision: "allow", remember: "thread" },
    },
  ]);
  // 두 번째 호출은 이 세션 동안 허용으로 기억되어 묻지 않고 실행된다
  expect(prompts.filter((prompt) => prompt.includes("[y] 이번만 허용"))).toHaveLength(1);
  const out = cli.harness.stdoutText();
  expect(out).toContain("whole-command-ran");
  expect(out).toContain("second-call");
  expect(out).toContain("끝났다");
  // 요청이 낮춰지지 않았으니 낮춤 알림은 없다
  expect(`${out}${cli.harness.stderrText()}`).not.toContain("낮춰 적용했다");
}, 90_000);

test("n with a reason sends the reason as the deny answer and the model sees the refusal", async () => {
  const { cli } = start(
    [bashCall(LONG, "call_1"), say("거부를 알았다")],
    ["실행해 줘", "n", "위험해 보인다"],
  );
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.sent("approval.respond")).toEqual([
    {
      method: "approval.respond",
      params: {
        approvalId: expect.stringMatching(/^evt_/),
        decision: "deny",
        answer: { feedback: "위험해 보인다" },
      },
    },
  ]);
  const out = cli.harness.stdoutText();
  expect(out).not.toContain("whole-command-ran");
  expect(out).toContain("거부를 알았다");
}, 90_000);

test("print mode answers the approval with deny, says so, and the command never runs", async () => {
  const cli = createRealCli({
    models: modelsOf("approval-consent-print", [bashCall(LONG, "call_1"), say("거부됐다")]),
  });
  clis.push(cli);
  expect(await cli.harness.run(["chat", "-p", "실행해 줘"])).toBe(EXIT.ok);
  expect(cli.sent("approval.respond")).toEqual([
    {
      method: "approval.respond",
      params: { approvalId: expect.stringMatching(/^evt_/), decision: "deny" },
    },
  ]);
  expect(cli.harness.stderrText()).toContain("비대화 모드라 거부로 답했다");
  expect(cli.harness.stderrText()).not.toContain("적용되지 않았다");
  expect(cli.harness.stdoutText()).not.toContain("whole-command-ran");
}, 90_000);
