import {
  isCompatible,
  wireError,
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  WIRE_PROTOCOL_VERSION,
  type FeatureInfo,
  type WireHandler,
  type WireHandlers,
  type WireMethodName,
} from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import { hostBinaryReportOf } from "../binary-report.ts";
import type { Engine } from "../types.ts";
import { isNotImplemented } from "./not-implemented.ts";

// L4.host-service.spec §3.4 M1 표, HS-01~HS-03. host.hello: 호환 검사, 실험 기능 기록, 연결을 ready로 바꾼다.
// host.status와 host.shutdown은 아래에 있다.

/** 호스트 프로세스의 수명 신호. `host.shutdown`이 협조 종료를 마치고 응답이 나간 뒤 부른다(HS-31) */
export interface HostLifecycle {
  stopRequested(reason: "shutdown_request" | "version_replace"): void;
}

export interface HostInfo {
  readonly serverName: "xeon";
  /** 엔진 빌드 버전. 등록 파일 version과 같은 값 */
  readonly serverVersion: string;
  readonly pid: number;
}

/** 이 호스트가 받는 클라이언트 알림과 보내는 서버 알림 가운데 구현된 것(F wire §3.3.2) */
const IMPLEMENTED_NOTIFICATIONS: readonly (
  | keyof typeof WIRE_NOTIFICATIONS
  | keyof typeof WIRE_CLIENT_NOTIFICATIONS
)[] = [
  "events.batch",
  "stream.chunk",
  "settings.invalidated",
  "$/cancelRequest",
  "$/connectionReset",
];

const NOTIFICATION_SPECS = { ...WIRE_NOTIFICATIONS, ...WIRE_CLIENT_NOTIFICATIONS };

function isMethodName(name: string): name is WireMethodName {
  return Object.hasOwn(WIRE_METHODS, name);
}

/** 구현한 메서드·알림의 FeatureInfo. notImplemented는 뺀다(§3.3.3) */
function featuresOf(table: WireHandlers): readonly FeatureInfo[] {
  const features: FeatureInfo[] = [];
  for (const name of Object.keys(WIRE_METHODS)) {
    if (!isMethodName(name) || isNotImplemented(table[name])) continue;
    const spec = WIRE_METHODS[name];
    features.push({ name, status: spec.status, since: spec.since });
  }
  for (const name of IMPLEMENTED_NOTIFICATIONS) {
    const spec = NOTIFICATION_SPECS[name];
    features.push({ name, status: "active", since: spec.since });
  }
  return features;
}

export function createHostHelloHandler(
  engine: Engine,
  hub: () => ConnectionHub,
  info: HostInfo,
  table: () => WireHandlers,
): WireHandler<"host.hello"> {
  return (params, context) => {
    const state = hub().state(context.connectionId);
    if (state === undefined) return Promise.reject(wireError("request.cancelled"));
    if (state.phase !== "awaitingHello") return Promise.reject(wireError("host.helloDuplicate"));
    if (!isCompatible(params.protocolVersion, WIRE_PROTOCOL_VERSION)) {
      // HS-02: 연결은 awaitingHello에 남긴다. 닫기는 클라이언트가 한다
      return Promise.reject(
        wireError("protocol.unsupported", {
          details: {
            serverVersion: WIRE_PROTOCOL_VERSION,
            clientVersion: params.protocolVersion,
          },
        }),
      );
    }
    const features = featuresOf(table());
    // 클라이언트가 요청한 이름 가운데 서버에 있는 experimental 기능만 연다. M1 계약에는 experimental 기능이 없다
    const experimental = (params.experimental ?? []).filter((name) =>
      features.some((feature) => feature.name === name && feature.status === "experimental"),
    );
    // 응답 전에 동기로 바꾼다: 같은 연결에서 곧바로 오는 다음 요청이 hello 완료를 본다
    state.phase = "ready";
    state.experimental = experimental;
    return Promise.resolve({
      protocolVersion: WIRE_PROTOCOL_VERSION,
      server: { name: info.serverName, version: info.serverVersion },
      storeId: engine.storeId,
      transport: state.transportKind,
      features: [...features],
      experimental,
    });
  };
}

/**
 * L4.host-service.spec HS-31, HS-34, F wire host.shutdown. 협조 종료 요청: 참여자(확장, L0 서비스, 호스트의 진행 중 turn 정지)를
 * 시한 안에서 모두 끝낸 뒤 `{ accepted: true }`로 응답한다. 응답이 송신 큐에 들어간 뒤 호스트에 알려 연결을 닫고 엔진을 닫게 한다.
 * 시한을 넘기면 협조 창구가 프로세스를 종료코드 1로 끝내므로 응답은 오지 않는다.
 */
export function createHostShutdownHandler(
  engine: Engine,
  hub: () => ConnectionHub,
  lifecycle: HostLifecycle,
): WireHandler<"host.shutdown"> {
  return async (params, context) => {
    const reason = params.reason === "version_replace" ? "version_replace" : "shutdown_request";
    const outcome = await engine.shutdown.request(reason);
    if (!outcome.completed) return { accepted: false };
    hub()
      .state(context.connectionId)
      ?.afterResponse(context.rpcId, () => {
        lifecycle.stopRequested(reason);
      });
    return { accepted: true };
  };
}

/**
 * 모드, pid, 시작 시각, 연결 수, 진행 중 turn 수. 유휴 종료 예정 시각은 서비스 모드(M3)가 채운다.
 * `includeBinaries: true`일 때만 외부 바이너리 점검(`Engine.diagnose`)을 하고 결과를 `binaries`에 싣는다(G2-07, HS-69):
 * 점검은 바이너리마다 자식 프로세스를 띄워 버전을 확인하므로 평소 상태 조회에는 하지 않는다. 점검이 중단되면 결과 없이 `request.cancelled`다
 */
export function createHostStatusHandler(
  engine: Engine,
  hub: () => ConnectionHub,
  info: HostInfo,
): WireHandler<"host.status"> {
  return async (params, context) => {
    const status = {
      mode: engine.mode,
      pid: info.pid,
      startedAt: new Date(engine.startedAt).toISOString(),
      connections: hub().size,
      liveTurns: engine.ports.activity.snapshot().liveTurns,
      idleShutdownAt: null,
    };
    if (params.includeBinaries !== true) return status;
    const diagnosed = await engine.diagnose(context.signal);
    if (!diagnosed.binaries.ok) throw wireError("request.cancelled");
    return { ...status, binaries: hostBinaryReportOf(diagnosed.binaries.value) };
  };
}
