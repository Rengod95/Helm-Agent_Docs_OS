import { parse, type Result } from "@xeon/contracts";
import { Type } from "typebox";

// 모델 계정과 레이트 리밋 설정의 순수 로직(L1.models.spec §3.10, §4.8, L4.settings-ui.spec §4.2.3). 화면은 이 값을 보여 주고 바꾼다.
// L1(core-models)을 import하지 않는다. 키와 모양은 core-models `accountsSchema`·`rateLimitSchema`를 typebox로 다시 적은 것이고,
// 같은지는 시험 x7.test.ts가 `MODELS_SETTING_DEFS`와 `validateSettingValue`로 확인한다.
// 값은 설정 파일에서 오므로 읽을 때 검사한다(TY-10). 비밀 값은 다루지 않는다. 계정 참조 `secret://<이름>`만 있다.

/** 계정 목록 설정 키 */
export const ACCOUNTS_KEY = "l1.models.accounts";
/** 레이트 리밋 설정 키 */
export const RATE_LIMIT_KEY = "l1.models.rateLimit";
/** 계정 회전 플러그인의 첫 사용 고지 동의 키(플러그인 userConfig, core-models `ROTATION_ACK_KEY`와 같다) */
export const ROTATION_ACK_KEY = "ext.account-rotation.acknowledgeRisk";

/**
 * 약관 위험 고지 문구. `packages/group-account-rotation/src/manifest.ts`의 `ROTATION_RISK_NOTICE`와 같은 글이다.
 * 설정 화면은 켜기 전에 이 문구를 보인다(L1.models.spec §4.8).
 */
export const ROTATION_RISK_NOTICE: string =
  "이 플러그인은 한 provider의 여러 계정(API 키 계정과 구독 계정)을 돌려 가며 요청을 보냅니다. 구독 계정을 이렇게 쓰면 provider 이용 약관에 어긋날 수 있고 계정이 제한되거나 정지될 수 있습니다. 켜면 그 위험을 사용자가 집니다.";

/** `l1.models.accounts`의 원소 하나. `credential`은 `secret://<이름>` 참조다 */
export interface AccountEntry {
  readonly provider: string;
  readonly accountId: string;
  readonly credential: string;
  /** 작을수록 먼저 쓴다 */
  readonly priority: number;
  /** 0~100. 창 사용률이 100 - reservePct 이상이면 이 계정을 건너뛴다 */
  readonly reservePct: number;
}

/** 화면 표의 한 줄. 지금은 저장 원소와 같다 */
export type AccountRow = AccountEntry;

export type UsageLimitAction = "wait" | "switch" | "fail";

/** `l1.models.rateLimit[provider]`의 값 */
export interface RateLimitEntry {
  /** 같은 계정의 요청 사이 최소 간격 */
  readonly minIntervalMs: number;
  readonly onLimit: UsageLimitAction;
  /** 기다림의 상한 */
  readonly maxWaitMs: number;
}

/** 정책이 없는 provider의 기본값 [결정: 오케스트레이터 기본값, L1.models.spec §4.8] */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitEntry = {
  minIntervalMs: 0,
  onLimit: "switch",
  maxWaitMs: 0,
};

export type AccountField = "provider" | "accountId" | "credential" | "priority" | "reservePct";
export type RateLimitField = "minIntervalMs" | "onLimit" | "maxWaitMs";

/** 입력 검사의 실패. 어느 칸이 틀렸는지만 말한다 */
export interface InvalidField<F extends string> {
  readonly kind: "invalid";
  readonly field: F;
}

// 키와 값 범위는 core-models settings.ts(accountsSchema, rateLimitSchema)와 같다
const PROVIDER_PATTERN = "^[a-z0-9][a-z0-9._-]{0,63}$";
const ACCOUNT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
const SECRET_REF_PATTERN = "^secret://[a-z][a-z0-9-]{1,63}$";
const LIMIT_MS_MAX = 3_600_000;

const providerField = Type.String({ pattern: PROVIDER_PATTERN, maxLength: 64 });
const accountIdField = Type.String({ pattern: ACCOUNT_ID_PATTERN, maxLength: 64 });
const credentialField = Type.String({ pattern: SECRET_REF_PATTERN });
const priorityField = Type.Integer({ minimum: 0, maximum: 1000 });
const reservePctField = Type.Integer({ minimum: 0, maximum: 100 });
const minIntervalField = Type.Integer({ minimum: 0, maximum: LIMIT_MS_MAX });
const onLimitField = Type.Union([
  Type.Literal("wait"),
  Type.Literal("switch"),
  Type.Literal("fail"),
]);
const maxWaitField = Type.Integer({ minimum: 0, maximum: LIMIT_MS_MAX });

const AccountEntrySchema = Type.Object(
  {
    provider: providerField,
    accountId: accountIdField,
    credential: credentialField,
    priority: priorityField,
    reservePct: reservePctField,
  },
  { additionalProperties: false },
);
const AccountsSchema = Type.Array(AccountEntrySchema, { maxItems: 64 });

const RateLimitPolicySchema = Type.Object(
  { minIntervalMs: minIntervalField, onLimit: onLimitField, maxWaitMs: maxWaitField },
  { additionalProperties: false },
);
const RateLimitMapSchema = Type.Record(
  Type.String({ pattern: PROVIDER_PATTERN }),
  RateLimitPolicySchema,
  { maxProperties: 64, additionalProperties: false },
);

