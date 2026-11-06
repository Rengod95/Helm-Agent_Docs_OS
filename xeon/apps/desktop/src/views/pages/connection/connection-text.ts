import type { Locale, MessageId } from "@fresnel/client/i18n";
import type { EngineState } from "../../../state/engine/index.ts";
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

const STEP_ID: Readonly<Record<StepId, MessageId>> = {
  stop: "desktop.connection.step.stop",
  start: "desktop.connection.step.start",
  sync: "desktop.connection.step.sync",
};

export function stepMessageOf(step: StepId): MessageId {
  return STEP_ID[step];
}

/** 시각을 지역 시각의 짧은 문장으로 쓴다. 엔진이 준 값은 ISO 문자열이다 */
export function timeTextOf(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}
