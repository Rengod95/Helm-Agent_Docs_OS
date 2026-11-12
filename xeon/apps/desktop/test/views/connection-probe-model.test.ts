import { describe, expect, test } from "bun:test";
import type { EngineState } from "../../src/state/engine/index.ts";
import type { PreflightEvent, SshHostsReply } from "../../src/transport/ipc.ts";
import {
  PAIR_CODE_MAX,
  PAIR_DEVICE_NAME,
  PROBE_IDLE,
  fingerprintFailureKeyOf,
  hostDisplayOf,
  hostKeyPromptOf,
  pairFailureKeyOf,
  pickEmptyKeyOf,
  pickedSshFields,
  preflightTargetOf,
  probeReducer,
  stopLineOf,
  type ProbeState,
} from "../../src/views/pages/connection/connection-probe-model.ts";
import {
  reconnectLinesOf,
  switchNeedsConfirm,
} from "../../src/views/pages/connection/connection-model.ts";

// 연결 시험의 순수 모델. 단계 줄의 순서와 교체, 멈춘 줄, 호스트 키 확인, 고르기 목록의 채움, 쌍 맺기와 지문의 문장 키,
// 대상 바꾸기 확인 조건, 다시 붙기 줄을 값으로 비교한다.

const PASS_RESOLVE: PreflightEvent = {
  step: "resolve",
  status: "pass",
  code: "ok",
  durationMs: 12,
  actions: [],
};

const HOST_KEY_DETAIL: NonNullable<PreflightEvent["detail"]> = {
  hostname: "build.local",
  port: 22,
  hostKey: {
    fingerprint: "SHA256:abc",
    keyType: "ED25519",
    hostname: "build.local",
    port: 22,
    scanned: [],
  },
};

const HOST_KEY_NEW: PreflightEvent = {
  step: "connect",
  status: "action",
  code: "host_key_new",
  durationMs: 340,
  actions: ["trust_host_key"],
  detail: HOST_KEY_DETAIL,
};

function applied(...events: readonly PreflightEvent[]): ProbeState {
  return events.reduce<ProbeState>(
    (state, event) => probeReducer(state, { type: "step", event }),
    probeReducer(PROBE_IDLE, { type: "begin" }),
  );
}

describe("the preflight step lines keep one line per step, in step order", () => {
  test("a later event for a step replaces its line, and the lines follow the step order", () => {
    const state = applied(
      { ...PASS_RESOLVE, step: "install", status: "running", code: "running", durationMs: 0 },
      PASS_RESOLVE,
      { ...PASS_RESOLVE, step: "install", status: "pass", durationMs: 90 },
    );
    expect(state.steps.map((line) => [line.step, line.status, line.durationMs])).toEqual([
      ["resolve", "pass", 12],
      ["install", "pass", 90],
    ]);
    expect(state.busy).toBe(true);
  });

  test("a stopped outcome ends the run and keeps the step's time from its earlier event", () => {
    const state = applied(HOST_KEY_NEW);
    const stopped = probeReducer(state, {
      type: "stopped",
      outcome: {
        ok: false,
        step: "connect",
        status: "action",
        code: "host_key_new",
        actions: ["trust_host_key"],
        detail: HOST_KEY_DETAIL,
      },
    });
    expect(stopped.busy).toBe(false);
    expect(stopped.steps).toHaveLength(1);
    expect(stopped.steps[0]?.durationMs).toBe(340);
    expect(stopLineOf(stopped.steps)?.step).toBe("connect");
  });

  test("a finished run is no longer busy, a failed command says so, and a tested address is its own answer", () => {
    expect(probeReducer(applied(PASS_RESOLVE), { type: "finished" }).busy).toBe(false);
    expect(probeReducer(probeReducer(PROBE_IDLE, { type: "begin" }), { type: "failed" })).toEqual({
      busy: false,
      steps: [],
      tested: null,
      failed: true,
    });
    const tested = probeReducer(probeReducer(PROBE_IDLE, { type: "begin" }), {
      type: "tested",
      outcome: { ok: true, code: "ok", durationMs: 9 },
    });
    expect(tested.busy).toBe(false);
    expect(tested.tested).toEqual({ ok: true, code: "ok", durationMs: 9 });
  });

  test("a new run clears the earlier lines and the earlier answer", () => {
    const again = probeReducer(
      { ...applied(HOST_KEY_NEW), tested: { ok: false, code: "dns", durationMs: 1 } },
      { type: "begin" },
    );
    expect(again).toEqual({ busy: true, steps: [], tested: null, failed: false });
  });
});

describe("the host key prompt comes from the action and the fingerprint", () => {
  test("a new host key asks to trust it, with the fingerprint and the key type", () => {
    expect(hostKeyPromptOf(stopLineOf(applied(HOST_KEY_NEW).steps))).toEqual({
      fingerprint: "SHA256:abc",
      keyType: "ED25519",
      hostname: "build.local",
      replace: false,
    });
  });

  test("a changed key asks to replace the saved one, and a step without the action asks nothing", () => {
    const changed = {
      ...HOST_KEY_NEW,
      code: "host_key_changed",
      actions: ["replace_host_key", "retry"],
    };
    expect(hostKeyPromptOf(stopLineOf(applied(changed).steps))?.replace).toBe(true);
    const failed = { ...HOST_KEY_NEW, status: "fail" as const, actions: ["retry"] };
    expect(hostKeyPromptOf(stopLineOf(applied(failed).steps))).toBeNull();
    expect(hostKeyPromptOf(null)).toBeNull();
  });
});

