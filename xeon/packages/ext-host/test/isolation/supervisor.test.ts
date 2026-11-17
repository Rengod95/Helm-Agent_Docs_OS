import { afterAll, expect, test } from "bun:test";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_HOST_MAX_FRAME_BYTES,
  type EngineCallParams,
  type PluginHostError,
} from "@fresnel/contracts/extensions";
import {
  createPluginHostSupervisor,
  type PluginHostSupervisor,
  type RestartLimitInfo,
} from "../../src/index.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
  type FakeChild,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";
import { cleanupTempRoots, fixtureRoot, initParamsOf, methodParams } from "./support/plugin.ts";

afterAll(cleanupTempRoots);

function okValue<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

interface Rig {
  readonly supervisor: PluginHostSupervisor;
  readonly port: FakeProcessPort;
  readonly clock: ManualClock;
  readonly events: string[];
  readonly restarts: RestartLimitInfo[];
  readonly engineCalls: EngineCallParams[];
  /** 다음 기동부터 쓰는 엔트리 파일(선언을 바꿀 때) */
  setEntry(entry: string): void;
}

interface RigOptions {
  readonly maskSecrets?: (line: string) => string;
  readonly initTimeoutMs?: number;
  readonly protocolVersion?: number;
  /** 있으면 엔진 호출마다 이 실패로 답한다 */
  readonly engineFailure?: PluginHostError;
  /** 재시작 한도와 창. 기본은 한도 1, 창 600초다 */
  readonly maxRestarts?: () => number;
  readonly restartWindowSec?: () => number;
}

function rigOf(root: string, options: RigOptions = {}): Rig {
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const events: string[] = [];
  const restarts: RestartLimitInfo[] = [];
  const engineCalls: EngineCallParams[] = [];
  const entry = { value: "./src/index.ts" };
  const supervisor = createPluginHostSupervisor({
    process: port,
    specOf: () => ({
      command: "plugin-host",
      args: [],
      readRoot: root,
      env: {},
      label: "ext:demo:v1",
    }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger(events),
    initParams: () => initParamsOf(root, entry.value, options.protocolVersion ?? 1),
    initTimeoutMs: options.initTimeoutMs ?? 1000,
    idleMs: 60_000,
    killGraceMs: 2000,
    maxRestarts: options.maxRestarts ?? (() => 1),
    restartWindowSec: options.restartWindowSec ?? (() => 600),
    onEngineCall: async (params) => {
      engineCalls.push(params);
      return options.engineFailure === undefined ? ok(params.params) : err(options.engineFailure);
    },
    onRestartLimit: (info) => {
      restarts.push(info);
    },
    ...(options.maskSecrets === undefined ? {} : { maskSecrets: options.maskSecrets }),
  });
  return {
    supervisor,
    port,
    clock,
    events,
    restarts,
    engineCalls,
    setEntry: (next) => {
      entry.value = next;
    },
  };
}

/** 이 호출 id의 요청이 자식에게 도착했는가 */
function sentWith(child: FakeChild | undefined, callId: string): () => boolean {
  return () => child?.received().includes(`"${callId}"`) === true;
}

const TIMEOUT_REASON = (): DOMException =>
  new DOMException("handler budget exceeded", "TimeoutError");

test("start answers with the registrations the entry declared", async () => {
  const rig = rigOf(await fixtureRoot());
  const init = okValue(await rig.supervisor.start());
  expect(init.protocolVersion).toBe(1);
  expect(init.registrations.map((decl) => decl.id)).toEqual(["demo"]);
  expect(init.registrations[0]?.methods).toEqual([
    { verb: "ping" },
    { verb: "hang" },
    { verb: "delay" },
    { verb: "bump" },
  ]);
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 0 });
});

test("a call round-trips the exact value the plugin returned", async () => {
  const rig = rigOf(await fixtureRoot());
  const reply = await rig.supervisor.call("method.call", methodParams("ping", { n: 7 }));
  expect(okValue(reply)).toEqual({ pong: 7 });
  expect(rig.supervisor.status().pid).not.toBeNull();
});

