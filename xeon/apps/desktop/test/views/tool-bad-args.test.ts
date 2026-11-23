import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import {
  failureLabelOf,
  failureToneOf,
  toolResultOf,
} from "../../src/views/convo/tool-view-model.ts";
import { itm } from "../state/helpers.ts";

// AGE-77 R-11: 모델의 도구 인자 검증 오류는 영어 원문 대신 "인자 오류" 줄로 접고, 원문은 펼침에 남는다.

function failedResult(text: string): ItemRecord {
  return {
    itemId: itm(1),
    status: "failed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "ask_user",
      content: [{ type: "text", text }],
      isError: true,
      timestamp: 0,
    },
  };
}

const RAW =
  'Validation failed for tool "ask_user":\n  - questions.0.options: must not have fewer than 2 items\n\nReceived arguments:\n{}';

test("an argument validation error becomes the badArgs failure and keeps the raw text for the fold", () => {
  const view = toolResultOf(failedResult(RAW));
  expect(view?.outcome).toEqual({ kind: "failed", failure: "badArgs" });
  expect(view?.output).toBe(RAW);
  expect(failureLabelOf("badArgs")).toBe(t("desktop.item.status.badArgs"));
  expect(failureToneOf("badArgs")).toBe("neutral");
});

test("any other failure stays a plain failure", () => {
  const view = toolResultOf(failedResult("Error: boom"));
  expect(view?.outcome).toEqual({ kind: "failed", failure: "failed" });
});
