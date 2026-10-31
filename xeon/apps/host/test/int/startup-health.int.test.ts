import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { assemble } from "../../src/assemble.ts";
import { STARTUP_HEALTH_FILE } from "../../src/assembly/startup-health.ts";
import type { Engine } from "../../src/types.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";

// M4 X-21(Y12): 시작이 끝나지 못한 표시가 연속으로 쌓이면 다음 시작이 안전 모드 제안을 싣고, 시작을 마치면 수를 0으로 되돌린다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).toReversed()) {
    // eslint-disable-next-line no-await-in-loop -- 만든 순서의 역순으로 차례로 닫는다
    await close();
  }
});

async function start(
  seed: { readonly failures: number; readonly starting: boolean } | undefined,
  safeMode?: boolean,
): Promise<{ engine: Engine; home: EngineHome }> {
  const home = useEngineHome();
  if (seed !== undefined) {
    mkdirSync(join(home.root, "state"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home.root, "state", STARTUP_HEALTH_FILE), JSON.stringify(seed));
  }
  const engine = await assemble({
    mode: "in-process",
    ...(safeMode === undefined ? {} : { safeMode }),
  });
  closers.push(
    () => engine.close(),
    () => home.dispose(),
  );
  return { engine, home };
}

realTest(
  "two unfinished starts make the third start suggest safe mode, then the count resets",
  async () => {
    const { engine, home } = await start({ failures: 2, starting: true });
    expect(engine.startup).toEqual({ failures: 3, suggestSafeMode: true });
    const file = join(home.root, "state", STARTUP_HEALTH_FILE);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ failures: 0, starting: false });
  },
);

realTest(
  "a clean history suggests nothing, and an engine already in safe mode does not suggest it",
  async () => {
    const clean = await start(undefined);
    expect(clean.engine.startup).toEqual({ failures: 0, suggestSafeMode: false });
    const safe = await start({ failures: 4, starting: true }, true);
    expect(safe.engine.startup).toEqual({ failures: 5, suggestSafeMode: false });
  },
);
