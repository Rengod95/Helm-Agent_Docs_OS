import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { assemble } from "../../src/assemble.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import type { AssembleOptions, Engine } from "../../src/types.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-18·104(D-M3-32 a, D-M3-02, D-M3-07): 실제 엔진(실제 cap-knowledge, 실제 세션 DB) 위에서 학습 그룹이 내장 그룹으로 서고, 합친 목록이 두 출처를
// 읽고, 학습 대기열의 승인이 `learning.queue` 증거로 L2 쓰기 경로를 거쳐 스킬 파일을 만든다. 안전 모드와 `defaultGroups: false`는 학습 그룹을 싣지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SIGNAL = new AbortController().signal;
const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).toReversed()) {
    // eslint-disable-next-line no-await-in-loop -- 만든 순서의 역순으로 차례로 닫는다
    await close();
  }
});

async function start(
  options: Partial<AssembleOptions> = {},
): Promise<{ engine: Engine; home: EngineHome }> {
  const home = useEngineHome();
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  const engine = await assemble({ mode: "in-process", ...options });
  closers.push(
    () => engine.close(),
    () => home.dispose(),
  );
  return { engine, home };
}

realTest(
  "the learning group is a built-in group: on by default, its queue is readable and the projection tables in the session database start empty",
  async () => {
    const { engine } = await start();
    const listed = await engine.ports.proposals.list({}, SIGNAL);
    // 학습 출처와 지식 출처가 모두 읽힌다(세션 DB의 x_learning_* 표는 엔진을 열 때 투영기를 등록하면서 만들어진다)
    expect(listed).toEqual({ proposals: [], nextCursor: null, unavailable: [] });
    expect(engine.catalog.has("l3.learning.trigger.userTurns")).toBe(true);
    expect(engine.catalog.get("l3.learning.curator.enabled")?.stage).toBe("reserved");
  },
);

realTest(
  "defaultGroups false and safe mode do not load the learning group, and L2 stays",
  async () => {
    const off = await start({ defaultGroups: false });
    expect(await off.engine.ports.proposals.list({}, SIGNAL)).toEqual({
      proposals: [],
      nextCursor: null,
      unavailable: ["learning"],
    });
    const safe = await start({ safeMode: true });
    expect(await safe.engine.ports.proposals.list({}, SIGNAL)).toEqual({
      proposals: [],
      nextCursor: null,
      unavailable: ["learning"],
    });
    // 결정은 오류 값이다: 꺼진 그룹의 후보를 승인할 수 없다
    const decided = await safe.engine.ports.proposals.decide(
      { source: "learning", id: "prop_1", decision: "reject" },
      SIGNAL,
    );
    expect(decided).toMatchObject({ ok: false, reason: "unavailable" });
  },
);

const PROPOSAL_ARGS = {
  kind: "skill",
  op: "create",
  target: "release-notes",
  body: "# Release notes\nWrite release notes from the merged pull requests.\n",
  description: "Use when the user asks for release notes.",
  rationale: "The user asked twice for the same release notes format.",
  evidenceEventIds: ["evt_00000000000000000000000001"],
};

interface Drive {
  readonly connection: ReturnType<typeof createHostConnection>;
  readonly home: EngineHome;
  readonly threadId: string;
  readonly toolText: string;
}

/**
 * 실제 엔진(SQLite 세션 DB, 실제 cap-knowledge)에서 모델이 `learning_propose`를 부르는 turn을 하나 돌린다. 도구 호출은 ambient 안에서
 * 비공개 기록을 남기고 투영기가 그 기록을 `x_learning_*` 행으로 접는다. 열린 대화는 결정을 실행할 곳이다
 */
async function driveOneProposal(): Promise<Drive> {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  const host = await startInProcessHost({
    devChecks: true,
    buildModels: callingModels("learning-uc3", [{ name: "learning_propose", args: PROPOSAL_ARGS }]),
  });
  const connection = createHostConnection(host.client);
  closers.push(
    async () => {
      await connection.close();
      await host.close();
    },
    () => home.dispose(),
  );
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  const created = await connection.request("thread.create", {});
  await connection.request("turn.start", {
    threadId: created.threadId,
    input: "write release notes",
  });
  // `learning_propose`는 읽기 위험을 선언해(builtin 그룹) 승인을 묻지 않는다
  await collector.waitFor((event) => event.kind === "turn.completed");
  expect(collector.events.some((event) => event.kind === "approval.requested")).toBe(false);
  return {
    connection,
    home,
    threadId: created.threadId,
    toolText: toolResultTexts(collector.events).join("\n"),
  };
}

