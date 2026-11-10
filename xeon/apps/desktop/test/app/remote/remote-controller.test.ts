import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  createRemoteController,
  type RemoteController,
} from "../../../src/app/remote/remote-controller.ts";
import {
  createFakeRemoteAdapter,
  FAKE_FINGERPRINT,
  FAKE_NOW,
  FAKE_OFF_STATUS,
  FAKE_PAIRING_TTL_MS,
  type FakeRemoteAdapter,
  type FakeRemoteOptions,
} from "../../../src/app/remote/fake-remote-adapter.ts";
import type { CommandError } from "../../../src/views/commands.ts";
import type {
  RemoteAdapter,
  RemoteDevice,
  RemoteStatus,
} from "../../../src/app/remote/remote-types.ts";

const RUNNING: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10"],
  fingerprint: FAKE_FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

const WEB_DEVICE: RemoteDevice = {
  id: "dev-a",
  name: "노트북",
  kind: "web",
  createdAt: 1,
  lastSeenAt: null,
  address: null,
};

const DESKTOP_DEVICE: RemoteDevice = {
  id: "dev-b",
  name: "데스크톱",
  kind: "desktop",
  createdAt: 2,
  lastSeenAt: null,
  address: null,
};

const FAILED: CommandError = { kind: "failed" };

// ── 시험 도구 ─────────────────────────────────────────────────────────────

/** 시험용 타이머. 실제 시간을 기다리지 않고 `advance`로 시각을 옮기며 기한이 온 타이머를 부른다 */
interface ManualTimers {
  readonly setTimer: (fn: () => void, ms: number) => number;
  readonly clearTimer: (handle: number) => void;
  /** `ms`만큼 시각을 옮기며 기한이 온 타이머를 기한 순서로 부른다. 부른 뒤 새로 건 타이머는 그 시각 기준이다 */
  readonly advance: (ms: number) => void;
  /** 걸려 있는 타이머 수 */
  readonly pending: () => number;
}

interface PendingTimer {
  readonly id: number;
  readonly due: number;
  readonly fn: () => void;
}

function manualTimers(): ManualTimers {
  let at = 0;
  let nextId = 1;
  let waiting: PendingTimer[] = [];

  function earliest(limit: number): PendingTimer | undefined {
    let best: PendingTimer | undefined;
    for (const timer of waiting) {
      if (timer.due <= limit && (best === undefined || timer.due < best.due)) best = timer;
    }
    return best;
  }

  return {
    setTimer: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      waiting.push({ id, due: at + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      waiting = waiting.filter((timer) => timer.id !== handle);
    },
    advance: (ms) => {
      const limit = at + ms;
      let next = earliest(limit);
      while (next !== undefined) {
        const fired = next;
        waiting = waiting.filter((timer) => timer.id !== fired.id);
        at = fired.due;
        fired.fn();
        next = earliest(limit);
      }
      at = limit;
    },
    pending: () => waiting.length,
  };
}

/** 응답을 붙잡아 두었다가 시험이 고른 순서로 풀어 준다. 늦게 온 응답을 흉내 낸다 */
interface Hold {
  hold<T>(pending: Promise<T>): Promise<T>;
  /** `order`번째로 붙잡은 응답(0부터 센다)을 푼다 */
  release(order: number): void;
  /** 아직 풀지 않은 응답 수 */
  held(): number;
}

function holdOf(): Hold {
  let issued = 0;
  const waiting = new Map<number, () => void>();
  return {
    hold<T>(pending: Promise<T>): Promise<T> {
      const order = issued;
      issued += 1;
      return new Promise<T>((resolve) => {
        waiting.set(order, () => {
          resolve(pending);
        });
      });
    },
    release(order) {
      waiting.get(order)?.();
      waiting.delete(order);
    },
    held: () => waiting.size,
  };
}

/** 걸린 읽기 응답이 모두 돌아올 때까지 한 바퀴 양보한다. 실제 대기는 없다 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });
}

interface HarnessOptions {
  readonly fake?: FakeRemoteOptions;
  /** 상태 읽기 응답을 붙잡는다 */
  readonly holdStatus?: boolean;
  /** `setEnabled` 응답을 붙잡는다 */
  readonly holdEnable?: boolean;
  /** 서비스 띄우기가 실패하게 한다 */
  readonly failStart?: boolean;
  /** 서비스 멈추기가 실패하게 한다 */
  readonly failStop?: boolean;
}

