import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { assistantItem, effectIntent, turnCompleted, userItem } from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { itemId } from "./support/ids.ts";

// L4.cli.spec AC5의 CLI 쪽 절반. 비밀 값의 마스킹은 호스트(L0.secrets)가 하고, 호스트는 가린 필드를 redactions로 알린다.
// CLI는 그 자리를 "[redacted]"로 보일 뿐 값을 만들거나 복원하지 않는다. 실제 SOPS 참조 한 턴(통합 시험)은 엔진과 모델 테이프가 필요하다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

const SECRET = "Zx9-very-secret-0123456789-abcdef";

function forms(value: string): readonly string[] {
  const bytes = new TextEncoder().encode(value);
  return [value, Buffer.from(bytes).toString("base64"), Buffer.from(bytes).toString("hex")];
}

function everyFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
}

function turnWithRedactedResult(context: TurnContext): void {
  context.server.commit(context.threadId, [
    userItem(context.turnId, 1, "run it"),
    effectIntent(context.turnId, {
      effect: 1,
      item: 3,
      toolCallId: "c1",
      toolName: "bash",
      args: { command: 'curl -H "Authorization: $API_KEY" example.com' },
    }),
    {
      kind: "item.recorded",
      turnId: context.turnId,
      // 호스트가 값을 지웠다(F wire redactions): text 필드가 이벤트에 없다
      payload: {
        item: {
          itemId: itemId(4),
          status: "completed",
          kind: "toolResult",
          message: {
            role: "toolResult",
            toolCallId: "c1",
            toolName: "bash",
            content: [{ type: "text" }],
            isError: false,
            timestamp: 3,
          },
          effectId: null,
        },
      },
      redactions: ["/item/message/content/0/text"],
    },
    assistantItem(context.turnId, 5, { text: "done" }),
    turnCompleted(context.turnId),
  ]);
}

test("redacted results show [redacted] and no output channel or file carries the value", async () => {
  const h = harness({ server: { onTurn: turnWithRedactedResult } });
  expect(await h.run(["chat", "-p", "run it"])).toBe(0);
  expect(h.stderrText()).toContain("[redacted]");
  const everything = [h.stdoutText(), h.stderrText(), ...everyFile(h.dir)].join("\n");
  for (const form of forms(SECRET)) expect(everything).not.toContain(form);
});

test("JSON mode passes the host's already-redacted events through unchanged", async () => {
  const h = harness({ server: { onTurn: turnWithRedactedResult } });
  await h.run(["chat", "-p", "run it", "--json"]);
  const everything = [h.stdoutText(), h.stderrText(), ...everyFile(h.dir)].join("\n");
  for (const form of forms(SECRET)) expect(everything).not.toContain(form);
  expect(h.stdoutText()).toContain('"redactions":["/item/message/content/0/text"]');
});

test("a settings value that is a secret reference is shown as the reference only", async () => {
  const h = harness({ server: { settings: { "l1.models.apiKey": "secret://anthropic-key" } } });
  await h.run(["config", "get", "l1.models.apiKey"]);
  expect(h.stdoutText()).toContain('"secret://anthropic-key"');
});
