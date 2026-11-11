import { parseTargetAddress, type TargetAddress } from "@fresnel/client";
import type { Locale, MessageId } from "@fresnel/client/i18n";
import type { EngineState } from "../../../state/engine/index.ts";
import type { ServerMode } from "../../../app/remote/remote-model.ts";
import type { AddressReason, StepId } from "./connection-model.ts";
import type { HostClientView } from "@fresnel/contracts/wire";

// 연결 화면의 문장 고르기. 값은 메시지 키와 인자로 바꾸고, 문장은 화면이 `t()`로 만든다. 키 이름은 `_` 없이 camelCase다.
// 연결 실패 문장은 `attachErrorKey`(client)가 고른다.

const ADDRESS_ID: Readonly<Record<AddressReason, MessageId>> = {
  empty: "desktop.connection.address.empty",
  bad_format: "desktop.connection.address.badFormat",
  relative_path: "desktop.connection.address.relativePath",
  non_loopback: "desktop.connection.address.nonLoopback",
  duplicate: "desktop.connection.address.duplicate",
};

/** 주소 칸의 거절 사유 문장 */
export function addressMessageOf(reason: AddressReason): MessageId {
  return ADDRESS_ID[reason];
}

const KIND_BADGE_ID: Readonly<Record<TargetAddress["kind"], MessageId>> = {
  ssh: "desktop.connection.host.badge.ssh",
  wss: "desktop.connection.host.badge.web",
  unix: "desktop.connection.host.badge.unix",
  tcp: "desktop.connection.host.badge.tcp",
};

/** 저장된 주소의 종류 배지 글. 저장할 때 맞은 주소만 들어오므로 풀리지 않으면 배지를 달지 않는다(null) */
export function hostBadgeOf(address: string): MessageId | null {
  const parsed = parseTargetAddress(address);
  return parsed.ok ? KIND_BADGE_ID[parsed.target.kind] : null;
}

const ENGINE_ID: Readonly<Record<EngineState["kind"], MessageId>> = {
  starting: "desktop.connection.engine.starting",
  running: "desktop.connection.engine.running",
  restarting: "desktop.connection.engine.restarting",
  stopping: "desktop.connection.engine.stopping",
  stopped: "desktop.connection.engine.stopped",
  failed: "desktop.connection.engine.failed",
};

/** 엔진 상태 문장. 아직 상태를 받지 못했으면 확인하는 중이다 */
export function engineMessageOf(engine: EngineState | null): MessageId {
  return engine === null ? "desktop.connection.engine.unknown" : ENGINE_ID[engine.kind];
}

const TRANSPORT_ID: Readonly<Record<HostClientView["transport"], MessageId>> = {
  "in-process": "desktop.connection.clients.transport.inProcess",
  stdio: "desktop.connection.clients.transport.stdio",
  socket: "desktop.connection.clients.transport.socket",
};

/** 연결 전송 종류의 이름. 클라이언트가 이름을 안 밝혔을 때 쓴다 */
export function transportMessageOf(transport: HostClientView["transport"]): MessageId {
  return TRANSPORT_ID[transport];
}

/**
 * 실행 방식을 바꾸다 서비스가 실패했을 때의 문장. 앱 안에서로 바꾸다 실패했으면 멈추기 실패이고, 그 밖은 켜기 실패다.
 * 켜지 못했으면 설정은 꺼짐으로 되돌아가 있다(명령이 한다).
 */
export function serviceFailureIdOf(mode: ServerMode): MessageId {
  return mode === "off"
    ? "desktop.connection.service.card.stopFailed"
    : "desktop.connection.service.card.startFailed";
}

const STEP_ID: Readonly<Record<StepId, MessageId>> = {
  stop: "desktop.connection.step.stop",
  start: "desktop.connection.step.start",
  sync: "desktop.connection.step.sync",
};

export function stepMessageOf(step: StepId): MessageId {
  return STEP_ID[step];
}

/**
 * 시각을 지역 시각의 "월 일 시:분" 문장으로 쓴다(ko "11월 10일 오후 6:39"). 엔진이 준 값은 ISO 문자열이다.
 * 해는 뺀다. 요약 줄의 "언제부터"를 짧게 보이려는 것이다.
 */
export function timeTextOf(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
