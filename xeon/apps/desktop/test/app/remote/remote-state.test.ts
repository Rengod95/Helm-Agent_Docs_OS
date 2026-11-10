import { describe, expect, test } from "bun:test";
import { FAKE_OFF_STATUS } from "../../../src/app/remote/fake-remote-adapter.ts";
import {
  INITIAL_REMOTE_STATE,
  reduce,
  type RemoteScreenState,
} from "../../../src/app/remote/remote-state.ts";
import type {
  RemoteDevice,
  RemoteError,
  RemoteStatus,
} from "../../../src/app/remote/remote-types.ts";
import type { ServiceAutostart } from "../../../src/transport/ipc.ts";

// 원격 접속 화면의 상태 전이. 각 동작이 해당 칸만 바꾸는지 본다. 값은 `toEqual`로 비교한다.

const AUTOSTART: ServiceAutostart = {
  supported: true,
  registered: true,
  active: true,
  linger: null,
  platform: "darwin",
};

const DEVICE_A: RemoteDevice = {
  id: "d1",
  name: "Phone",
  kind: "web",
  createdAt: 1_800_000_000_000,
  lastSeenAt: null,
  address: null,
};
const DEVICE_B: RemoteDevice = {
  id: "d2",
  name: "Studio",
  kind: "desktop",
  createdAt: 1_800_000_050_000,
  lastSeenAt: 1_800_000_100_000,
  address: "192.168.0.21",
};
const STATUS: RemoteStatus = { ...FAKE_OFF_STATUS, enabled: true, state: "starting" };
const FAILED: RemoteError = { kind: "failed", message: "포트 사용 중" };

