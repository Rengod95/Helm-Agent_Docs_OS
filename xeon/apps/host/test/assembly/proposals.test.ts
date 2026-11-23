import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { CapabilityError, type CallOptions } from "@fresnel/contracts/capabilities";
import type {
  CommonSet,
  Profile,
  ProposalDecideParams,
  ProposalDecideResult,
  ProposalRow,
} from "@fresnel/contracts/wire";
import type { KnowledgeProposalListInput, KnowledgeProposalWire } from "@fresnel/cap-knowledge";
import type { RegistrationStatus } from "@fresnel/contracts/extensions";
import {
  createProposalPort,
  pluginNamesInProfiles,
  suggestEnabledOf,
  suggestGateOf,
  type SuggestRegistration,
} from "../../src/assembly/proposals.ts";

// M3-REQ-18: `proposal.list`·`proposal.decide`의 포트. 학습 그룹은 빌트인에서 빠졌다(AGE-49): 목록은 지식 대기열만 읽고, 학습 출처는 늘 `unavailable`이고
// 결정은 거절한다. 가짜 지식 대기열 위의 시험이다. 실제 엔진 위의 시험은 test/int/proposals.int.test.ts다.

const SIGNAL = new AbortController().signal;
const LEARNING_NOT_BUILT_IN: ProposalDecideResult = {
  ok: false,
  reason: "unavailable",
  detail: "the learning plugin is not built in",
};

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
    note: null,
    revision: 1,
    scope: null,
    afterUntrusted: false,
    createdAt: 1000,
    expiresAt: null,
    ...patch,
  };
}

interface Calls {
  readonly knowledgeLists: {
    input: KnowledgeProposalListInput;
    options: CallOptions | undefined;
  }[];
  readonly knowledgeDecides: { params: ProposalDecideParams; options: CallOptions }[];
  readonly reports: string[];
}

function rig(options: {
  /** 지식 대기열의 행. `down`이면 지식 어댑터가 없고, `throws`면 읽기가 실패한다 */
  readonly knowledge?: readonly ProposalRow[] | "down" | "throws";
  /** 제안 플러그인이 켜져 있는가. 생략하면 켜져 있다 */
  readonly suggestEnabled?: boolean;
  /** 게이트를 직접 준다(등록과 프로필에서 `suggestGateOf`로 정하는 시험). 주면 `suggestEnabled`는 쓰지 않는다 */
  readonly gate?: () => Promise<boolean>;
}) {
  const gate = { suggestEnabled: options.suggestEnabled ?? true };
  const calls: Calls = { knowledgeLists: [], knowledgeDecides: [], reports: [] };
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
    decide: (params, callOptions) => {
      calls.knowledgeDecides.push({ params, options: callOptions });
      return Promise.resolve({
        ok: true,
        proposal: row({ id: params.id }),
        applied: params.decision === "approve",
      });
    },
  };
  const port = createProposalPort({
    knowledge: () => (options.knowledge === "down" ? undefined : wire),
    suggestEnabled: options.gate ?? (async () => gate.suggestEnabled),
    report: (message) => {
      calls.reports.push(message);
    },
  });
  return {
    port,
    calls,
    setSuggestEnabled: (enabled: boolean): void => {
      gate.suggestEnabled = enabled;
    },
  };
}

// ── proposal.list ───────────────────────────────────────────────────────

test("proposal.list orders the knowledge queue newest first and breaks ties by id ascending", async () => {
  const { port } = rig({
    knowledge: [
      row({ id: "knp_z", createdAt: 2000 }),
      row({ id: "knp_y", createdAt: 2000 }),
      row({ id: "knp_x", createdAt: 500 }),
      row({ id: "knp_w", createdAt: 3000 }),
    ],
  });
  const listed = await port.list({}, SIGNAL);
  expect(listed.proposals.map((entry) => [entry.source, entry.id])).toEqual([
    ["knowledge", "knp_w"],
    ["knowledge", "knp_y"],
    ["knowledge", "knp_z"],
    ["knowledge", "knp_x"],
  ]);
  expect(listed.unavailable).toEqual([]);
  expect(listed.nextCursor).toBeNull();
});