test("a frame over the limit is not sent and the call fails as frame_too_large", async () => {
  const rig = rigOf(await fixtureRoot());
  const huge = "x".repeat(PLUGIN_HOST_MAX_FRAME_BYTES);
  const failed = await rig.supervisor.call(
    "method.call",
    methodParams("ping", { blob: huge }, "call_huge"),
  );
  expect(errorOf(failed).kind).toBe("frame_too_large");
  expect(rig.port.children[0]?.received().includes("call_huge")).toBe(false);
  expect(okValue(await rig.supervisor.call("method.call", methodParams("ping", { n: 1 })))).toEqual(
    { pong: 1 },
  );
});

test("an idle process is stopped after idleMs and restarted lazily without counting a death", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.call("method.call", methodParams("ping", { n: 1 })));
  rig.clock.advance(60_000);
  await until(() => rig.supervisor.status().state === "idle", "idle state");
  expect(rig.port.children[0]?.isAlive()).toBe(false);
  expect(rig.supervisor.status().deaths).toBe(0);
  expect(okValue(await rig.supervisor.call("method.call", methodParams("ping", { n: 2 })))).toEqual(
    { pong: 2 },
  );
  expect(rig.port.children.length).toBe(2);
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 0 });
  expect(rig.restarts).toEqual([]);
});

test("a timeout abort kills the process: that call gets process_killed, the other process_exit", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  const child = rig.port.children[0];
  const controller = new AbortController();
  const first = rig.supervisor.call("method.call", methodParams("hang", {}, "call_a"), {
    signal: controller.signal,
  });
  const second = rig.supervisor.call("method.call", methodParams("hang", {}, "call_b"));
  await until(sentWith(child, "call_b"), "both calls sent");
  controller.abort(TIMEOUT_REASON());
  expect(errorOf(await first).kind).toBe("process_killed");
  expect(errorOf(await second).kind).toBe("process_exit");
  expect(child?.signals).toEqual(["SIGTERM"]);
  expect(rig.supervisor.status().deaths).toBe(1);
  await until(() => rig.supervisor.status().state === "stopped", "stopped after the kill");
  expect(okValue(await rig.supervisor.call("method.call", methodParams("ping", { n: 5 })))).toEqual(
    { pong: 5 },
  );
  expect(rig.port.children.length).toBe(2);
  // 성공한 응답은 죽음을 지우지 않는다. 죽음은 창이 지나야 빠진다
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 1 });
});

test("a deadline that elapses kills the process as well", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  const pending = rig.supervisor.call("method.call", methodParams("hang", {}, "call_d"), {
    deadlineMs: 500,
  });
  await until(sentWith(rig.port.children[0], "call_d"), "sent");
  rig.clock.advance(500);
  expect(errorOf(await pending).kind).toBe("process_killed");
  expect(rig.port.children[0]?.signals).toEqual(["SIGTERM"]);
});

test("a process that ignores SIGTERM gets SIGKILL after the grace period", async () => {
  const rig = rigOf(await fixtureRoot());
  rig.port.nextOptions({ ignoreSigterm: true });
  okValue(await rig.supervisor.start());
  const child = rig.port.children[0];
  const controller = new AbortController();
  const pending = rig.supervisor.call("method.call", methodParams("hang", {}, "call_k"), {
    signal: controller.signal,
  });
  await until(sentWith(child, "call_k"), "sent");
  controller.abort(TIMEOUT_REASON());
  expect(errorOf(await pending).kind).toBe("process_killed");
  expect(child?.signals).toEqual(["SIGTERM"]);
  expect(child?.isAlive()).toBe(true);
  rig.clock.advance(2000);
  expect(child?.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(child?.isAlive()).toBe(false);
});

test("a plain abort cancels only that call, sends request.cancel, and the late reply is dropped", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  const child = rig.port.children[0];
  const controller = new AbortController();
  const slow = rig.supervisor.call("method.call", methodParams("delay", { ms: 30 }, "call_slow"), {
    signal: controller.signal,
  });
  await until(sentWith(child, "call_slow"), "sent");
  controller.abort();
  expect(errorOf(await slow).kind).toBe("cancelled");
  expect(child?.signals).toEqual([]);
  await until(
    () => child?.received().includes('"method":"request.cancel"') === true,
    "cancel sent",
  );
  await until(() => rig.events.includes("plugin_host.late_reply_dropped"), "late reply dropped");
  expect(okValue(await rig.supervisor.call("method.call", methodParams("ping", { n: 3 })))).toEqual(
    { pong: 3 },
  );
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 0 });
});

