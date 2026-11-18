import { mkdirSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { assemble } from "../../src/assemble.ts";
import type { AssembleOptions, Engine } from "../../src/types.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";

// M3-REQ-18(D-M3-32 a, D-M3-02): 실제 엔진(실제 cap-knowledge, 실제 세션 DB) 위의 `proposal.list`·`proposal.decide`. 학습 그룹은 빌트인에서 빠졌다(AGE-49):
// 기본 목록은 지식 대기열만 읽어 `unavailable`이 비고, 학습 출처는 빈 목록과 `unavailable: ["learning"]`이며 결정은 거절한다.

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
  "the learning group is not built in: the default proposal list is empty with no unavailable source, and the knowledge source reads the same way",
  async () => {
    const { engine } = await start();
    expect(await engine.ports.proposals.list({}, SIGNAL)).toEqual({
      proposals: [],
      nextCursor: null,
      unavailable: [],
    });
    expect(await engine.ports.proposals.list({ source: "knowledge" }, SIGNAL)).toEqual({
      proposals: [],
      nextCursor: null,
      unavailable: [],
    });
    expect(engine.catalog.has("l3.learning.trigger.userTurns")).toBe(false);
  },
);

realTest(
  "asking for the learning source lists nothing and reports learning unavailable, and deciding on it is refused as unavailable",
  async () => {
    const { engine } = await start();
    expect(await engine.ports.proposals.list({ source: "learning" }, SIGNAL)).toEqual({
      proposals: [],
      nextCursor: null,
      unavailable: ["learning"],
    });
    const decided = await engine.ports.proposals.decide(
      { source: "learning", id: "prop_1", decision: "reject" },
      SIGNAL,
    );
    expect(decided).toEqual({
      ok: false,
      reason: "unavailable",
      detail: "the learning plugin is not built in",
    });
  },
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