test("proposal.list without a source reads only the knowledge queue and reports no unavailable source", async () => {
  const { port, calls } = rig({ knowledge: [row({ id: "knp_1" })] });
  const listed = await port.list({}, SIGNAL);
  expect(listed).toEqual({
    proposals: [row({ id: "knp_1" })],
    nextCursor: null,
    unavailable: [],
  });
  expect(calls.knowledgeLists).toHaveLength(1);
});

test("proposal.list asked for the learning source returns no rows and reports learning unavailable, and never reads the knowledge queue", async () => {
  const { port, calls } = rig({ knowledge: [row({ id: "knp_1" })] });
  expect(await port.list({ source: "learning" }, SIGNAL)).toEqual({
    proposals: [],
    nextCursor: null,
    unavailable: ["learning"],
  });
  // 상태 거름이 있어도 학습 출처는 빈 목록이고 `unavailable`이다
  expect(await port.list({ source: "learning", status: ["pending"] }, SIGNAL)).toEqual({
    proposals: [],
    nextCursor: null,
    unavailable: ["learning"],
  });
  expect(calls.knowledgeLists).toEqual([]);
  expect(calls.reports).toEqual([]);
});

test("proposal.list with a knowledge source reads only the knowledge queue and reports nothing unavailable", async () => {
  const { port, calls } = rig({ knowledge: [row({ id: "knp_1" })] });
  const listed = await port.list({ source: "knowledge" }, SIGNAL);
  expect(listed).toEqual({ proposals: [row({ id: "knp_1" })], nextCursor: null, unavailable: [] });
  expect(calls.knowledgeLists).toHaveLength(1);
});

test("proposal.list reports the knowledge queue as unavailable when its adapter is missing or its read fails, and keeps the rest of the answer", async () => {
  const knowledgeDown = await rig({ knowledge: "down" }).port.list({ source: "knowledge" }, SIGNAL);
  expect(knowledgeDown).toEqual({ proposals: [], nextCursor: null, unavailable: ["knowledge"] });
  const throwing = rig({ knowledge: "throws" });
  const result = await throwing.port.list({}, SIGNAL);
  expect(result).toEqual({ proposals: [], nextCursor: null, unavailable: ["knowledge"] });
  expect(throwing.calls.reports).toEqual(["proposal.knowledge_list_failed"]);
});

test("proposal.list applies the status filter on the server for the knowledge queue", async () => {
  const { port, calls } = rig({
    knowledge: [row({ id: "knp_a", status: "stale" }), row({ id: "knp_b", status: "applied" })],
  });
  const stale = await port.list({ status: ["stale"] }, SIGNAL);
  expect(stale.proposals.map((entry) => entry.id)).toEqual(["knp_a"]);
  expect(stale.unavailable).toEqual([]);
  const applied = await port.list({ status: ["applied", "reverted"] }, SIGNAL);
  expect(applied.proposals.map((entry) => entry.id)).toEqual(["knp_b"]);
  expect(calls.knowledgeLists.at(-1)?.input.status).toEqual(["applied", "reverted"]);
});

