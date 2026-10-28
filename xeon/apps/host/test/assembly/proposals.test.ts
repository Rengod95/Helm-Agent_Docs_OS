import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import { CapabilityError, type CallOptions } from "@xeon/contracts/capabilities";
import type { ProposalDecideParams, ProposalRow, ProposalStatusWire } from "@xeon/contracts/wire";
import type { KnowledgeProposalListInput, KnowledgeProposalWire } from "@xeon/cap-knowledge";
import {
  decisionCommandLine,
  type DecisionResult,
  type LearningError,
  type LearningQueueApi,
  type ProposalDecision,
  type ProposalView,
} from "@xeon/group-learning";
import type { LearningRunner } from "../../src/assembly/learning.ts";
import { createProposalPort } from "../../src/assembly/proposals.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";

// M3-REQ-18(D-M3-32 a): `proposal.list`·`proposal.decide`의 포트. 두 출처를 한 목록으로 합치고 결정을 출처로 보낸다. 가짜 두 출처 위의 시험이다.
// 실제 L2 대기열과 학습 대기열 위의 시험은 test/int/proposals.int.test.ts다.

const SIGNAL = new AbortController().signal;
const MIXED_STATUS: ProposalStatusWire[] = ["applied", "reverted"];
const THREAD = fixedIdFactory().next("thr");

function view(patch: Partial<ProposalView> & { id: string }): ProposalView {
  return {
    kind: "skill",
    op: "create",
    target: "release-notes",
    status: "pending",
    destructive: false,
    diff: "+ x",
    rationale: "asked twice",
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    revision: 1,
    scope: "user",
    afterUntrusted: false,
    createdAt: 1000,
    source: "learning",
    ...patch,
  };
}

function row(patch: Partial<ProposalRow> & { id: string }): ProposalRow {
  return {
    source: "knowledge",
    kind: "memory",
    op: "memory.add",
    target: "memory:user",
    status: "pending",
    destructive: false,
    diff: "+ y",
    rationale: null,
    evidence: [],
    conflictsWith: null,
    reason: null,
    revision: 1,
    scope: null,
    afterUntrusted: false,
    createdAt: 1000,
    ...patch,
  };
}

interface Calls {
  /** 명령 실행기가 받은 줄과 실행 대화 */
  readonly runs: { line: string; preferred: string | undefined }[];
  readonly sweeps: number[];
  readonly knowledgeLists: {
    input: KnowledgeProposalListInput;
    options: CallOptions | undefined;
  }[];
  readonly knowledgeDecides: { params: ProposalDecideParams; options: CallOptions }[];
  readonly reports: string[];
}

