import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §4.1.17: 코어(내장 L1 단위 `core-*`)와 코어가 기대는 `cap-workspace`, `cap-dialog`는 프로필에 적지 않아도 항상 켜진다.
// 옛 결함: 프로필이 내장 단위를 모두 빼면(예: `[guide]`만) 코어 단위 `core-tasks`가 꺼져 `turn.start`가 60초 멈췄다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

async function runWith(plugins: readonly string[]): Promise<{
  readonly turnStarted: boolean;
  readonly completed: boolean;
  readonly enabled: readonly string[];
}> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS });
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-core-units-")));
  const provider = tapeProvider(
    tapePlayer(
      tape("core-units", [
        {
          role: "main" as const,
          label: "answer",
          response: {
            type: "message" as const,
            content: [t.text("ok.")],
            stopReason: "stop" as const,
          },
        },
      ]),
      { clock: realTapeClock() },
    ),
  );
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "xh-core-units-bundles-")),
    buildModels: tapeBuildModels(provider),
  });
  try {
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    await connection.request("profile.put", {
      profile: {
        id: "bare",
        title: "bare",
        plugins: plugins.map((name) => ({ name })),
        settings: [],
        driver: null,
      },
      baseRev: null,
    });
    const created = await connection.request("thread.create", { workspace, profileId: "bare" });
    // 멈춤이 결함이므로 모든 기다림에 시한을 둔다
    const turnStarted = await Promise.race([
      connection
        .request("turn.start", { threadId: created.threadId, input: "hi" })
        .then(() => true),
      Bun.sleep(10_000).then(() => false),
    ]);
    const completed =
      turnStarted &&
      (await Promise.race([
        collector.waitFor((event) => event.kind === "turn.completed").then(() => true),
        Bun.sleep(10_000).then(() => false),
      ]));
    const listed = await connection.request("ext.list", { threadId: created.threadId });
    const enabled = listed.extensions
      .filter((entry) => entry.status === "enabled")
      .map((entry) => entry.name);
    await connection.close();
    return { turnStarted, completed, enabled };
  } finally {
    await host.close();
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
  }
}

const CORE_UNITS = [
  "core-persistence",
  "core-tasks",
  "core-models",
  "core-context",
  "core-tools",
  "core-loop",
  "core-agents",
  "cap-workspace",
  "cap-dialog",
];

realTest(
  "a profile with only the guide still answers: core units and the units core needs stay on",
  async () => {
    const run = await runWith(["guide"]);
    expect(run.turnStarted).toBe(true);
    expect(run.completed).toBe(true);
    for (const name of CORE_UNITS) expect(run.enabled).toContain(name);
    expect(run.enabled).toContain("guide");
  },
  60_000,
);

realTest(
  "an empty profile answers too",
  async () => {
    const run = await runWith([]);
    expect(run.turnStarted).toBe(true);
    expect(run.completed).toBe(true);
    for (const name of CORE_UNITS) expect(run.enabled).toContain(name);
  },
  60_000,
);
