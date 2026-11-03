import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@fresnel/contracts/records";
import type { LeafMask } from "@fresnel/contracts/conversation";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import type { EngineMirror } from "../../src/state/engine/state.ts";
import { decodePendingApprovals } from "../../src/state/engine/decode.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { Providers } from "../../src/views/providers.tsx";
import { ApprovalQueue } from "../../src/views/approvals.tsx";
import { evt, openedHarness, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";
import { renderToString } from "react-dom/server";

// L0.secrets.spec §3.5.1 [결정: 2026-11-03 사용자]. 승인 카드는 호스트가 가린 값을 보이지 않게 그린다.
// 시험은 approval.list 결과(표식 포함)를 실제 디코드 경로로 넣고 카드 HTML에 값이 없는지 본다.

const VALUE = "maskprobe-value-one";
const MARKER = "[REDACTED:known:display-token]";

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function request(title: string, command: string): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin: { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "req-1",
    title,
    body: {
      kind: "tool",
      tool: { toolName: "bash", risk: "write", args: { command }, argsHash: "h", ruleId: null },
    },
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 1,
  });
  if (!parsed.ok) throw new Error("the test approval payload must be valid");
  return parsed.value;
}

function leafOf(text: string, pointer: string): LeafMask {
  const start = text.indexOf(VALUE);
  return {
    pointer,
    len: text.length,
    ranges: [{ start, end: start + VALUE.length, label: "known:display-token" }],
  };
}

describe("approval card", () => {
  test("the card shows the marker for a registered value in the title and the command, never the value", () => {
    const title = `Run bash with ${VALUE}`;
    const command = `curl -H token=${VALUE} https://example.test`;
    const h = openedHarness();
    const approvals = decodePendingApprovals({
      approvals: [{ approvalId: evt(5), seq: 5, request: request(title, command) }],
      masks: [
        {
          approvalId: evt(5),
          leaves: [leafOf(title, "/title"), leafOf(command, "/body/tool/args/command")],
        },
      ],
    });
    h.store.ingest({ type: "approvals", approvals });
    h.store.flush();
    const state: EngineMirror = h.store.read.getState();
    const html = renderToString(
      <Providers engine={frozen(state)} ui={createUiStore().read} commands={fakeCommands()}>
        <ApprovalQueue />
      </Providers>,
    );
    expect(html).toContain(MARKER);
    expect(html).not.toContain(VALUE);
  });

  test("an approval whose mask does not fit is not shown at all", () => {
    const title = `Run bash with ${VALUE}`;
    const h = openedHarness();
    const approvals = decodePendingApprovals({
      approvals: [{ approvalId: evt(6), seq: 6, request: request(title, "ls") }],
      masks: [{ approvalId: evt(6), leaves: [{ pointer: "/body/tool/args", len: 0, ranges: [] }] }],
    });
    h.store.ingest({ type: "approvals", approvals });
    h.store.flush();
    const html = renderToString(
      <Providers
        engine={frozen(h.store.read.getState())}
        ui={createUiStore().read}
        commands={fakeCommands()}
      >
        <ApprovalQueue />
      </Providers>,
    );
    expect(html).not.toContain(VALUE);
    expect(html).not.toContain("Run bash");
  });
});
