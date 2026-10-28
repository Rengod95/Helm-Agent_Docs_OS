import { describe, expect, test } from "bun:test";
import { createPostHocRedaction } from "../src/post-redact.ts";
import { createRedactor } from "../src/redactor.ts";
import { forms } from "./support/encode.ts";
import { nameOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// M3-REQ-59. 이미 기록된 이벤트를 표시·내보내기·모델 입력 단계에서 사후에 가린다. 원본은 그대로 둔다.

const encoder = new TextEncoder();
const NAME = nameOf("github-token");
const STAGES = ["display", "export", "model-input"] as const;

/** 값이 등록되기 전에 기록된 이벤트 payload(저장된 원본 행) */
function recordedEvent(value: string) {
  const basic = forms(value).find((form) => form.label.startsWith("base64"));
  return {
    id: "evt_1",
    kind: "tool.result",
    payload: {
      text: `token is ${value} ok`,
      nested: [{ line: `curl --data ${value}` }, 42, null, true],
      encoded: basic?.text ?? "",
    },
  };
}

describe("post-hoc redaction", () => {
  test.each(STAGES)(
    "%s: a value registered after the event was recorded is masked, the stored row is not",
    (stage) => {
      const value = fakeValue(seededRandom(21), 24, true);
      const stored = recordedEvent(value);
      const snapshot = structuredClone(stored);
      const redactor = createRedactor();
      const post = createPostHocRedaction(redactor);

      // 값을 아직 모를 때는 가릴 수 없다. 그래서 등록 전 결과는 원문 그대로다
      expect(post.apply(stage, stored).value).toEqual(snapshot);

      expect(redactor.registerKnown(NAME, encoder.encode(value)).ok).toBe(true);
      const result = post.apply(stage, stored);
      expect(result.stage).toBe(stage);
      expect(result.value).toEqual({
        id: "evt_1",
        kind: "tool.result",
        payload: {
          text: "token is [REDACTED:known:github-token] ok",
          nested: [{ line: "curl --data [REDACTED:known:github-token]" }, 42, null, true],
          encoded: "[REDACTED:known:github-token]",
        },
      });
      expect(result.hits).toEqual([{ kind: "known:github-token", count: 3 }]);
      // 원본 행은 값이 그대로이고 같은 객체다
      expect(stored).toEqual(snapshot);
      expect(result.value).not.toBe(stored);
    },
  );

  test("masked results never contain any encoded form of the value", () => {
    const value = fakeValue(seededRandom(22), 24, true);
    const redactor = createRedactor();
    redactor.registerKnown(NAME, encoder.encode(value));
    const post = createPostHocRedaction(redactor);
    for (const form of forms(value)) {
      const out = post.apply("export", { line: `x ${form.text} y` });
      expect(JSON.stringify(out.value).includes(form.text)).toBe(false);
    }
  });

  test("advice names the masked secrets so the caller can tell the person to rotate them", () => {
    const value = fakeValue(seededRandom(23), 24, true);
    const redactor = createRedactor();
    redactor.registerKnown(NAME, encoder.encode(value));
    const post = createPostHocRedaction(redactor);
    expect(post.apply("display", { text: value }).advice).toEqual({
      kind: "rotate_key",
      names: ["github-token"],
      patternHits: 0,
    });
    // 패턴(접두)으로 가려진 것은 이름 없이 개수만 센다
    const pat = post.apply("display", { text: "key ghp_abcdefghijklmnopqrstuvwxyz0123456789" });
    expect(pat.advice).toEqual({ kind: "rotate_key", names: [], patternHits: 1 });
  });

  test("nothing masked means no advice and an equal value", () => {
    const post = createPostHocRedaction(createRedactor());
    const input = { a: ["plain", 1], b: { c: "text" } };
    const out = post.apply("model-input", input);
    expect(out.value).toEqual(input);
    expect(out.hits).toEqual([]);
    expect(out.advice).toBeNull();
  });
});
