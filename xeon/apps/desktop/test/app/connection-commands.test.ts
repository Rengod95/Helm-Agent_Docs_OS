import { describe, expect, test } from "bun:test";
import { LAST_TARGET_KEY, TARGETS_KEY, type TargetEntry } from "@fresnel/client";
import { err, ok, type Scheduler } from "@fresnel/contracts";
import { WIRE_ERRORS, type WireResult } from "@fresnel/contracts/wire";
import type { LogLine } from "../../src/app/logger.ts";
import type {
  DesktopIpc,
  EngineState,
  PreflightEvent,
  RestartOptions,
  ServiceAutostart,
  ServiceStatusReply,
} from "../../src/transport/ipc.ts";
import { summary, thr } from "../state/helpers.ts";
import { fakeIpc } from "../transport/fake-ipc.ts";
import { engineFake, makeApp, makeAppOver, until, type EngineExtra } from "./support.ts";

// 연결 화면의 명령(`commands.connection`)을 가짜 ipc 위에서 돌린다. 대상 목록은 로컬 설정 파일의 값으로, 엔진 대상 바꾸기는
// 셸 명령 인자로, `host.status`와 서비스 모드·멈추기는 엔진 응답으로 본다. 값은 `toEqual`로 비교한다.

const RUNNING_STATE: EngineState = { kind: "running", source: "sidecar", pid: 1 };

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

const REMOTE_KEY = "l0.process.service.allowRemoteRespond";
const SERVICE_KEY = "l0.process.service.enabled";

/** 원격 응답 허용 한 줄(`settings.get`의 값 모양) */
function remoteSetting(value: unknown) {
  return {
    key: REMOTE_KEY,
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

/** `settings.get`이 읽는 키 묶음만 보고 응답을 고른다. 두 키를 따로 읽으므로 인자로 가른다 */
const readOf = (keys: readonly string[]): string => JSON.stringify({ keys });

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
    const { fake } = engineFake([], (n) => (n === 1 ? RUNNING_STATE : { kind: "stopping" }));
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    const remote = await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
      label: SAVED.label,
    });
    // 바꾸는 동안에는 다음 바꾸기가 거절되므로 엔진이 내려갔다 올라오기를 기다린다
    fake.emitState({ kind: "stopping" });
    await until(() => app.engine.read.getState().engine?.kind === "stopping", "stopping");
    fake.emitState({ kind: "running", source: "sidecar", pid: 2 });
    await until(() => !app.ui.read.getState().engineSwitching, "hold released");
    const local = await app.commands.connection.retarget({ kind: "local" });
    expect(remote).toEqual({ ok: true, value: null });
    expect(local).toEqual({ ok: true, value: null });
    expect(fake.retargeted).toEqual([
      { kind: "remote", address: "ssh://me@build/run/fresnel.sock" },
      { kind: "local" },
    ]);
    await app.stop();
  });

  test("the connection screen's retarget holds writes as switching until the new engine runs", async () => {
    const { fake } = engineFake([], (n) => (n === 1 ? RUNNING_STATE : { kind: "stopping" }));
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    const done = await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
      label: SAVED.label,
    });
    expect(done).toEqual({ ok: true, value: null });
    expect(app.ui.read.getState().engineSwitching).toBe(true);
    const before = fake.written.length;
    expect(await app.commands.sendTurn(thr(1), "hi", "r1")).toEqual({
      ok: false,
      error: { kind: "switching" },
    });
    expect(fake.written.length).toBe(before);
    fake.emitState({ kind: "stopping" });
    await until(() => app.engine.read.getState().engine?.kind === "stopping", "stopping");
    fake.emitState({ kind: "running", source: "sidecar", pid: 2 });
    await until(() => !app.ui.read.getState().engineSwitching, "hold released");
    await app.stop();
  });

  test("a second retarget while the switch is held is reported as other", async () => {
    const { fake } = engineFake([], (n) => (n === 1 ? RUNNING_STATE : { kind: "stopping" }));
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
      label: SAVED.label,
    });
    const second = await app.commands.connection.retarget({ kind: "local" });
    expect(second).toEqual({ ok: false, error: "other" });
    expect(fake.retargeted).toEqual([{ kind: "remote", address: SAVED.address }]);
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
    const done = await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
      label: SAVED.label,
    });
    expect(done).toEqual({ ok: false, error: "other" });
    await app.stop();
  });

  test("a successful retarget records the target with its name for the status bar, and the shell gets the address only", async () => {
    const { fake } = engineFake([], (n) => (n === 1 ? RUNNING_STATE : { kind: "stopping" }));
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    expect(app.ui.read.getState().engineTarget).toEqual({ kind: "local" });
    const done = await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
      label: SAVED.label,
    });
    expect(done).toEqual({ ok: true, value: null });
    expect(app.ui.read.getState().engineTarget).toEqual({
      kind: "remote",
      address: SAVED.address,
      label: "build-box",
    });
    expect(fake.retargeted).toEqual([{ kind: "remote", address: SAVED.address }]);
    await app.stop();
  });

  test("a failed retarget leaves the recorded engine target unchanged", async () => {
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
    const done = await app.commands.connection.retarget({
      kind: "remote",
      address: SAVED.address,
      label: SAVED.label,
    });
    expect(done).toEqual({ ok: false, error: "other" });
    expect(app.ui.read.getState().engineTarget).toEqual({ kind: "local" });
    await app.stop();
  });
});

