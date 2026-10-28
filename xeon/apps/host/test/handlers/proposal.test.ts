import { expect, test } from "bun:test";
import { WireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { invalidParams } from "../fixtures/unsafe.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// proposal.list, proposal.decide(F wire §3.3.1, M3-REQ-18). 가짜 엔진 위의 실제 처리기다. 두 대기열을 합치는 포트의 시험은
// test/assembly/proposals.test.ts이고, 실제 두 대기열 위의 시험은 test/int/proposals.int.test.ts다.

const ROW: WireResult<"proposal.list">["proposals"][number] = {
  source: "learning",
  id: "prop_1",
  kind: "skill",
  op: "create",
  target: "release-notes",
  status: "pending",
  destructive: false,
  diff: "+ x",
  rationale: "asked twice",
  evidence: [],
  conflictsWith: null,
  reason: null,
  revision: 1,
  scope: "user",
  afterUntrusted: false,
  createdAt: 1000,
};

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

test("proposal.list passes the filters on and returns the merged list with its unavailable sources", async () => {
  const asked: WireParams<"proposal.list">[] = [];
  const answer: WireResult<"proposal.list"> = {
    proposals: [ROW],
    nextCursor: "abc",
    unavailable: ["knowledge"],
  };
  const host = createFakeHost({
    overrides: {
      proposals: {
        list: (params) => {
          asked.push(params);
          return Promise.resolve(answer);
        },
      },
    },
  });
  const connection = await open(host);
  const params: WireParams<"proposal.list"> = {
    source: "learning",
    status: ["pending", "approved"],
    limit: 20,
    cursor: "xyz",
  };
  expect(await connection.request("proposal.list", params)).toEqual(answer);
  expect(asked).toEqual([params]);
  await connection.close();
});

test("proposal.decide returns a decision value, failures included, and passes every decision variant on", async () => {
  const seen: WireParams<"proposal.decide">[] = [];
  const host = createFakeHost({
    overrides: {
      proposals: {
        decide: (params) => {
          seen.push(params);
          return Promise.resolve(
            params.decision === "approve" && params.revision === 9
              ? {
                  ok: false as const,
                  reason: "revision_mismatch" as const,
                  detail: "current revision is 2",
                }
              : { ok: true as const, proposal: ROW, applied: params.decision === "approve" },
          );
        },
      },
    },
  });
  const connection = await open(host);
  const approve = await connection.request("proposal.decide", {
    source: "learning",
    id: "prop_1",
    decision: "approve",
    revision: 1,
    scope: "project",
  });
  expect(approve).toEqual({ ok: true, proposal: ROW, applied: true });
  // 결정 실패는 JSON-RPC 오류가 아니라 오류 값이다
  const stale = await connection.request("proposal.decide", {
    source: "knowledge",
    id: "knp_1",
    decision: "approve",
    revision: 9,
  });
  expect(stale).toEqual({
    ok: false,
    reason: "revision_mismatch",
    detail: "current revision is 2",
  });
  await connection.request("proposal.decide", {
    source: "learning",
    id: "prop_1",
    decision: "reject",
    note: "no",
  });
  await connection.request("proposal.decide", {
    source: "learning",
    id: "prop_1",
    decision: "edit",
    revision: 1,
    body: "b",
  });
  await connection.request("proposal.decide", {
    source: "learning",
    id: "prop_1",
    decision: "revert",
  });
  expect(seen.map((params) => params.decision)).toEqual([
    "approve",
    "approve",
    "reject",
    "edit",
    "revert",
  ]);
  await connection.close();
});

test("proposal.decide without the revision of an approve or an edit is invalid params (-32602), and never reaches the port", async () => {
  let reached = 0;
  const host = createFakeHost({
    overrides: {
      proposals: {
        decide: () => {
          reached += 1;
          return Promise.resolve({ ok: false as const, reason: "unavailable" as const });
        },
      },
    },
  });
  const connection = await open(host);
  const noRevision = await wireErrorOf(
    connection.request(
      "proposal.decide",
      invalidParams({ source: "learning", id: "prop_1", decision: "approve" }),
    ),
  );
  expect(noRevision.code).toBe(-32602);
  const noEditRevision = await wireErrorOf(
    connection.request(
      "proposal.decide",
      invalidParams({ source: "learning", id: "prop_1", decision: "edit", body: "x" }),
    ),
  );
  expect(noEditRevision.code).toBe(-32602);
  expect(reached).toBe(0);
  await connection.close();
});

test("proposal.list and proposal.decide are advertised as implemented methods", async () => {
  const host = createFakeHost({});
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const methods = JSON.stringify(hello);
  expect(methods).toContain("proposal.list");
  expect(methods).toContain("proposal.decide");
  await connection.close();
});
