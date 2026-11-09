import {
  Type,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";
import { Nullable } from "../../base/index.ts";

// M4 원격 접속 메서드(`host.remote.*`). 원천은 L4.remote.spec(§8 페어링·기기, §10 설정)이다.
// 와이어 메서드 이름과 모양은 F.wire-settings.spec에 아직 없어 [제안]이다. params는 기능 입력과 같고 레지스트리(`methods.ts`)가 `_meta`를 더한다.
// 원격 접속이 꺼져 있을 때 `pair`·`devices`·`revoke`는 wire 오류 `remote.off`(5008, `errors.ts`)다.

/** `host.remote.status`·`host.remote.pair`·`host.remote.devices` 요청 params. 선택 필드가 없고 `_meta`만 레지스트리가 더한다 */
export const HostRemoteEmptyParamsSchema: TObject<{}> = Type.Object(
  {},
  { additionalProperties: false },
);

/** `host.remote.setEnabled` params */
export const HostRemoteSetEnabledParamsSchema: TObject<{ enabled: TBoolean }> = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);

const RemoteStateSchema: TUnion<
  [TLiteral<"off">, TLiteral<"starting">, TLiteral<"running">, TLiteral<"failed">]
> = Type.Union([
  Type.Literal("off"),
  Type.Literal("starting"),
  Type.Literal("running"),
  Type.Literal("failed"),
]);

const RemoteCertSourceSchema: TUnion<[TLiteral<"self-signed">, TLiteral<"user">]> = Type.Union([
  Type.Literal("self-signed"),
  Type.Literal("user"),
]);

/** 마지막으로 시작하다 실패한 원인. 문장은 싣지 않는다 */
const RemoteErrorSchema: TObject<{ kind: TString; message: TString }> = Type.Object(
  {
    kind: Type.String({ minLength: 1, maxLength: 96 }),
    message: Type.String({ maxLength: 512 }),
  },
  { additionalProperties: false },
);

/** `host.remote.status` 결과. `host.remote.setEnabled`도 같은 객체를 쓴다 */
export const HostRemoteStatusResultSchema: TObject<{
  enabled: TBoolean;
  state: typeof RemoteStateSchema;
  loopbackPort: TUnion<[TInteger, TNull]>;
  tlsPort: TUnion<[TInteger, TNull]>;
  hosts: TArray<TString>;
  fingerprint: TUnion<[TString, TNull]>;
  certSource: TUnion<[typeof RemoteCertSourceSchema, TNull]>;
  pushAvailable: TBoolean;
  error: TUnion<[typeof RemoteErrorSchema, TNull]>;
}> = Type.Object(
  {
    enabled: Type.Boolean(),
    state: RemoteStateSchema,
    loopbackPort: Nullable(Type.Integer({ minimum: 1, maximum: 65535 })),
    tlsPort: Nullable(Type.Integer({ minimum: 1, maximum: 65535 })),
    hosts: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 64 }),
    /** 자체 서명 또는 사용자 인증서의 SHA-256 지문(소문자 16진 64자). 원격이 꺼져 있으면 null이다 */
    fingerprint: Nullable(Type.String({ pattern: "^[0-9a-f]{64}$" })),
    certSource: Nullable(RemoteCertSourceSchema),
    pushAvailable: Type.Boolean(),
    error: Nullable(RemoteErrorSchema),
  },
  { additionalProperties: false },
);

/** `host.remote.pair` 결과. 페어링 코드 한 개와 만료 시각(epoch ms)이다 */
export const HostRemotePairResultSchema: TObject<{ code: TString; expiresAt: TInteger }> =
  Type.Object(
    {
      code: Type.String({ minLength: 10, maxLength: 10 }),
      expiresAt: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  );

const RemoteDeviceKindSchema: TUnion<[TLiteral<"web">, TLiteral<"desktop">]> = Type.Union([
  Type.Literal("web"),
  Type.Literal("desktop"),
]);

/** 페어링된 기기 한 대. 토큰 값과 해시는 싣지 않는다 */
const HostRemoteDeviceSchema: TObject<{
  id: TString;
  name: TString;
  kind: typeof RemoteDeviceKindSchema;
  createdAt: TInteger;
  lastSeenAt: TUnion<[TInteger, TNull]>;
  address: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 64 }),
    kind: RemoteDeviceKindSchema,
    createdAt: Type.Integer({ minimum: 0 }),
    lastSeenAt: Nullable(Type.Integer({ minimum: 0 })),
    address: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

/** `host.remote.devices` 결과 */
export const HostRemoteDevicesResultSchema: TObject<{
  devices: TArray<typeof HostRemoteDeviceSchema>;
}> = Type.Object(
  { devices: Type.Array(HostRemoteDeviceSchema, { maxItems: 256 }) },
  { additionalProperties: false },
);

/** `host.remote.revoke` params의 한 모양: 기기 하나 */
export const HostRemoteRevokeByIdParamsSchema: TObject<{ id: TString }> = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);

/** `host.remote.revoke` params의 다른 모양: 모든 기기 */
export const HostRemoteRevokeAllParamsSchema: TObject<{ all: TLiteral<true> }> = Type.Object(
  { all: Type.Literal(true) },
  { additionalProperties: false },
);

/** `host.remote.revoke` 결과. 지운 기기 수다 */
export const HostRemoteRevokeResultSchema: TObject<{ revoked: TInteger }> = Type.Object(
  { revoked: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