interface Harness {
  readonly controller: RemoteController;
  readonly fake: FakeRemoteAdapter;
  readonly timers: ManualTimers;
  readonly statusHold: Hold;
  readonly enableHold: Hold;
  /** 어댑터의 `setEnabled`와 서비스 명령이 받은 순서 */
  readonly order: readonly string[];
  /** 서비스 명령만 받은 순서 */
  readonly connection: readonly string[];
  /** `onChange`가 불린 횟수 */
  readonly changes: () => number;
  /** 시험 시계를 `ms`만큼 옮긴다 */
  readonly moveClock: (ms: number) => void;
}

function harnessOf(options: HarnessOptions = {}): Harness {
  let clock = FAKE_NOW;
  let changes = 0;
  const order: string[] = [];
  const connection: string[] = [];
  const timers = manualTimers();
  const statusHold = holdOf();
  const enableHold = holdOf();
  const fake = createFakeRemoteAdapter({ now: () => clock, ...options.fake });

  const adapter: RemoteAdapter = {
    status: () => {
      const reply = fake.status();
      return options.holdStatus === true ? statusHold.hold(reply) : reply;
    },
    setEnabled: (enabled) => {
      order.push(`setEnabled ${enabled}`);
      const reply = fake.setEnabled(enabled);
      return options.holdEnable === true ? enableHold.hold(reply) : reply;
    },
    pair: () => fake.pair(),
    devices: () => fake.devices(),
    revoke: (target) => fake.revoke(target),
  };

  const serviceCommands = {
    startLocalService: () => {
      order.push("startLocalService");
      connection.push("startLocalService");
      return Promise.resolve(options.failStart === true ? err(FAILED) : ok(null));
    },
    stopLocalService: () => {
      order.push("stopLocalService");
      connection.push("stopLocalService");
      return Promise.resolve(options.failStop === true ? err(FAILED) : ok(null));
    },
  };

  const controller = createRemoteController<number>({
    adapter,
    connection: serviceCommands,
    now: () => clock,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onChange: () => {
      changes += 1;
    },
  });

  return {
    controller,
    fake,
    timers,
    statusHold,
    enableHold,
    order,
    connection,
    changes: () => changes,
    moveClock: (ms) => {
      clock += ms;
    },
  };
}

/** 타이머를 `ms`만큼 옮기고 걸린 읽기 응답이 돌아올 때까지 기다린다 */
async function tick(harness: Harness, ms: number): Promise<void> {
  harness.timers.advance(ms);
  await settle();
}

// ── 처음 읽기 ─────────────────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 처음 읽기", () => {
  test("상태와 기기 목록을 읽으면 둘 다 ready다", async () => {
    const h = harnessOf({ fake: { devices: [WEB_DEVICE] } });
    h.controller.start();
    await settle();
    expect(h.controller.state().status).toEqual({ kind: "ready", value: FAKE_OFF_STATUS });
    expect(h.controller.state().devices).toEqual({ kind: "ready", value: [WEB_DEVICE] });
  });

  test("상태 읽기가 실패하면 status는 failed이고 기기 목록은 따로 ready다", async () => {
    const h = harnessOf();
    h.fake.failNext({ kind: "failed", message: "엔진 응답 없음" });
    h.controller.start();
    await settle();
    expect(h.controller.state().status).toEqual({
      kind: "failed",
      error: { kind: "failed", message: "엔진 응답 없음" },
    });
    expect(h.controller.state().devices).toEqual({ kind: "ready", value: [] });
  });
});

