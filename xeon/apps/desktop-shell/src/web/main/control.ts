// 제어 명령 처리(감독하는 서비스가 쓰는 표준 입력 프로토콜). 한 줄에 JSON 명령 하나를 받고, 답은 이벤트 줄들이다.
// 입출력 줄 나누기는 `src/web/main.ts`가 맡는다. 이 함수는 줄 하나를 받아 이벤트 목록과 "멈출지"를 돌려준다.
// 페어링 코드는 `pair` 명령의 답에만 나온다. 토큰은 이 파일 어디에서도 다루지 않는다.
import { isRecord, ownField } from "../../main/lib/narrow.ts";
import { parseJson } from "@fresnel/contracts";
import type { AuthPort, RevokeError } from "../auth/auth-port.ts";
import type { DeviceInfo } from "../auth/devices.ts";
import type { PairingStatus } from "../auth/pairing.ts";
import type { GatewayInfo } from "../server/gateway.ts";

/** 목록과 상태에 싣는 기기 정보. 시각과 주소만이고 해시나 토큰은 없다 */
interface DeviceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: DeviceInfo["kind"];
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly lastAddress: string;
}

export type ControlEvent =
  | { readonly event: "pairing-code"; readonly code: string; readonly expiresAt: number }
  | {
      readonly event: "status";
      readonly pairing: PairingStatus;
      readonly devices: readonly DeviceSummary[];
      readonly loopbackPort: number | null;
      readonly tlsPort: number | null;
      readonly fingerprint: string | null;
    }
  | { readonly event: "devices"; readonly devices: readonly DeviceSummary[] }
  | { readonly event: "revoked"; readonly count: number }
  | { readonly event: "error"; readonly error: "bad_command" | "not_found" | "store_failed" };

export interface ControlReply {
  readonly events: readonly ControlEvent[];
  /** `stop` 명령이면 참이다. 호출자가 게이트웨이를 멈추고 끝낸다 */
  readonly stop: boolean;
}

export interface ControlDeps {
  readonly auth: AuthPort;
  /** 지금 열린 포트와 지문. 시작이 끝난 뒤에만 부른다 */
  readonly ports: () => GatewayInfo;
}

function summaryOf(device: DeviceInfo): DeviceSummary {
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    lastAddress: device.lastAddress,
  };
}

function reply(events: readonly ControlEvent[], stop = false): ControlReply {
  return { events, stop };
}

function badCommand(): ControlReply {
  return reply([{ event: "error", error: "bad_command" }]);
}

/** 줄 하나를 명령으로 읽는다. 모양이 틀리면 null이다 */
function commandOf(
  line: string,
): { readonly cmd: string; readonly value: Record<string, unknown> } | null {
  const parsed = parseJson(line);
  if (!parsed.ok || !isRecord(parsed.value)) return null;
  const cmd = ownField(parsed.value, "cmd");
  if (typeof cmd !== "string") return null;
  return { cmd, value: parsed.value };
}

export function controlHandler(deps: ControlDeps): (line: string) => ControlReply {
  return (line) => {
    const command = commandOf(line);
    if (command === null) return badCommand();
    const { cmd, value } = command;
    if (cmd === "pair") {
      const issued = deps.auth.createPairingCode();
      return reply([{ event: "pairing-code", code: issued.display, expiresAt: issued.expiresAt }]);
    }
    if (cmd === "status") {
      const ports = deps.ports();
      return reply([
        {
          event: "status",
          pairing: deps.auth.pairingStatus(),
          devices: deps.auth.listDevices().map(summaryOf),
          loopbackPort: ports.loopbackPort,
          tlsPort: ports.tlsPort,
          fingerprint: ports.fingerprint,
        },
      ]);
    }
    if (cmd === "devices") {
      return reply([{ event: "devices", devices: deps.auth.listDevices().map(summaryOf) }]);
    }
    if (cmd === "revoke") {
      const id = ownField(value, "id");
      if (typeof id !== "string" || id.length === 0) return badCommand();
      const revoked = deps.auth.revokeDevice(id);
      if (!revoked.ok) return reply([{ event: "error", error: revokeErrorOf(revoked.error) }]);
      return reply([{ event: "revoked", count: 1 }]);
    }
    if (cmd === "revoke-all") {
      const revoked = deps.auth.revokeAllDevices();
      if (!revoked.ok) return reply([{ event: "error", error: "store_failed" }]);
      return reply([{ event: "revoked", count: revoked.value.length }]);
    }
    if (cmd === "stop") return reply([], true);
    return badCommand();
  };
}

function revokeErrorOf(error: RevokeError): "not_found" | "store_failed" {
  return error.kind === "not_found" ? "not_found" : "store_failed";
}
