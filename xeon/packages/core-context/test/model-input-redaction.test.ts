import { expect, test } from "bun:test";
import { canonicalJson } from "@fresnel/contracts";
import type { AssistantMessage, Message } from "@fresnel/contracts/conversation";
import { maskMessages, type MessageMasker } from "../src/mask-messages.ts";
import { assembleOptions, userItem } from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { valueOf } from "./support/result.ts";

// L0.secrets.spec §3.5.1 모델 입력 단계. 값은 실행 때 만든다(비밀 스캐너가 소스의 고정 문자열을 시크릿으로 읽는다)
const NEEDLE = ["fixture", "context", "secret", "value"].join("-");
const MARK = "[REDACTED:known:fixture]";

/** 대역: 문자열 필드를 제자리에서 바꾼다(타입 단언 없이 T를 돌려주려고). 호출자는 복사본을 넘긴다 */
function maskInPlace(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "string") Object.assign(value, { [key]: inner.replaceAll(NEEDLE, MARK) });
    else maskInPlace(inner);
  }
}

const masker: MessageMasker = {
  mask: (text) => ({ text: text.replaceAll(NEEDLE, MARK), hits: [] }),
  maskDeep: (value) => {
    const copy: typeof value = structuredClone(value);
    maskInPlace(copy);
    return { value: copy, hits: [] };
  },
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("assembled model input masks a value registered after the row was recorded, and the row stays", async () => {
  const h = await harness({ redactor: masker });
  h.log.append("thread.started", {});
  const recorded = h.log.append("item.recorded", userItem(h.log, `token is ${NEEDLE} ok`));
  const out = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const user = out.messages.find((message) => message.role === "user");
  expect(user?.content).toBe(`token is ${MARK} ok`);
  expect(JSON.stringify(out.messages)).not.toContain(NEEDLE);
  // 기록된 행은 그대로다
  expect(JSON.stringify(recorded)).toContain(NEEDLE);
});

test("the masked output is deterministic and keeps the prefix hash and cache marks of an unmasked run", async () => {
  const masked = await harness({ redactor: masker });
  const plain = await harness();
  for (const h of [masked, plain]) {
    h.log.append("thread.started", {});
    h.log.append("item.recorded", userItem(h.log, `token is ${NEEDLE} ok`));
  }
  const options = (h: typeof masked) => assembleOptions(h.log.ids);
  const first = valueOf(
    await masked.service.assemble(masked.log.threadId, masked.log.leaf(), options(masked)),
  );
  const again = valueOf(
    await masked.service.assemble(masked.log.threadId, masked.log.leaf(), options(masked)),
  );
  const base = valueOf(
    await plain.service.assemble(plain.log.threadId, plain.log.leaf(), options(plain)),
  );
  // 같은 등록부면 요청마다 같은 바이트
  expect(canonicalJson(again.messages)).toBe(canonicalJson(first.messages));
  expect(first.prefix.prefixHash).toBe(base.prefix.prefixHash);
  expect(first.cacheMarks).toEqual(base.cacheMarks);
  expect(first.messages).toHaveLength(base.messages.length);
  // 가릴 것이 없는 시스템 접두는 바이트가 같다
  expect(canonicalJson(first.messages[0])).toBe(canonicalJson(base.messages[0]));
});

test("maskMessages masks text and tool arguments but keeps images, thinking and signatures", () => {
  const assistant: AssistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: `plan ${NEEDLE}`, thinkingSignature: "sig-1" },
      { type: "text", text: `said ${NEEDLE}` },
      { type: "toolCall", id: "call_1", name: "bash", arguments: { command: `echo ${NEEDLE}` } },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage,
    stopReason: "toolUse",
    timestamp: 3,
  };
  const messages: Message[] = [
    {
      role: "user",
      content: [
        { type: "text", text: `a ${NEEDLE}` },
        { type: "image", data: NEEDLE, mimeType: "image/png" },
      ],
      timestamp: 1,
    },
    assistant,
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      content: [{ type: "text", text: `out ${NEEDLE}` }],
      isError: false,
      timestamp: 4,
    },
  ];
  const out = maskMessages(masker, messages);
  expect(out[0]).toEqual({
    role: "user",
    content: [
      { type: "text", text: `a ${MARK}` },
      { type: "image", data: NEEDLE, mimeType: "image/png" },
    ],
    timestamp: 1,
  });
  expect(out[1]).toEqual({
    ...assistant,
    content: [
      { type: "thinking", thinking: `plan ${NEEDLE}`, thinkingSignature: "sig-1" },
      { type: "text", text: `said ${MARK}` },
      { type: "toolCall", id: "call_1", name: "bash", arguments: { command: `echo ${MARK}` } },
    ],
  });
  expect(out[2]).toMatchObject({ content: [{ type: "text", text: `out ${MARK}` }] });
  // 입력은 바뀌지 않는다
  expect(JSON.stringify(messages)).toContain(`echo ${NEEDLE}`);
});
