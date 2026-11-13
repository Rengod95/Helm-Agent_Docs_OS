import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@fresnel/contracts/records";
import { renderToString } from "react-dom/server";
import type { DurableFact } from "../../src/state/engine/input.ts";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import { selectWriteAccessAllowed } from "../../src/state/engine/convo-select.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { ApprovalQueue, InboxApprovals } from "../../src/views/approvals.tsx";
import { cardTitleViewOf } from "../../src/views/approval-card/card-model.ts";
import {
  pathPartsOf,
  writeAccessDecisionsOf,
  writeAccessFoldsOf,
  writeAccessViewOf,
} from "../../src/views/approval-card/write-access-model.ts";
import { Providers } from "../../src/views/providers.tsx";
import { SUB, evt, openedHarness, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 샌드박스 밖 쓰기 승인 카드(DP-204)와 입력창의 조용한 표시 값(DP-205).
// 엔진(cap-workspace write-access-adapter)이 내는 body 모양 그대로 넣고, 일반 도구 카드로 떨어지지 않는지 본다.

const T = thr(1);
const origin = { threadId: T, turnId: null, stepId: null, toolCallId: null, caller: "main" };

function payload(input: {
  readonly requestKey: string;
  readonly args: Record<string, unknown>;
  readonly ruleId?: string | null;
  readonly toolName?: string;
  readonly remember?: readonly string[];
  readonly title?: string;
}): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin,
    surfaceThreadId: T,
    requestedAt: Date.now(),
    requestKey: input.requestKey,
    title: input.title ?? "Allow writing outside the workspace?",
    remember: input.remember ?? ["once", "thread"],
    body: {
      kind: "tool",
      tool: {
        toolName: input.toolName ?? "bash",
        risk: "write",
        args: input.args,
        argsHash: "h",
        ruleId: input.ruleId === undefined ? "sandbox.write_access" : input.ruleId,
      },
    },
  });
  if (!parsed.ok) throw new Error("the test approval payload must be valid");
  return parsed.value;
}

const BASH = payload({
  requestKey: "wa-bash",
  args: {
    subject: "write_access",
    tool: "bash",
    command: "npm install -g pnpm",
    writePaths: ["/Users/me/.npm/_cacache/index-v5/aa/bb"],
    allowRoots: ["/Users/me/.npm"],
    homeWide: false,
  },
});

const HOME = payload({
  requestKey: "wa-home",
  toolName: "write",
  args: {
    subject: "write_access",
    tool: "write",
    writePaths: ["/Users/me/notes.txt"],
    allowRoots: ["/Users/me"],
    homeWide: true,
  },
});

const GENERIC = payload({
  requestKey: "plain",
  title: 'Allow tool "bash"?',
  ruleId: null,
  remember: ["once"],
  args: { command: "ls" },
});

function frozen<S>(state: S): ReadonlyStore<S> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function stateWith(requests: readonly ApprovalRequestedPayload[]): EngineMirror {
  const h = openedHarness();
  h.store.ingest({ type: "threads", threads: [summary(T, { title: "Build" })] });
  requests.forEach((request, index) => {
    const seq = 6 + index;
    const fact: DurableFact = {
      type: "approval.requested",
      seq,
      eventId: evt(seq),
      threadId: T,
      turnId: null,
      at: "t",
      request,
    };
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: seq - 1,
      to: seq,
      caughtUp: true,
      facts: [fact],
    });
  });
  h.store.flush();
  return h.store.read.getState();
}

function cardsOf(html: string): string[] {
  return html.match(/<li data-slot="approval-card-item"[\s\S]*?<\/li>/g) ?? [];
}

function actionsOf(card: string): string[] {
  const block = card.match(/data-slot="approval-actions"[\s\S]*$/)?.[0] ?? "";
  return [...block.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1] ?? "");
}

