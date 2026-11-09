// 웹 게이트웨이 제어 줄의 모양(`apps/desktop-shell/src/web/main.ts` 머리 주석이 정본). 게이트웨이 코드는 import하지 않는다.
// 읽은 값은 모두 TypeBox 스키마로 검사한 뒤에만 쓴다(단언 없음). 공개 타입은 손으로 적고, 스키마가 그 모양과 맞는지는 반환 타입 대입으로 본다.
// 응답에는 요청 id가 없으므로 호출자가 순서로 짝을 맞춘다.
import { Type, type Static, type TSchema } from "typebox";
import { err, ok, parse, parseJson, type Result } from "@fresnel/contracts";

export interface ReadyEvent {
  readonly event: "ready";
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  readonly fingerprint: string | null;
  readonly pid: number;
}

export interface DeviceReply {
  readonly id: string;
  readonly name: string;
  readonly kind: "web" | "desktop";
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly lastAddress: string;
}

export type ReplyEvent =
  | { readonly event: "pairing-code"; readonly code: string; readonly expiresAt: number }
  | { readonly event: "devices"; readonly devices: readonly DeviceReply[] }
  | { readonly event: "revoked"; readonly count: number }
  | { readonly event: "error"; readonly error: "bad_command" | "not_found" | "store_failed" };

const PORT = Type.Union([Type.Integer({ minimum: 0, maximum: 65_535 }), Type.Null()]);

const ReadySchema = Type.Object({
  event: Type.Literal("ready"),
  loopbackPort: PORT,
  tlsPort: PORT,
  fingerprint: Type.Union([Type.String({ pattern: "^[0-9a-f]+$" }), Type.Null()]),
  pid: Type.Integer({ minimum: 0 }),
});

const PairingCodeSchema = Type.Object({
  event: Type.Literal("pairing-code"),
  code: Type.String({ minLength: 1 }),
  expiresAt: Type.Integer({ minimum: 0 }),
});

const DeviceSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  kind: Type.Union([Type.Literal("web"), Type.Literal("desktop")]),
  createdAt: Type.Integer({ minimum: 0 }),
  lastSeenAt: Type.Integer({ minimum: 0 }),
  lastAddress: Type.String(),
});

const DevicesSchema = Type.Object({
  event: Type.Literal("devices"),
  devices: Type.Array(DeviceSchema),
});

const RevokedSchema = Type.Object({
  event: Type.Literal("revoked"),
  count: Type.Integer({ minimum: 0 }),
});

const ErrorSchema = Type.Object({
  event: Type.Literal("error"),
  error: Type.Union([
    Type.Literal("bad_command"),
    Type.Literal("not_found"),
    Type.Literal("store_failed"),
  ]),
});

const ReplySchema = Type.Union([PairingCodeSchema, DevicesSchema, RevokedSchema, ErrorSchema]);

function parseLine<S extends TSchema>(schema: S, line: string): Result<Static<S>, string> {
  const json = parseJson(line);
  if (!json.ok) return err("the line is not JSON");
  const parsed = parse(schema, json.value);
  if (!parsed.ok) return err("the line does not match the control protocol");
  return ok(parsed.value);
}

/** 시작 뒤 첫 줄(`ready`)을 읽는다 */
export function parseReady(line: string): Result<ReadyEvent, string> {
  return parseLine(ReadySchema, line);
}

/** 명령의 답 한 줄을 읽는다. 어느 이벤트인지는 호출자가 본다 */
export function parseReply(line: string): Result<ReplyEvent, string> {
  return parseLine(ReplySchema, line);
}