describe("remote screen state", () => {
  test("it starts with the reads loading, no pairing, no dialog, nothing busy, autostart unread", () => {
    expect(INITIAL_REMOTE_STATE).toEqual({
      status: { kind: "loading" },
      devices: { kind: "loading" },
      pairing: { kind: "none" },
      confirmOpen: false,
      busy: "none",
      notice: null,
      autostart: { kind: "loading" },
      autostartConfirmOpen: false,
      autostartLinger: false,
    });
  });

  test("noticeSet keeps one notice and noticeCleared removes it", () => {
    const set = reduce(INITIAL_REMOTE_STATE, { type: "noticeSet", kind: "enableFailed" });
    expect(set.notice).toEqual({ kind: "enableFailed", code: null });
    const replaced = reduce(set, { type: "noticeSet", kind: "serviceFailed" });
    expect(replaced.notice).toEqual({ kind: "serviceFailed", code: null });
    expect(reduce(replaced, { type: "noticeCleared" }).notice).toBeNull();
  });

  test("loadStarted puts both reads back to loading", () => {
    const loaded = reduce(INITIAL_REMOTE_STATE, { type: "statusLoaded", status: STATUS });
    const again = reduce(loaded, { type: "loadStarted" });
    expect(again.status).toEqual({ kind: "loading" });
    expect(again.devices).toEqual({ kind: "loading" });
  });

  test("a status read ends in ready with the value, and a failed read keeps the error", () => {
    expect(reduce(INITIAL_REMOTE_STATE, { type: "statusLoaded", status: STATUS }).status).toEqual({
      kind: "ready",
      value: STATUS,
    });
    expect(reduce(INITIAL_REMOTE_STATE, { type: "statusFailed", error: FAILED }).status).toEqual({
      kind: "failed",
      error: FAILED,
    });
  });

  test("an empty device list is ready with no devices, not loading", () => {
    const next = reduce(INITIAL_REMOTE_STATE, { type: "devicesLoaded", devices: [] });
    expect(next.devices).toEqual({ kind: "ready", value: [] });
  });

  test("a failed device read keeps the error and leaves the status alone", () => {
    const withStatus = reduce(INITIAL_REMOTE_STATE, { type: "statusLoaded", status: STATUS });
    const next = reduce(withStatus, { type: "devicesFailed", error: FAILED });
    expect(next.devices).toEqual({ kind: "failed", error: FAILED });
    expect(next.status).toEqual({ kind: "ready", value: STATUS });
  });

  test("pairing goes none, issuing, issued, and a failure replaces it", () => {
    const code = { code: "481920", expiresAt: 1_800_000_300_000 };
    const issuing = reduce(INITIAL_REMOTE_STATE, { type: "pairStarted" });
    expect(issuing.pairing).toEqual({ kind: "issuing" });
    const issued = reduce(issuing, { type: "pairIssued", code });
    expect(issued.pairing).toEqual({ kind: "issued", code });
    const failed = reduce(issued, { type: "pairFailed", error: { kind: "remote-off" } });
    expect(failed.pairing).toEqual({ kind: "failed", error: { kind: "remote-off" } });
  });

  test("the confirm dialog opens and closes", () => {
    const open = reduce(INITIAL_REMOTE_STATE, { type: "confirmOpened" });
    expect(open.confirmOpen).toBe(true);
    expect(reduce(open, { type: "confirmClosed" }).confirmOpen).toBe(false);
  });

  test("busy is set to the action in progress and back to none", () => {
    const enabling = reduce(INITIAL_REMOTE_STATE, { type: "busySet", busy: "enabling" });
    expect(enabling.busy).toBe("enabling");
    expect(reduce(enabling, { type: "busySet", busy: "none" }).busy).toBe("none");
  });

  test("removing one device drops only its row and keeps the rest in order", () => {
    const loaded = reduce(INITIAL_REMOTE_STATE, {
      type: "devicesLoaded",
      devices: [DEVICE_A, DEVICE_B],
    });
    const next = reduce(loaded, { type: "deviceRemoved", target: { id: "d1" } });
    expect(next.devices).toEqual({ kind: "ready", value: [DEVICE_B] });
  });

  test("removing all empties the list but keeps it ready", () => {
    const loaded = reduce(INITIAL_REMOTE_STATE, {
      type: "devicesLoaded",
      devices: [DEVICE_A, DEVICE_B],
    });
    const next = reduce(loaded, { type: "deviceRemoved", target: { all: true } });
    expect(next.devices).toEqual({ kind: "ready", value: [] });
  });

  test("removing a device while the list is not ready changes nothing", () => {
    const loading = reduce(INITIAL_REMOTE_STATE, { type: "deviceRemoved", target: { all: true } });
    expect(loading).toEqual(INITIAL_REMOTE_STATE);
    const failedList = reduce(INITIAL_REMOTE_STATE, { type: "devicesFailed", error: FAILED });
    expect(reduce(failedList, { type: "deviceRemoved", target: { id: "d1" } })).toEqual(failedList);
  });

  test("the reducer does not change the previous state object", () => {
    const before: RemoteScreenState = reduce(INITIAL_REMOTE_STATE, {
      type: "devicesLoaded",
      devices: [DEVICE_A],
    });
    reduce(before, { type: "deviceRemoved", target: { id: "d1" } });
    expect(before.devices).toEqual({ kind: "ready", value: [DEVICE_A] });
  });

  test("autostart: a read sets the value, a failed read is failed, and a new load starts it over", () => {
    const loaded = reduce(INITIAL_REMOTE_STATE, { type: "autostartLoaded", autostart: AUTOSTART });
    expect(loaded.autostart).toEqual({ kind: "ready", value: AUTOSTART });
    expect(reduce(loaded, { type: "autostartFailed" }).autostart).toEqual({
      kind: "failed",
      error: { kind: "failed", message: null },
    });
    expect(reduce(loaded, { type: "loadStarted" }).autostart).toEqual({ kind: "loading" });
  });

  test("autostart: the confirm dialog opens and closes, and only that flag moves", () => {
    const open = reduce(INITIAL_REMOTE_STATE, { type: "autostartConfirmOpened" });
    expect(open.autostartConfirmOpen).toBe(true);
    expect(open.busy).toBe("none");
    expect(reduce(open, { type: "autostartConfirmClosed" }).autostartConfirmOpen).toBe(false);
  });

  test("autostart: a failure notice keeps the closed code, and an ordinary notice has none", () => {
    const failed = reduce(INITIAL_REMOTE_STATE, {
      type: "noticeSet",
      kind: "autostartFailed",
      code: "autostart_failed",
    });
    expect(failed.notice).toEqual({ kind: "autostartFailed", code: "autostart_failed" });
    expect(
      reduce(INITIAL_REMOTE_STATE, { type: "noticeSet", kind: "enableFailed" }).notice,
    ).toEqual({ kind: "enableFailed", code: null });
  });

  test("autostart: the linger hint is a flag that the next write turns off", () => {
    const shown = reduce(INITIAL_REMOTE_STATE, { type: "autostartLingerSet", shown: true });
    expect(shown.autostartLinger).toBe(true);
    expect(reduce(shown, { type: "autostartLingerSet", shown: false }).autostartLinger).toBe(false);
  });
});