/** 설정 값의 계정 목록을 읽는다. 모양이 맞지 않으면 빈 목록이다(설정 서비스가 쓰기 때 이미 검사했다) */
export function accountsOf(value: unknown): readonly AccountEntry[] {
  const parsed = parse(AccountsSchema, value);
  return parsed.ok ? parsed.value : [];
}

/** 설정 값의 레이트 리밋 맵을 읽는다. 모양이 맞지 않으면 빈 맵이다 */
export function rateLimitOf(value: unknown): Readonly<Record<string, RateLimitEntry>> {
  const parsed = parse(RateLimitMapSchema, value);
  return parsed.ok ? parsed.value : {};
}

// ── 입력 검사 ────────────────────────────────────────────────────────────

/** 정책 입력. 빠진 칸은 `current`의 값을 쓴다. 칸마다 값이 맞는지 본다 */
export interface RateLimitPatch {
  readonly minIntervalMs?: unknown;
  readonly onLimit?: unknown;
  readonly maxWaitMs?: unknown;
}

/** 계정 입력. 칸마다 아직 검사하지 않은 값이다 */
export interface AccountInput {
  readonly provider: unknown;
  readonly accountId: unknown;
  readonly credential: unknown;
  readonly priority: unknown;
  readonly reservePct: unknown;
}

/** `patch`를 `current`(기본값은 `DEFAULT_RATE_LIMIT_POLICY`)에 덮어 쓴 정책을 검사한다. 실패하면 첫 번째 잘못된 칸을 말한다 */
export function checkRateLimit(
  patch: RateLimitPatch,
  current: RateLimitEntry = DEFAULT_RATE_LIMIT_POLICY,
): Result<RateLimitEntry, InvalidField<RateLimitField>> {
  const minInterval = parse(
    minIntervalField,
    patch.minIntervalMs === undefined ? current.minIntervalMs : patch.minIntervalMs,
  );
  if (!minInterval.ok) return { ok: false, error: { kind: "invalid", field: "minIntervalMs" } };
  const onLimit = parse(
    onLimitField,
    patch.onLimit === undefined ? current.onLimit : patch.onLimit,
  );
  if (!onLimit.ok) return { ok: false, error: { kind: "invalid", field: "onLimit" } };
  const maxWait = parse(
    maxWaitField,
    patch.maxWaitMs === undefined ? current.maxWaitMs : patch.maxWaitMs,
  );
  if (!maxWait.ok) return { ok: false, error: { kind: "invalid", field: "maxWaitMs" } };
  return {
    ok: true,
    value: { minIntervalMs: minInterval.value, onLimit: onLimit.value, maxWaitMs: maxWait.value },
  };
}

/** 계정 입력을 검사한다. 실패하면 첫 번째 잘못된 칸을 말한다 */
export function checkAccount(
  input: AccountInput,
): Result<AccountEntry, InvalidField<AccountField>> {
  const provider = parse(providerField, input.provider);
  if (!provider.ok) return { ok: false, error: { kind: "invalid", field: "provider" } };
  const accountId = parse(accountIdField, input.accountId);
  if (!accountId.ok) return { ok: false, error: { kind: "invalid", field: "accountId" } };
  const credential = parse(credentialField, input.credential);
  if (!credential.ok) return { ok: false, error: { kind: "invalid", field: "credential" } };
  const priority = parse(priorityField, input.priority);
  if (!priority.ok) return { ok: false, error: { kind: "invalid", field: "priority" } };
  const reservePct = parse(reservePctField, input.reservePct);
  if (!reservePct.ok) return { ok: false, error: { kind: "invalid", field: "reservePct" } };
  return {
    ok: true,
    value: {
      provider: provider.value,
      accountId: accountId.value,
      credential: credential.value,
      priority: priority.value,
      reservePct: reservePct.value,
    },
  };
}

// ── 편집 (순수 함수: 입력을 바꾸지 않고 새 값을 돌려준다) ─────────────────

/** 같은 provider와 accountId의 계정이 있으면 그 자리를 바꾸고, 없으면 끝에 더한다 */
export function withAccount(
  list: readonly AccountEntry[],
  entry: AccountEntry,
): readonly AccountEntry[] {
  const index = list.findIndex(
    (item) => item.provider === entry.provider && item.accountId === entry.accountId,
  );
  if (index === -1) return [...list, entry];
  return list.map((item, position) => (position === index ? entry : item));
}

export function withoutAccount(
  list: readonly AccountEntry[],
  provider: string,
  accountId: string,
): readonly AccountEntry[] {
  return list.filter((item) => !(item.provider === provider && item.accountId === accountId));
}

/**
 * provider의 정책을 `change`만큼 바꾼다. 정책이 없는 provider는 `DEFAULT_RATE_LIMIT_POLICY`에서 시작한다.
 * 값은 `checkRateLimit`으로 검사한 것을 넣는다.
 */
export function withRateLimit(
  map: Readonly<Record<string, RateLimitEntry>>,
  provider: string,
  change: Partial<RateLimitEntry>,
): Readonly<Record<string, RateLimitEntry>> {
  const current = map[provider] ?? DEFAULT_RATE_LIMIT_POLICY;
  return { ...map, [provider]: { ...current, ...change } };
}

export function withoutRateLimit(
  map: Readonly<Record<string, RateLimitEntry>>,
  provider: string,
): Readonly<Record<string, RateLimitEntry>> {
  return Object.fromEntries(Object.entries(map).filter(([key]) => key !== provider));
}
