import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TNumber,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import { ThreadIdSchema } from "../../conversation/index.ts";
import { IsoTimeSchema } from "./notifications.ts";

// 설정 파일 단위 편집과 사용량 wire(M3-REQ-15, M3-19). 모양과 이유는 F.wire-settings.spec §3.3.1 아래 설명과
// L4.settings-ui.spec §4.2.3(파일 단위 편집기), §4.7(게이지)이다. 파일 쓰기는 호스트 한 곳에서만 한다.

/** 파일이 있는 범위. managed는 읽기 전용이라 `settings.readFile`만 받는다 */
export const SettingsFileScopeSchema: TUnion<
  [TLiteral<"managed">, TLiteral<"user">, TLiteral<"project">, TLiteral<"local">]
> = Type.Union([
  Type.Literal("managed"),
  Type.Literal("user"),
  Type.Literal("project"),
  Type.Literal("local"),
]);
export type SettingsFileScope = Static<typeof SettingsFileScopeSchema>;

export const SettingsWritableFileScopeSchema: TUnion<
  [TLiteral<"user">, TLiteral<"project">, TLiteral<"local">]
> = Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("local")]);
export type SettingsWritableFileScope = Static<typeof SettingsWritableFileScopeSchema>;

/** 설정 파일 원문의 최대 길이(UTF-16 단위). 넘는 파일은 파일 편집기로 열지 않는다 */
export const SETTINGS_FILE_TEXT_MAX: number = 1_048_576;

const FileSha256Schema: TString = Type.String({ pattern: "^[0-9a-f]{64}$" });

/** `project`와 `local`은 작업 폴더가 있어야 정해진다. `threadId`로 그 thread의 작업 폴더를 쓴다 */
export const SettingsReadFileParamsSchema: TObject<{
  scope: typeof SettingsFileScopeSchema;
  threadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  { scope: SettingsFileScopeSchema, threadId: Type.Optional(ThreadIdSchema) },
  { additionalProperties: false },
);
export type SettingsReadFileParams = Static<typeof SettingsReadFileParamsSchema>;

/**
 * 파일 원문. 파일이 없으면 `exists`가 거짓이고 `text`는 빈 문자열, `sha256`은 null이다.
 * `unknownKeys`는 카탈로그에 없는 키다(파일에는 그대로 보존한다, §4.8). `sha256`은 `writeFile`의 `baseSha256`로 돌려보내 덮어쓰기 충돌을 막는다.
 */
export const SettingsReadFileResultSchema: TObject<{
  scope: typeof SettingsFileScopeSchema;
  path: TUnion<[TString, ReturnType<typeof Type.Null>]>;
  exists: TBoolean;
  readOnly: TBoolean;
  text: TString;
  sha256: TUnion<[TString, ReturnType<typeof Type.Null>]>;
  unknownKeys: TArray<TString>;
}> = Type.Object(
  {
    scope: SettingsFileScopeSchema,
    /** 그 범위의 파일 경로. 작업 폴더가 없어 정할 수 없으면 null */
    path: Nullable(Type.String({ minLength: 1, maxLength: 4096 })),
    exists: Type.Boolean(),
    /** managed 범위이거나 파일 권한이 읽기 전용이면 참 */
    readOnly: Type.Boolean(),
    text: Type.String({ maxLength: SETTINGS_FILE_TEXT_MAX }),
    sha256: Nullable(FileSha256Schema),
    unknownKeys: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 256 }),
  },
  { additionalProperties: false },
);
export type SettingsReadFileResult = Static<typeof SettingsReadFileResultSchema>;

/**
 * 파일 전체를 바꾼다. 호스트는 `text`를 JSON 객체로 읽고 그 범위의 `settingsJsonSchema`로 검사한 뒤 쓴다.
 * `baseSha256`은 `readFile`이 준 값이고 파일이 없었으면 null이다. 지금 파일의 해시와 다르면 `settings.fileConflict`다.
 */