describe("host status, service mode and stopping the service", () => {
  test("load returns host.status, the service mode, and the remote answer setting, each read by its own key", async () => {
    const { app, params } = await liveApp({
      results: { "host.status": HOST_STATUS },
      resultFor: (method, requested) => {
        if (method !== "settings.get") return undefined;
        return JSON.stringify(requested) === readOf([REMOTE_KEY])
          ? { settings: [remoteSetting(false)] }
          : { settings: [serviceSetting(true)] };
      },
    });
    const loaded = await app.commands.connection.load();
    expect(loaded).toEqual({
      ok: true,
      value: {
        host: HOST_STATUS,
        service: { kind: "stopped", reason: "no registration" },
        restartPending: false,
        remoteAllowRespond: false,
      },
    });
    expect(
      params.filter((entry) => entry.method === "settings.get").map((entry) => entry.params),
    ).toEqual([{ keys: [SERVICE_KEY] }, { keys: [REMOTE_KEY] }]);
    await app.stop();
  });

  test("a host that does not know the remote answer setting still loads the status, with the value unknown", async () => {
    const unknown = WIRE_ERRORS["settings.unknownKey"];
    const { app } = await liveApp({
      results: { "host.status": HOST_STATUS },
      resultFor: (method, requested) =>
        method === "settings.get" && JSON.stringify(requested) === readOf([SERVICE_KEY])
          ? { settings: [serviceSetting(true)] }
          : undefined,
      failFor: (method, requested) =>
        method === "settings.get" && JSON.stringify(requested) === readOf([REMOTE_KEY])
          ? { code: unknown.code, kind: unknown.kind, details: { key: REMOTE_KEY } }
          : undefined,
    });
    const loaded = await app.commands.connection.load();
    expect(loaded).toEqual({
      ok: true,
      value: {
        host: HOST_STATUS,
        service: { kind: "stopped", reason: "no registration" },
        restartPending: false,
        remoteAllowRespond: null,
      },
    });
    await app.stop();
  });

  test("a read failure other than an unknown key fails the whole load", async () => {
    const invalid = WIRE_ERRORS["settings.invalidValue"];
    const { app } = await liveApp({
      results: { "host.status": HOST_STATUS },
      resultFor: (method, requested) =>
        method === "settings.get" && JSON.stringify(requested) === readOf([SERVICE_KEY])
          ? { settings: [serviceSetting(true)] }
          : undefined,
      failFor: (method, requested) =>
        method === "settings.get" && JSON.stringify(requested) === readOf([REMOTE_KEY])
          ? { code: invalid.code, kind: invalid.kind }
          : undefined,
    });
    const loaded = await app.commands.connection.load();
    expect(loaded).toEqual({ ok: false, error: { kind: "rejected", code: invalid.code } });
    await app.stop();
  });

  test("setting the remote answer writes the user-scope key and the value", async () => {
    const { app, params } = await liveApp({
      results: { "settings.set": { setting: remoteSetting(false) } },
    });
    const written = await app.commands.connection.setRemoteRespond(false);
    expect(written).toEqual({ ok: true, value: null });
    expect(paramsOf(params, "settings.set")).toEqual({
      key: "l0.process.service.allowRemoteRespond",
      value: false,
      scope: "user",
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
      results: {
        "settings.get": { settings: [serviceSetting(true)] },
        "settings.set": { setting: serviceSetting(false) },
      },
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

describe("session.restartEngine passes its options to the shell and reports the answer", () => {
  test("options reach restart as given, and a refusal comes back as false", async () => {
    const engine = engineFake();
    const seen: (RestartOptions | undefined)[] = [];
    const ipc: DesktopIpc = {
      ...engine.fake.ipc,
      restart: (options) => {
        seen.push(options);
        return Promise.resolve(
          options?.confirmed === true
            ? { ok: true, value: null }
            : {
                ok: false,
                error: { kind: "command", command: "engine_restart", code: "not-confirmed" },
              },
        );
      },
    };
    const app = makeAppOver(ipc);
    expect(await app.session.restartEngine({ safeMode: true, confirmed: true })).toBe(true);
    expect(await app.session.restartEngine()).toBe(false);
    expect(seen).toStrictEqual([{ safeMode: true, confirmed: true }, undefined]);
    await app.stop();
  });
});

describe("the connected clients list reads host.clients", () => {
  const HOST_CLIENTS: WireResult<"host.clients"> = {
    clients: [
      {
        connectionId: "c-1",
        transport: "stdio",
        name: "fresnel-cli",
        version: "1.2.0",
        writeThreads: 2,
        observedThreads: 1,
        self: false,
      },
      { connectionId: "c-2", transport: "socket", writeThreads: 0, observedThreads: 3, self: true },
    ],
  };

  test("clients returns the list as the engine gave it, and sends no params", async () => {
    const { app, params } = await liveApp({ results: { "host.clients": HOST_CLIENTS } });
    const listed = await app.commands.connection.clients();
    expect(listed).toEqual({ ok: true, value: HOST_CLIENTS.clients });
    expect(paramsOf(params, "host.clients")).toEqual({});
    await app.stop();
  });

  test("an engine without host.clients answers unsupported, so the screen shows no list", async () => {
    const missing = WIRE_ERRORS["jsonrpc.methodNotFound"];
    const { app } = await liveApp({
      errors: { "host.clients": { code: missing.code, kind: missing.kind } },
    });
    const listed = await app.commands.connection.clients();
    expect(listed).toEqual({ ok: false, error: { kind: "unsupported" } });
    await app.stop();
  });

  test("with no connection, clients is the offline command error", async () => {
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
    const listed = await app.commands.connection.clients();
    expect(listed).toEqual({ ok: false, error: { kind: "offline" } });
    await app.stop();
  });
});

/** 엔진 역할은 `engineFake`가 맡고, 서비스 셸 명령만 시험이 정한 답으로 바꾼 앱을 연결될 때까지 기다린다. 쓰기와 셸 호출의 순서는 `log`에 남는다 */
async function serviceApp(
  service: Partial<
    Pick<DesktopIpc, "serviceStatus" | "serviceEnsure" | "serviceStop" | "serviceAutostartSet">
  > = {},
  extra: EngineExtra = {},
  log: string[] = [],
) {
  // 쓰기 전에 읽는 이전 값은 기본으로 꺼짐이다. 시험이 `settings.get`을 따로 주면 그 값을 쓴다
  const engine = engineFake([summary(thr(1))], undefined, {
    ...extra,
    results: { "settings.get": { settings: [serviceSetting(false)] }, ...extra.results },
  });
  const base: DesktopIpc = { ...engine.fake.ipc, ...service };
  const ipc: DesktopIpc = {
    ...base,
    write: (epoch, chunk) => {
      if (new TextDecoder().decode(chunk).includes('"method":"settings.set"')) {
        log.push("settings.set");
      }
      return base.write(epoch, chunk);
    },
    serviceEnsure: () => {
      log.push("serviceEnsure");
      return base.serviceEnsure();
    },
    serviceStop: () => {
      log.push("serviceStop");
      return base.serviceStop();
    },
    serviceAutostartSet: (enabled) => {
      log.push(`serviceAutostartSet ${enabled}`);
      return base.serviceAutostartSet(enabled);
    },
    restart: (options) => {
      log.push("restart");
      return base.restart(options);
    },
  };
  const lines: LogLine[] = [];
  const app = makeAppOver(ipc, { logSink: (line) => lines.push(line) });
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  // 연결이 live가 되면 앱이 서비스 상태를 한 번 읽는다(엔진 빌드 비교). 시험이 세는 호출은 그 뒤의 것이다
  await Promise.resolve();
  await Promise.resolve();
  engine.fake.serviceCalls.length = 0;
  return { app, ...engine, log, lines };
}

const SERVICE_KEY_NAME = "l0.process.service.enabled";
const SETTING_ON = { setting: serviceSetting(true) };
const SETTING_OFF = { setting: serviceSetting(false) };

describe("the local service: enabling and disabling run in one order and report their failures", () => {
  test("enabling writes the setting, starts the service, then restarts the local engine onto it", async () => {
    const log: string[] = [];
    const { app, params, fake } = await serviceApp(
      {},
      { results: { "settings.set": SETTING_ON } },
      log,
    );
    expect(await app.commands.connection.setServiceMode(true)).toEqual({ ok: true, value: null });
    expect(log).toEqual(["settings.set", "serviceEnsure", "restart"]);
    expect(
      params.filter((entry) => entry.method === "settings.set").map((entry) => entry.params),
    ).toEqual([{ key: SERVICE_KEY_NAME, value: true, scope: "user" }]);
    expect(fake.restarts).toEqual([{ confirmed: true }]);
    await app.stop();
  });

  test("an ensure that fails writes the setting back to off and returns the start failure, without a restart", async () => {
    const log: string[] = [];
    const { app, params, fake } = await serviceApp(
      {
        serviceEnsure: () =>
          Promise.resolve(
            err({ kind: "command", command: "service_ensure", code: "start_failed" }),
          ),
      },
      { results: { "settings.set": SETTING_ON } },
      log,
    );
    expect(await app.commands.connection.setServiceMode(true)).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(log).toEqual(["settings.set", "serviceEnsure", "settings.set"]);
    expect(
      params.filter((entry) => entry.method === "settings.set").map((entry) => entry.params),
    ).toEqual([
      { key: SERVICE_KEY_NAME, value: true, scope: "user" },
      { key: SERVICE_KEY_NAME, value: false, scope: "user" },
    ]);
    expect(fake.restarts).toEqual([]);
    await app.stop();
  });

  test("disabling stops the service, then restarts the local engine back into the app", async () => {
    const log: string[] = [];
    const { app, params, fake } = await serviceApp(
      {},
      { results: { "settings.set": SETTING_OFF } },
      log,
    );
    expect(await app.commands.connection.stopLocalService()).toEqual({ ok: true, value: null });
    expect(log).toEqual(["settings.set", "serviceStop", "restart"]);
    expect(paramsOf(params, "settings.set")).toEqual({
      key: SERVICE_KEY_NAME,
      value: false,
      scope: "user",
    });
    expect(fake.restarts).toEqual([{ confirmed: true }]);
    await app.stop();
  });

  test("a stop that fails writes the setting back to on, reports it, and does not restart", async () => {
    const log: string[] = [];
    const { app, params, fake } = await serviceApp(
      {
        serviceStop: () =>
          Promise.resolve(
            err({ kind: "command", command: "service_stop", code: "service_failed" }),
          ),
      },
      {
        results: {
          "settings.get": { settings: [serviceSetting(true)] },
          "settings.set": SETTING_OFF,
        },
      },
      log,
    );
    expect(await app.commands.connection.stopLocalService()).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(log).toEqual(["settings.set", "serviceStop", "settings.set"]);
    expect(
      params.filter((entry) => entry.method === "settings.set").map((entry) => entry.params),
    ).toEqual([
      { key: SERVICE_KEY_NAME, value: false, scope: "user" },
      { key: SERVICE_KEY_NAME, value: true, scope: "user" },
    ]);
    expect(fake.restarts).toEqual([]);
    await app.stop();
  });

  test("a stop whose restore is refused as well still returns the stop failure, and the refused write is reported", async () => {
    const log: string[] = [];
    const refused = WIRE_ERRORS["settings.invalidValue"];
    const { app, lines } = await serviceApp(
      {
        serviceStop: () =>
          Promise.resolve(
            err({ kind: "command", command: "service_stop", code: "service_failed" }),
          ),
      },
      {
        results: {
          "settings.get": { settings: [serviceSetting(true)] },
          "settings.set": SETTING_OFF,
        },
        // 되돌리는 쓰기(값 true)만 거절한다. 처음 끄기 쓰기는 받는다
        failFor: (method, params) =>
          method === "settings.set" &&
          JSON.stringify(params) ===
            JSON.stringify({ key: SERVICE_KEY_NAME, value: true, scope: "user" })
            ? { code: refused.code, kind: refused.kind }
            : undefined,
      },
      log,
    );
    expect(await app.commands.connection.stopLocalService()).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(log).toEqual(["settings.set", "serviceStop", "settings.set"]);
    expect(
      lines.filter((line) => line.event === "desktop.connection.failed").map((line) => line.fields),
    ).toEqual([{ reason: "rejected" }]);
    await app.stop();
  });

  test("a stop that succeeds writes the setting once and does not write it back", async () => {
    const log: string[] = [];
    const { app, params } = await serviceApp(
      {},
      {
        results: {
          "settings.get": { settings: [serviceSetting(true)] },
          "settings.set": SETTING_OFF,
        },
      },
      log,
    );
    expect(await app.commands.connection.stopLocalService()).toEqual({ ok: true, value: null });
    expect(log).toEqual(["settings.set", "serviceStop", "restart"]);
    expect(
      params.filter((entry) => entry.method === "settings.set").map((entry) => entry.params),
    ).toEqual([{ key: SERVICE_KEY_NAME, value: false, scope: "user" }]);
    await app.stop();
  });

  test("a start that fails while the setting was already on writes on back, not off", async () => {
    const log: string[] = [];
    const { app, params, fake } = await serviceApp(
      {
        serviceEnsure: () =>
          Promise.resolve(
            err({ kind: "command", command: "service_ensure", code: "start_failed" }),
          ),
      },
      {
        results: {
          "settings.get": { settings: [serviceSetting(true)] },
          "settings.set": SETTING_ON,
        },
      },
      log,
    );
    expect(await app.commands.connection.setServiceMode(true)).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(log).toEqual(["settings.set", "serviceEnsure", "settings.set"]);
    expect(
      params.filter((entry) => entry.method === "settings.set").map((entry) => entry.params),
    ).toEqual([
      { key: SERVICE_KEY_NAME, value: true, scope: "user" },
      { key: SERVICE_KEY_NAME, value: true, scope: "user" },
    ]);
    expect(fake.restarts).toEqual([]);
    await app.stop();
  });

  test("when the previous setting cannot be read, nothing is written and no service call is made", async () => {
    const log: string[] = [];
    const invalid = WIRE_ERRORS["settings.invalidValue"];
    const { app, params, fake } = await serviceApp(
      {},
      { errors: { "settings.get": { code: invalid.code, kind: invalid.kind } } },
      log,
    );
    expect(await app.commands.connection.setServiceMode(true)).toEqual({
      ok: false,
      error: { kind: "rejected", code: invalid.code },
    });
    expect(log).toEqual([]);
    expect(params.filter((entry) => entry.method === "settings.set")).toEqual([]);
    expect(fake.serviceCalls).toEqual([]);
    expect(fake.restarts).toEqual([]);
    await app.stop();
  });

  test("the start and stop commands are the same flow as the setting itself", async () => {
    const started = await serviceApp({}, { results: { "settings.set": SETTING_ON } });
    expect(await started.app.commands.connection.startLocalService()).toEqual({
      ok: true,
      value: null,
    });
    expect(started.fake.serviceCalls).toEqual(["serviceEnsure"]);
    await started.app.stop();
  });

  test("with the engine on a remote target only the setting is written, and the local service is left alone", async () => {
    const log: string[] = [];
    const { app, fake, params } = await serviceApp(
      {},
      { results: { "settings.set": SETTING_ON } },
      log,
    );
    app.ui.actions.setEngineTarget({ kind: "remote", address: SAVED.address, label: SAVED.label });
    expect(await app.commands.connection.setServiceMode(true)).toEqual({ ok: true, value: null });
    expect(log).toEqual(["settings.set"]);
    expect(fake.serviceCalls).toEqual([]);
    expect(fake.restarts).toEqual([]);
    expect(paramsOf(params, "settings.set")).toEqual({
      key: SERVICE_KEY_NAME,
      value: true,
      scope: "user",
    });
    await app.stop();
  });
});

/** 지원하고 등록은 안 된 로그인 자동 시작 상태 */
const AUTOSTART_OFF: ServiceAutostart = {
  supported: true,
  registered: false,
  active: false,
  linger: null,
  platform: "darwin",
};

describe("load reads the local service card from the shell", () => {
  const RUNNING: ServiceStatusReply = {
    running: true,
    socket: "/run/fresnel/service.sock",
    pid: 4321,
    version: "1.2.3",
    startedAt: 1_700_000_000_000,
    autostart: AUTOSTART_OFF,
  };

  test("a running service that this app is attached to shows its pid, version and start time, and no socket", async () => {
    const { app } = await serviceApp(
      { serviceStatus: () => Promise.resolve(ok(RUNNING)) },
      {
        results: {
          "host.status": HOST_STATUS,
          "settings.get": { settings: [serviceSetting(true)] },
        },
      },
    );
    expect(await app.commands.connection.load()).toEqual({
      ok: true,
      value: {
        host: HOST_STATUS,
        service: {
          kind: "running",
          pid: 4321,
          version: "1.2.3",
          startedAt: 1_700_000_000_000,
          attached: true,
        },
        restartPending: false,
        remoteAllowRespond: null,
      },
    });
    await app.stop();
  });

  test("a running service that this app is not attached to says so", async () => {
    const { app } = await serviceApp(
      { serviceStatus: () => Promise.resolve(ok(RUNNING)) },
      {
        results: {
          "host.status": { ...HOST_STATUS, mode: "in-process" },
          "settings.get": { settings: [serviceSetting(false)] },
        },
      },
    );
    const loaded = await app.commands.connection.load();
    expect(loaded.ok && loaded.value.service).toEqual({
      kind: "running",
      pid: 4321,
      version: "1.2.3",
      startedAt: 1_700_000_000_000,
      attached: false,
    });
    await app.stop();
  });

  test("a status read that fails shows the card as unknown, and the rest of the load still succeeds", async () => {
    const { app } = await serviceApp(
      {
        serviceStatus: () =>
          Promise.resolve(
            err({ kind: "command", command: "service_status", code: "storage-failed" }),
          ),
      },
      {
        results: {
          "host.status": HOST_STATUS,
          "settings.get": { settings: [serviceSetting(true)] },
        },
      },
    );
    const loaded = await app.commands.connection.load();
    expect(loaded.ok && loaded.value.service).toEqual({ kind: "unknown" });
    expect(loaded.ok && loaded.value.restartPending).toBe(false);
    await app.stop();
  });

  test("a remote target never asks the shell about the local service", async () => {
    const { app, fake } = await serviceApp(
      {},
      {
        results: {
          "host.status": HOST_STATUS,
          "settings.get": { settings: [serviceSetting(true)] },
        },
      },
    );
    app.ui.actions.setEngineTarget({ kind: "remote", address: SAVED.address, label: SAVED.label });
    const loaded = await app.commands.connection.load();
    expect(loaded.ok && loaded.value.service).toEqual({ kind: "unknown" });
    expect(fake.serviceCalls).toEqual([]);
    await app.stop();
  });
});

describe("the login autostart commands", () => {
  const REGISTERED: ServiceAutostart = {
    supported: true,
    registered: true,
    active: true,
    linger: false,
    platform: "linux",
  };

  test("serviceAutostart reads the autostart object of service_status, running or not", async () => {
    const { app } = await serviceApp({
      serviceStatus: () =>
        Promise.resolve(ok({ running: false, reason: "no registration", autostart: REGISTERED })),
    });
    expect(await app.commands.connection.serviceAutostart()).toEqual({
      ok: true,
      value: REGISTERED,
    });
    await app.stop();
  });

  test("a failed status read is the closed unknown code, and never a path", async () => {
    const { app } = await serviceApp({
      serviceStatus: () =>
        Promise.resolve(
          err({ kind: "command", command: "service_status", code: "storage-failed" }),
        ),
    });
    expect(await app.commands.connection.serviceAutostart()).toEqual({
      ok: false,
      error: { code: "unknown" },
    });
    await app.stop();
  });

  test("setServiceAutostart calls the shell with the flag, and passes the linger advice through", async () => {
    const log: string[] = [];
    const { app, fake } = await serviceApp({}, {}, log);
    expect(await app.commands.connection.setServiceAutostart(true)).toEqual({
      ok: true,
      value: { lingerAdvice: false },
    });
    expect(await app.commands.connection.setServiceAutostart(false)).toEqual({
      ok: true,
      value: { lingerAdvice: false },
    });
    expect(log).toEqual(["serviceAutostartSet true", "serviceAutostartSet false"]);
    expect(fake.autostartSets).toEqual([true, false]);
    await app.stop();
  });

  test("a rejected set keeps the autostart code, and any other code is unknown", async () => {
    const failed = await serviceApp({
      serviceAutostartSet: () =>
        Promise.resolve(
          err({ kind: "command", command: "service_autostart_set", code: "autostart_failed" }),
        ),
    });
    expect(await failed.app.commands.connection.setServiceAutostart(true)).toEqual({
      ok: false,
      error: { code: "autostart_failed" },
    });
    await failed.app.stop();

    const other = await serviceApp({
      serviceAutostartSet: () =>
        Promise.resolve(
          err({ kind: "command", command: "service_autostart_set", code: "something-else" }),
        ),
    });
    expect(await other.app.commands.connection.setServiceAutostart(true)).toEqual({
      ok: false,
      error: { code: "unknown" },
    });
    await other.app.stop();

    const invalid = await serviceApp({
      serviceAutostartSet: () =>
        Promise.resolve(err({ kind: "invalid", command: "service_autostart_set" })),
    });
    expect(await invalid.app.commands.connection.setServiceAutostart(false)).toEqual({
      ok: false,
      error: { code: "unknown" },
    });
    await invalid.app.stop();
  });
});

const REMOTE = { kind: "remote", address: SAVED.address, label: SAVED.label } as const;

/** 시한이 `longerThanMs`보다 긴 예약만 시험이 직접 부른다. 짧은 예약은 실제 시간으로 흐른다 */
function manualLongTimers(longerThanMs: number): {
  readonly scheduler: Scheduler;
  readonly fire: (ms: number) => void;
  readonly pending: (ms: number) => boolean;
} {
  const held = new Map<number, { readonly fn: () => void; readonly ms: number }>();
  let next = -1;
  return {
    scheduler: {
      setTimeout: (fn, ms) => {
        if (ms < longerThanMs) return Number(setTimeout(fn, ms));
        const id = next;
        next -= 1;
        held.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => {
        if (id < 0) held.delete(id);
        else clearTimeout(id);
      },
    },
    fire: (ms) => {
      for (const [id, timer] of held) {
        if (timer.ms !== ms) continue;
        held.delete(id);
        timer.fn();
        return;
      }
      throw new Error(`no held timer of ${String(ms)} ms`);
    },
    pending: (ms) => [...held.values()].some((timer) => timer.ms === ms),
  };
}

/** 엔진이 붙은 상태에서 시작한다. 대상 바꾸기 시험은 엔진이 내려갔다 올라오는 것을 흉내 낸다 */
async function remoteSwitchApp(
  first: EngineState = RUNNING_STATE,
  scheduler?: Scheduler,
): Promise<ReturnType<typeof engineFake> & { readonly app: ReturnType<typeof makeApp> }> {
  const engine = engineFake([], (n) => (n === 1 ? first : { kind: "stopping" }));
  const app = makeAppOver(engine.fake.ipc, scheduler === undefined ? {} : { scheduler });
  await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
  return { ...engine, app };
}

/** 엔진 상태를 보내고, 거울에 들어간 것을 기다린다(상태 적용은 비동기다) */
async function emitAndWait(
  fake: { emitState(state: EngineState): void },
  app: ReturnType<typeof makeApp>,
  state: EngineState,
): Promise<void> {
  fake.emitState(state);
  await until(() => app.engine.read.getState().engine?.kind === state.kind, `engine ${state.kind}`);
}

describe("the last target: remembered on a successful change, restored on start", () => {
  test("a successful remote retarget is remembered, and going back to this computer forgets it", async () => {
    const { fake, app } = await remoteSwitchApp();
    await app.commands.connection.retarget(REMOTE);
    expect(fake.settingsFile[LAST_TARGET_KEY]).toBe(SAVED.address);
    expect(await app.commands.connection.lastTarget()).toBe(SAVED.address);
    await emitAndWait(fake, app, { kind: "stopping" });
    await emitAndWait(fake, app, { kind: "running", source: "sidecar", pid: 2 });
    await until(() => !app.ui.read.getState().engineSwitching, "hold released");
    expect(await app.commands.connection.retarget({ kind: "local" })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.settingsFile[LAST_TARGET_KEY]).toBe("");
    expect(await app.commands.connection.lastTarget()).toBeNull();
    await app.stop();
  });

  test("a failed save of the remembered target is reported, and the retarget still succeeds", async () => {
    const engine = engineFake([], (n) => (n === 1 ? RUNNING_STATE : { kind: "stopping" }));
    const base = engine.fake.ipc;
    const ipc: DesktopIpc = {
      ...base,
      writeSettings: (key, value) =>
        key === LAST_TARGET_KEY
          ? Promise.resolve({
              ok: false,
              error: { kind: "command", command: "desktop_settings_write", code: "storage-failed" },
            })
          : base.writeSettings(key, value),
    };
    const lines: LogLine[] = [];
    const app = makeAppOver(ipc, { logSink: (line) => lines.push(line) });
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    expect(await app.commands.connection.retarget(REMOTE)).toEqual({ ok: true, value: null });
    expect(app.ui.read.getState().engineTarget).toEqual(REMOTE);
    expect(lines.find((line) => line.event === "desktop.connection.failed")?.fields).toEqual({
      reason: "ipc",
    });
    await app.stop();
  });

  test("with nothing saved, the restore does nothing and says none", async () => {
    const { fake, app } = await remoteSwitchApp();
    expect(await app.commands.connection.restoreLastTarget()).toBe("none");
    expect(fake.retargeted).toEqual([]);
    expect(app.ui.read.getState().targetNotice).toBeNull();
    await app.stop();
  });

  test("a saved remote target that comes up running is restored, with no notice", async () => {
    const { fake, app } = await remoteSwitchApp();
    fake.settingsFile[TARGETS_KEY] = [SAVED];
    fake.settingsFile[LAST_TARGET_KEY] = SAVED.address;
    const pending = app.commands.connection.restoreLastTarget();
    await until(() => fake.retargeted.length === 1, "remote retarget sent");
    await emitAndWait(fake, app, { kind: "stopping" });
    await emitAndWait(fake, app, { kind: "starting", source: "sidecar", attempt: 1 });
    await emitAndWait(fake, app, { kind: "running", source: "sidecar", pid: 2 });
    expect(await pending).toBe("restored");
    expect(app.ui.read.getState().engineTarget).toEqual({
      kind: "remote",
      address: SAVED.address,
      label: "build-box",
    });
    expect(app.ui.read.getState().targetNotice).toBeNull();
    expect(fake.retargeted).toEqual([{ kind: "remote", address: SAVED.address }]);
    await app.stop();
  });

  test("a remote target that fails to start falls back to this computer, names it, and keeps the memory", async () => {
    const { fake, app } = await remoteSwitchApp();
    fake.settingsFile[TARGETS_KEY] = [SAVED];
    fake.settingsFile[LAST_TARGET_KEY] = SAVED.address;
    const pending = app.commands.connection.restoreLastTarget();
    await until(() => fake.retargeted.length === 1, "remote retarget sent");
    await emitAndWait(fake, app, { kind: "stopping" });
    await emitAndWait(fake, app, {
      kind: "failed",
      attempts: 1,
      lastExit: { code: 3, signal: null, at: "2026-11-12T00:00:00.000Z" },
    });
    expect(await pending).toBe("fellBack");
    expect(fake.retargeted).toEqual([
      { kind: "remote", address: SAVED.address },
      { kind: "local" },
    ]);
    expect(app.ui.read.getState().engineTarget).toEqual({ kind: "local" });
    expect(app.ui.read.getState().targetNotice).toEqual({ kind: "fellBack", name: "build-box" });
    expect(fake.settingsFile[LAST_TARGET_KEY]).toBe(SAVED.address);
    await app.stop();
  });

  test("a remote target the shell refuses goes back to this computer with the notice", async () => {
    const engine = engineFake();
    const retargets: string[] = [];
    const ipc: DesktopIpc = {
      ...engine.fake.ipc,
      retarget: (target) => {
        retargets.push(target.kind);
        return Promise.resolve(
          target.kind === "remote"
            ? {
                ok: false,
                error: { kind: "command", command: "engine_retarget", code: "bad-request" },
              }
            : { ok: true, value: null },
        );
      },
    };
    engine.fake.settingsFile[TARGETS_KEY] = [SAVED];
    engine.fake.settingsFile[LAST_TARGET_KEY] = SAVED.address;
    const app = makeAppOver(ipc);
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    expect(await app.commands.connection.restoreLastTarget()).toBe("fellBack");
    expect(retargets).toEqual(["remote", "local"]);
    expect(app.ui.read.getState().targetNotice).toEqual({ kind: "fellBack", name: "build-box" });
    await app.stop();
  });

  test("a restore that never reaches running gives up at thirty seconds and goes back", async () => {
    // 30초 감시와 대상 바꾸기의 보류 시한(7초 + 15초)은 시험이 직접 불러 본다
    const timers = manualLongTimers(10_000);
    const { fake, app } = await remoteSwitchApp(RUNNING_STATE, timers.scheduler);
    fake.settingsFile[TARGETS_KEY] = [SAVED];
    fake.settingsFile[LAST_TARGET_KEY] = SAVED.address;
    const pending = app.commands.connection.restoreLastTarget();
    await until(() => fake.retargeted.length === 1, "remote retarget sent");
    await emitAndWait(fake, app, { kind: "stopping" });
    expect(timers.pending(30_000)).toBe(true);
    timers.fire(30_000);
    timers.fire(22_000);
    expect(await pending).toBe("fellBack");
    expect(fake.retargeted).toEqual([
      { kind: "remote", address: SAVED.address },
      { kind: "local" },
    ]);
    expect(app.ui.read.getState().targetNotice).toEqual({ kind: "fellBack", name: "build-box" });
    await app.stop();
  });
});

describe("the connected remote's state and the switch impact", () => {
  test("a load on a remote target records what was seen, and on this computer nothing is recorded", async () => {
    const { app } = await liveApp({
      results: { "host.status": HOST_STATUS },
      resultFor: (method) => (method === "settings.get" ? { settings: [] } : undefined),
    });
    await app.commands.connection.load();
    expect(app.ui.read.getState().lastRemoteSeen).toBeNull();
    app.ui.actions.setEngineTarget(REMOTE);
    await app.commands.connection.load();
    expect(app.ui.read.getState().lastRemoteSeen).toEqual({
      at: expect.any(Number),
      version: "1.2.3",
      liveTurns: 1,
    });
    await app.stop();
  });

  test("switchImpact counts the live turns and the waiting approvals, and says whether the service keeps running", async () => {
    const stdio = await liveApp({
      results: {
        "host.status": { ...HOST_STATUS, liveTurns: 2, waitingApprovals: 3, mode: "stdio" },
      },
    });
    expect(await stdio.app.commands.connection.switchImpact()).toEqual({
      ok: true,
      value: { liveTurns: 2, waitingApprovals: 3, keepsRunning: false },
    });
    await stdio.app.stop();
    const served = await liveApp({ results: { "host.status": HOST_STATUS } });
    expect(await served.app.commands.connection.switchImpact()).toEqual({
      ok: true,
      value: { liveTurns: 1, waitingApprovals: 0, keepsRunning: true },
    });
    await served.app.stop();
  });

  test("switchImpact with no connection is the offline error", async () => {
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
    expect(await app.commands.connection.switchImpact()).toEqual({
      ok: false,
      error: { kind: "offline" },
    });
    await app.stop();
  });
});

describe("the target notice can be dismissed from the connection screen", () => {
  test("dismissTargetNotice clears the fell-back notice and leaves the remembered target alone", async () => {
    const { app } = await liveApp({ results: {} });
    app.ui.actions.setTargetNotice({ kind: "fellBack", name: "build-box" });
    expect(app.ui.read.getState().targetNotice).toEqual({ kind: "fellBack", name: "build-box" });
    app.commands.connection.dismissTargetNotice();
    expect(app.ui.read.getState().targetNotice).toBeNull();
    await app.stop();
  });
});

describe("the remote attach commands pass their arguments to the shell and map its answers", () => {
  test("serviceAlive asks the shell only for an ssh address, with the user, host and port", async () => {
    const { fake, app } = await remoteSwitchApp();
    expect(
      await app.commands.connection.serviceAlive("unix:/run/user/1000/fresnel/fresnel.sock"),
    ).toEqual({ alive: null, version: null, code: null });
    expect(fake.remoteCalls).toEqual([]);
    expect(
      await app.commands.connection.serviceAlive("ssh://me@build:2222/run/fresnel.sock"),
    ).toEqual({ alive: true, version: "1.2.3", code: "ok" });
    expect(fake.remoteCalls).toEqual([
      { command: "ssh_service_alive", args: { target: "me@build:2222" } },
    ]);
    await app.stop();
  });

  test("sshHosts returns the shell's list, and a shell failure is failed", async () => {
    const hosts = {
      hosts: [{ name: "build", hostName: "build.local", user: "me", port: null, proxyJump: false }],
      unreadable: null,
    };
    const app = makeApp(fakeIpc({ sshHostsResult: ok(hosts) }));
    expect(await app.commands.connection.sshHosts()).toEqual({ ok: true, value: hosts });
    await app.stop();
    const failing = makeApp(
      fakeIpc({ sshHostsResult: err({ kind: "command", command: "ssh_hosts", code: "boom" }) }),
    );
    expect(await failing.commands.connection.sshHosts()).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    await failing.stop();
  });

  test("preflight streams the step events to the caller and returns the outcome", async () => {
    const event: PreflightEvent = {
      step: "connect",
      status: "action",
      code: "host_key_new",
      durationMs: 5,
      actions: ["trust_host_key"],
      detail: {
        hostKey: {
          fingerprint: "SHA256:ab",
          keyType: "ED25519",
          hostname: "build.local",
          port: 22,
          scanned: ["build.local ssh-ed25519 AAAA"],
        },
      },
    };
    const fake = fakeIpc({
      sshPreflightEvents: [event],
      sshPreflightResult: ok({
        ok: false,
        step: "connect",
        status: "action",
        code: "host_key_new",
        actions: ["trust_host_key"],
      }),
    });
    const app = makeApp(fake);
    const seen: PreflightEvent[] = [];
    const outcome = await app.commands.connection.preflight({ target: "me@build" }, (step) => {
      seen.push(step);
    });
    expect(seen).toEqual([event]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        ok: false,
        step: "connect",
        status: "action",
        code: "host_key_new",
        actions: ["trust_host_key"],
      },
    });
    expect(fake.remoteCalls).toEqual([{ command: "ssh_preflight", args: { target: "me@build" } }]);
    await app.stop();
  });

  test("testTarget and fingerprintOf pass the address and host, and map the probe's refusal", async () => {
    const fake = fakeIpc({
      remoteFingerprintResult: ok({ ok: false, code: "refused" }),
    });
    const app = makeApp(fake);
    expect(await app.commands.connection.testTarget(SAVED.address)).toEqual({
      ok: true,
      value: { ok: true, code: "ok", durationMs: 12, detail: { serverVersion: "1.2.3" } },
    });
    expect(await app.commands.connection.fingerprintOf("gw.local", 7421)).toEqual({
      ok: false,
      error: { kind: "probe", code: "refused" },
    });
    expect(fake.remoteCalls).toEqual([
      { command: "remote_test", args: { address: SAVED.address } },
      { command: "remote_fingerprint", args: { host: "gw.local", port: 7421 } },
    ]);
    await app.stop();
  });

  test("pair returns the device name, and a refusal keeps its code and the wait", async () => {
    const pairing = {
      host: "gw.local",
      port: 7421,
      pin: "ab".repeat(32),
      code: "123456",
      deviceName: "laptop",
    };
    const granted = makeApp(fakeIpc());
    expect(await granted.commands.connection.pair(pairing)).toEqual({
      ok: true,
      value: { deviceName: "laptop" },
    });
    await granted.stop();
    const locked = makeApp(
      fakeIpc({ remotePairResult: ok({ ok: false, code: "locked", retryAfterSeconds: 30 }) }),
    );
    expect(await locked.commands.connection.pair(pairing)).toEqual({
      ok: false,
      error: { kind: "server", code: "locked", retryAfterSeconds: 30 },
    });
    await locked.stop();
    const wrongCode = makeApp(
      fakeIpc({ remotePairResult: ok({ ok: false, code: "invalid_code" }) }),
    );
    expect(await wrongCode.commands.connection.pair(pairing)).toEqual({
      ok: false,
      error: { kind: "server", code: "invalid_code", retryAfterSeconds: null },
    });
    await wrongCode.stop();
  });
});