// ── 서버 모드 고르기 ──────────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 서버 모드 고르기", () => {
  test("끄기: 원격이 켜져 있으면 원격을 먼저 끄고 서비스를 멈춘다", async () => {
    const h = harnessOf({ fake: { status: RUNNING } });
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.selectMode("off", true);
    expect(h.fake.calls.slice(mark)).toEqual([{ method: "setEnabled", enabled: false }]);
    expect(h.order).toEqual(["setEnabled false", "stopLocalService"]);
    expect(h.connection).toEqual(["stopLocalService"]);
    expect(h.controller.state().status).toEqual({ kind: "ready", value: FAKE_OFF_STATUS });
  });

  test("끄기: 원격이 꺼져 있으면 서비스만 멈춘다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.selectMode("off", true);
    expect(h.fake.calls.slice(mark)).toEqual([]);
    expect(h.order).toEqual(["stopLocalService"]);
  });

  test("끄기: 원격 끄기가 실패해도 서비스는 멈추고, 알림은 끄기 실패다", async () => {
    const h = harnessOf({ fake: { status: RUNNING } });
    h.controller.start();
    await settle();
    h.fake.failNext({ kind: "failed", message: "끌 수 없음" });
    await h.controller.selectMode("off", true);
    expect(h.order).toEqual(["setEnabled false", "stopLocalService"]);
    expect(h.connection).toEqual(["stopLocalService"]);
    expect(h.controller.state().notice).toEqual({ kind: "disableFailed" });
    expect(h.controller.state().status).toEqual({
      kind: "failed",
      error: { kind: "failed", message: "끌 수 없음" },
    });
  });

  test("서비스: 원격을 끄고 서비스를 띄운다", async () => {
    const h = harnessOf({ fake: { status: RUNNING } });
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.selectMode("service", false);
    expect(h.fake.calls.slice(mark)).toEqual([{ method: "setEnabled", enabled: false }]);
    expect(h.order).toEqual(["setEnabled false", "startLocalService"]);
    expect(h.connection).toEqual(["startLocalService"]);
  });

  test("서비스: 이미 떠 있고 원격도 꺼져 있으면 아무 호출도 없다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.selectMode("service", true);
    expect(h.fake.calls.slice(mark)).toEqual([]);
    expect(h.order).toEqual([]);
  });

  test("원격 포함: 서비스를 띄운 뒤 확인 대화 상자만 열고 원격은 켜지 않는다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.selectMode("service+remote", false);
    expect(h.order).toEqual(["startLocalService"]);
    expect(h.fake.calls.slice(mark)).toEqual([]);
    expect(h.controller.state().confirmOpen).toBe(true);
  });

  test("원격 포함: 서비스가 떠 있으면 띄우기는 건너뛰고 대화 상자만 연다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    expect(h.order).toEqual([]);
    expect(h.controller.state().confirmOpen).toBe(true);
  });

  test("원격 포함: 서비스 띄우기가 실패하면 대화 상자를 열지 않는다", async () => {
    const h = harnessOf({ failStart: true });
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.selectMode("service+remote", false);
    expect(h.connection).toEqual(["startLocalService"]);
    expect(h.fake.calls.slice(mark)).toEqual([]);
    expect(h.controller.state().confirmOpen).toBe(false);
  });
});

