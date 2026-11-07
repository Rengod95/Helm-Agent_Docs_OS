import { describe, expect, test } from "bun:test";
import type { DesktopIpc, EngineState } from "../../src/transport/ipc.ts";
import { engineFake, makeAppOver, until } from "./support.ts";

// 실패한 대상 전환 뒤의 복구(F-2). 엔진이 running으로 보였다가 hello에 답하지 못하고 내려간 뒤,
// 다른 대상이 running이 되면 새로고침 없이 다시 붙는다.

const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const FAILED: EngineState = {
  kind: "failed",
  attempts: 3,
  lastExit: { code: 3, signal: null, at: "2026-11-07T00:00:00.000Z" },
};

describe("session recovery after a failed target", () => {
  test("a hello that never got an answer does not park the loop once another engine runs", async () => {
    const engine = engineFake();
    const seen = { hellos: 0 };
    // 첫 hello는 엔진에 닿지 않는다(닫힌 포트로 가던 사이드카가 죽은 경우)
    const ipc: DesktopIpc = {
      ...engine.fake.ipc,
      write: (epoch, chunk) => {
        if (new TextDecoder().decode(chunk).includes('"host.hello"')) {
          seen.hellos += 1;
          if (seen.hellos === 1) return Promise.resolve({ ok: true, value: null });
        }
        return engine.fake.ipc.write(epoch, chunk);
      },
    };
    const app = makeAppOver(ipc);
    await until(() => seen.hellos === 1, "first hello");
    engine.fake.emitState(FAILED);
    await app.commands.connection.retarget({ kind: "local" });
    engine.fake.emitState(RUNNING);
    await until(() => app.engine.read.getState().link.phase === "live", "live again");
    expect(seen.hellos).toBe(2);
    await app.stop();
  });
});