function rig(options: {
  readonly learning?: readonly ProposalView[] | "down";
  readonly knowledge?: readonly ProposalRow[] | "down" | "throws";
  /** 결정 명령 줄의 후보 id를 받아 명령이 낼 결정 결과를 정한다 */
  readonly decide?: (proposalId: string) => DecisionResult;
  readonly sweepFails?: boolean;
  /** 열린 대화가 없다 */
  readonly noThread?: boolean;
  readonly knowledgeDecide?: KnowledgeProposalWire["decide"];
}) {
  const calls: Calls = {
    runs: [],
    sweeps: [],
    knowledgeLists: [],
    knowledgeDecides: [],
    reports: [],
  };
  const api: LearningQueueApi = {
    list: (filter) => {
      const all =
        options.learning === undefined || options.learning === "down" ? [] : options.learning;
      const rows = all.filter(
        (found) => filter.statuses === undefined || filter.statuses.includes(found.status),
      );
      return Promise.resolve(ok(rows));
    },
  };
  const runner: LearningRunner = {
    report: () => undefined,
    run: (line, preferred) => {
      calls.runs.push({ line, preferred });
      if (options.noThread === true) {
        return Promise.resolve({ kind: "unavailable", detail: "no conversation is open" });
      }
      if (line === "queue") {
        calls.sweeps.push(calls.runs.length - 1);
        return Promise.resolve(
          options.sweepFails === true
            ? {
                kind: "report",
                report: {
                  kind: "error",
                  error: { kind: "learning.storeUnavailable", detail: "down" },
                },
              }
            : { kind: "report", report: { kind: "queue", views: [], sweep: null } },
        );
      }
      const proposalId = line.split(" ")[2] ?? "";
      return Promise.resolve({
        kind: "report",
        report: {
          kind: "decision",
          result: options.decide?.(proposalId) ?? {
            ok: true,
            proposal: view({ id: proposalId }),
            applied: false,
          },
        },
      });
    },
  };
  const wire: KnowledgeProposalWire = {
    list: (input, callOptions) => {
      calls.knowledgeLists.push({ input, options: callOptions });
      if (options.knowledge === "throws") {
        return Promise.reject(
          new CapabilityError({
            capability: "knowledge.ledger",
            method: "proposals",
            code: "unavailable",
            message: "down",
            retryable: true,
          }),
        );
      }
      const all =
        options.knowledge === undefined || options.knowledge === "down" ? [] : options.knowledge;
      // 실제 어댑터처럼 (createdAt, id) 내림차순으로 `before` 뒤에서 `limit`행을 돌려준다
      const filtered = all
        .filter((found) => input.status === undefined || input.status.includes(found.status))
        .filter(
          (found) =>
            input.before === undefined ||
            found.createdAt < input.before.createdAt ||
            (found.createdAt === input.before.createdAt && found.id < input.before.id),
        )
        .toSorted((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      return Promise.resolve(filtered.slice(0, input.limit ?? 50));
    },
    decide:
      options.knowledgeDecide ??
      ((params, callOptions) => {
        calls.knowledgeDecides.push({ params, options: callOptions });
        return Promise.resolve({
          ok: true,
          proposal: row({ id: params.id }),
          applied: params.decision === "approve",
        });
      }),
  };
  const port = createProposalPort({
    learning: () => (options.learning === "down" ? undefined : api),
    runner,
    knowledge: () => (options.knowledge === "down" ? undefined : wire),
    report: (message) => {
      calls.reports.push(message);
    },
  });
  return { port, calls };
}

// ── proposal.list ───────────────────────────────────────────────────────

test("proposal.list merges both queues newest first and breaks ties by source then id", async () => {
  const { port } = rig({
    learning: [
      view({ id: "prop_b", createdAt: 2000 }),
      view({ id: "prop_a", createdAt: 3000 }),
      view({ id: "prop_c", createdAt: 1000 }),
    ],
    knowledge: [
      row({ id: "knp_z", createdAt: 2000 }),
      row({ id: "knp_y", createdAt: 2000 }),
      row({ id: "knp_x", createdAt: 500 }),
    ],
  });
  const listed = await port.list({}, SIGNAL);
  // createdAt 내림차순. 같으면 (source, id) 오름차순이고 "knowledge"가 "learning"보다 앞이다
  expect(listed.proposals.map((entry) => [entry.source, entry.id])).toEqual([
    ["learning", "prop_a"],
    ["knowledge", "knp_y"],
    ["knowledge", "knp_z"],
    ["learning", "prop_b"],
    ["learning", "prop_c"],
    ["knowledge", "knp_x"],
  ]);
  expect(listed.unavailable).toEqual([]);
  expect(listed.nextCursor).toBeNull();
});

test("proposal.list maps a learning row: scope only for skills, evidence with a thread, the source column", async () => {
  const { port } = rig({
    learning: [
      view({ id: "prop_skill", scope: "project" }),
      view({
        id: "prop_memory",
        kind: "memory",
        op: "add",
        target: "user",
        scope: "user",
        afterUntrusted: true,
        conflictsWith: "other",
        reason: "base_stale",
        createdAt: 900,
      }),
    ],
    knowledge: [],
  });
  const { proposals } = await port.list({ source: "learning" }, SIGNAL);
  expect(proposals[0]).toEqual({
    source: "learning",
    id: "prop_skill",
    kind: "skill",
    op: "create",
    target: "release-notes",
    status: "pending",
    destructive: false,
    diff: "+ x",
    rationale: "asked twice",
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    revision: 1,
    scope: "project",
    afterUntrusted: false,
    createdAt: 1000,
  });
  expect(proposals[1]).toMatchObject({
    kind: "memory",
    scope: null,
    afterUntrusted: true,
    conflictsWith: "other",
    reason: "base_stale",
  });
});

test("proposal.list reports a source it cannot read and still returns the other", async () => {
  const learningDown = await rig({ learning: "down", knowledge: [row({ id: "knp_1" })] }).port.list(
    {},
    SIGNAL,
  );
  expect(learningDown.unavailable).toEqual(["learning"]);
  expect(learningDown.proposals.map((entry) => entry.id)).toEqual(["knp_1"]);
  const knowledgeDown = await rig({
    learning: [view({ id: "prop_1" })],
    knowledge: "down",
  }).port.list({}, SIGNAL);
  expect(knowledgeDown.unavailable).toEqual(["knowledge"]);
  expect(knowledgeDown.proposals.map((entry) => entry.id)).toEqual(["prop_1"]);
  const throwing = rig({ learning: [view({ id: "prop_1" })], knowledge: "throws" });
  const result = await throwing.port.list({}, SIGNAL);
  expect(result.unavailable).toEqual(["knowledge"]);
  expect(throwing.calls.reports).toEqual(["proposal.knowledge_list_failed"]);
  const both = await rig({ learning: "down", knowledge: "down" }).port.list({}, SIGNAL);
  expect(both).toEqual({ proposals: [], nextCursor: null, unavailable: ["learning", "knowledge"] });
});

test("proposal.list with a source filter reads only that source and does not call the other", async () => {
  const { port, calls } = rig({
    learning: [view({ id: "prop_1" })],
    knowledge: [row({ id: "knp_1" })],
  });
  expect(
    (await port.list({ source: "learning" }, SIGNAL)).proposals.map((entry) => entry.id),
  ).toEqual(["prop_1"]);
  expect(calls.knowledgeLists).toEqual([]);
  expect(
    (await port.list({ source: "knowledge" }, SIGNAL)).proposals.map((entry) => entry.id),
  ).toEqual(["knp_1"]);
  // 읽지 않은 출처는 unavailable이 아니다
  expect((await port.list({ source: "knowledge" }, SIGNAL)).unavailable).toEqual([]);
});

test("proposal.list applies the status filter on the server: stale is knowledge only, reverted is learning only", async () => {
  const { port, calls } = rig({
    learning: [
      view({ id: "prop_a", status: "applied" }),
      view({ id: "prop_b", status: "reverted" }),
      view({ id: "prop_c", status: "pending" }),
    ],
    knowledge: [row({ id: "knp_a", status: "stale" }), row({ id: "knp_b", status: "applied" })],
  });
  const stale = await port.list({ status: ["stale"] }, SIGNAL);
  expect(stale.proposals.map((entry) => entry.id)).toEqual(["knp_a"]);
  expect(stale.unavailable).toEqual([]);
  const mixed = await port.list({ status: MIXED_STATUS }, SIGNAL);
  expect(mixed.proposals.map((entry) => entry.id).toSorted()).toEqual([
    "knp_b",
    "prop_a",
    "prop_b",
  ]);
  expect(calls.knowledgeLists.at(-1)?.input.status).toEqual(["applied", "reverted"]);
});

test("proposal.list pages with an opaque cursor and the pages together are the whole list", async () => {
  const learning = Array.from({ length: 5 }, (_, n) =>
    view({ id: `prop_${String(n)}`, createdAt: 5000 - n * 10 }),
  );
  const knowledge = Array.from({ length: 4 }, (_, n) =>
    row({ id: `knp_${String(n)}`, createdAt: 5005 - n * 10 }),
  );
  const { port } = rig({ learning, knowledge });
  const whole = await port.list({ limit: 200 }, SIGNAL);
  expect(whole.proposals).toHaveLength(9);
  const collected: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- 페이지는 차례로 읽는다
    const next = await port.list({ limit: 4, ...(cursor === undefined ? {} : { cursor }) }, SIGNAL);
    collected.push(...next.proposals.map((entry) => entry.id));
    if (next.nextCursor === null) break;
    cursor = next.nextCursor;
  }
  expect(collected).toEqual(whole.proposals.map((entry) => entry.id));
});

test("proposal.list sweeps the learning queue before it reads, and a failed sweep does not fail the list", async () => {
  const sweepOk = rig({ learning: [view({ id: "prop_1" })], knowledge: [] });
  await sweepOk.port.list({}, SIGNAL);
  expect(sweepOk.calls.sweeps).toEqual([0]);
  const failing = rig({ learning: [view({ id: "prop_1" })], knowledge: [], sweepFails: true });
  const result = await failing.port.list({}, SIGNAL);
  expect(result.proposals.map((entry) => entry.id)).toEqual(["prop_1"]);
  expect(failing.calls.reports).toEqual(["proposal.sweep_failed"]);
  // 열린 대화가 없으면 정리를 건너뛰고 목록은 읽는다
  const idle = rig({ learning: [view({ id: "prop_1" })], knowledge: [], noThread: true });
  expect((await idle.port.list({}, SIGNAL)).proposals.map((entry) => entry.id)).toEqual(["prop_1"]);
  expect(idle.calls.reports).toEqual(["proposal.sweep_skipped"]);
});

test("proposal.decide runs the command in the proposal's parent conversation and says unavailable when none is open", async () => {
  const { port, calls } = rig({ learning: [view({ id: "prop_1" })] });
  await port.decide({ source: "learning", id: "prop_1", decision: "reject" }, SIGNAL);
  expect(calls.runs).toEqual([{ line: "queue reject prop_1", preferred: THREAD }]);
  const idle = rig({ learning: [view({ id: "prop_1" })], noThread: true });
  expect(
    await idle.port.decide({ source: "learning", id: "prop_1", decision: "reject" }, SIGNAL),
  ).toEqual({ ok: false, reason: "unavailable", detail: "no conversation is open" });
});

test("proposal.list calls the knowledge queue as the host, not as an extension or a model", async () => {
  const { port, calls } = rig({ learning: [], knowledge: [] });
  await port.list({}, SIGNAL);
  expect(calls.knowledgeLists[0]?.options?.context).toEqual({ caller: { kind: "host" } });
  expect(calls.knowledgeLists[0]?.options?.signal).toBe(SIGNAL);
});

// ── proposal.decide ─────────────────────────────────────────────────────

test("proposal.decide routes a learning decision to the learning queue with the revision and scope", async () => {
  const { port, calls } = rig({
    learning: [],
    decide: (proposalId) => ({
      ok: true,
      proposal: view({ id: proposalId, status: "applied", scope: "project" }),
      applied: true,
    }),
  });
  const approved = await port.decide(
    { source: "learning", id: "prop_1", decision: "approve", revision: 3, scope: "project" },
    SIGNAL,
  );
  expect(approved).toMatchObject({
    ok: true,
    applied: true,
    proposal: { source: "learning", id: "prop_1", status: "applied", scope: "project" },
  });
  await port.decide(
    { source: "learning", id: "prop_1", decision: "reject", note: "too vague" },
    SIGNAL,
  );
  await port.decide(
    { source: "learning", id: "prop_1", decision: "edit", revision: 2, body: "new body" },
    SIGNAL,
  );
  await port.decide({ source: "learning", id: "prop_1", decision: "revert" }, SIGNAL);
  const decisions: readonly ProposalDecision[] = [
    { kind: "approve", proposalId: "prop_1", revision: 3, scope: "project" },
    { kind: "reject", proposalId: "prop_1", note: "too vague" },
    { kind: "edit", proposalId: "prop_1", revision: 2, body: "new body" },
    { kind: "revert", proposalId: "prop_1" },
  ];
  // 결정은 `/learning` 명령 줄로 실행한다. 후보의 부모 대화(근거의 thread)에서 돈다
  expect(calls.runs.filter((run) => run.line !== "queue")).toEqual(
    decisions.map((decision) => ({ line: decisionCommandLine(decision), preferred: undefined })),
  );
  // 지식 대기열은 부르지 않는다
  expect(calls.knowledgeDecides).toEqual([]);
});

test("proposal.decide routes a knowledge decision to the knowledge queue as the host", async () => {
  const { port, calls } = rig({ learning: [], knowledge: [] });
  const decided = await port.decide(
    { source: "knowledge", id: "knp_1", decision: "approve", revision: 1, scope: "user" },
    SIGNAL,
  );
  expect(decided).toMatchObject({
    ok: true,
    applied: true,
    proposal: { source: "knowledge", id: "knp_1" },
  });
  expect(calls.knowledgeDecides).toHaveLength(1);
  expect(calls.knowledgeDecides[0]?.options.context).toEqual({ caller: { kind: "host" } });
  expect(calls.runs).toEqual([]);
});

const LEARNING_ERRORS: readonly [LearningError, string][] = [
  [{ kind: "learning.notFound", proposalId: "p" }, "not_found"],
  [{ kind: "learning.revisionMismatch", proposalId: "p", current: 4 }, "revision_mismatch"],
  [{ kind: "learning.closed", proposalId: "p", status: "applied" }, "closed"],
  [{ kind: "learning.scopeNotAllowed", proposalId: "p" }, "scope_not_allowed"],
  [
    { kind: "learning.invalidBody", proposalId: "p", detail: "patch body is not JSON" },
    "unsupported",
  ],
  [{ kind: "learning.knowledgeUnavailable" }, "unavailable"],
  [{ kind: "learning.settingsUnavailable" }, "unavailable"],
  [{ kind: "learning.storeUnavailable", detail: "busy" }, "unavailable"],
  [{ kind: "learning.reviewBusy", requestId: "r" }, "unavailable"],
];

test("proposal.decide turns every learning error into a decision failure value, never a throw", async () => {
  for (const [error, reason] of LEARNING_ERRORS) {
    const { port } = rig({ learning: [], decide: () => ({ ok: false, error }) });
    // eslint-disable-next-line no-await-in-loop -- 오류마다 하나씩 본다
    const result = await port.decide(
      { source: "learning", id: "p", decision: "approve", revision: 1 },
      SIGNAL,
    );
    expect(result).toMatchObject({ ok: false, reason });
  }
  const detail = await rig({
    learning: [],
    decide: () => ({
      ok: false,
      error: { kind: "learning.revisionMismatch", proposalId: "p", current: 4 },
    }),
  }).port.decide({ source: "learning", id: "p", decision: "approve", revision: 1 }, SIGNAL);
  expect(detail).toEqual({
    ok: false,
    reason: "revision_mismatch",
    detail: "current revision is 4",
  });
});

function outcome(patch: Partial<ProposalView>) {
  return rig({
    learning: [],
    decide: (proposalId) => ({
      ok: true,
      proposal: view({ id: proposalId, ...patch }),
      applied: false,
    }),
  });
}

test("proposal.decide maps a rejected-by-scan or stale outcome of an approval to failure reasons and keeps a retry as success", async () => {
  expect(
    await outcome({ status: "rejected", reason: "scan_failed" }).port.decide(
      { source: "learning", id: "p", decision: "approve", revision: 1 },
      SIGNAL,
    ),
  ).toMatchObject({ ok: false, reason: "scan_failed" });
  expect(
    await outcome({ status: "pending", reason: "base_stale", revision: 2 }).port.decide(
      { source: "learning", id: "p", decision: "approve", revision: 1 },
      SIGNAL,
    ),
  ).toMatchObject({ ok: false, reason: "base_stale" });
  expect(
    await outcome({ status: "rejected", reason: "apply_failed" }).port.decide(
      { source: "learning", id: "p", decision: "approve", revision: 1 },
      SIGNAL,
    ),
  ).toMatchObject({ ok: false, reason: "unavailable" });
  // 적용이 일시 실패해 approved로 남았다: 성공이고 applied는 거짓이다(다음 목록 조회의 정리가 다시 적용한다)
  expect(
    await outcome({ status: "approved" }).port.decide(
      { source: "learning", id: "p", decision: "approve", revision: 1 },
      SIGNAL,
    ),
  ).toMatchObject({ ok: true, applied: false, proposal: { status: "approved" } });
  // 수정한 본문을 스캔이 막은 경우도 실패다
  expect(
    await outcome({ status: "rejected", reason: "scan_failed" }).port.decide(
      { source: "learning", id: "p", decision: "edit", revision: 1, body: "x" },
      SIGNAL,
    ),
  ).toMatchObject({ ok: false, reason: "scan_failed" });
});

test("proposal.decide says unavailable when the source cannot be reached", async () => {
  const learningDown = await rig({ learning: "down", knowledge: [] }).port.decide(
    { source: "learning", id: "p", decision: "reject" },
    SIGNAL,
  );
  expect(learningDown).toMatchObject({ ok: false, reason: "unavailable" });
  const knowledgeDown = await rig({ learning: [], knowledge: "down" }).port.decide(
    { source: "knowledge", id: "p", decision: "reject" },
    SIGNAL,
  );
  expect(knowledgeDown).toMatchObject({ ok: false, reason: "unavailable" });
});

test("proposal.list pages through more than 200 knowledge rows without losing any or ending early", async () => {
  const knowledge = Array.from({ length: 450 }, (_, n) =>
    row({ id: `knp_${String(n).padStart(4, "0")}`, createdAt: 100_000 - n }),
  );
  const learning = Array.from({ length: 3 }, (_, n) =>
    view({ id: `prop_${String(n)}`, createdAt: 99_700 - n }),
  );
  const { port } = rig({ learning, knowledge });
  const collected: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- 페이지는 차례로 읽는다
    const next = await port.list(
      { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
      SIGNAL,
    );
    collected.push(...next.proposals.map((entry) => entry.id));
    if (next.nextCursor === null) break;
    cursor = next.nextCursor;
  }
  expect(collected).toHaveLength(453);
  expect(new Set(collected).size).toBe(453);
});

test("proposal.list reports learning evidence it cannot put on the wire instead of dropping it silently", async () => {
  const { port, calls } = rig({
    learning: [view({ id: "prop_1", evidence: [{ eventId: "evt_1", threadId: "not-a-thread" }] })],
    knowledge: [],
  });
  const listed = await port.list({}, SIGNAL);
  expect(listed.proposals[0]?.evidence).toEqual([]);
  expect(calls.reports).toContain("proposal.evidence_dropped");
});
