import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { t } from "@xeon/core-models/testing";
import type { JsonObject } from "@xeon/contracts/conversation";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, modelsOf, type RealCli, type TapeStep } from "./support/real-host.ts";
import { waitFor } from "./support/harness.ts";
import { scriptedInput } from "./support/script.ts";

// B2-ART (실제 호스트): 모델이 a.txt를 고치고 review_request로 검토를 연다. 검토 카드에서 hunk f0h0을 거절하면 파일이
// 원래 내용으로 되돌아간다. 도구 승인(edit)은 y로 허용하고, 검토 카드는 r → f0h0으로 답한다.
// 답 모양과 입력 재질문은 가짜 호스트 시험(chat-approval.test.ts)이 맡는다. 여기서는 실제 호스트가 카드와 되돌림을 낸다는 것만 본다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;
const ORIGINAL = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n") + "\n";
const REVIEW_PROMPT = "[y] 모두 승인  [r] 일부 거절  [c] 수정 요청  [n] 모두 거절 > ";

function toolCall(label: string, name: string, args: JsonObject, id: string): TapeStep {
  return {
    role: "main",
    label,
    response: { type: "message", content: [t.toolCall(name, args, id)], stopReason: "toolUse" },
  };
}

function say(label: string, text: string): TapeStep {
  return {
    role: "main",
    label,
    response: { type: "message", content: [t.text(text)], stopReason: "stop" },
  };
}

test("rejecting one hunk on the review card reverts the file, and the card lists the file change", async () => {
  const input = scriptedInput(["a.txt를 고쳐 줘", "y", "r", "f0h0", "/quit"]);
  const cli = createRealCli({
    models: modelsOf("review-card-host", [
      toolCall(
        "edit",
        "edit",
        { path: "a.txt", edits: [{ oldText: "four\n", newText: "FOUR\n" }] },
        "call_1",
      ),
      toolCall("open review", "review_request", {}, "call_2"),
      say("closing", "done."),
    ]),
    files: { "a.txt": ORIGINAL },
    settings: { "l0.sandbox.enabled": false },
    harness: { terminal: TTY, readLine: (prompt, signal) => input.readLine(prompt, signal) },
  });
  clis.push(cli);

  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);

  // 카드는 편집이 만든 변경을 요약 한 줄로 보인다. 편집이 일어나지 않았다면 이 줄이 없다
  expect(cli.harness.stderrText()).toContain("modified a.txt (hunk 1)");
  expect(input.prompts).toContain(REVIEW_PROMPT);
  expect(input.prompts).toContain("거절할 hunk (쉼표로 구분, 예 f0h1,f1h0 / all = 전부) > ");
  expect(cli.sent("approval.respond")).toEqual([
    {
      method: "approval.respond",
      params: { approvalId: expect.stringMatching(/^evt_/), decision: "allow", remember: "once" },
    },
    {
      method: "approval.respond",
      params: {
        approvalId: expect.stringMatching(/^evt_/),
        decision: "answer",
        answer: {
          decisions: [{ hunkId: "f0h0", decision: "rejected" }],
          comments: [],
          submit: true,
          approveRemaining: true,
        },
      },
    },
  ]);
  expect(cli.harness.stdoutText()).toContain("done.");

  // 되돌림은 응답 뒤에 파일에 반영된다. 원래 내용이 될 때까지 기다린 뒤 확인한다
  const file = join(cli.home.work, "a.txt");
  await waitFor(() => readFileSync(file, "utf8") === ORIGINAL, 5_000);
  expect(readFileSync(file, "utf8")).toBe(ORIGINAL);
}, 90_000);