test("proposal.list pages with an opaque cursor and the pages together are the whole knowledge list, ties included", async () => {
  // 두 행씩 같은 시각이라 쪽 경계가 같은 시각 한가운데 걸린다
  const knowledge = Array.from({ length: 9 }, (_, n) =>
    row({ id: `knp_${String(n)}`, createdAt: 5000 - Math.floor(n / 2) * 10 }),
  );
  const { port } = rig({ knowledge });
  const whole = await port.list({ limit: 200 }, SIGNAL);
  expect(whole.proposals.map((entry) => entry.id)).toEqual(knowledge.map((entry) => entry.id));
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

test("proposal.list calls the knowledge queue as the host, not as an extension or a model", async () => {
  const { port, calls } = rig({ knowledge: [] });
  await port.list({}, SIGNAL);
  expect(calls.knowledgeLists[0]?.options?.context).toEqual({ caller: { kind: "host" } });
  expect(calls.knowledgeLists[0]?.options?.signal).toBe(SIGNAL);
});

test("proposal.list pages through more than 200 knowledge rows without losing any or ending early", async () => {
  const knowledge = Array.from({ length: 450 }, (_, n) =>
    row({ id: `knp_${String(n).padStart(4, "0")}`, createdAt: 100_000 - n }),
  );
  const { port } = rig({ knowledge });
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
  expect(collected).toEqual(knowledge.map((entry) => entry.id));
});

// ── proposal.decide ─────────────────────────────────────────────────────

test("proposal.decide routes a knowledge decision to the knowledge queue as the host", async () => {
  const { port, calls } = rig({ knowledge: [] });
  const decided = await port.decide(
    { source: "knowledge", id: "knp_1", decision: "approve", revision: 1, scope: "user" },
    SIGNAL,
  );
  expect(decided).toEqual({
    ok: true,
    applied: true,
    proposal: row({ id: "knp_1" }),
  });
  expect(calls.knowledgeDecides).toHaveLength(1);
  expect(calls.knowledgeDecides[0]?.options.context).toEqual({ caller: { kind: "host" } });
});

test("proposal.decide on the learning source fails as unavailable for every decision, and touches neither queue", async () => {
  const { port, calls } = rig({ knowledge: [] });
  const variants: ProposalDecideParams[] = [
    { source: "learning", id: "prop_1", decision: "approve", revision: 1 },
    { source: "learning", id: "prop_1", decision: "approve", revision: 3, scope: "project" },
    { source: "learning", id: "prop_1", decision: "reject", note: "too vague" },
    { source: "learning", id: "prop_1", decision: "edit", revision: 2, body: "new body" },
    { source: "learning", id: "prop_1", decision: "revert" },
  ];
  const results = await Promise.all(variants.map((params) => port.decide(params, SIGNAL)));
  expect(results).toEqual(variants.map(() => LEARNING_NOT_BUILT_IN));
  expect(calls.knowledgeDecides).toEqual([]);
  expect(calls.reports).toEqual([]);
});

test("proposal.decide on the knowledge source says unavailable when the knowledge queue is missing", async () => {
  const knowledgeDown = await rig({ knowledge: "down" }).port.decide(
    { source: "knowledge", id: "knp_1", decision: "reject" },
    SIGNAL,
  );
  expect(knowledgeDown).toEqual({
    ok: false,
    reason: "unavailable",
    detail: "knowledge store is not available",
  });
});

// ── 제안 플러그인의 켜짐 게이트 ─────────────────────────────────────────

test("with the suggest plugin off, proposal.list reports knowledge unavailable with no rows and does not read the queue", async () => {
  const { port, calls } = rig({ knowledge: [row({ id: "knp_1" })], suggestEnabled: false });
  expect(await port.list({}, SIGNAL)).toEqual({
    proposals: [],
    nextCursor: null,
    unavailable: ["knowledge"],
  });
  expect(calls.knowledgeLists).toEqual([]);
});

test("with the suggest plugin off, proposal.decide is refused as unavailable and nothing is decided", async () => {
  const { port, calls } = rig({ knowledge: [], suggestEnabled: false });
  expect(
    await port.decide(
      { source: "knowledge", id: "knp_1", decision: "approve", revision: 1 },
      SIGNAL,
    ),
  ).toEqual({ ok: false, reason: "unavailable", detail: "the suggest plugin is off" });
  expect(
    await port.decide({ source: "knowledge", id: "knp_1", decision: "reject" }, SIGNAL),
  ).toEqual({ ok: false, reason: "unavailable", detail: "the suggest plugin is off" });
  expect(calls.knowledgeDecides).toEqual([]);
});

test("the gate does not change the learning source: it is still unavailable and the knowledge queue is not read", async () => {
  const { port, calls } = rig({ knowledge: [row({ id: "knp_1" })], suggestEnabled: false });
  expect(await port.list({ source: "learning" }, SIGNAL)).toEqual({
    proposals: [],
    nextCursor: null,
    unavailable: ["learning"],
  });
  expect(calls.knowledgeLists).toEqual([]);
});

test("turning the suggest plugin back on opens the list and the decision again at the next call", async () => {
  const { port, calls, setSuggestEnabled } = rig({
    knowledge: [row({ id: "knp_1", createdAt: 5 })],
    suggestEnabled: false,
  });
  expect((await port.list({}, SIGNAL)).unavailable).toEqual(["knowledge"]);
  setSuggestEnabled(true);
  const opened = await port.list({}, SIGNAL);
  expect(opened.unavailable).toEqual([]);
  expect(opened.proposals.map((entry) => entry.id)).toEqual(["knp_1"]);
  expect(calls.knowledgeLists).toHaveLength(1);
  setSuggestEnabled(false);
  expect(
    (await port.decide({ source: "knowledge", id: "knp_1", decision: "reject" }, SIGNAL)).ok,
  ).toBe(false);
  setSuggestEnabled(true);
  expect(
    (await port.decide({ source: "knowledge", id: "knp_1", decision: "reject" }, SIGNAL)).ok,
  ).toBe(true);
});

/** 등록 정보 한 줄의 대역. 게이트가 읽는 두 칸만 둔다 */
function registration(id: string, status: RegistrationStatus): SuggestRegistration {
  return { id, status };
}

/** 프로필 한 개의 대역. 게이트가 읽는 칸(플러그인 목록)만 실제 값으로 채운다 */
function profileWith(id: string, plugins: readonly string[]): Profile {
  return {
    id,
    title: id,
    builtin: id === "default",
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-24T00:00:00.000Z",
    rev: 1,
  };
}

function commonWith(plugins: readonly string[]): CommonSet {
  return {
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    updatedAt: "2026-11-24T00:00:00.000Z",
    rev: 1,
  };
}

test("suggestEnabledOf is true only for the enabled root registration named suggest that some profile holds", () => {
  const held = new Set(["suggest"]);
  expect(suggestEnabledOf([registration("suggest", "enabled")], held)).toBe(true);
  expect(suggestEnabledOf([registration("suggest", "disabled")], held)).toBe(false);
  expect(suggestEnabledOf([registration("suggest", "enabling")], held)).toBe(false);
  expect(suggestEnabledOf([registration("suggest", "disabling")], held)).toBe(false);
  expect(suggestEnabledOf([registration("helm", "enabled")], held)).toBe(false);
  expect(suggestEnabledOf([registration("suggest/child", "enabled")], held)).toBe(false);
  expect(suggestEnabledOf([], held)).toBe(false);
  // 등록이 켜져 있어도 어느 프로필에도 없으면 꺼짐이다
  expect(suggestEnabledOf([registration("suggest", "enabled")], new Set(["helm"]))).toBe(false);
  expect(suggestEnabledOf([registration("suggest", "enabled")], new Set())).toBe(false);
});

test("pluginNamesInProfiles reads every profile and the common set", () => {
  const names = pluginNamesInProfiles({
    profiles: [profileWith("default", ["helm", "suggest"]), profileWith("quiet", ["helm"])],
    common: commonWith(["cap-web"]),
  });
  expect([...names].toSorted()).toEqual(["cap-web", "helm", "suggest"]);
  expect([...pluginNamesInProfiles({ profiles: [], common: commonWith([]) })]).toEqual([]);
});

test("the gate follows profile membership: removing suggest from every profile closes the list and the decision, putting it back opens them", async () => {
  // 프로필 목록은 호출 때마다 읽는다. 바꾼 뒤 다음 호출에 반영돼야 한다
  let profiles: readonly Profile[] = [profileWith("default", ["helm", "suggest"])];
  const reports: string[] = [];
  const gate = (): Promise<boolean> =>
    suggestGateOf({
      registrations: () => [registration("suggest", "enabled")],
      profiles: () => Promise.resolve(ok({ profiles, common: commonWith([]) })),
      report: (message) => {
        reports.push(message);
      },
    });
  const { port, calls } = rig({ knowledge: [row({ id: "knp_1", createdAt: 5 })], gate });

  expect((await port.list({}, SIGNAL)).unavailable).toEqual([]);

  profiles = [profileWith("default", ["helm"])];
  expect(await port.list({}, SIGNAL)).toEqual({
    proposals: [],
    nextCursor: null,
    unavailable: ["knowledge"],
  });
  expect(
    await port.decide(
      { source: "knowledge", id: "knp_1", decision: "approve", revision: 1 },
      SIGNAL,
    ),
  ).toEqual({ ok: false, reason: "unavailable", detail: "the suggest plugin is off" });
  expect(calls.knowledgeDecides).toEqual([]);
  expect(reports).toEqual([]);

  profiles = [profileWith("default", ["helm", "suggest"])];
  const reopened = await port.list({}, SIGNAL);
  expect(reopened.unavailable).toEqual([]);
  expect(reopened.proposals.map((entry) => entry.id)).toEqual(["knp_1"]);
  expect(
    (await port.decide({ source: "knowledge", id: "knp_1", decision: "reject" }, SIGNAL)).ok,
  ).toBe(true);
});

test("suggest held only by the common set keeps the gate open", async () => {
  const open = await suggestGateOf({
    registrations: () => [registration("suggest", "enabled")],
    profiles: () =>
      Promise.resolve(
        ok({ profiles: [profileWith("quiet", ["helm"])], common: commonWith(["suggest"]) }),
      ),
    report: () => {},
  });
  expect(open).toBe(true);
});

test("without a registration or with a disabled one the gate is closed even when a profile holds suggest", async () => {
  const profiles = [profileWith("default", ["helm", "suggest"])];
  const closedWith = (regs: readonly SuggestRegistration[]): Promise<boolean> =>
    suggestGateOf({
      registrations: () => regs,
      profiles: () => Promise.resolve(ok({ profiles, common: commonWith([]) })),
      report: () => {},
    });
  expect(await closedWith([])).toBe(false);
  expect(await closedWith([registration("suggest", "disabled")])).toBe(false);
  expect(await closedWith([registration("suggest", "enabling")])).toBe(false);
});

test("when the profile list cannot be read the gate closes and the reason is logged, not the previous answer", async () => {
  const reports: { message: string; fields: unknown }[] = [];
  let failing = false;
  const gate = (): Promise<boolean> =>
    suggestGateOf({
      registrations: () => [registration("suggest", "enabled")],
      profiles: () =>
        failing
          ? Promise.resolve(err({ kind: "corrupt" }))
          : Promise.resolve(
              ok({ profiles: [profileWith("default", ["suggest"])], common: commonWith([]) }),
            ),
      report: (message, fields) => {
        reports.push({ message, fields });
      },
    });
  expect(await gate()).toBe(true);

  failing = true;
  expect(await gate()).toBe(false);
  expect(reports).toEqual([
    { message: "proposal.suggest_gate_unreadable", fields: { reason: "corrupt" } },
  ]);

  const { port } = rig({ knowledge: [row({ id: "knp_1" })], gate });
  expect((await port.list({}, SIGNAL)).unavailable).toEqual(["knowledge"]);
});

test("a profile read that throws also closes the gate and is logged", async () => {
  const reports: { message: string; fields: unknown }[] = [];
  const closed = await suggestGateOf({
    registrations: () => [registration("suggest", "enabled")],
    profiles: () => Promise.reject(new Error("boom")),
    report: (message, fields) => {
      reports.push({ message, fields });
    },
  });
  expect(closed).toBe(false);
  expect(reports).toEqual([
    { message: "proposal.suggest_gate_unreadable", fields: { reason: "threw" } },
  ]);
});