test("an unexpected exit fails the in-flight call and the next call relaunches the process", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  const pending = rig.supervisor.call("method.call", methodParams("hang", {}, "call_hang"));
  await until(sentWith(rig.port.children[0], "call_hang"), "sent");
  rig.port.children[0]?.crash();
  expect(errorOf(await pending).kind).toBe("process_exit");
  expect(rig.supervisor.status()).toMatchObject({ state: "stopped", deaths: 1 });
  expect(okValue(await rig.supervisor.call("method.call", methodParams("ping", { n: 4 })))).toEqual(
    { pong: 4 },
  );
  expect(rig.port.children.length).toBe(2);
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 1 });
  expect(rig.restarts).toEqual([]);
});

test("a second death without a success refuses restarts and notifies the restart limit once", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  const first = rig.supervisor.call("method.call", methodParams("hang", {}, "call_1"));
  await until(sentWith(rig.port.children[0], "call_1"), "first sent");
  rig.port.children[0]?.crash();
  expect(errorOf(await first).kind).toBe("process_exit");

  const second = rig.supervisor.call("method.call", methodParams("hang", {}, "call_2"));
  await until(sentWith(rig.port.children[1], "call_2"), "relaunched and sent");
  rig.port.children[1]?.crash();
  expect(errorOf(await second).kind).toBe("process_exit");

  expect(rig.supervisor.status()).toMatchObject({ state: "restart_limit", deaths: 2 });
  expect(
    errorOf(await rig.supervisor.call("method.call", methodParams("ping", { n: 1 }))),
  ).toMatchObject({ kind: "restart_limit" });
  expect(
    errorOf(await rig.supervisor.call("method.call", methodParams("ping", { n: 1 }))),
  ).toMatchObject({ kind: "restart_limit" });
  expect(rig.restarts).toEqual([{ deaths: 2, reason: "process_exit", label: "ext:demo:v1" }]);
  expect(rig.port.children.length).toBe(2);
});

/** 자식 `index`를 죽이고, 감독이 그 죽음을 셀 때까지 기다린다 */
async function dieAt(rig: Rig, index: number, next: "stopped" | "restart_limit"): Promise<void> {
  rig.port.children[index]?.crash();
  await until(() => rig.supervisor.status().state === next, `death of child ${index} observed`);
}

/** 죽은 뒤 첫 호출은 프로세스를 다시 띄운다 */
function pingAfterRelaunch(rig: Rig, n: number): ReturnType<PluginHostSupervisor["call"]> {
  return rig.supervisor.call("method.call", methodParams("ping", { n }));
}

test("with maxRestarts 2 a success between deaths keeps the count, and the third death in the window is the limit", async () => {
  const rig = rigOf(await fixtureRoot(), { maxRestarts: () => 2, restartWindowSec: () => 60 });
  okValue(await rig.supervisor.start());
  await dieAt(rig, 0, "stopped");
  expect(okValue(await pingAfterRelaunch(rig, 1))).toEqual({ pong: 1 });
  await dieAt(rig, 1, "stopped");
  expect(okValue(await pingAfterRelaunch(rig, 2))).toEqual({ pong: 2 });
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 2 });

  await dieAt(rig, 2, "restart_limit");
  expect(rig.supervisor.status()).toMatchObject({ state: "restart_limit", deaths: 3 });
  expect(errorOf(await pingAfterRelaunch(rig, 3))).toMatchObject({ kind: "restart_limit" });
  expect(rig.restarts).toEqual([{ deaths: 3, reason: "process_exit", label: "ext:demo:v1" }]);
  expect(rig.port.children.length).toBe(3);
});

test("a death older than the window is not counted, so the next death starts the process again", async () => {
  const rig = rigOf(await fixtureRoot(), { maxRestarts: () => 1, restartWindowSec: () => 60 });
  okValue(await rig.supervisor.start());
  await dieAt(rig, 0, "stopped");
  rig.clock.advance(61_000);
  expect(okValue(await pingAfterRelaunch(rig, 1))).toEqual({ pong: 1 });
  expect(rig.supervisor.status()).toMatchObject({ state: "running", deaths: 0 });

  await dieAt(rig, 1, "stopped");
  expect(rig.supervisor.status()).toMatchObject({ state: "stopped", deaths: 1 });
  expect(okValue(await pingAfterRelaunch(rig, 2))).toEqual({ pong: 2 });
  expect(rig.restarts).toEqual([]);
  expect(rig.port.children.length).toBe(3);
});

