import { describe, expect, test } from "bun:test";
import {
  CapabilityError,
  KnowledgeLedger,
  type Proposal,
  type ProposalsInput,
} from "@fresnel/contracts/capabilities";
import type { ProposalRow } from "@fresnel/contracts/wire";
import { countPending, LEDGER_MAX, listSuggestions, type LedgerReader } from "../../src/queue.ts";

// 제안 목록과 개수의 값 시험. 가짜 대기열은 호스트 대기열(`ledger.proposals`)의 거르기, 정렬, `before` 위치를 흉내 낸다.
// 기록은 호출한 입력을 값으로 남기고, 시험은 그 값을 비교한다.

function proposalOf(
  patch: Partial<Proposal> & { proposalId: string; createdAt: number },
): Proposal {
  return {
    actor: { kind: "agent", sessionId: "session-1", agent: "main" },
    target: { kind: "memory", name: "user" },
    op: "memory.add",
    baseHash: null,
    status: "pending",
    preview: "+ 메모",
    scan: { rulesetVersion: "1", findings: [] },
    ...patch,
  };
}

/** 호스트 대기열의 정렬(최신순, 같은 시각은 id 내림차순)과 거르기를 흉내 낸 가짜 대기열 */
function fakeLedger(rows: readonly Proposal[], calls: ProposalsInput[]): LedgerReader {
  return {
    proposals: (input) => {
      calls.push(input);
      const statuses = input.statuses;
      const before = input.before;
      const listed = rows
        .filter((row) => statuses === undefined || statuses.includes(row.status))
        .filter(
          (row) =>
            before === undefined ||
            row.createdAt < before.createdAt ||
            (row.createdAt === before.createdAt && row.proposalId < before.proposalId),
        )
        .toSorted((a, b) =>
          a.createdAt !== b.createdAt
            ? b.createdAt - a.createdAt
            : a.proposalId < b.proposalId
              ? 1
              : a.proposalId > b.proposalId
                ? -1
                : 0,
        )
        .slice(0, input.limit ?? 50);
      return Promise.resolve({ proposals: listed });
    },
  };
}

function failingLedger(error: Error): LedgerReader {
  return {
    proposals: async () => {
      throw error;
    },
  };
}

/** 던진 오류의 메시지. 던지지 않으면 "resolved"다 */
function messageOf(pending: Promise<unknown>): Promise<string> {
  return pending.then(
    () => "resolved",
    (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)),
  );
}

function capabilityFailure(): CapabilityError {
  return new CapabilityError({
    capability: KnowledgeLedger.id,
    method: "proposals",
    code: "unavailable",
    message: "knowledge store is down",
    retryable: false,
  });
}

// 시험 대기열: 시각 300 하나, 시각 200 셋(id b, c, e), 시각 100 하나. c만 applied다.
const SAMPLE: readonly Proposal[] = [
  proposalOf({ proposalId: "knp_d", createdAt: 100 }),
  proposalOf({ proposalId: "knp_e", createdAt: 200 }),
  proposalOf({ proposalId: "knp_c", createdAt: 200, status: "applied" }),
  proposalOf({ proposalId: "knp_b", createdAt: 200 }),
  proposalOf({ proposalId: "knp_a", createdAt: 300 }),
];

function idsOf(rows: readonly ProposalRow[]): string[] {
  return rows.map((row) => row.id);
}

