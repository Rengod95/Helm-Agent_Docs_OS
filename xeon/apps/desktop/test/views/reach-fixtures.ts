import { FAKE_FINGERPRINT, FAKE_NOW } from "../../src/app/remote/fake-remote-adapter.ts";
import { INITIAL_REMOTE_STATE, type RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import type {
  RemoteDevice,
  RemotePreflight,
  RemoteStatus,
  TailscaleInfo,
} from "../../src/app/remote/remote-types.ts";
import type { RemoteActions, RemoteScreen } from "../../src/app/remote/use-remote-controller.ts";
import type { ServiceCard } from "../../src/views/commands.ts";
import type { ConnectionScreenHandlers } from "../../src/views/pages/connection/connection-handlers.ts";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import type { ReachSetupActions } from "../../src/views/pages/connection/reach-container.tsx";

// "휴대폰·브라우저에서 쓰기"와 "등록된 기기" 시험이 함께 쓰는 값. 동작은 부른 이름을 차례로 `calls`에 남긴다.

export { FAKE_NOW };

const NOOP = (): void => {};

export const HANDLERS: ConnectionScreenHandlers = {
  query: NOOP,
  connect: NOOP,
  retry: NOOP,
  backToLocal: NOOP,
  removeAsk: NOOP,
  removeCancel: NOOP,
  removeConfirm: NOOP,
  renameOpen: NOOP,
  renameField: NOOP,
  renameSubmit: NOOP,
  renameCancel: NOOP,
  dismissNotice: NOOP,
  confirmStop: NOOP,
  restart: NOOP,
  copyDiagnostics: NOOP,
  refresh: NOOP,
  setRemoteRespond: NOOP,
  setStopConfirm: NOOP,
  testRow: NOOP,
  copyCommand: NOOP,
  switchConfirm: NOOP,
  switchCancel: NOOP,
  dismissTargetNotice: NOOP,
  addTarget: () => Promise.resolve(false),
};

export const RUNNING: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10", "my-mac.local"],
  fingerprint: FAKE_FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

export const OFF: RemoteStatus = {
  ...RUNNING,
  enabled: false,
  state: "off",
  loopbackPort: null,
  tlsPort: null,
  fingerprint: null,
};

export const PHONE: RemoteDevice = {
  id: "d1",
  name: "Pixel",
  kind: "web",
  createdAt: FAKE_NOW - 3_600_000,
  lastSeenAt: FAKE_NOW - 180_000,
  address: "192.168.0.21",
};

export const LAPTOP: RemoteDevice = {
  id: "d2",
  name: "Studio",
  kind: "desktop",
  createdAt: FAKE_NOW - 7_200_000,
  lastSeenAt: null,
  address: null,
};

export function remoteState(patch: Partial<RemoteScreenState> = {}): RemoteScreenState {
  return {
    ...INITIAL_REMOTE_STATE,
    status: { kind: "ready", value: RUNNING },
    devices: { kind: "ready", value: [] },
    autostart: {
      kind: "ready",
      value: { supported: true, registered: true, active: true, linger: null, platform: "macos" },
    },
    ...patch,
  };
}

export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** 원격 동작 묶음과 그 기록 */
export function remoteOf(state: RemoteScreenState): { remote: RemoteScreen; calls: Call[] } {
  const calls: Call[] = [];
  const later =
    (name: string) =>
    (...args: readonly unknown[]): Promise<void> => {
      calls.push({ name, args });
      return Promise.resolve();
    };
  const now =
    (name: string) =>
    (...args: readonly unknown[]): void => {
      calls.push({ name, args });
    };
  const actions: RemoteActions = {
    selectMode: later("selectMode"),
    confirmRemote: later("confirmRemote"),
    cancelConfirm: now("cancelConfirm"),
    retryEnable: later("retryEnable"),
    issuePairing: later("issuePairing"),
    revoke: later("revoke"),
    requestAutostart: later("requestAutostart"),
    confirmAutostart: later("confirmAutostart"),
    cancelAutostartConfirm: now("cancelAutostartConfirm"),
    keepOn: later("keepOn"),
    reloadAutostart: later("reloadAutostart"),
    reloadStatus: later("reloadStatus"),
    reloadDevices: later("reloadDevices"),
  };
  return { remote: { state, actions }, calls };
}

export function setupActionsOf(calls: Call[]): ReachSetupActions {
  const record =
    (name: string) =>
    (...args: readonly unknown[]): void => {
      calls.push({ name, args });
    };
  return {
    recheck: record("recheck"),
    reloadTailscale: record("reloadTailscale"),
    setServe: record("setServe"),
    applyDomain: record("applyDomain"),
    setProxyKind: record("setProxyKind"),
    ensureProxy: record("ensureProxy"),
    addAllowedHosts: record("addAllowedHosts"),
    openLink: record("openLink"),
  };
}

const RUNNING_SERVICE: ServiceCard = {
  kind: "running",
  pid: 900,
  version: "0.4.1",
  startedAt: 1,
  attached: true,
};

/** 화면 상태. 서비스가 돌고 승인하기 값이 `allow`다 */
export function screenState(allow: boolean | null = true): ConnectionState {
  return connectionReducer(INITIAL_CONNECTION_STATE, {
    type: "statusLoaded",
    snapshot: {
      host: {
        mode: "service",
        pid: 4211,
        startedAt: "2026-11-12T01:00:00.000Z",
        connections: 0,
        liveTurns: 0,
        idleShutdownAt: null,
        safeMode: false,
      },
      service: RUNNING_SERVICE,
      restartPending: false,
      remoteAllowRespond: allow,
    },
  });
}

/** 사전 점검 7항목. 기본은 모두 통과(인증서는 자체 서명 안내) */
export function preflightOf(
  overrides: Partial<Record<string, Partial<RemotePreflight["items"][number]>>> = {},
): RemotePreflight {
  const ids = [
    "service_running",
    "gateway_running",
    "listen_port",
    "allowed_hosts",
    "certificate",
    "autostart",
    "reachable_addresses",
  ];
  const items: RemotePreflight["items"][number][] = [];
  for (const id of ids) {
    items.push({
      id,
      status: "pass",
      cause: id === "certificate" ? "cert_self_signed" : null,
      fix: id === "certificate" ? "use_tailscale_serve_for_trusted_https" : null,
      autoFix: null,
      detail: {},
      ...overrides[id],
    });
  }
  return { ready: items.every((item) => item.status !== "fail"), items };
}

export const TAILSCALE_READY: TailscaleInfo = {
  state: "ready",
  authUrl: null,
  magicDnsName: "my-mac.tail1234.ts.net",
  ips: ["100.101.1.2"],
  httpsEnabled: true,
  serve: { kind: "off", url: null },
  consentUrl: null,
  failure: null,
};
