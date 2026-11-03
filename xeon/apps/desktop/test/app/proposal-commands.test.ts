import { describe, expect, test } from "bun:test";
import type { ProposalRow } from "@fresnel/contracts/wire";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { ProposalRowVM } from "@fresnel/client/settings";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 제안 명령(`commands.proposals`)을 가짜 엔진 위에서 끝까지 돌린다. 목록과 결정의 wire params가 정확한지, 결과가 화면 값으로
// 바뀌는지 본다. 값은 `toEqual`로 비교한다.

const THREAD = (() => {
  const parsed = parse(ThreadIdSchema, "thr_00000000000000000000000001");
  if (!parsed.ok) throw new Error("test id must parse");
  return parsed.value;
})();

const ROW: ProposalRow = {
  source: "learning",
  id: "p1",
  kind: "skill",
  op: "create",
  target: "skills/review.md",
  status: "pending",
  destructive: false,
  diff: "+ line",
  rationale: null,
  evidence: [{ eventId: "evt_1", threadId: THREAD }],
  conflictsWith: null,
  reason: null,
  revision: 3,
  scope: null,
  afterUntrusted: false,
  createdAt: 1000,
};

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

describe("proposal.list", () => {
  test("the filters and cursor go out as the wire names them, and the page becomes view rows", async () => {
    const { app, params } = await liveApp({
      results: {
        "proposal.list": {
          proposals: [ROW],
          nextCursor: "cur-2",
          unavailable: ["knowledge"],
        },
      },
    });
    const listed = await app.commands.proposals.list({
      status: ["pending"],
      source: "learning",
      cursor: "cur-1",
    });
    expect(paramsOf(params, "proposal.list")).toEqual({
      status: ["pending"],
      source: "learning",
      cursor: "cur-1",
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error("expected a list");
    expect(listed.value.nextCursor).toBe("cur-2");
    expect(listed.value.unavailableTexts).toEqual(["지식 제안을 불러오지 못했어요"]);
    expect(
      listed.value.rows.map((row) => [row.key, row.kind, row.statusLabel, row.actions]),
    ).toEqual([["learning:p1", "skill", "대기 중", ["approve", "reject", "edit"]]]);
    expect(listed.value.rows[0]?.evidenceThreadIds).toEqual([THREAD]);
    await app.stop();
  });

  test("a host that cannot read the list gives a command error, not a value", async () => {
    const { app } = await liveApp({
      errors: { "proposal.list": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.proposals.list({})).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });
});

describe("proposal.decide", () => {
  test("an approval sends the row's identity, the revision seen and the chosen scope", async () => {
    const { app, params } = await liveApp({
      results: {
        "proposal.decide": { ok: true, proposal: { ...ROW, status: "applied" }, applied: true },
      },
    });
    const decided = await app.commands.proposals.decide({
      source: "learning",
      id: "p1",
      decision: "approve",
      revision: 3,
      scope: "project",
    });
    expect(paramsOf(params, "proposal.decide")).toEqual({
      source: "learning",
      id: "p1",
      decision: "approve",
      revision: 3,
      scope: "project",
    });
    expect(decided).toEqual({
      ok: true,
      value: {
        kind: "done",
        applied: true,
        proposal: expectedAppliedVM(),
      },
    });
    await app.stop();
  });

  test("a stale revision comes back as the reload failure sentence, with reload set", async () => {
    const { app } = await liveApp({
      results: {
        "proposal.decide": { ok: false, reason: "revision_mismatch" },
      },
    });
    const decided = await app.commands.proposals.decide({
      source: "learning",
      id: "p1",
      decision: "approve",
      revision: 2,
    });
    expect(decided).toEqual({
      ok: true,
      value: {
        kind: "failed",
        text: "다른 곳에서 제안이 바뀌었어요. 목록을 새로 불러왔어요",
        reload: true,
      },
    });
    await app.stop();
  });

  test("a revert sends only the target and the decision", async () => {
    const { app, params } = await liveApp({
      results: {
        "proposal.decide": { ok: true, proposal: { ...ROW, status: "reverted" }, applied: false },
      },
    });
    await app.commands.proposals.decide({ source: "learning", id: "p1", decision: "revert" });
    expect(paramsOf(params, "proposal.decide")).toEqual({
      source: "learning",
      id: "p1",
      decision: "revert",
    });
    await app.stop();
  });
});

/** 적용 뒤 행의 화면 값. 상태 문장과 행 동작만 본다 */
function expectedAppliedVM(): ProposalRowVM {
  return {
    key: "learning:p1",
    source: "learning",
    sourceLabel: "학습",
    id: "p1",
    kind: "skill",
    kindLabel: "스킬",
    op: "create",
    target: "skills/review.md",
    statusLabel: "적용됨",
    status: "applied",
    actions: ["revert"],
    destructive: false,
    afterUntrusted: false,
    conflictsWith: null,
    reason: null,
    diff: "+ line",
    rationale: null,
    evidenceCount: 1,
    evidenceThreadIds: [THREAD],
    revision: 3,
    scopeChoice: { allowed: ["user", "project"], initial: "user" },
    createdAt: 1000,
  };
}
