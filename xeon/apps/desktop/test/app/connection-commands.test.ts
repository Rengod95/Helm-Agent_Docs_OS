import { describe, expect, test } from "bun:test";
import { TARGETS_KEY, type TargetEntry } from "@fresnel/client";
import type { WireResult } from "@fresnel/contracts/wire";
import type { DesktopIpc } from "../../src/transport/ipc.ts";
import { summary, thr } from "../state/helpers.ts";
import { fakeIpc } from "../transport/fake-ipc.ts";
import { engineFake, makeApp, makeAppOver, until, type EngineExtra } from "./support.ts";

// 연결 화면의 명령(`commands.connection`)을 가짜 ipc 위에서 돌린다. 대상 목록은 로컬 설정 파일의 값으로, 엔진 대상 바꾸기는
// 셸 명령 인자로, `host.status`와 서비스 모드·멈추기는 엔진 응답으로 본다. 값은 `toEqual`로 비교한다.

const SAVED: TargetEntry = {
  id: "t1",
  label: "build-box",
  address: "ssh://me@build/run/fresnel.sock",
};

const HOST_STATUS: WireResult<"host.status"> = {
  mode: "service",
  pid: 4211,
  startedAt: "2026-11-04T01:00:00.000Z",
  connections: 2,
  liveTurns: 1,
  idleShutdownAt: null,
  safeMode: false,
};

/** 설정 한 줄(`settings.get`·`settings.set`의 값 모양). 시험 값은 서비스 모드 키 하나다 */
function serviceSetting(value: unknown) {
  return {
    key: "l0.process.service.enabled",
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("saved remote targets live in the local settings file", () => {
  test("only the entries that pass the address rules come back", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    engine.fake.settingsFile[TARGETS_KEY] = [
      SAVED,
      { id: "t2", label: "open", address: "tcp://192.168.0.5:7421" },
      { id: "t3", label: "relative", address: "unix:run/fresnel.sock" },
      { label: "no id", address: "unix:/run/a.sock" },
    ];
    const listed = await app.commands.connection.targets();
    expect(listed).toEqual({ ok: true, value: [SAVED] });
    await app.stop();
  });

  test("saving writes the list under the window key and reading it back returns the same list", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    const saved = await app.commands.connection.saveTargets([SAVED]);
    expect(saved).toEqual({ ok: true, value: null });
    expect(engine.fake.settingsFile[TARGETS_KEY]).toEqual([SAVED]);
    expect(await app.commands.connection.targets()).toEqual({ ok: true, value: [SAVED] });
    await app.stop();
  });

  test("a write the shell refuses is a storage error value, not a throw", async () => {
    const base = fakeIpc();
    const ipc: DesktopIpc = {
      ...base.ipc,
      writeSettings: () =>
        Promise.resolve({
          ok: false,
          error: { kind: "command", command: "desktop_settings_write", code: "storage-failed" },
        }),
    };
    const app = makeAppOver(ipc);
    const saved = await app.commands.connection.saveTargets([SAVED]);
    expect(saved).toEqual({ ok: false, error: { kind: "storage" } });
    await app.stop();
  });
});

describe("retarget hands the engine target to the shell", () => {
  test("a remote target goes out as the address only, and a local one as the local kind", async () => {
    const engine = engineFake();
    const app = makeApp(engine.fake);
    const remote = await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
    });
    const local = await app.commands.connection.retarget({ kind: "local" });
    expect(remote).toEqual({ ok: true, value: null });
    expect(local).toEqual({ ok: true, value: null });
    expect(engine.fake.retargeted).toEqual([
      { kind: "remote", address: "ssh://me@build/run/fresnel.sock" },
      { kind: "local" },
    ]);
    await app.stop();
  });

  test("a shell refusal has no attach kind, so it is reported as other", async () => {
    const base = fakeIpc();
    const ipc: DesktopIpc = {
      ...base.ipc,
      retarget: () =>
        Promise.resolve({
          ok: false,
          error: { kind: "command", command: "engine_retarget", code: "bad-request" },
        }),
    };
    const app = makeAppOver(ipc);
    const done = await app.commands.connection.retarget({ kind: "remote", address: SAVED.address });
    expect(done).toEqual({ ok: false, error: "other" });
    await app.stop();
  });
});

describe("host status, service mode and stopping the service", () => {
  test("load returns host.status and whether the service mode is on", async () => {
    const { app } = await liveApp({
      results: {
        "host.status": HOST_STATUS,
        "settings.get": { settings: [serviceSetting(true)] },
      },
    });
    const loaded = await app.commands.connection.load();
    expect(loaded).toEqual({
      ok: true,
      value: { host: HOST_STATUS, serviceEnabled: true },
    });
    await app.stop();
  });

  test("with no connection, load is the offline command error", async () => {
    const base = fakeIpc();
    const ipc: DesktopIpc = {
      ...base.ipc,
      attach: () =>
        Promise.resolve({
          ok: false,
          error: { kind: "command", command: "engine_attach", code: "engine-not-running" },
        }),
    };
    const app = makeAppOver(ipc);
    const loaded = await app.commands.connection.load();
    expect(loaded).toEqual({ ok: false, error: { kind: "offline" } });
    await app.stop();
  });

  test("setting the service mode writes the user-scope key and the value", async () => {
    const { app, params } = await liveApp({
      results: { "settings.set": { setting: serviceSetting(false) } },
    });
    const written = await app.commands.connection.setServiceMode(false);
    expect(written).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual({
      key: "l0.process.service.enabled",
      value: false,
      scope: "user",
    });
    await app.stop();
  });

  test("stopping the service sends host.shutdown with the user reason and returns accepted", async () => {
    const { app, params } = await liveApp({
      results: { "host.shutdown": { accepted: true } },
    });
    const stopped = await app.commands.connection.stopService();
    expect(stopped).toEqual({ ok: true, value: true });
    expect(paramsOf(params, "host.shutdown")).toEqual({ reason: "user" });
    await app.stop();
  });
});

describe("retry restarts a stopped engine and re-attaches the rest", () => {
  test("a restart the engine accepts does not re-attach on its own", async () => {
    const engine = engineFake();
    let restarts = 0;
    const ipc: DesktopIpc = {
      ...engine.fake.ipc,
      restart: () => {
        restarts += 1;
        return Promise.resolve({ ok: true, value: null });
      },
    };
    const app = makeAppOver(ipc);
    await app.commands.connection.retry();
    expect(restarts).toBe(1);
    await app.stop();
  });
});
