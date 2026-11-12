import {
  Type,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { Nullable } from "../../base/index.ts";

// M4 원격 접속 메서드(`host.remote.*`). 원천은 L4.remote.spec(§8 페어링·기기·연결 링크·Tailscale·사전 점검, §10 설정)이다.
// 와이어 메서드 이름과 모양은 F.wire-settings.spec §3.3.1 표다. `preflight`·`tailscale`·`config`·`proxyExample`과 `pair`의 `links`는 [결정: 2026-11-11 사용자]다.
// params는 기능 입력과 같고 레지스트리(`methods.ts`)가 `_meta`를 더한다.
// 원격 접속이 꺼져 있을 때 `pair`·`devices`·`revoke`와 루프백 포트가 필요한 `tailscale` `serveOn`·`serveOff`는 wire 오류 `remote.off`(5008, `errors.ts`)다.

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

/** 주소의 종류(`ReachableAddressKind`). 루프백과 비루프백 이름 넷 */
const RemoteAddressKindSchema: TUnion<
  [
    TLiteral<"loopback">,
    TLiteral<"lan_ip">,
    TLiteral<"mdns_local">,
    TLiteral<"tailscale_ip">,
    TLiteral<"tailscale_magicdns">,
  ]
> = Type.Union([
  Type.Literal("loopback"),
  Type.Literal("lan_ip"),
  Type.Literal("mdns_local"),
  Type.Literal("tailscale_ip"),
  Type.Literal("tailscale_magicdns"),
]);

/** 연결 링크 한 개: 주소의 종류와 `https://<호스트>[:포트]/login#code=<코드>` 같은 URL */
const HostRemotePairLinkSchema: TObject<{ kind: typeof RemoteAddressKindSchema; url: TString }> =
  Type.Object(
    {
      kind: RemoteAddressKindSchema,
      url: Type.String({ minLength: 1, maxLength: 512 }),
    },
    { additionalProperties: false },
  );

/**
 * `host.remote.pair` 결과. 페어링 코드 한 개와 만료 시각(epoch ms)이다.
 * `links`(선택)는 연결 링크다: 허용된 비루프백 주소마다 하나이고, 비루프백 주소가 하나도 없으면 루프백 링크 하나다. 빈 배열일 수 있다. 코드는 로그에 싣지 않는다
 */
export const HostRemotePairResultSchema: TObject<{
  code: TString;
  expiresAt: TInteger;
  links: TOptional<TArray<typeof HostRemotePairLinkSchema>>;
}> = Type.Object(
  {
    code: Type.String({ minLength: 10, maxLength: 10 }),
    expiresAt: Type.Integer({ minimum: 0 }),
    links: Type.Optional(Type.Array(HostRemotePairLinkSchema, { maxItems: 64 })),
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

// ── 사전 점검·Tailscale·게이트웨이 설정·프록시 예시 [결정: 2026-11-11 사용자] ──

const PreflightStatusSchema: TUnion<[TLiteral<"pass">, TLiteral<"fail">, TLiteral<"skip">]> =
  Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("skip")]);

/** 점검 항목 한 개. `cause`·`fix`·`autoFix`는 코드(화면이 번역한다). `detail`은 JSON 값만 싣는다 */
const HostRemotePreflightItemSchema: TObject<{
  id: TString;
  status: typeof PreflightStatusSchema;
  cause: TUnion<[TString, TNull]>;
  fix: TUnion<[TString, TNull]>;
  autoFix: TUnion<[TString, TNull]>;
  detail: TRecord<"^.*$", TUnknown>;
}> = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    status: PreflightStatusSchema,
    cause: Nullable(Type.String({ maxLength: 96 })),
    fix: Nullable(Type.String({ maxLength: 96 })),
    autoFix: Nullable(Type.String({ maxLength: 96 })),
    detail: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

/** `host.remote.preflight` 결과. 원격이 꺼져 있어도 답한다. `ready`는 `fail`이 하나도 없을 때 참이다 */
export const HostRemotePreflightResultSchema: TObject<{
  ready: TBoolean;
  items: TArray<typeof HostRemotePreflightItemSchema>;
}> = Type.Object(
  {
    ready: Type.Boolean(),
    items: Type.Array(HostRemotePreflightItemSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);

/** `host.remote.tailscale` params. `serveOn`·`serveOff`은 이 포트의 루프백 리스너를 `tailscale serve`에 올리고 내린다 */
export const HostRemoteTailscaleParamsSchema: TObject<{
  action: TUnion<[TLiteral<"status">, TLiteral<"serveOn">, TLiteral<"serveOff">]>;
}> = Type.Object(
  {
    action: Type.Union([Type.Literal("status"), Type.Literal("serveOn"), Type.Literal("serveOff")]),
  },
  { additionalProperties: false },
);

const TailscaleStateSchema: TUnion<
  [
    TLiteral<"not_installed">,
    TLiteral<"not_running">,
    TLiteral<"needs_login">,
    TLiteral<"ready">,
    TLiteral<"unreadable">,
  ]
> = Type.Union([
  Type.Literal("not_installed"),
  Type.Literal("not_running"),
  Type.Literal("needs_login"),
  Type.Literal("ready"),
  Type.Literal("unreadable"),
]);

const TailscaleServeKindSchema: TUnion<
  [TLiteral<"off">, TLiteral<"on">, TLiteral<"other">, TLiteral<"unavailable">]
> = Type.Union([
  Type.Literal("off"),
  Type.Literal("on"),
  Type.Literal("other"),
  Type.Literal("unavailable"),
]);

/** `host.remote.tailscale` 결과. 실패는 값이다(`failure`가 실패 kind, 성공이면 null). 루프백 포트가 없어 `serveOn`·`serveOff`를 못 하면 `remote.off` 오류다 */
export const HostRemoteTailscaleResultSchema: TObject<{
  state: typeof TailscaleStateSchema;
  authUrl: TUnion<[TString, TNull]>;
  magicDnsName: TUnion<[TString, TNull]>;
  ips: TArray<TString>;
  httpsEnabled: TUnion<[TBoolean, TNull]>;
  serve: TObject<{ kind: typeof TailscaleServeKindSchema; url: TUnion<[TString, TNull]> }>;
  consentUrl: TUnion<[TString, TNull]>;
  failure: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    state: TailscaleStateSchema,
    authUrl: Nullable(Type.String({ maxLength: 512 })),
    magicDnsName: Nullable(Type.String({ maxLength: 256 })),
    ips: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 }),
    httpsEnabled: Nullable(Type.Boolean()),
    serve: Type.Object(
      {
        kind: TailscaleServeKindSchema,
        url: Nullable(Type.String({ maxLength: 512 })),
      },
      { additionalProperties: false },
    ),
    consentUrl: Nullable(Type.String({ maxLength: 512 })),
    failure: Nullable(Type.String({ maxLength: 96 })),
  },
  { additionalProperties: false },
);