test("the limit is read at each death, so a lowered value applies to the next decision", async () => {
  let limit = 2;
  const rig = rigOf(await fixtureRoot(), { maxRestarts: () => limit, restartWindowSec: () => 60 });
  okValue(await rig.supervisor.start());
  await dieAt(rig, 0, "stopped");
  expect(okValue(await pingAfterRelaunch(rig, 1))).toEqual({ pong: 1 });

  limit = 0;
  await dieAt(rig, 1, "restart_limit");
  expect(rig.restarts).toEqual([{ deaths: 2, reason: "process_exit", label: "ext:demo:v1" }]);
});

test("the window length is read at each death, so a shortened window drops the older death", async () => {
  let windowSec = 600;
  const rig = rigOf(await fixtureRoot(), {
    maxRestarts: () => 1,
    restartWindowSec: () => windowSec,
  });
  okValue(await rig.supervisor.start());
  await dieAt(rig, 0, "stopped");
  expect(okValue(await pingAfterRelaunch(rig, 1))).toEqual({ pong: 1 });

  rig.clock.advance(30_000);
  windowSec = 10;
  await dieAt(rig, 1, "stopped");
  expect(rig.supervisor.status()).toMatchObject({ state: "stopped", deaths: 1 });
  expect(rig.restarts).toEqual([]);
});

test("a restart that declares different registrations is refused and the new process is stopped", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  rig.setEntry("./src/other.ts");
  rig.port.children[0]?.crash();
  await until(() => rig.supervisor.status().state === "stopped", "the death is observed");
  expect(
    errorOf(await rig.supervisor.call("method.call", methodParams("ping", { n: 1 }))),
  ).toMatchObject({ kind: "declarations_changed" });
  expect(rig.port.children[1]?.isAlive()).toBe(false);
  expect(rig.supervisor.status().deaths).toBe(1);
});

test("stderr keeps the last lines, clipped to the line limit and masked before storing", async () => {
  const rig = rigOf(await fixtureRoot(), {
    maskSecrets: (line) => line.replaceAll(/sk-[a-z0-9]+/g, "sk-***"),
  });
  okValue(await rig.supervisor.start());
  const child = rig.port.children[0];
  child?.writeStderr("token sk-abc123 here\n");
  await until(() => rig.supervisor.stderrTail().length === 1, "first stderr line");
  expect(rig.supervisor.stderrTail()).toEqual(["token sk-*** here"]);

  child?.writeStderr(`${"x".repeat(2500)}\n`);
  await until(() => rig.supervisor.stderrTail().length === 2, "clipped line");
  expect(rig.supervisor.stderrTail()[1]?.length).toBe(2000);

  const many = Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n");
  child?.writeStderr(`${many}\n`);
  await until(() => rig.supervisor.stderrTail().at(-1) === "line 249", "last line");
  const tail = rig.supervisor.stderrTail();
  expect(tail.length).toBe(200);
  expect(tail[0]).toBe("line 50");
});

test("a line whose masking throws is dropped rather than stored raw", async () => {
  const rig = rigOf(await fixtureRoot(), {
    maskSecrets: (line) => {
      if (line.includes("boom")) throw new Error("mask failed");
      return line;
    },
  });
  okValue(await rig.supervisor.start());
  const child = rig.port.children[0];
  child?.writeStderr("boom sk-secret\n");
  child?.writeStderr("fine\n");
  await until(() => rig.supervisor.stderrTail().length === 1, "the safe line");
  expect(rig.supervisor.stderrTail()).toEqual(["fine"]);
  expect(rig.events).toContain("plugin_host.stderr_mask_failed");
});