realTest(
  "UC-3 on the real SQLite path: a candidate waits in the projected queue, no file changes before approval, and the approval applies it through learning.queue evidence",
  async () => {
    const { connection, home, toolText } = await driveOneProposal();
    const skillFile = join(home.dataDir, "skills", "release-notes", "SKILL.md");
    expect(toolText).toContain("proposalId");
    const listed = await connection.request("proposal.list", {});
    expect(listed.unavailable).toEqual([]);
    expect(listed.proposals).toHaveLength(1);
    const pending = listed.proposals[0];
    if (pending === undefined) throw new Error("the proposal was not projected");
    expect(pending).toMatchObject({
      source: "learning",
      status: "pending",
      kind: "skill",
      op: "create",
      target: "release-notes",
      scope: "user",
      revision: 1,
      afterUntrusted: false,
    });
    // 승인 전에는 스킬 파일이 없다
    expect(existsSync(skillFile)).toBe(false);
    const stale = await connection.request("proposal.decide", {
      source: "learning",
      id: pending.id,
      decision: "approve",
      revision: 2,
    });
    expect(stale).toMatchObject({ ok: false, reason: "revision_mismatch" });
    expect(existsSync(skillFile)).toBe(false);
    const approved = await connection.request("proposal.decide", {
      source: "learning",
      id: pending.id,
      decision: "approve",
      revision: 1,
    });
    expect(approved).toMatchObject({
      ok: true,
      applied: true,
      proposal: { source: "learning", status: "applied" },
    });
    // cap-knowledge가 `learning.queue` 증거를 믿어 승인이 한 번이고 파일이 생겼다
    expect(readFileSync(skillFile, "utf8")).toContain(
      "Write release notes from the merged pull requests.",
    );
    // 투영이 결정을 반영한다: 목록의 같은 행이 applied이고 같은 승인을 다시 보내면 닫힌 후보다
    const after = await connection.request("proposal.list", { status: ["applied"] });
    expect(after.proposals.map((row) => [row.id, row.status])).toEqual([[pending.id, "applied"]]);
    const again = await connection.request("proposal.decide", {
      source: "learning",
      id: pending.id,
      decision: "approve",
      revision: 1,
    });
    expect(again).toMatchObject({ ok: false, reason: "closed" });
  },
  60_000,
);

realTest(
  "a rejected or unknown learning proposal never touches the skill directory",
  async () => {
    const { connection, home } = await driveOneProposal();
    const listed = await connection.request("proposal.list", {});
    const pending = listed.proposals[0];
    if (pending === undefined) throw new Error("the proposal was not projected");
    const rejected = await connection.request("proposal.decide", {
      source: "learning",
      id: pending.id,
      decision: "reject",
      note: "no",
    });
    expect(rejected).toMatchObject({
      ok: true,
      applied: false,
      proposal: { status: "rejected", reason: "user_rejected" },
    });
    const missing = await connection.request("proposal.decide", {
      source: "learning",
      id: "prop_nope",
      decision: "approve",
      revision: 1,
    });
    expect(missing).toMatchObject({ ok: false, reason: "not_found" });
    expect(existsSync(join(home.dataDir, "skills", "release-notes"))).toBe(false);
  },
  60_000,
);

realTest(
  "a knowledge-only decision kind on the knowledge source is unsupported and a missing knowledge proposal is not_found",
  async () => {
    const { engine } = await start();
    const edit = await engine.ports.proposals.decide(
      {
        source: "knowledge",
        id: "knp_00000000000000000000000001",
        decision: "edit",
        revision: 1,
        body: "x",
      },
      SIGNAL,
    );
    expect(edit).toMatchObject({ ok: false, reason: "unsupported" });
    const revert = await engine.ports.proposals.decide(
      { source: "knowledge", id: "knp_00000000000000000000000001", decision: "revert" },
      SIGNAL,
    );
    expect(revert).toMatchObject({ ok: false, reason: "unsupported" });
    const missing = await engine.ports.proposals.decide(
      { source: "knowledge", id: "knp_00000000000000000000000001", decision: "reject" },
      SIGNAL,
    );
    expect(missing).toMatchObject({ ok: false, reason: "not_found" });
  },
);