/** `host.remote.config` params의 `patch`. 적은 키만 바꾼다. `listenTls`·`tlsCert`·`tlsKey`에 null을 주면 없음이다 */
const HostRemoteConfigPatchSchema: TObject<{
  listen: TOptional<TString>;
  listenTls: TOptional<TUnion<[TString, TNull]>>;
  hosts: TOptional<TArray<TString>>;
  tlsCert: TOptional<TUnion<[TString, TNull]>>;
  tlsKey: TOptional<TUnion<[TString, TNull]>>;
}> = Type.Object(
  {
    listen: Type.Optional(Type.String({ maxLength: 256 })),
    listenTls: Type.Optional(Nullable(Type.String({ maxLength: 256 }))),
    hosts: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 256 }),
    ),
    tlsCert: Type.Optional(Nullable(Type.String({ maxLength: 1024 }))),
    tlsKey: Type.Optional(Nullable(Type.String({ maxLength: 1024 }))),
  },
  { additionalProperties: false },
);

/** `host.remote.config` params. `patch`가 없으면 읽기다. `dryRun`이면 검사만 하고 아무것도 쓰지 않는다 */
export const HostRemoteConfigParamsSchema: TObject<{
  patch: TOptional<typeof HostRemoteConfigPatchSchema>;
  dryRun: TOptional<TBoolean>;
}> = Type.Object(
  {
    patch: Type.Optional(HostRemoteConfigPatchSchema),
    dryRun: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const HostRemoteConfigIssueSchema: TObject<{ field: TString; code: TString }> = Type.Object(
  {
    field: Type.String({ maxLength: 32 }),
    code: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);

/** `host.remote.config`가 다루는 게이트웨이 설정 다섯 키(`l4.remote.web.*`)의 값 */
const HostRemoteConfigSettingsSchema: TObject<{
  listen: TString;
  listenTls: TUnion<[TString, TNull]>;
  hosts: TArray<TString>;
  tlsCert: TUnion<[TString, TNull]>;
  tlsKey: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    listen: Type.String({ maxLength: 256 }),
    listenTls: Nullable(Type.String({ maxLength: 256 })),
    hosts: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 }),
    tlsCert: Nullable(Type.String({ maxLength: 1024 })),
    tlsKey: Nullable(Type.String({ maxLength: 1024 })),
  },
  { additionalProperties: false },
);

/**
 * `host.remote.config` 결과. `settings`는 호출 뒤의 합친 값(현재 값에 `patch`를 더한 것)이다. 읽기면 현재 값이다.
 * `written`은 실제로 썼을 때만 참이다. `restartNeeded`는 쓴 뒤 게이트웨이가 떠 있을 때 참이다(서비스는 자동으로 다시 띄우지 않는다)
 */
export const HostRemoteConfigResultSchema: TObject<{
  settings: typeof HostRemoteConfigSettingsSchema;
  issues: TArray<typeof HostRemoteConfigIssueSchema>;
  written: TBoolean;
  restartNeeded: TBoolean;
}> = Type.Object(
  {
    settings: HostRemoteConfigSettingsSchema,
    issues: Type.Array(HostRemoteConfigIssueSchema, { maxItems: 32 }),
    written: Type.Boolean(),
    restartNeeded: Type.Boolean(),
  },
  { additionalProperties: false },
);

const ProxyKindSchema: TUnion<[TLiteral<"caddy">, TLiteral<"nginx">]> = Type.Union([
  Type.Literal("caddy"),
  Type.Literal("nginx"),
]);

/** `host.remote.proxyExample` params. 상태를 바꾸지 않는다 */
export const HostRemoteProxyExampleParamsSchema: TObject<{
  kind: typeof ProxyKindSchema;
  domain: TString;
  tlsPort: TInteger;
}> = Type.Object(
  {
    kind: ProxyKindSchema,
    domain: Type.String({ minLength: 1, maxLength: 253 }),
    tlsPort: Type.Integer({ minimum: 1, maximum: 65535 }),
  },
  { additionalProperties: false },
);

/** `host.remote.proxyExample` 결과. `plan`은 공개 서버 구성의 루프백 전용 설정(`loopbackOnlyPlan`)이다 */
export const HostRemoteProxyExampleResultSchema: TObject<{
  text: TString;
  plan: TObject<{ listen: TString; listenTls: TString; hosts: TArray<TString> }>;
}> = Type.Object(
  {
    text: Type.String({ maxLength: 8192 }),
    plan: Type.Object(
      {
        listen: Type.String({ maxLength: 64 }),
        listenTls: Type.String({ maxLength: 64 }),
        hosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