// ── 확인 대화 상자와 켜기 ─────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 확인과 켜기", () => {
  test("확인하면 켜기를 정확히 한 번 보내고 대화 상자를 닫는다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    const mark = h.fake.calls.length;
    const before = h.changes();
    await h.controller.confirmRemote();
    expect(h.fake.calls.slice(mark)).toEqual([{ method: "setEnabled", enabled: true }]);
    expect(h.order).toEqual(["setEnabled true"]);
    expect(h.controller.state().confirmOpen).toBe(false);
    expect(h.controller.state().busy).toBe("none");
    expect(h.controller.state().status).toEqual({
      kind: "ready",
      value: { ...FAKE_OFF_STATUS, enabled: true, state: "starting" },
    });
    // busySet(enabling), confirmClosed, busySet(none), statusLoaded
    expect(h.changes()).toBe(before + 4);
  });

  test("대화 상자를 열지 않고 확인하면 아무 호출도 없다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.confirmRemote();
    expect(h.fake.calls.slice(mark)).toEqual([]);
  });

  test("취소하면 어떤 호출도 하지 않는다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    const mark = h.fake.calls.length;
    h.controller.cancelConfirm();
    expect(h.controller.state().confirmOpen).toBe(false);
    expect(h.fake.calls.slice(mark)).toEqual([]);
    expect(h.order).toEqual([]);
  });

  test("켜는 동안 busy는 enabling이고, 그 사이 다른 쓰기는 받지 않는다", async () => {
    const h = harnessOf({ holdEnable: true });
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    const pending = h.controller.confirmRemote();
    expect(h.controller.state().busy).toBe("enabling");
    expect(h.controller.state().confirmOpen).toBe(false);
    await h.controller.selectMode("off", true);
    expect(h.order).toEqual(["setEnabled true"]);
    h.enableHold.release(0);
    await pending;
    expect(h.controller.state().busy).toBe("none");
    expect(h.controller.state().status).toEqual({
      kind: "ready",
      value: { ...FAKE_OFF_STATUS, enabled: true, state: "starting" },
    });
  });

  test("켜기가 실패하면 상태가 failed이고, 다시 시도하면 한 번 더 켠다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    h.fake.failNext({ kind: "failed", message: "포트 충돌" });
    await h.controller.confirmRemote();
    expect(h.controller.state().status).toEqual({
      kind: "failed",
      error: { kind: "failed", message: "포트 충돌" },
    });
    const mark = h.fake.calls.length;
    await h.controller.retryEnable();
    expect(h.fake.calls.slice(mark)).toEqual([{ method: "setEnabled", enabled: true }]);
    expect(h.controller.state().status).toEqual({
      kind: "ready",
      value: { ...FAKE_OFF_STATUS, enabled: true, state: "starting" },
    });
  });
});

// ── 주기 읽기 ─────────────────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 주기 읽기", () => {
  test("띄우는 중에는 3000ms마다 상태를 읽고, 실행 중이 되면 멈춘다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    await h.controller.confirmRemote();
    const reads = () => h.fake.calls.filter((call) => call.method === "status").length;
    expect(reads()).toBe(1);

    await tick(h, 2999);
    expect(reads()).toBe(1);
    await tick(h, 1);
    expect(reads()).toBe(2);
    expect(h.controller.state().status).toEqual({
      kind: "ready",
      value: { ...FAKE_OFF_STATUS, enabled: true, state: "starting" },
    });

    h.fake.advance();
    await tick(h, 3000);
    expect(reads()).toBe(3);
    expect(h.controller.state().status).toEqual({ kind: "ready", value: RUNNING });

    await tick(h, 3000);
    expect(reads()).toBe(3);
    expect(h.timers.pending()).toBe(1);
  });

  test("외부 접속이 실행 중으로 바뀌는 순간 기기 목록을 바로 다시 읽는다(주기를 기다리지 않는다)", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    await h.controller.confirmRemote();
    const devicesReads = () => h.fake.calls.filter((call) => call.method === "devices").length;
    expect(devicesReads()).toBe(1);

    h.fake.advance();
    await tick(h, 3000);
    expect(h.controller.state().status).toEqual({ kind: "ready", value: RUNNING });
    expect(devicesReads()).toBe(2);

    // 이미 실행 중이면 상태를 다시 읽어도 목록을 더 읽지 않는다
    await h.controller.reloadStatus();
    expect(devicesReads()).toBe(2);
  });

  test("시작한 뒤에는 기기 목록을 15000ms마다 다시 읽는다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    const devicesReads = () => h.fake.calls.filter((call) => call.method === "devices").length;
    expect(devicesReads()).toBe(1);

    await tick(h, 14999);
    expect(devicesReads()).toBe(1);
    await tick(h, 1);
    expect(devicesReads()).toBe(2);
    await tick(h, 15000);
    expect(devicesReads()).toBe(3);
  });

  test("멈추면 걸린 타이머가 모두 풀리고 이후 읽기가 없다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    expect(h.timers.pending()).toBe(1);
    h.controller.stop();
    expect(h.timers.pending()).toBe(0);
    const mark = h.fake.calls.length;
    await tick(h, 15000);
    expect(h.fake.calls.slice(mark)).toEqual([]);
  });
});

