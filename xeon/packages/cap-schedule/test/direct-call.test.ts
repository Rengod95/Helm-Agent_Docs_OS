import { describe, expect, test } from "bun:test";
import { ok, parse, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  type CallContext,
  type CallerInfo,
  type CallOptions,
  type DirectCreateMode,
  type ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type {
  ApprovalDecision,
  ApprovalRequestError,
  ApprovalRequestInput,
  ApprovalResolution,
} from "@fresnel/contracts/services";
import { createScheduleApi, type ScheduleApprovals } from "../src/index.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// L2.schedule.spec §4.4.9 [결정: 2026-11-03 사용자]. 직접 호출(모델 경로 밖)은 `l2.schedule.entries.directCreate`를 따른다.
// 기본은 allow, deny는 거부하고 아무것도 만들지 않으며, ask는 호출한 대화에 승인을 낸다. 모델 호출은 이 설정을 읽지 않는다.

function threadOf(text: string): ThreadId {
  const parsed = parse(ThreadIdSchema, text);
  if (!parsed.ok) throw new Error(`not a thread id: ${text}`);
  return parsed.value;
}

const THREAD: ThreadId = threadOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const EXTENSION: CallerInfo = { kind: "extension", extension: "consumer" };
const MODEL: CallerInfo = { kind: "model", agent: "main" };
const TRIGGER: ScheduleTrigger = { kind: "remote" };
const INPUT = { trigger: TRIGGER, prompt: "go" };

/** 호출 문맥을 붙인 옵션. 이 파일의 호출은 전부 문맥을 가진다(기능 가드가 채우는 모양) */
function callAs(caller: CallerInfo, extra: Partial<CallContext> = {}): CallOptions {
  return { context: { caller, threadId: THREAD, ...extra } };
}

async function rejectionOf(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected the call to reject with a CapabilityError");
}

/** 승인 서비스 대역. 받은 요청을 기록하고 정해 둔 결정으로 바로 답한다 */
function approvalsAnswering(decision: ApprovalDecision): {
  readonly approvals: ScheduleApprovals;
  readonly requests: ApprovalRequestInput[];
} {
  const requests: ApprovalRequestInput[] = [];
  const approvals: ScheduleApprovals = {
    request(input): Promise<Result<ApprovalResolution, ApprovalRequestError>> {
      requests.push(input);
      const resolution: ApprovalResolution = {
        approvalId: `apr_${requests.length}`,
        decision,
        answer: null,
        remember: "once",
        requestedRemember: "once",
        resolvedBy: "user",
      };
      return Promise.resolve(ok(resolution));
    },
  };
  return { approvals, requests };
}

function listed(h: Harness): number {
  return h.service.list().length;
}

describe("allow (the default)", () => {
  test("without a policy the direct call creates the entry and records the calling extension", async () => {
    const h = createHarness();
    const out = await createScheduleApi(h.service).create(INPUT, callAs(EXTENSION));
    expect(out.entry).toMatchObject({ trigger: { kind: "remote" }, prompt: "go", enabled: true });
    expect(out.entry.createdBy).toBe("ext:consumer");
    expect(listed(h)).toBe(1);
  });

  test("with the policy answering allow the direct call creates the entry", async () => {
    const h = createHarness();
    const api = createScheduleApi(h.service, { directCreate: () => "allow" });
    await api.create(INPUT, callAs(EXTENSION));
    expect(listed(h)).toBe(1);
  });

  test("a call without any context is recorded as made by the host", async () => {
    const h = createHarness();
    const out = await createScheduleApi(h.service).create(INPUT);
    expect(out.entry.createdBy).toBe("host");
  });
});

describe("deny", () => {
  test("a direct call is refused with the denied code and no entry is created", async () => {
    const h = createHarness();
    const api = createScheduleApi(h.service, { directCreate: () => "deny" });
    const error = await rejectionOf(api.create(INPUT, callAs(EXTENSION)));
    expect(error.data).toMatchObject({
      capability: "schedule.entries",
      method: "create",
      code: "denied",
      retryable: false,
    });
    expect(listed(h)).toBe(0);
    expect(h.store.saves).toBe(0);
  });

  test("the setting is read on each call, so a change applies to the next call", async () => {
    const h = createHarness();
    let mode: DirectCreateMode = "deny";
    const api = createScheduleApi(h.service, { directCreate: () => mode });
    await rejectionOf(api.create(INPUT, callAs(EXTENSION)));
    expect(listed(h)).toBe(0);
    mode = "allow";
    await api.create(INPUT, callAs(EXTENSION));
    expect(listed(h)).toBe(1);
  });

  test("the model call path is unchanged: deny does not stop a call from the model", async () => {
    const h = createHarness();
    const api = createScheduleApi(h.service, { directCreate: () => "deny" });
    const out = await api.create(INPUT, callAs(MODEL));
    expect(out.entry.createdBy).toBe("main");
    expect(listed(h)).toBe(1);
  });
});

describe("ask", () => {
  test("a granted approval lets the direct call create the entry, and the request names that call", async () => {
    const h = createHarness();
    const { approvals, requests } = approvalsAnswering("allow");
    const api = createScheduleApi(h.service, { directCreate: () => "ask", approvals });
    const out = await api.create(INPUT, callAs(EXTENSION));
    expect(out.entry.createdBy).toBe("ext:consumer");
    expect(listed(h)).toBe(1);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.origin).toMatchObject({
      threadId: THREAD,
      toolCallId: null,
      caller: "ext:consumer",
    });
    expect(request?.remember).toEqual(["once"]);
    expect(request?.requestKey.length).toBeLessThanOrEqual(48);
    expect(request?.body).toMatchObject({
      kind: "tool",
      tool: {
        toolName: "schedule.entries.create",
        capability: { id: "schedule.entries", method: "create" },
        risk: "exec",
        args: { prompt: "go", trigger: { kind: "remote" } },
      },
    });
  });

  test("a refused approval rejects with denied and creates nothing", async () => {
    const h = createHarness();
    const { approvals, requests } = approvalsAnswering("deny");
    const api = createScheduleApi(h.service, { directCreate: () => "ask", approvals });
    const error = await rejectionOf(api.create(INPUT, callAs(EXTENSION)));
    expect(error.data.code).toBe("denied");
    expect(requests).toHaveLength(1);
    expect(listed(h)).toBe(0);
    expect(h.store.saves).toBe(0);
  });

  test("each ask uses a new request key, so an earlier answer is never reused", async () => {
    const h = createHarness();
    const { approvals, requests } = approvalsAnswering("allow");
    const api = createScheduleApi(h.service, { directCreate: () => "ask", approvals });
    await api.create(INPUT, callAs(EXTENSION));
    await api.create(INPUT, callAs(EXTENSION));
    expect(requests).toHaveLength(2);
    expect(requests[0]?.requestKey).not.toBe(requests[1]?.requestKey);
    expect(listed(h)).toBe(2);
  });

  test("without a conversation nothing is asked and the call is refused as unavailable", async () => {
    const h = createHarness();
    const { approvals, requests } = approvalsAnswering("allow");
    const api = createScheduleApi(h.service, { directCreate: () => "ask", approvals });
    const error = await rejectionOf(api.create(INPUT, { context: { caller: EXTENSION } }));
    expect(error.data.code).toBe("unavailable");
    expect(requests).toHaveLength(0);
    expect(listed(h)).toBe(0);
  });

  test("in an unattended run nothing is asked and the call is refused as denied", async () => {
    const h = createHarness();
    const { approvals, requests } = approvalsAnswering("allow");
    const api = createScheduleApi(h.service, { directCreate: () => "ask", approvals });
    const error = await rejectionOf(api.create(INPUT, callAs(EXTENSION, { interactive: false })));
    expect(error.data.code).toBe("denied");
    expect(requests).toHaveLength(0);
    expect(listed(h)).toBe(0);
  });

  test("without an approval service ask is refused as unavailable", async () => {
    const h = createHarness();
    const api = createScheduleApi(h.service, { directCreate: () => "ask" });
    const error = await rejectionOf(api.create(INPUT, callAs(EXTENSION)));
    expect(error.data.code).toBe("unavailable");
    expect(listed(h)).toBe(0);
  });

  test("the model call path is never asked, even when the setting says ask", async () => {
    const h = createHarness();
    const { approvals, requests } = approvalsAnswering("deny");
    const api = createScheduleApi(h.service, { directCreate: () => "ask", approvals });
    const out = await api.create(INPUT, callAs(MODEL));
    expect(out.entry.createdBy).toBe("main");
    expect(requests).toHaveLength(0);
    expect(listed(h)).toBe(1);
  });
});
