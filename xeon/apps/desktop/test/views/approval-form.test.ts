import { describe, expect, test } from "bun:test";
import {
  answerOf,
  setPickText,
  toolApprovalView,
  togglePick,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalBody,
} from "../../src/views/approval-form.ts";

function tool(args: ToolApprovalBody["args"]): ToolApprovalBody {
  return { toolName: "bash", risk: "execute", args, argsHash: "h", ruleId: null };
}

describe("toolApprovalView", () => {
  test("shows the command, the full args and the secret handles of a bash call", () => {
    const view = toolApprovalView(
      tool({
        command: 'curl -H "Authorization: $TOKEN" https://api.example.com',
        secretEnv: { TOKEN: "secret://prod/api-token", ODD: "plain-value" },
      }),
    );
    expect(view.command).toBe('curl -H "Authorization: $TOKEN" https://api.example.com');
    expect(view.secrets).toEqual([
      { name: "TOKEN", handle: "secret://prod/api-token" },
      { name: "ODD", handle: null },
    ]);
    expect(view.argsText).toContain("secretEnv");
    expect(view.argsStored).toBe(false);
  });

  test("never echoes a non-handle value of secretEnv as a handle", () => {
    const view = toolApprovalView(tool({ command: "x", secretEnv: { A: "hunter2" } }));
    expect(view.secrets).toEqual([{ name: "A", handle: null }]);
  });

  test("a call without secretEnv or command has neither", () => {
    const view = toolApprovalView(tool({ path: "/a/b" }));
    expect(view.command).toBeNull();
    expect(view.secrets).toEqual([]);
    expect(view.argsText).toContain("/a/b");
  });

  test("big args stay in the blob store and are not shown", () => {
    const view = toolApprovalView(
      tool({ type: "blob", sha256: "a".repeat(64), size: 9_000_000, mediaType: null }),
    );
    expect(view.argsStored).toBe(true);
    expect(view.argsText).toBeNull();
  });

  test("long args are clipped and marked", () => {
    const view = toolApprovalView(tool({ command: "x", note: "n".repeat(10_000) }));
    expect(view.argsTruncated).toBe(true);
    expect(view.argsText?.length).toBe(4000);
  });
});

const single: QuestionItem = {
  id: "q1",
  text: "Which?",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  multiSelect: false,
  allowFreeText: false,
};
const multi: QuestionItem = { ...single, id: "q2", multiSelect: true };
const free: QuestionItem = {
  id: "q3",
  text: "Why?",
  options: [],
  multiSelect: false,
  allowFreeText: true,
};
const both: QuestionItem = { ...single, id: "q4", allowFreeText: true };

describe("question answers", () => {
  test("is incomplete until every question has a selection or text", () => {
    expect(answerOf([single, free], {})).toBeNull();
    const half = togglePick({}, single, "a");
    expect(answerOf([single, free], half)).toBeNull();
    const full = setPickText(half, "q3", "because");
    expect(answerOf([single, free], full)).toEqual({
      q1: { selected: ["a"] },
      q3: { selected: [], text: "because" },
    });
  });

  test("single select replaces the choice and clicking it again clears it", () => {
    let draft: QuestionDraft = togglePick({}, single, "a");
    draft = togglePick(draft, single, "b");
    expect(answerOf([single], draft)).toEqual({ q1: { selected: ["b"] } });
    draft = togglePick(draft, single, "b");
    expect(answerOf([single], draft)).toBeNull();
  });

  test("multi select toggles and keeps the pick order", () => {
    let draft: QuestionDraft = togglePick({}, multi, "b");
    draft = togglePick(draft, multi, "a");
    expect(answerOf([multi], draft)).toEqual({ q2: { selected: ["b", "a"] } });
    draft = togglePick(draft, multi, "b");
    expect(answerOf([multi], draft)).toEqual({ q2: { selected: ["a"] } });
  });

  test("free text is dropped for questions that do not allow it", () => {
    const draft = setPickText(togglePick({}, single, "a"), "q1", "extra");
    expect(answerOf([single], draft)).toEqual({ q1: { selected: ["a"] } });
    // 자유 입력만 있고 허용되지 않으면 빈 답이다
    expect(answerOf([single], setPickText({}, "q1", "only text"))).toBeNull();
  });

  test("an option plus free text sends both; blank text counts as none", () => {
    const withText = setPickText(togglePick({}, both, "a"), "q4", "  note  ");
    expect(answerOf([both], withText)).toEqual({ q4: { selected: ["a"], text: "note" } });
    expect(answerOf([both], setPickText({}, "q4", "   "))).toBeNull();
  });

  test("text over the service limit is not sent", () => {
    expect(answerOf([free], setPickText({}, "q3", "x".repeat(8193)))).toBeNull();
  });
});
