import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import {
  failureLabelOf,
  failureToneOf,
  pathDenialLineOf,
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

// AGE-78: 작업 폴더 경계가 막은 도구 실패는 실패 종류로 한국어 한 줄을 보이고, 원문은 그대로 남는다.
function deniedResult(reason: string, text: string): ItemRecord {
  const base = failedResult(text);
  if (base.kind !== "toolResult") throw new Error("failedResult must build a tool result");
  return {
    ...base,
    message: {
      ...base.message,
      toolName: "read",
      details: { code: "denied", detail: { reason, requested: "/x" } },
    },
  };
}

test("a protected-path or outside-root denial becomes pathBlocked with its reason and keeps the raw text", () => {
  const raw = "[denied] Access to /x is denied: it is a protected path.";
  const protectedView = toolResultOf(deniedResult("protected_path", raw));
  expect(protectedView?.outcome).toEqual({ kind: "failed", failure: "pathBlocked" });
  expect(protectedView?.pathDenial).toBe("protected_path");
  expect(protectedView?.output).toBe("Access to /x is denied: it is a protected path.");
  expect(pathDenialLineOf("protected_path")).toBe(t("desktop.item.pathBlocked.protected"));
  const outside = toolResultOf(deniedResult("outside_root", raw));
  expect(outside?.pathDenial).toBe("outside_root");
  expect(pathDenialLineOf("outside_root")).toBe(t("desktop.item.pathBlocked.outside"));
  expect(failureToneOf("pathBlocked")).toBe("warning");
  // 모르는 이유는 평범한 실패로 남는다
  expect(toolResultOf(deniedResult("parent_traversal", raw))?.outcome).toEqual({
    kind: "failed",
    failure: "failed",
  });
});