function render(state: EngineMirror, inbox = false): string[] {
  return cardsOf(
    renderToString(
      <Providers engine={frozen(state)} ui={createUiStore().read} commands={fakeCommands()}>
        {inbox ? <InboxApprovals /> : <ApprovalQueue />}
      </Providers>,
    ),
  );
}

describe("write access view", () => {
  test("recognises the request by rule id or by args.subject, and leaves other tools alone", () => {
    expect(writeAccessViewOf(BASH)).toEqual({
      tool: "bash",
      toolName: "bash",
      command: "npm install -g pnpm",
      writePaths: ["/Users/me/.npm/_cacache/index-v5/aa/bb"],
      allowRoots: ["/Users/me/.npm"],
      homeWide: false,
      homeRoot: null,
      offersThread: true,
    });
    const bySubject = payload({
      requestKey: "s",
      ruleId: null,
      toolName: "edit",
      args: { subject: "write_access", tool: "edit", writePaths: ["/tmp/x"], allowRoots: [] },
    });
    expect(writeAccessViewOf(bySubject)?.tool).toBe("edit");
    expect(writeAccessViewOf(GENERIC)).toBeNull();
  });

  test("a malformed body under the rule id still reads as write access with empty values", () => {
    const odd = payload({ requestKey: "odd", toolName: "shell", args: { writePaths: "x" } });
    expect(writeAccessViewOf(odd)).toEqual({
      tool: "other",
      toolName: "shell",
      command: null,
      writePaths: [],
      allowRoots: [],
      homeWide: false,
      homeRoot: null,
      offersThread: true,
    });
  });

  test("homeWide names the home-like root", () => {
    expect(writeAccessViewOf(HOME)?.homeRoot).toBe("/Users/me");
    const many = payload({
      requestKey: "many",
      args: { subject: "write_access", allowRoots: ["/opt/a", "/home/kim/"], homeWide: true },
    });
    expect(writeAccessViewOf(many)?.homeRoot).toBe("/home/kim/");
  });

  test("the title is the write access title, not the generic tool title", () => {
    expect(cardTitleViewOf(BASH)).toEqual({ id: "desktop.approvals.title.writeAccess" });
    expect(cardTitleViewOf(GENERIC)).toEqual({
      id: "desktop.approvals.title.tool",
      params: { tool: "bash" },
    });
  });

  test("the three answers", () => {
    const view = writeAccessViewOf(BASH);
    if (view === null) throw new Error("expected a write access view");
    expect(writeAccessDecisionsOf(view)).toEqual({
      once: { decision: "allow", remember: "once" },
      thread: { decision: "allow", remember: "thread" },
      deny: { decision: "deny" },
    });
    expect(writeAccessDecisionsOf({ ...view, offersThread: false }).thread).toBeNull();
  });
});

describe("path parts", () => {
  test("splits the folder part (kept to the trailing separator) from the last name", () => {
    expect(pathPartsOf("/Users/me/.npm/_cacache/a1")).toEqual({
      dir: "/Users/me/.npm/_cacache/",
      base: "a1",
    });
    expect(pathPartsOf("C:\\Users\\me\\x.txt")).toEqual({ dir: "C:\\Users\\me\\", base: "x.txt" });
    expect(pathPartsOf("notes.md")).toEqual({ dir: "", base: "notes.md" });
    expect(pathPartsOf("/Users/me/")).toEqual({ dir: "", base: "/Users/me/" });
  });

  test("folds when paths overflow the folded count, a path is long, or the command is long", () => {
    const view = writeAccessViewOf(BASH);
    if (view === null) throw new Error("expected a write access view");
    expect(writeAccessFoldsOf(view)).toBe(false);
    expect(writeAccessFoldsOf({ ...view, writePaths: ["/a", "/b", "/c", "/d"] })).toBe(true);
    expect(writeAccessFoldsOf({ ...view, allowRoots: [`/${"x".repeat(70)}`] })).toBe(true);
    expect(writeAccessFoldsOf({ ...view, command: "a\nb" })).toBe(true);
  });
});