export const SettingsWriteFileParamsSchema: TObject<{
  scope: typeof SettingsWritableFileScopeSchema;
  text: TString;
  baseSha256: TUnion<[TString, ReturnType<typeof Type.Null>]>;
  threadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    scope: SettingsWritableFileScopeSchema,
    text: Type.String({ maxLength: SETTINGS_FILE_TEXT_MAX }),
    baseSha256: Nullable(FileSha256Schema),
    threadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SettingsWriteFileParams = Static<typeof SettingsWriteFileParamsSchema>;

export const SettingsWriteFileResultSchema: TObject<{
  path: TString;
  sha256: TString;
  unknownKeys: TArray<TString>;
}> = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    sha256: FileSha256Schema,
    unknownKeys: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 256 }),
  },
  { additionalProperties: false },
);
export type SettingsWriteFileResult = Static<typeof SettingsWriteFileResultSchema>;

// ── usage.get ────────────────────────────────────────────────────────────

export const UsageWindowSchema: TUnion<
  [
    TLiteral<"minute">,
    TLiteral<"hour">,
    TLiteral<"day">,
    TLiteral<"week">,
    TLiteral<"month">,
    TLiteral<"session">,
  ]
> = Type.Union([
  Type.Literal("minute"),
  Type.Literal("hour"),
  Type.Literal("day"),
  Type.Literal("week"),
  Type.Literal("month"),
  Type.Literal("session"),
]);
export type UsageWindow = Static<typeof UsageWindowSchema>;

export const UsageUnitSchema: TUnion<[TLiteral<"tokens">, TLiteral<"usd">, TLiteral<"requests">]> =
  Type.Union([Type.Literal("tokens"), Type.Literal("usd"), Type.Literal("requests")]);
export type UsageUnit = Static<typeof UsageUnitSchema>;

/** 게이지 한 줄. 데이터 원천은 L1.models의 사용량 투영이다(L4.settings-ui.spec §4.7) */
export const UsageGaugeSchema: TObject<{
  id: TString;
  providerId: TString;
  account: TUnion<[TString, ReturnType<typeof Type.Null>]>;
  window: typeof UsageWindowSchema;
  unit: typeof UsageUnitSchema;
  used: TNumber;
  limit: TUnion<[TNumber, ReturnType<typeof Type.Null>]>;
  resetsAt: TUnion<[TString, ReturnType<typeof Type.Null>]>;
}> = Type.Object(
  {
    /** 게이지를 가리키는 안정된 이름. `<providerId>:<account>:<window>:<unit>` 꼴이다 */
    id: Type.String({ minLength: 1, maxLength: 256 }),
    providerId: Type.String({ minLength: 1, maxLength: 128 }),
    /** 계정 풀의 계정 이름. 계정 구분이 없으면 null */
    account: Nullable(Type.String({ minLength: 1, maxLength: 128 })),
    window: UsageWindowSchema,
    unit: UsageUnitSchema,
    used: Type.Number({ minimum: 0 }),
    /** 한도. 한도를 모르면 null이라 화면은 사용량만 보인다 */
    limit: Nullable(Type.Number({ minimum: 0 })),
    resetsAt: Nullable(IsoTimeSchema),
  },
  { additionalProperties: false },
);
export type UsageGauge = Static<typeof UsageGaugeSchema>;

export const UsageGetParamsSchema: TObject<{
  providerId: TOptional<TString>;
  threadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    providerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    /** 주면 그 thread의 `session` 창 사용량을 더한다 */
    threadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type UsageGetParams = Static<typeof UsageGetParamsSchema>;

export const UsageGetResultSchema: TObject<{
  gauges: TArray<typeof UsageGaugeSchema>;
  asOf: typeof IsoTimeSchema;
}> = Type.Object(
  { gauges: Type.Array(UsageGaugeSchema, { maxItems: 256 }), asOf: IsoTimeSchema },
  { additionalProperties: false },
);
export type UsageGetResult = Static<typeof UsageGetResultSchema>;