describe("listSuggestions", () => {
  test("lists the knowledge queue newest first and breaks ties by id ascending", async () => {
    const calls: ProposalsInput[] = [];
    const result = await listSuggestions(fakeLedger(SAMPLE, calls), {});
    expect(idsOf(result.proposals)).toEqual(["knp_a", "knp_b", "knp_c", "knp_e", "knp_d"]);
    expect(result.nextCursor).toBeNull();
    expect(result.unavailable).toEqual([]);
    expect(calls).toEqual([{ limit: 101 }]);
  });

  test("maps a queue row to the approval list row the way the host does", async () => {
    const result = await listSuggestions(
      fakeLedger(
        [
          proposalOf({
            proposalId: "knp_s",
            createdAt: 500,
            status: "stale",
            baseHash: "a".repeat(64),
            target: { kind: "skill", name: "review-tips", scope: "project" },
            op: "skill.patch",
            preview: "- 옛 줄\n+ 새 줄",
            afterUntrusted: true,
          }),
        ],
        [],
      ),
      {},
    );
    expect(result.proposals).toEqual([
      {
        source: "knowledge",
        id: "knp_s",
        kind: "skill",
        op: "skill.patch",
        target: "skill:review-tips",
        status: "stale",
        destructive: true,
        diff: "- 옛 줄\n+ 새 줄",
        rationale: null,
        evidence: [],
        conflictsWith: null,
        reason: "base_stale",
        note: null,
        revision: 1,
        scope: "project",
        afterUntrusted: true,
        createdAt: 500,
        expiresAt: null,
      },
    ]);
  });

  test("pages with an opaque cursor, and the pages together are the whole list with ties kept once", async () => {
    const calls: ProposalsInput[] = [];
    const ledger = fakeLedger(SAMPLE, calls);
    const first = await listSuggestions(ledger, { limit: 2 });
    expect(idsOf(first.proposals)).toEqual(["knp_a", "knp_b"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listSuggestions(ledger, { limit: 2, cursor: first.nextCursor ?? "" });
    expect(idsOf(second.proposals)).toEqual(["knp_c", "knp_e"]);
    expect(second.nextCursor).not.toBeNull();

    const third = await listSuggestions(ledger, { limit: 2, cursor: second.nextCursor ?? "" });
    expect(idsOf(third.proposals)).toEqual(["knp_d"]);
    expect(third.nextCursor).toBeNull();

    const together = [...first.proposals, ...second.proposals, ...third.proposals];
    expect(idsOf(together)).toEqual(["knp_a", "knp_b", "knp_c", "knp_e", "knp_d"]);
    // 다음 쪽은 앞 쪽의 마지막 행 시각 다음(`createdAt + 1`)부터 읽는다. 두 쪽 모두 마지막 행의 시각이 200이다
    expect(calls[1]?.before).toEqual({ createdAt: 201, proposalId: "" });
    expect(calls[2]?.before).toEqual({ createdAt: 201, proposalId: "" });
  });

  test("caps the page size at 100 even when a larger limit is asked", async () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      proposalOf({ proposalId: `knp_${String(index).padStart(3, "0")}`, createdAt: 1000 - index }),
    );
    const calls: ProposalsInput[] = [];
    const result = await listSuggestions(fakeLedger(many, calls), { limit: 500 });
    expect(result.proposals).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(calls[0]?.limit).toBe(151);
  });

  test("applies the status filter in the ledger and reads only the knowledge states", async () => {
    const calls: ProposalsInput[] = [];
    const result = await listSuggestions(fakeLedger(SAMPLE, calls), { status: ["pending"] });
    expect(idsOf(result.proposals)).toEqual(["knp_a", "knp_b", "knp_e", "knp_d"]);
    expect(calls[0]?.statuses).toEqual(["pending"]);
  });

  test("a status filter made only of learning states returns no rows and does not read the ledger", async () => {
    const calls: ProposalsInput[] = [];
    const result = await listSuggestions(fakeLedger(SAMPLE, calls), { status: ["approved"] });
    expect(result).toEqual({ proposals: [], nextCursor: null, unavailable: [] });
    expect(calls).toEqual([]);
  });

  test("a capability failure reports knowledge unavailable with no rows", async () => {
    const result = await listSuggestions(failingLedger(capabilityFailure()), {});
    expect(result).toEqual({ proposals: [], nextCursor: null, unavailable: ["knowledge"] });
  });

  test("a failure that is not a capability error is thrown to the caller", async () => {
    const message = await messageOf(listSuggestions(failingLedger(new Error("disk gone")), {}));
    expect(message).toBe("disk gone");
  });

  test("an unreadable cursor is treated as the first page", async () => {
    const calls: ProposalsInput[] = [];
    const result = await listSuggestions(fakeLedger(SAMPLE, calls), {
      limit: 2,
      cursor: "not-a-cursor",
    });
    expect(idsOf(result.proposals)).toEqual(["knp_a", "knp_b"]);
    expect(calls[0]?.before).toBeUndefined();
  });
});

describe("countPending", () => {
  test("counts only the pending proposals", async () => {
    const calls: ProposalsInput[] = [];
    expect(await countPending(fakeLedger(SAMPLE, calls))).toEqual({
      ok: true,
      count: 4,
      capped: false,
    });
    expect(calls).toEqual([{ statuses: ["pending"], limit: LEDGER_MAX }]);
  });

  test("counts up to the cap and says so when the list is full", async () => {
    const full = Array.from({ length: LEDGER_MAX + 1 }, (_, index) =>
      proposalOf({ proposalId: `knp_${index}`, createdAt: 10_000 - index }),
    );
    expect(await countPending(fakeLedger(full, []))).toEqual({
      ok: true,
      count: LEDGER_MAX,
      capped: true,
    });
  });

  test("a capability failure reports unavailable without a count", async () => {
    expect(await countPending(failingLedger(capabilityFailure()))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