describe("write access card", () => {
  test("draws the write access body and three answers in the transcript and the inbox", () => {
    const state = stateWith([BASH, GENERIC]);
    for (const inbox of [false, true]) {
      const [card, plain] = render(state, inbox);
      expect(card).toContain("작업 폴더 밖에 써도 될까요?");
      expect(card).toContain('data-slot="write-access"');
      expect(card).toContain("npm install -g pnpm");
      expect(card).toContain("/Users/me/.npm");
      expect(card).toContain("계속 허용하면 이 대화에서는 다시 묻지 않아요");
      // 원시 인자 단추 대신 구조로 보이고, 단추는 [거부][계속 허용][이번만 허용]
      expect(actionsOf(card ?? "")).toEqual(["deny", "allow-thread", "primary"]);
      expect(card).toContain("이번만 허용");
      expect(card).toContain("이 대화에서 계속 허용");
      expect(card).not.toContain("Allow writing outside the workspace?");
      // 일반 도구 카드는 그대로
      expect(plain).not.toContain('data-slot="write-access"');
      expect(actionsOf(plain ?? "")).toEqual(["args", "deny", "primary"]);
    }
  });

  test("homeWide shows the whole home folder in warning color with a warning line", () => {
    const [card] = render(stateWith([HOME]));
    expect(card).toContain('data-slot="write-access-home"');
    expect(card).toContain("홈 폴더 전체");
    expect(card).toContain('data-slot="write-access-home-warning"');
    expect(card).toContain("파일 쓰기");
  });

  test("a request without the thread option has two answers and no note", () => {
    const once = payload({
      requestKey: "once",
      remember: ["once"],
      args: {
        subject: "write_access",
        tool: "bash",
        command: "touch ~/x",
        writePaths: ["/Users/me/x"],
      },
    });
    const [card] = render(stateWith([once]));
    expect(actionsOf(card ?? "")).toEqual(["deny", "primary"]);
    expect(card).not.toContain('data-slot="write-access-thread-note"');
  });

  test("many paths fold to three with a count and a show-all toggle", () => {
    const many = payload({
      requestKey: "many",
      args: {
        subject: "write_access",
        tool: "bash",
        command: "make install",
        writePaths: ["/opt/a", "/opt/b", "/opt/c", "/opt/d", "/opt/e"],
        allowRoots: ["/opt"],
      },
    });
    const [card] = render(stateWith([many]));
    expect(actionsOf(card ?? "")).toEqual(["fold", "deny", "allow-thread", "primary"]);
    expect(card).toContain("외 2개");
    expect(card).toContain('title="/opt/c"');
    expect(card).not.toContain('title="/opt/d"');
  });
});

function resolvedState(remember: "once" | "thread", decision: "allow" | "deny"): EngineMirror {
  const h = openedHarness();
  const fact: DurableFact = {
    type: "approval.resolved",
    seq: 6,
    eventId: evt(16),
    threadId: T,
    turnId: null,
    at: "t",
    approvalId: evt(5),
    resolved: {
      approvalId: evt(5),
      decision,
      answer: null,
      remember,
      requestedRemember: "thread",
      resolvedBy: "user",
    },
  };
  h.store.ingest({ type: "batch", sub: SUB, from: 5, to: 6, caughtUp: true, facts: [fact] });
  h.store.flush();
  return h.store.read.getState();
}

describe("thread grant flag", () => {
  test("only allow + thread turns the flag on", () => {
    expect(selectWriteAccessAllowed(resolvedState("thread", "allow"), T)).toBe(true);
    expect(selectWriteAccessAllowed(resolvedState("once", "allow"), T)).toBe(false);
    expect(selectWriteAccessAllowed(resolvedState("thread", "deny"), T)).toBe(false);
    expect(selectWriteAccessAllowed(resolvedState("thread", "allow"), thr(2))).toBe(false);
  });
});
