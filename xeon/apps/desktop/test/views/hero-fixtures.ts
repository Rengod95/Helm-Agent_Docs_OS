import type { TargetEntry } from "@fresnel/client";
import { INITIAL_REMOTE_STATE, type RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import { FAKE_OFF_STATUS } from "../../src/app/remote/fake-remote-adapter.ts";
import type { RemoteActions, RemoteScreen } from "../../src/app/remote/use-remote-controller.ts";
import type { ServiceAutostart } from "../../src/transport/ipc.ts";
import type { ConnectionSnapshot, ServiceCard } from "../../src/views/commands.ts";
import type { ConnectionScreenHandlers } from "../../src/views/pages/connection/connection-handlers.ts";
import {
  INITIAL_CONNECTION_STATE,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import type { SectionContext } from "../../src/views/pages/connection/connection-sections.ts";

// 요약 카드와 "계속 켜 두기" 구역 시험이 함께 쓰는 값. 동작은 부른 이름을 차례로 `calls`에 남긴다.

export const SERVICE_STARTED_MS: number = Date.parse("2026-11-12T05:10:00.000Z");

export const RUNNING_SERVICE: ServiceCard = {
  kind: "running",
  pid: 900,
  version: "0.4.1",
  startedAt: SERVICE_STARTED_MS,
  attached: true,
};

export const STOPPED_SERVICE: ServiceCard = { kind: "stopped", reason: "no_registration" };

export const DEV_BOX: TargetEntry = {
  id: "dev",
  label: "dev-box",
  address: "ssh://dev@10.0.0.5/run/fresnel.sock",
};

export const AUTOSTART_OFF: ServiceAutostart = {
  supported: true,
  registered: false,
  active: false,
  linger: null,
  platform: "macos",
};

export function snapshotOf(
  mode: "in-process" | "service",
  service: ServiceCard,
): ConnectionSnapshot {
  return {
    host: {
      mode,
      pid: 4211,
      startedAt: "2026-11-12T05:10:00.000Z",
      connections: 2,
      liveTurns: 1,
      idleShutdownAt: null,
    },
    service,
    restartPending: false,
    remoteAllowRespond: null,
  };
}

/** 이 컴퓨터가 서비스로 돌고 상태를 읽은 화면 상태 */
export function localState(patch: Partial<ConnectionState> = {}): ConnectionState {
  const service = patch.service ?? RUNNING_SERVICE;
  const mode = service.kind === "running" && service.attached ? "service" : "in-process";
  return {
    ...INITIAL_CONNECTION_STATE,
    status: { kind: "ready", snapshot: snapshotOf(mode, service) },
    clients: { kind: "offline" },
    service,
    ...patch,
  };
}

function handlersOf(calls: string[]): ConnectionScreenHandlers {
  const record =
    (name: string) =>
    (...args: readonly unknown[]): void => {
      calls.push(args.length === 0 ? name : `${name}:${args.map(String).join(",")}`);
    };
  return {
    connect: record("connect"),
    query: record("query"),
    removeAsk: record("removeAsk"),
    removeCancel: record("removeCancel"),
    removeConfirm: record("removeConfirm"),
    renameOpen: record("renameOpen"),
    renameField: record("renameField"),
    renameSubmit: record("renameSubmit"),
    renameCancel: record("renameCancel"),
    dismissNotice: record("dismissNotice"),
    confirmStop: record("confirmStop"),
    refresh: record("refresh"),
    testRow: record("testRow"),
    copyCommand: record("copyCommand"),
    switchConfirm: record("switchConfirm"),
    switchCancel: record("switchCancel"),
    dismissTargetNotice: record("dismissTargetNotice"),
    addTarget: (entry, connectNow) => {
      calls.push(`addTarget:${entry.label},${entry.address},${String(connectNow)}`);
      return Promise.resolve(true);
    },
    restart: record("restart"),
    copyDiagnostics: record("copyDiagnostics"),
    backToLocal: record("backToLocal"),
    setRemoteRespond: record("setRemoteRespond"),
    setStopConfirm: record("setStopConfirm"),
    retry: record("retry"),
  };
}

function actionsOf(calls: string[]): RemoteActions {
  const record =
    (name: string) =>
    (...args: readonly unknown[]): Promise<void> => {
      calls.push(args.length === 0 ? name : `${name}:${args.map(String).join(",")}`);
      return Promise.resolve();
    };
  return {
    selectMode: record("selectMode"),
    confirmRemote: record("confirmRemote"),
    cancelConfirm: () => {
      calls.push("cancelConfirm");
    },
    retryEnable: record("retryEnable"),
    issuePairing: record("issuePairing"),
    revoke: record("revoke"),
    requestAutostart: record("requestAutostart"),
    confirmAutostart: record("confirmAutostart"),
    cancelAutostartConfirm: () => {
      calls.push("cancelAutostartConfirm");
    },
    keepOn: record("keepOn"),
    reloadAutostart: record("reloadAutostart"),
    reloadStatus: record("reloadStatus"),
    reloadDevices: record("reloadDevices"),
  };
}

/** 원격 컨트롤러. 기본은 다른 기기 접속 꺼짐, 자동 시작 지원·미등록이다 */
export function remoteOf(calls: string[], patch: Partial<RemoteScreenState> = {}): RemoteScreen {
  return {
    state: {
      ...INITIAL_REMOTE_STATE,
      status: { kind: "ready", value: FAKE_OFF_STATUS },
      devices: { kind: "ready", value: [] },
      autostart: { kind: "ready", value: AUTOSTART_OFF },
      ...patch,
    },
    actions: actionsOf(calls),
  };
}

export function contextOf(calls: string[], patch: Partial<SectionContext> = {}): SectionContext {
  return {
    state: localState(),
    engine: { kind: "running", source: "service", pid: 4211 },
    locale: "ko",
    handlers: handlersOf(calls),
    remote: remoteOf(calls),
    web: false,
    nowMs: 0,
    copy: (text) => {
      calls.push(`copy:${text}`);
    },
    ...patch,
  };
}
