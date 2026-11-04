import { describe, expect, test } from "bun:test";
import type { DesktopIpc, RestartOptions } from "../../src/transport/ipc.ts";
import { engineFake, makeApp, makeAppOver } from "./support.ts";

// 다시 시작 명령(`commands.restartEngine`)과 필요 목록 기록(`commands.noteRestartNeeded`)을 가짜 ipc 위에서 본다.
// 셸이 받은 옵션은 가짜 ipc의 `restarts`에 그대로 남는다.

describe("engine restart commands", () => {
  test("a confirmed restart reaches the shell with confirmed true and reports the shell's yes", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    expect(await app.commands.restartEngine({ confirmed: true })).toBe(true);
    expect(engine.fake.restarts).toEqual([{ confirmed: true }]);
    await app.stop();
  });

  test("a restart without options (the failed-state button) reaches the shell as an empty request", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    expect(await app.commands.restartEngine()).toBe(true);
    expect(engine.fake.restarts).toEqual([{}]);
    await app.stop();
  });

  test("a refused confirmed restart comes back as false and keeps the options it sent", async () => {
    const engine = engineFake();
    const seen: (RestartOptions | undefined)[] = [];
    const ipc: DesktopIpc = {
      ...engine.fake.ipc,
      restart: (options) => {
        seen.push(options);
        return Promise.resolve({
          ok: false,
          error: { kind: "command", command: "engine_restart", code: "not-confirmed" },
        });
      },
    };
    const app = makeAppOver(ipc);
    expect(await app.commands.restartEngine({ confirmed: true })).toBe(false);
    expect(seen).toEqual([{ confirmed: true }]);
    await app.stop();
  });

  test("the safe mode choices reach the shell with exactly their options, in order", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    expect(await app.commands.restartEngine({ safeMode: true, confirmed: true })).toBe(true);
    expect(await app.commands.restartEngine({ safeMode: false, confirmed: true })).toBe(true);
    expect(await app.commands.restartEngine({ confirmed: true })).toBe(true);
    expect(engine.fake.restarts).toEqual([
      { safeMode: true, confirmed: true },
      { safeMode: false, confirmed: true },
      { confirmed: true },
    ]);
    await app.stop();
  });

  test("noteRestartNeeded records each install or rollback once", async () => {
    const app = makeApp(engineFake().fake);
    app.commands.noteRestartNeeded({ kind: "install", name: "alpha" });
    app.commands.noteRestartNeeded({ kind: "install", name: "alpha" });
    app.commands.noteRestartNeeded({ kind: "rollback", name: "beta" });
    expect(app.ui.read.getState().restartNeeded).toEqual([
      { kind: "install", name: "alpha" },
      { kind: "rollback", name: "beta" },
    ]);
    await app.stop();
  });
});