describe("the target and the picked host fill the add form", () => {
  test("a target is user, host and port as far as they are given", () => {
    expect(preflightTargetOf({ user: " me ", host: " build ", port: "2222" })).toBe(
      "me@build:2222",
    );
    expect(preflightTargetOf({ user: "", host: "build", port: "" })).toBe("build");
    expect(preflightTargetOf({ user: "me", host: "  ", port: "" })).toBeNull();
  });

  test("a picked host fills the alias and its user, and keeps the socket that was typed", () => {
    const host: SshHostsReply["hosts"][number] = {
      name: "build",
      hostName: "build.example.com",
      user: "me",
      port: 2222,
      proxyJump: true,
    };
    expect(hostDisplayOf(host)).toBe("me@build.example.com:2222");
    expect(
      pickedSshFields(host, { user: "", host: "", port: "", socket: "/run/fresnel.sock" }),
    ).toEqual({ user: "me", host: "build", port: "", socket: "/run/fresnel.sock" });
    expect(
      hostDisplayOf({ name: "bare", hostName: null, user: null, port: null, proxyJump: false }),
    ).toBe("bare");
  });

  test("an unreadable config says so, an empty one says there are no hosts, and a list has no empty line", () => {
    expect(pickEmptyKeyOf({ hosts: [], unreadable: "missing" })).toBe(
      "desktop.connection.hosts.unreadable",
    );
    expect(pickEmptyKeyOf({ hosts: [], unreadable: null })).toBe("desktop.connection.hosts.none");
    expect(
      pickEmptyKeyOf({
        hosts: [{ name: "a", hostName: null, user: null, port: null, proxyJump: false }],
        unreadable: null,
      }),
    ).toBeNull();
  });
});

describe("the pairing and fingerprint sentences", () => {
  test("the device name is fixed and the code field takes up to 64 characters", () => {
    expect(PAIR_DEVICE_NAME).toBe("Fresnel desktop");
    expect(PAIR_CODE_MAX).toBe(64);
  });

  test("a locked pairing carries the seconds to wait, and a locked one with no seconds is a refusal", () => {
    expect(pairFailureKeyOf({ kind: "server", code: "locked", retryAfterSeconds: 30 })).toEqual({
      key: "desktop.connection.pair.error.locked",
      seconds: 30,
    });
    expect(pairFailureKeyOf({ kind: "server", code: "locked", retryAfterSeconds: null })).toEqual({
      key: "desktop.connection.pair.error.rejected",
    });
    expect(
      pairFailureKeyOf({ kind: "server", code: "invalid_code", retryAfterSeconds: null }),
    ).toEqual({
      key: "desktop.connection.pair.error.invalidCode",
    });
    expect(pairFailureKeyOf({ kind: "failed" })).toEqual({
      key: "desktop.connection.actionFailed",
    });
  });

  test("a fingerprint that could not be read says why the server was not reached", () => {
    expect(fingerprintFailureKeyOf({ kind: "probe", code: "refused" })).toBe(
      "desktop.connection.pair.error.refused",
    );
    expect(fingerprintFailureKeyOf({ kind: "probe", code: "timeout" })).toBe(
      "desktop.connection.pair.error.timeout",
    );
    expect(fingerprintFailureKeyOf({ kind: "failed" })).toBe("desktop.connection.actionFailed");
  });
});

describe("the switch confirm and the reconnect lines", () => {
  const quiet = { liveTurns: 0, waitingApprovals: 0, keepsRunning: false };

  test("a switch with no running turns and no approvals goes through without a dialog", () => {
    expect(switchNeedsConfirm(quiet)).toBe(false);
    expect(switchNeedsConfirm({ ...quiet, liveTurns: 1 })).toBe(true);
    expect(switchNeedsConfirm({ ...quiet, waitingApprovals: 2 })).toBe(true);
  });

  test("a restarting engine shows the attempt; a remote target that is down also shows what was seen and whether the service lives", () => {
    const restarting: EngineState = {
      kind: "restarting",
      attempt: 2,
      retryAt: new Date(10_000).toISOString(),
      lastExit: { code: 3, signal: null, at: new Date(0).toISOString() },
    };
    const lines = reconnectLinesOf({
      engine: restarting,
      nowMs: 7_500,
      remote: true,
      live: false,
      lastSeen: { at: 1_000, version: "1.2.3", liveTurns: 3 },
      alive: { kind: "read", alive: true },
    });
    expect(lines).toEqual([
      { kind: "attempt", attempt: 2, seconds: 3 },
      { kind: "lastSeen", at: 1_000, turns: 3 },
      { kind: "alive" },
    ]);
  });

  test("a live or local target has no remote lines, and an unreadable SSH answer is the unknown line", () => {
    const base = {
      engine: null,
      nowMs: 0,
      lastSeen: { at: 1, version: null, liveTurns: 0 },
      alive: { kind: "read" as const, alive: null },
    };
    expect(reconnectLinesOf({ ...base, remote: true, live: true })).toEqual([]);
    expect(reconnectLinesOf({ ...base, remote: false, live: false })).toEqual([]);
    expect(reconnectLinesOf({ ...base, remote: true, live: false })).toEqual([
      { kind: "lastSeen", at: 1, turns: 0 },
      { kind: "unknown" },
    ]);
    expect(
      reconnectLinesOf({ ...base, remote: true, live: false, alive: { kind: "unchecked" } }),
    ).toEqual([{ kind: "lastSeen", at: 1, turns: 0 }]);
  });
});