// ── 기기 해제 ─────────────────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 기기 해제", () => {
  test("기기 하나를 해제하면 그 줄만 빠지고 목록을 다시 읽는다", async () => {
    const h = harnessOf({ fake: { devices: [WEB_DEVICE, DESKTOP_DEVICE] } });
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.revoke({ id: "dev-a" });
    expect(h.controller.state().devices).toEqual({ kind: "ready", value: [DESKTOP_DEVICE] });
    expect(h.fake.calls.slice(mark)).toEqual([
      { method: "revoke", target: { id: "dev-a" } },
      { method: "devices" },
    ]);
  });

  test("전부 해제하면 목록이 빈다", async () => {
    const h = harnessOf({ fake: { devices: [WEB_DEVICE, DESKTOP_DEVICE] } });
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.revoke({ all: true });
    expect(h.controller.state().devices).toEqual({ kind: "ready", value: [] });
    expect(h.fake.calls.slice(mark)).toEqual([
      { method: "revoke", target: { all: true } },
      { method: "devices" },
    ]);
  });
});

// ── 페어링 ────────────────────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 페어링", () => {
  test("발급한 코드는 만료 시각이 지나면 none으로 보이고, 다시 발급하면 새 코드를 받는다", async () => {
    const h = harnessOf({ fake: { status: RUNNING } });
    h.controller.start();
    await settle();
    await h.controller.issuePairing();
    const expiresAt = FAKE_NOW + FAKE_PAIRING_TTL_MS;
    expect(h.controller.state().pairing).toEqual({
      kind: "issued",
      code: { code: "100001", expiresAt },
    });

    h.moveClock(FAKE_PAIRING_TTL_MS - 1);
    expect(h.controller.state().pairing.kind).toBe("issued");
    h.moveClock(1);
    expect(h.controller.state().pairing).toEqual({ kind: "none" });

    await h.controller.issuePairing();
    expect(h.controller.state().pairing).toEqual({
      kind: "issued",
      code: { code: "100002", expiresAt: expiresAt + FAKE_PAIRING_TTL_MS },
    });
  });

  test("발급 뒤에는 기기 목록을 다시 읽는다", async () => {
    const h = harnessOf({ fake: { status: RUNNING } });
    h.controller.start();
    await settle();
    const mark = h.fake.calls.length;
    await h.controller.issuePairing();
    expect(h.fake.calls.slice(mark)).toEqual([{ method: "pair" }, { method: "devices" }]);
  });

  test("원격이 꺼져 있으면 발급은 remote-off 오류가 된다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.issuePairing();
    expect(h.controller.state().pairing).toEqual({
      kind: "failed",
      error: { kind: "remote-off" },
    });
  });
});

// ── 늦은 응답 ─────────────────────────────────────────────────────────────

