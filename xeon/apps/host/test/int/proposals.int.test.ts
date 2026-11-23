import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { buildSuggestPlugin } from "@fresnel/plugin-suggest/build";
import { assemble } from "../../src/assemble.ts";
import type { AssembleOptions, Engine } from "../../src/types.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";

// M3-REQ-18(D-M3-32 a, D-M3-02): 실제 엔진(실제 cap-knowledge, 실제 세션 DB) 위의 `proposal.list`·`proposal.decide`. 학습 그룹은 빌트인에서 빠졌다(AGE-49):
// 기본 목록은 지식 대기열만 읽어 `unavailable`이 비고, 학습 출처는 빈 목록과 `unavailable: ["learning"]`이며 결정은 거절한다.
// 지식 대기열은 제안 플러그인(`suggest`)이 켜져 있을 때만 열린다(기본 번들에서 설치한다). 번들이 없으면 `unavailable: ["knowledge"]`다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SIGNAL = new AbortController().signal;
const closers: (() => Promise<void> | void)[] = [];
/** 제안 플러그인 번들이 든 기본 플러그인 폴더(`<뿌리>/suggest/`). 엔진이 첫 실행처럼 사용자 확장 위치에 설치한다 */
let bundleRoot: string;
/** 번들이 없는 기본 플러그인 폴더. 제안 플러그인이 설치되지 않은 엔진을 세운다 */
let emptyBundleRoot: string;
beforeAll(async () => {
  bundleRoot = mkdtempSync(join(tmpdir(), "proposals-suggest-bundle-"));
  const built = await buildSuggestPlugin(join(bundleRoot, "suggest"));
  if (!built.ok) throw new Error(`suggest plugin build failed: ${built.error.kind}`);
  emptyBundleRoot = mkdtempSync(join(tmpdir(), "proposals-no-bundle-"));
}, 60_000);
afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
  rmSync(emptyBundleRoot, { recursive: true, force: true });
});
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
  // 제안 플러그인은 엔진 안에서 싣는다(격리 자식을 띄우지 않는다). 다른 실제 엔진 시험과 같은 설정이다
  const engine = await assemble({
    mode: "in-process",
    defaultPluginsDir: bundleRoot,
    pluginHost: { disabled: true },
    ...options,
  });
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
  "without the suggest plugin installed, the knowledge queue is unavailable and a decision on it is refused as unavailable",
  async () => {
    const { engine } = await start({ defaultPluginsDir: emptyBundleRoot });
    expect(await engine.ports.proposals.list({}, SIGNAL)).toEqual({
      proposals: [],
      nextCursor: null,
      unavailable: ["knowledge"],
    });
    expect(
      await engine.ports.proposals.decide(
        { source: "knowledge", id: "knp_1", decision: "reject" },
        SIGNAL,
      ),
    ).toEqual({ ok: false, reason: "unavailable", detail: "the suggest plugin is off" });
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
