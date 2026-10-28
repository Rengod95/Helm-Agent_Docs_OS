import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import type { EventWire } from "@xeon/contracts/wire";
import { startService } from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { connectedClient, manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents } from "../fixtures/wire-client.ts";

// M3-REQ-45 (int): `ExecService.withCwd`의 대화별 cwd를 서비스 모드로 확인한다. 한 서비스 프로세스가 작업 폴더가 다른 두 대화를 동시에 열고,
// 각 대화의 `read`(상대 경로) 도구는 그 대화의 작업 폴더를 기준으로 파일을 읽는다. 엔진 프로세스의 cwd는 어느 쪽도 아니다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
// 서비스는 사용자 홈에서 뜬다(spec §4.4.6). 어느 작업 폴더도 엔진 프로세스의 cwd가 아니다
const engineCwd = realpathSync(mkdtempSync(join(tmpdir(), "xsvc-engine-cwd-")));
const previousCwd = process.cwd();
process.chdir(engineCwd);
const base = realpathSync(mkdtempSync(join(tmpdir(), "xsvc-cwd-")));
afterAll(() => {
  process.chdir(previousCwd);
  home.dispose();
  rmSync(base, { recursive: true, force: true });
  rmSync(engineCwd, { recursive: true, force: true });
});

function readStep(label: string, id: string) {
  return {
    role: "main" as const,
    label,
    response: {
      type: "message" as const,
      content: [t.toolCall("read", { path: "marker.txt" }, id)],
      stopReason: "toolUse" as const,
    },
  };
}

function finalStep(label: string) {
  return {
    role: "main" as const,
    label,
    response: { type: "message" as const, content: [t.text("done.")], stopReason: "stop" as const },
  };
}

function toolResultText(events: readonly EventWire[]): string {
  return events
    .filter((event) => event.kind === "item.recorded")
    .map((event) => JSON.stringify(event.payload))
    .filter((text) => text.includes('"kind":"toolResult"'))
    .join("\n");
}

realTest(
  "two threads with different workspaces in one service each read marker.txt relative to their own workspace",
  async () => {
    const alpha = join(base, "alpha");
    const beta = join(base, "beta");
    mkdirSync(alpha, { recursive: true });
    mkdirSync(beta, { recursive: true });
    writeFileSync(join(alpha, "marker.txt"), "ALPHA-CONTENT\n");
    writeFileSync(join(beta, "marker.txt"), "BETA-CONTENT\n");
    writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
    const runtime = scratchRuntimeDir();
    const models = tapeBuildModels(
      tapeProvider(
        tapePlayer(
          tape("svc-cwd", [
            readStep("alpha reads", "call_a"),
            finalStep("alpha answers"),
            readStep("beta reads", "call_b"),
            finalStep("beta answers"),
          ]),
          { clock: realTapeClock() },
        ),
      ),
    );
    const started = await startService({
      runtimeDir: runtime.dir,
      assemble: { devChecks: true, defaultGroups: false, buildModels: models },
      time: manualTime(),
      handleSignals: false,
      startupGraceMs: 0,
      idleGraceMs: 60_000,
    });
    if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
    const { handle } = started;
    try {
      const first = await connectedClient({ kind: "unix", path: handle.registration.socket });
      const second = await connectedClient({ kind: "unix", path: handle.registration.socket });
      const firstEvents = collectEvents(first);
      const secondEvents = collectEvents(second);
      await first.request("events.subscribe", { from: "head" });
      await second.request("events.subscribe", { from: "head" });
      // 두 연결이 서로 다른 작업 폴더의 thread를 동시에 연다
      const a = await first.request("thread.create", { workspace: alpha });
      const b = await second.request("thread.create", { workspace: beta });
      await first.request("turn.start", { threadId: a.threadId, input: "read the marker" });
      await firstEvents.waitFor(
        (event) => event.kind === "turn.completed" && event.threadId === a.threadId,
      );
      await second.request("turn.start", { threadId: b.threadId, input: "read the marker" });
      await secondEvents.waitFor(
        (event) => event.kind === "turn.completed" && event.threadId === b.threadId,
      );
      const alphaResults = toolResultText(
        firstEvents.events.filter((event) => event.threadId === a.threadId),
      );
      const betaResults = toolResultText(
        secondEvents.events.filter((event) => event.threadId === b.threadId),
      );
      expect(alphaResults).toContain("ALPHA-CONTENT");
      expect(alphaResults).not.toContain("BETA-CONTENT");
      expect(betaResults).toContain("BETA-CONTENT");
      expect(betaResults).not.toContain("ALPHA-CONTENT");
      await first.close();
      await second.close();
    } finally {
      await handle.shutdown("stop");
      runtime.dispose();
    }
  },
  60_000,
);
