import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { attemptAsync, repeatAsync } from "@xeon/contracts";
import { WireError, type HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startService, type ServiceHandle } from "../../src/index.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  connectedClient,
  manualTime,
  scratchRuntimeDir,
  wireErrorOf,
} from "../fixtures/service-harness.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-80 (int): `l1.persistence.autoResume`은 기본 꺼짐이고 서비스 모드에서 켜면 표식이 남은 thread를 서비스가 시작 때 이어서 실행한다.
// 승인 대기 중 SIGKILL로 죽은 호스트의 저장소 위에서, 꺼진 서비스는 thread를 쥐지 않아 응답이 3002로 거절되고 켠 서비스는 쥔 뒤라 응답이 이어진다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const CRASH_HOST: string = join(import.meta.dir, "..", "fixtures", "crash-host.ts");

function serviceOptions(runtimeDir: string) {
  return {
    runtimeDir,
    assemble: {
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("resume", "finished."),
    },
    time: manualTime(),
    handleSignals: false,
    startupGraceMs: 0,
    idleGraceMs: 60_000,
  };
}

async function started(runtimeDir: string): Promise<ServiceHandle> {
  const result = await startService(serviceOptions(runtimeDir));
  if (!result.started) throw new Error(`the service did not start: ${result.reason}`);
  return result.handle;
}

/** 서비스가 thread를 쥘 때까지(3002) 짧게 다시 시도한다. 시한은 시험 시간 제한이 맡는다 */
function respondWhenOwned(client: HostConnection, approvalId: string): Promise<unknown> {
  const deadline = Date.now() + 15_000;
  return repeatAsync<unknown>(async () => {
    const sent = await attemptAsync(() =>
      client.request("approval.respond", { approvalId, decision: "allow" }),
    );
    if (sent.ok) return { value: sent.value };
    const cause = sent.error.cause;
    if (cause instanceof WireError && cause.code === 3002 && Date.now() < deadline) {
      await Bun.sleep(25);
      return undefined;
    }
    throw cause;
  });
}

realTest(
  "autoResume off leaves the interrupted thread to the user; on, the service resumes it and the approval answer continues the turn",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
    const workspace = mkdtempSync(join(tmpdir(), "xsvc-ar-"));
    const previousCwd = process.cwd();
    const child = Bun.spawn([process.execPath, CRASH_HOST], {
      cwd: workspace,
      env: { ...process.env, XEON_HOME: home.root },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      // 1. 첫 호스트가 승인 대기까지 가고 SIGKILL로 죽는다
      const first = createHostConnection(
        createStdioTransport({
          readable: child.stdout,
          writable: new WritableStream<Uint8Array>({
            async write(chunk) {
              await child.stdin.write(chunk);
              await child.stdin.flush();
            },
          }),
        }),
      );
      await first.request("host.hello", HELLO_PARAMS);
      const seen = collectEvents(first);
      await first.request("events.subscribe", { from: "head" });
      const created = await first.request("thread.create", { workspace });
      await first.request("turn.start", { threadId: created.threadId, input: "run it" });
      const asked = await seen.waitFor((event) => event.kind === "approval.requested");
      child.kill("SIGKILL");
      await child.exited;

      process.chdir(workspace);

      // 2. 자동 재개가 꺼진 서비스: thread를 쥐지 않으므로 응답은 소유가 없어 3002다
      const offRuntime = scratchRuntimeDir();
      const off = await started(offRuntime.dir);
      try {
        const client = await connectedClient({ kind: "unix", path: off.registration.socket });
        const listed = (await client.request("thread.list", {})).threads.find(
          (row) => row.threadId === created.threadId,
        );
        expect(listed?.resumable).not.toBeNull();
        const refused = await wireErrorOf(
          client.request("approval.respond", { approvalId: asked.id, decision: "allow" }),
        );
        expect(refused).toBeInstanceOf(WireError);
        expect(refused.code).toBe(3002);
        await client.close();
      } finally {
        await off.shutdown("stop");
        offRuntime.dispose();
      }

      // 3. 켠 서비스: 시작 때 표식이 남은 thread를 쓰기 소유로 열고 이어서 실행한다
      writeUserSettings(home, {
        ...TAPE_SETTINGS,
        "l0.sandbox.enabled": false,
        "l1.persistence.autoResume": true,
      });
      const onRuntime = scratchRuntimeDir();
      const on = await started(onRuntime.dir);
      try {
        const client = await connectedClient({ kind: "unix", path: on.registration.socket });
        const collected = collectEvents(client);
        await client.request("events.subscribe", {
          from: "head",
          filter: { threadIds: [created.threadId] },
        });
        // 서비스가 시작 때 thread를 쥘 때까지 응답은 3002다. 쥔 뒤에는 응답이 적용된다
        const applied = await respondWhenOwned(client, asked.id);
        expect(applied).toEqual({ applied: true });
        const done = await collected.waitFor((event) => event.kind === "turn.completed");
        expect(done.payload).toMatchObject({ status: "completed" });
        await client.close();
      } finally {
        await on.shutdown("stop");
        onRuntime.dispose();
      }
    } finally {
      child.kill("SIGKILL");
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  90_000,
);