describe("원격 접속 컨트롤러: 끄기 규칙과 알림", () => {
  test("상태를 못 읽었으면 끄기는 외부 접속 끄기부터 보낸다", async () => {
    const h = harnessOf();
    h.fake.failNext({ kind: "failed", message: "엔진 응답 없음" });
    h.controller.start();
    await settle();
    expect(h.controller.state().status.kind).toBe("failed");
    await h.controller.selectMode("off", true);
    expect(h.order).toEqual(["setEnabled false", "stopLocalService"]);
    expect(h.connection).toEqual(["stopLocalService"]);
  });

  test("상태를 못 읽었으면 서비스 모드도 외부 접속 끄기를 먼저 보낸다", async () => {
    const h = harnessOf();
    h.fake.failNext({ kind: "failed", message: "엔진 응답 없음" });
    h.controller.start();
    await settle();
    await h.controller.selectMode("service", false);
    expect(h.order).toEqual(["setEnabled false", "startLocalService"]);
  });

  test("상태가 꺼짐으로 읽혔으면 서비스 모드는 외부 접속 끄기를 보내지 않는다", async () => {
    const h = harnessOf();
    h.controller.start();
    await settle();
    await h.controller.selectMode("service", false);
    expect(h.order).toEqual(["startLocalService"]);
  });

  test("끄기: 서비스가 안 떠 있으면 서비스 멈춤을 보내지 않는다", async () => {
    const h = harnessOf({ fake: { status: RUNNING } });
    h.controller.start();
    await settle();
    await h.controller.selectMode("off", false);
    expect(h.order).toEqual(["setEnabled false"]);
    expect(h.connection).toEqual([]);
  });

  test("켜기가 실패하면 알림은 켜기 실패이고, 다음 쓰기가 시작하면 없어진다", async () => {
    const h = harnessOf({ holdEnable: true });
    h.controller.start();
    await settle();
    await h.controller.selectMode("service+remote", true);
    h.fake.failNext({ kind: "failed", message: "포트 충돌" });
    const first = h.controller.confirmRemote();
    h.enableHold.release(0);
    await first;
    expect(h.controller.state().notice).toEqual({ kind: "enableFailed" });

    const retry = h.controller.retryEnable();
    expect(h.controller.state().notice).toBeNull();
    h.enableHold.release(1);
    await retry;
    expect(h.controller.state().status.kind).toBe("ready");
    expect(h.controller.state().notice).toBeNull();
  });

  test("서비스 띄우기가 실패하면 알림은 서비스 실패다", async () => {
    const h = harnessOf({ failStart: true });
    h.controller.start();
    await settle();
    await h.controller.selectMode("service", false);
    expect(h.connection).toEqual(["startLocalService"]);
    expect(h.controller.state().notice).toEqual({ kind: "serviceFailed" });
  });

  test("서비스 멈추기가 실패하면 알림은 서비스 실패다", async () => {
    const h = harnessOf({ failStop: true });
    h.controller.start();
    await settle();
    await h.controller.selectMode("off", true);
    expect(h.connection).toEqual(["stopLocalService"]);
    expect(h.controller.state().notice).toEqual({ kind: "serviceFailed" });
  });

  test("해제가 실패하면 알림은 해제 실패이고 목록은 그대로다. 다음 해제가 시작하면 알림이 없어진다", async () => {
    const h = harnessOf({ fake: { devices: [WEB_DEVICE] } });
    h.controller.start();
    await settle();
    h.fake.failNext({ kind: "failed", message: "해제 불가" });
    await h.controller.revoke({ id: "dev-a" });
    expect(h.controller.state().notice).toEqual({ kind: "revokeFailed" });
    expect(h.controller.state().devices).toEqual({ kind: "ready", value: [WEB_DEVICE] });

    await h.controller.revoke({ id: "dev-a" });
    expect(h.controller.state().notice).toBeNull();
    expect(h.controller.state().devices).toEqual({ kind: "ready", value: [] });
  });
});

describe("원격 접속 컨트롤러: 늦은 응답", () => {
  test("먼저 나간 상태 읽기가 나중 읽기 뒤에 와도 버린다", async () => {
    const h = harnessOf({ holdStatus: true });
    h.controller.start();
    // 첫 읽기(0번)는 꺼진 상태를 담은 채 붙잡힌다
    await settle();
    expect(h.controller.state().status).toEqual({ kind: "loading" });

    h.fake.setStatus(RUNNING);
    const fresh = h.controller.reloadStatus();
    // 새 읽기(1번)가 먼저 돌아온다
    h.statusHold.release(1);
    await fresh;
    expect(h.controller.state().status).toEqual({ kind: "ready", value: RUNNING });

    // 옛 응답(0번, 꺼진 상태)이 뒤늦게 와도 화면은 바뀌지 않는다
    h.statusHold.release(0);
    await settle();
    expect(h.controller.state().status).toEqual({ kind: "ready", value: RUNNING });
    expect(h.statusHold.held()).toBe(0);
  });
});
