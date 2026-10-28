import { describe, expect, test } from "bun:test";
import type { ApprovalRequestedPayload } from "@xeon/contracts/records";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { ApprovalQueue } from "../../src/views/approvals.tsx";
import type { Commands } from "../../src/views/commands.ts";
import { Providers } from "../../src/views/providers.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { evt, openedHarness, thr } from "../state/helpers.ts";

// 서버 렌더는 getInitialState를 읽으므로 상태를 채운 스냅샷을 초기 상태로 하는 스토어를 만든다.
// 클릭은 DOM이 없어 시험하지 못한다. 클릭이 부르는 답 조립은 approval-form.test.ts가 본다.

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

const commands: Commands = fakeCommands();

function mirrorWith(request: ApprovalRequestedPayload): EngineMirror {
  const h = openedHarness();
  h.store.ingest({ type: "threads", threads: [] });
  h.store.ingest({
    type: "approvals",
    approvals: [{ approvalId: evt(7), seq: 4, request }],
  });
  h.store.flush();
  const state = h.store.read.getState();
  expect(state.approvals.ids).toEqual([evt(7)]);
  return state;
}

function html(
  request: ApprovalRequestedPayload,
  options: {
    readonly failure?: "invalid" | "closed" | "unapplied" | "failed";
    readonly detail?: string;
  } = {},
): string {
  const engine = frozen(mirrorWith(request));
  const uiStore = createUiStore();
  if (options.failure !== undefined)
    uiStore.actions.approvalFailed(evt(7), options.failure, options.detail);
  const ui = frozen<UiState>(uiStore.read.getState());
  return renderToString(
    <Providers engine={engine} ui={ui} commands={commands}>
      <ApprovalQueue />
    </Providers>,
  );
}

const origin = { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" };

function toolRequest(args: Record<string, unknown>): ApprovalRequestedPayload {
  return {
    origin,
    requestKey: "k",
    title: 'Allow "bash" to use TOKEN?',
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "execute",
        args: JSON.parse(JSON.stringify(args)),
        argsHash: "h",
        ruleId: null,
      },
    },
  };
}

function questionRequest(
  question: Extract<ApprovalRequestedPayload["body"], { kind: "question" }>["question"],
): ApprovalRequestedPayload {
  return {
    origin,
    requestKey: "k",
    title: "Question",
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
    body: { kind: "question", question },
  };
}

describe("tool approval card", () => {
  test("shows the command, the args and the secret handles, never a value", () => {
    const out = html(
      toolRequest({ command: "deploy --prod", secretEnv: { TOKEN: "secret://prod/token" } }),
    );
    expect(out).toContain("deploy --prod");
    expect(out).toContain("TOKEN");
    expect(out).toContain("secret://prod/token");
    expect(out).toContain("이 호출이 사용할 비밀");
    expect(out).toContain("bash");
    expect(out).toContain("execute");
  });

  test("a call with no secrets shows no secret block", () => {
    const out = html(toolRequest({ command: "ls" }));
    expect(out).toContain("ls");
    expect(out).not.toContain("이 호출이 사용할 비밀");
  });
});

describe("question approval card", () => {
  const picker = questionRequest({
    questions: [
      {
        id: "q1",
        header: "Scope",
        text: "Which one?",
        options: [
          { id: "a", label: "Alpha", description: "first", recommended: true },
          { id: "b", label: "Beta" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
      {
        id: "q2",
        text: "Pick some",
        options: [{ id: "x", label: "Ex" }],
        multiSelect: true,
        allowFreeText: true,
      },
    ],
  });

  test("renders options as radios or checkboxes and shows header, description and recommended", () => {
    const out = html(picker);
    expect(out).toContain("Scope");
    expect(out).toContain("Alpha");
    expect(out).toContain("(추천)");
    expect(out).toContain("first");
    expect(out).toContain('type="radio"');
    expect(out).toContain('type="checkbox"');
  });

  test("a free-text input appears only where allowFreeText is set", () => {
    const out = html(picker);
    expect(out.match(/type="text"/g)?.length).toBe(1);
    const freeOnly = html(
      questionRequest({
        questions: [
          { id: "f", text: "Why?", options: [], multiSelect: false, allowFreeText: true },
        ],
      }),
    );
    expect(freeOnly).toContain('type="text"');
    expect(freeOnly).not.toContain('type="radio"');
  });

  test("the answer button starts disabled and a deny button is offered", () => {
    const out = html(picker);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>답하기/);
    expect(out).toContain("거부");
  });
});

describe("failure marks tell the user what to do", () => {
  const request = toolRequest({ command: "ls" });
  test("answer invalid, already resolved, unapplied and failed read differently", () => {
    const texts = (["invalid", "closed", "unapplied", "failed"] as const).map((failure) => {
      const out = html(request, { failure });
      expect(out).toContain(`data-failure="${failure}"`);
      return out.match(/data-failure="[a-z]+">([^<]*)</)?.[1];
    });
    expect(new Set(texts).size).toBe(4);
    expect(texts[0]).toContain("올바르지 않아");
    expect(texts[1]).toContain("이미 처리된");
  });
});

describe("answer_invalid detail", () => {
  test("shows the one line the host gave next to the failure text", () => {
    const out = html(toolRequest({ command: "ls" }), {
      failure: "invalid",
      detail: "q2: choose at most one",
    });
    expect(out).toContain("q2: choose at most one");
  });
});