test("a child that rejects the protocol version fails the start with init_failed", async () => {
  const rig = rigOf(await fixtureRoot(), { protocolVersion: 99 });
  const failed = await rig.supervisor.start();
  expect(errorOf(failed)).toMatchObject({ kind: "init_failed", hostKind: "protocol_version" });
  expect(rig.supervisor.status().state).toBe("stopped");
  expect(rig.port.children[0]?.signals).toEqual(["SIGTERM"]);
  expect(rig.supervisor.status().deaths).toBe(0);
});

test("a spawn failure and a missing sandbox come back as start errors", async () => {
  const rig = rigOf(await fixtureRoot());
  rig.port.failNextSpawn({ kind: "sandbox_unavailable", reason: "no sandbox on this machine" });
  expect(errorOf(await rig.supervisor.start())).toEqual({
    kind: "sandbox_unavailable",
    message: "no sandbox on this machine",
  });
  rig.port.failNextSpawn({ kind: "spawn_failed", code: "ENOENT", message: "no such file" });
  expect(errorOf(await rig.supervisor.start())).toEqual({
    kind: "spawn_failed",
    message: "ENOENT: no such file",
  });
  expect(rig.supervisor.status().state).toBe("stopped");
});

test("a child that never answers host.init is stopped at the init time limit", async () => {
  const rig = rigOf(await fixtureRoot(), { initTimeoutMs: 1000 });
  rig.port.nextOptions({ silent: true });
  const started = rig.supervisor.start();
  await until(() => rig.clock.armed() > 0, "the init timer is armed");
  rig.clock.advance(1000);
  expect(errorOf(await started)).toMatchObject({ kind: "init_timeout" });
  expect(rig.port.children[0]?.signals).toEqual(["SIGTERM"]);
  expect(rig.supervisor.status().deaths).toBe(1);
  await until(() => rig.supervisor.status().state === "stopped", "stopped after the timeout");
});

test("dispose ends the process, later calls report disposed, and a second dispose is harmless", async () => {
  const rig = rigOf(await fixtureRoot());
  okValue(await rig.supervisor.start());
  rig.supervisor.dispose("shutdown");
  rig.supervisor.dispose("shutdown");
  await until(() => rig.supervisor.status().state === "stopped", "stopped after dispose");
  expect(rig.port.children[0]?.isAlive()).toBe(false);
  expect(
    errorOf(await rig.supervisor.call("method.call", methodParams("ping", { n: 1 }))),
  ).toMatchObject({ kind: "disposed" });
  expect(rig.port.children.length).toBe(1);
});

test("a plugin's engine call reaches the engine and its answer returns to the plugin", async () => {
  const rig = rigOf(await fixtureRoot());
  const reply = await rig.supervisor.call("method.call", methodParams("bump", {}));
  expect(okValue(reply)).toEqual({ count: 1 });
  expect(rig.engineCalls).toMatchObject([{ method: "commit", registration: "demo" }]);
});

test("an engine call failure reaches the plugin with its origin", async () => {
  const rig = rigOf(await fixtureRoot(), {
    engineFailure: {
      kind: "engine_call_failed",
      message: "state_schema: bad",
      origin: { kind: "primitive", code: "state_schema", scopeId: "demo" },
    },
  });
  await rig.supervisor.call("method.call", methodParams("bump", {}));
  // 엔진이 자식에게 쓴 줄 가운데 오류 응답 하나(엔진 호출의 답)
  const answer = rig.port.children[0]
    ?.received()
    .split("\n")
    .find((line) => line.includes('"error"'));
  const parsed = answer === undefined ? undefined : parseJson(answer);
  expect(parsed?.ok ? parsed.value : undefined).toMatchObject({
    error: {
      kind: "engine_call_failed",
      message: "state_schema: bad",
      origin: { kind: "primitive", code: "state_schema", scopeId: "demo" },
    },
  });
});

test("a notification is sent without an answer and the process keeps serving calls", async () => {
  const rig = rigOf(await fixtureRoot());
  const notice = await rig.supervisor.notify("request.cancel", { id: 999 });
  expect(notice.ok).toBe(true);
  const reply: Result<JsonValue, unknown> = await rig.supervisor.call(
    "method.call",
    methodParams("ping", { n: 5 }),
  );
  expect(okValue(reply)).toEqual({ pong: 5 });
  expect(rig.port.children[0]?.received()).toContain('"method":"request.cancel"');
});
