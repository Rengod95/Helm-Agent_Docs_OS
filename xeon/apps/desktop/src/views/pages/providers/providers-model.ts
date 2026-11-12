import { ROTATION_ACK_KEY, type AccountEntry } from "@fresnel/client";
import type { FieldVM, ProviderEntry, SecretRow } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import { parseSecretRef, type SecretName } from "@fresnel/contracts/capabilities";
import { normalizePastedKey } from "@fresnel/contracts/services";
import type { ModelEntry, ProviderCheckAuthResult, UsageGauge } from "@fresnel/contracts/wire";
import {
  KNOWN_PROVIDER_IDS,
  isKnownProvider,
  providerMarkOf,
  providerNameOf,
  providerOfRef,
} from "../shared/provider-names.ts";

// 설정 "모델과 계정" 구역(P-11, DP-83·DP-84 [결정: 2026-11-11 사용자])의 순수 모델.
// 제공자 카드의 상태, 계정 풀 묶기와 순서, 계정 회전 스위치의 쓰기, 모델 쓰기·막기 목록을 계산한다.
// 값의 검사와 모양은 client(`accounts`, `settings`)가 맡고, 여기서는 화면이 쓰는 묶기와 순서만 한다.

// ── 제공자 카드 ─────────────────────────────────────────────────────────

/**
 * 카드의 상태. 꺼짐 → 키 없음(참조가 없다) → 키를 찾을 수 없음(참조한 시크릿이 저장소에 없다) → 모델 없음(엔진이 이 제공자의 모델을 내지 않는다)
 * 차례로 정하고, 그 밖은 이 화면의 마지막 연결 시험 넷째 단계(`provider.checkAuth`) 결과로 정한다.
 * 받음 → 연결됨, 거절 → 거절됨, 확인할 방법이 없음(unsupported) → 확인됨, 시험을 안 했거나 결과가 분명하지 않음 → 확인 안 됨.
 * "연결됨"은 제공자가 키를 받았을 때만이다. 시크릿 목록을 읽지 못했으면 저장소 판정을 건너뛴다(지어내지 않는다).
 */
export type ProviderStatus =
  | "off"
  | "noKey"
  | "missingKey"
  | "noModels"
  | "unchecked"
  | "rejected"
  | "confirmed"
  | "connected";

/** `usage.get`의 누적 합계(이 엔진이 기록한 모든 대화). 한도와 창은 엔진이 주지 않는다 */
export interface UsageTotals {
  readonly tokens: number;
  readonly usd: number;
  readonly requests: number;
}

export interface ProviderCard {
  readonly id: string;
  readonly name: string;
  readonly mark: string;
  /** 알려진 제공자가 아니면 참. id를 이름 아래에 따로 보인다 */
  readonly custom: boolean;
  readonly enabled: boolean;
  /** 키 참조가 가리키는 시크릿 이름. 참조가 없거나 모양이 틀리면 null */
  readonly secretName: SecretName | null;
  readonly baseUrl: string | null;
  readonly status: ProviderStatus;
  /** 엔진 카탈로그에서 이 제공자의 모델 수(`models.list`, 막은 모델 뺌) */
  readonly modelCount: number;
  readonly usage: UsageTotals | null;
}

/** 키 참조(`secret://<이름>`)의 시크릿 이름. 참조가 없거나 모양이 틀리면 null */
export function secretNameOfRef(ref: string | null): SecretName | null {
  if (ref === null) return null;
  const parsed = parseSecretRef(ref);
  return parsed.ok ? parsed.value.name : null;
}

function modelCountOf(models: readonly ModelEntry[], providerId: string): number {
  return models.filter((entry) => providerOfRef(entry.ref) === providerId).length;
}

/** 한 제공자의 누적 사용량. 그 제공자의 게이지가 하나도 없으면 null */
export function usageTotalsOf(
  gauges: readonly UsageGauge[],
  providerId: string,
): UsageTotals | null {
  const own = gauges.filter((gauge) => gauge.providerId === providerId);
  if (own.length === 0) return null;
  const sum = (unit: UsageGauge["unit"]): number =>
    own.filter((gauge) => gauge.unit === unit).reduce((total, gauge) => total + gauge.used, 0);
  return { tokens: sum("tokens"), usd: sum("usd"), requests: sum("requests") };
}

/** 마지막 연결 시험의 넷째 단계가 무엇을 말했는가. 시험을 안 했거나 판정이 분명하지 않으면 `undecided` */
type AuthVerdict = "passed" | "neutral" | "rejected" | "undecided";

function authVerdictOf(checks: readonly ProviderCheckResult[] | undefined): AuthVerdict {
  const auth = checks?.find((check) => check.id === "auth");
  if (auth === undefined) return "undecided";
  if (auth.state === "passed") return "passed";
  if (auth.state === "neutral") return "neutral";
  if (
    auth.state === "failed" &&
    auth.reason.kind === "authFailed" &&
    (auth.reason.cause === "rejected" || auth.reason.cause === "oauthTokenNotApiKey")
  ) {
    return "rejected";
  }
  return "undecided";
}

function providerStatusOf(input: {
  readonly entry: ProviderEntry;
  /** 시크릿 목록. 읽지 못했으면 null */
  readonly secrets: readonly SecretRow[] | null;
  readonly modelCount: number;
  /** 이 제공자의 마지막 연결 시험 결과. 이 화면에서 한 번도 안 돌렸으면 undefined */
  readonly checks: readonly ProviderCheckResult[] | undefined;
}): ProviderStatus {
  const { entry, modelCount } = input;
  if (!entry.enabled) return "off";
  const name = secretNameOfRef(entry.apiKeyRef);
  if (name === null) return "noKey";
  if (input.secrets !== null && !input.secrets.some((s) => s.name === name && s.registered)) {
    return "missingKey";
  }
  if (modelCount === 0) return "noModels";
  const verdict = authVerdictOf(input.checks);
  switch (verdict) {
    case "passed":
      return "connected";
    case "rejected":
      return "rejected";
    case "neutral":
      return "confirmed";
    case "undecided":
      return "unchecked";
    default:
      return assertNever(verdict, "AuthVerdict");
  }
}

/** 설정 순서 그대로의 카드 목록. `checks`는 제공자 id별 마지막 연결 시험 결과다 */
export function providerCardsOf(input: {
  readonly providers: readonly ProviderEntry[];
  readonly secrets: readonly SecretRow[] | null;
  readonly models: readonly ModelEntry[];
  readonly gauges: readonly UsageGauge[];
  readonly checks: Readonly<Record<string, readonly ProviderCheckResult[]>>;
}): readonly ProviderCard[] {
  return input.providers.map((entry) => {
    const modelCount = modelCountOf(input.models, entry.id);
    return {
      id: entry.id,
      name: providerNameOf(entry.id),
      mark: providerMarkOf(entry.id),
      custom: !isKnownProvider(entry.id),
      enabled: entry.enabled,
      secretName: secretNameOfRef(entry.apiKeyRef),
      baseUrl: entry.baseUrl,
      status: providerStatusOf({
        entry,
        secrets: input.secrets,
        modelCount,
        checks: input.checks[entry.id],
      }),
      modelCount,
      usage: usageTotalsOf(input.gauges, entry.id),
    };
  });
}

/** "제공자 추가"에서 고를 수 있는 알려진 제공자: 아직 목록에 없는 것 */
export function addableProvidersOf(providers: readonly ProviderEntry[]): readonly string[] {
  return KNOWN_PROVIDER_IDS.filter((id) => !providers.some((entry) => entry.id === id));
}

export function withProviderEnabled(
  providers: readonly ProviderEntry[],
  id: string,
  enabled: boolean,
): readonly ProviderEntry[] {
  return providers.map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
}

/** 기본 URL을 바꾼다. 빈 글은 null(엔진 카탈로그의 주소)이다 */
export function withProviderBaseUrl(
  providers: readonly ProviderEntry[],
  id: string,
  baseUrl: string,
): readonly ProviderEntry[] {
  const trimmed = baseUrl.trim();
  return providers.map((entry) =>
    entry.id === id ? { ...entry, baseUrl: trimmed === "" ? null : trimmed } : entry,
  );
}

export function withoutProvider(
  providers: readonly ProviderEntry[],
  id: string,
): readonly ProviderEntry[] {
  return providers.filter((entry) => entry.id !== id);
}

/** 키 없이 제공자를 더한다(다른 제공자: id와 기본 URL을 먼저 적고 키는 다음 단계). 이미 있으면 그대로다 */
export function withNewProvider(
  providers: readonly ProviderEntry[],
  id: string,
  baseUrl: string,
): readonly ProviderEntry[] {
  if (providers.some((entry) => entry.id === id)) return providers;
  const trimmed = baseUrl.trim();
  return [
    ...providers,
    { id, enabled: true, apiKeyRef: null, baseUrl: trimmed === "" ? null : trimmed },
  ];
}

/** 기본 URL 형식: http(s) 주소. 비면 통과(엔진 기본 주소) */
export function isBaseUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  if (!URL.canParse(trimmed)) return false;
  const url = new URL(trimmed);
  return url.protocol === "https:" || url.protocol === "http:";
}

// ── 연결 시험 ───────────────────────────────────────────────────────────

/** 제공자 연결 시험의 네 단계. 키 저장 → 제공자 연결 → 모델 목록 → 제공자가 키를 받는지(`provider.checkAuth`) */
const PROVIDER_CHECK_IDS = ["stored", "linked", "models", "auth"] as const;
export type ProviderCheckId = (typeof PROVIDER_CHECK_IDS)[number];

/**
 * 단계 하나의 결과. 문장은 화면이 키로 만든다. `neutral`은 실패가 아닌 건너뜀이다(확인할 방법이 없는 제공자의 넷째 단계).
 * 앞 단계가 떨어져 건너뛴 것은 `skipped`(사유 없음)다.
 */
export type ProviderCheckResult =
  | { readonly id: ProviderCheckId; readonly state: "waiting" | "running" | "skipped" }
  | {
      readonly id: ProviderCheckId;
      readonly state: "passed" | "failed" | "neutral";
      /** 실패 까닭이나 통과 값, 건너뜀의 사유 */
      readonly reason: ProviderCheckReason;
      /** 걸린 시간(ms). 시험을 돌리지 않은 결과(키 등록 실패의 저장 단계)는 시간이 없다 */
      readonly elapsedMs?: number;
    };

/** `provider.checkAuth`가 실패로 본 원인 종류(`noKey`는 따로 둔다) */
type AuthFailureCause =
  | "rejected"
  | "oauthTokenNotApiKey"
  | "badAddress"
  | "quotaOrBilling"
  | "upstream"
  | "timeout";

export type ProviderCheckReason =
  | { readonly kind: "stored"; readonly length: number | null }
  | { readonly kind: "noKey" }
  | { readonly kind: "missing" }
  | { readonly kind: "undecryptable" }
  | { readonly kind: "linked" }
  | { readonly kind: "off" }
  | { readonly kind: "notLinked" }
  | { readonly kind: "models"; readonly count: number }
  | { readonly kind: "noModels" }
  /** 제공자가 키를 받았다 */
  | { readonly kind: "authOk" }
  /** 제공자 확인 방법이 없다(목록에 없는 provider). 실패가 아니다 */
  | { readonly kind: "authUnsupported" }
  /** 제공자 확인이 실패했다. `status`와 `reason`(키 값은 가려진 글)은 응답이 있을 때만 */
  | {
      readonly kind: "authFailed";
      readonly cause: AuthFailureCause;
      readonly status?: number;
      readonly reason?: string;
    }
  /** 시험이나 등록이 실패한 사유 한 문장. `fix`가 있으면 그 밑에 고치는 법 한 줄이 온다 */
  | { readonly kind: "error"; readonly text: string; readonly fix?: string };

export function initialChecks(): readonly ProviderCheckResult[] {
  return PROVIDER_CHECK_IDS.map((id) => ({ id, state: "waiting" }));
}

/**
 * 키 등록이 실패한 사유를 저장 단계에 둔다. 시험을 돌리지 않았으므로 뒤 단계는 건너뜀이다.
 * `text`와 `fix`는 키 등록 결과의 문장이다(값은 없다). 카드를 다시 열어도 사유가 남는다.
 */
export function storeFailedChecks(
  text: string,
  fix: string | undefined,
): readonly ProviderCheckResult[] {
  return withCheck(initialChecks(), {
    id: "stored",
    state: "failed",
    reason: { kind: "error", text, ...(fix === undefined ? {} : { fix }) },
  });
}

/** 단계 하나를 바꾸고, 실패면 뒤 단계를 건너뜀으로 둔다 */
export function withCheck(
  checks: readonly ProviderCheckResult[],
  next: ProviderCheckResult,
): readonly ProviderCheckResult[] {
  const at = PROVIDER_CHECK_IDS.indexOf(next.id);
  return checks.map((check) => {
    if (check.id === next.id) return next;
    const index = PROVIDER_CHECK_IDS.indexOf(check.id);
    return next.state === "failed" && index > at ? { id: check.id, state: "skipped" } : check;
  });
}

/** 저장소 단계 판정: 시크릿 시험 결과에서 */
export function storedCheckOf(test: {
  readonly state: "registered" | "missing";
  readonly decryptable: boolean;
  readonly length: number | null;
}): ProviderCheckReason {
  if (test.state === "missing") return { kind: "missing" };
  if (!test.decryptable) return { kind: "undecryptable" };
  return { kind: "stored", length: test.length };
}

/** 연결 단계 판정: 설정의 제공자 원소가 켜져 있고 그 시크릿을 가리키는가 */
export function linkedCheckOf(
  providers: readonly ProviderEntry[],
  id: string,
  name: SecretName,
): ProviderCheckReason {
  const entry = providers.find((candidate) => candidate.id === id);
  if (entry === undefined || secretNameOfRef(entry.apiKeyRef) !== name) {
    return { kind: "notLinked" };
  }
  return entry.enabled ? { kind: "linked" } : { kind: "off" };
}

export function modelsCheckOf(models: readonly ModelEntry[], id: string): ProviderCheckReason {
  const count = modelCountOf(models, id);
  return count === 0 ? { kind: "noModels" } : { kind: "models", count };
}

/** 제공자 확인 응답(`provider.checkAuth`)의 판정. 키 값은 응답에 없고 사유는 이미 가려져 있다 */
export function authCheckOf(result: ProviderCheckAuthResult): ProviderCheckReason {
  switch (result.kind) {
    case "ok":
      return { kind: "authOk" };
    case "unsupported":
      return { kind: "authUnsupported" };
    case "noKey":
      return { kind: "noKey" };
    case "rejected":
    case "oauthTokenNotApiKey":
    case "badAddress":
    case "quotaOrBilling":
    case "upstream":
    case "timeout":
      return {
        kind: "authFailed",
        cause: result.kind,
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      };
    default:
      return assertNever(result.kind, "ProviderAuthKind");
  }
}

/** 판정이 통과인가 */
export function isPassing(reason: ProviderCheckReason): boolean {
  return (
    reason.kind === "stored" ||
    reason.kind === "linked" ||
    reason.kind === "models" ||
    reason.kind === "authOk"
  );
}

/** 판정이 실패가 아닌 건너뜀인가(확인할 방법이 없는 제공자). 화면은 실패 색을 쓰지 않는다 */
export function isNeutral(reason: ProviderCheckReason): boolean {
  return reason.kind === "authUnsupported";
}

/** 구독 로그인 토큰(`sk-ant-oat`로 시작)의 접두. 기본 anthropic 제공자는 이 토큰을 받지 않는다(L1.models.spec §3.9) */
const SUBSCRIPTION_TOKEN_PREFIX = "sk-ant-oat";

/**
 * 입력 중인 키 글이 구독 로그인 토큰 접두로 시작하는가. 앞뒤 공백과 따옴표를 지운 뒤 접두만 본다.
 * 값은 돌려주지 않고 어디에도 남기지 않는다(판정 결과인 참·거짓만 쓴다).
 */
export function isSubscriptionTokenText(text: string): boolean {
  return normalizePastedKey(text).value.startsWith(SUBSCRIPTION_TOKEN_PREFIX);
}

// ── 계정 풀 ─────────────────────────────────────────────────────────────

/** 계정이 이만큼 넘는 provider는 접는다(L4.desktop-ux §6.15 긴 내용) */
export const ACCOUNT_FOLD_MAX = 20;
/** 끌거나 키로 옮긴 뒤 우선순위 간격 [제안] */
const PRIORITY_STEP = 10;

export interface ProviderPool {
  readonly provider: string;
  /** 우선순위 오름차순. 같으면 설정 순서다 */
  readonly accounts: readonly AccountEntry[];
}

/** 계정 목록을 provider별로 묶는다. provider는 id 순서다 */
export function poolsOf(list: readonly AccountEntry[]): readonly ProviderPool[] {
  const providers = [...new Set(list.map((entry) => entry.provider))].toSorted();
  return providers.map((provider) => ({
    provider,
    accounts: list
      .filter((entry) => entry.provider === provider)
      .toSorted((a, b) => a.priority - b.priority),
  }));
}

/** 접힌 목록에서 보일 계정 수와 숨은 수. 펼치면 전부 보인다 */
export function foldOf<T>(
  items: readonly T[],
  expanded: boolean,
): { readonly shown: readonly T[]; readonly hidden: number } {
  if (expanded || items.length <= ACCOUNT_FOLD_MAX) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, ACCOUNT_FOLD_MAX), hidden: items.length - ACCOUNT_FOLD_MAX };
}

/**
 * provider 안에서 계정 순서를 `orderedIds`(계정 id 순서)대로 바꾼다. 같은 provider의 계정은 `PRIORITY_STEP` 간격으로 다시 매긴다.
 * 다른 provider의 계정은 그대로다.
 */
export function reprioritizedOf(
  list: readonly AccountEntry[],
  provider: string,
  orderedIds: readonly string[],
): readonly AccountEntry[] {
  return list.map((entry) => {
    if (entry.provider !== provider) return entry;
    const index = orderedIds.indexOf(entry.accountId);
    return index === -1 ? entry : { ...entry, priority: index * PRIORITY_STEP };
  });
}

/** 새 계정의 우선순위: 그 provider의 맨 뒤 */
export function nextPriorityOf(list: readonly AccountEntry[], provider: string): number {
  const own = list.filter((entry) => entry.provider === provider).map((entry) => entry.priority);
  return own.length === 0 ? 0 : Math.max(...own) + PRIORITY_STEP;
}

// ── 계정 회전 행 ─────────────────────────────────────────────────────────

/** 계정 회전 플러그인의 켜기 키(X 로더 예약 키 `enabled`, 기본 꺼짐). 고지 동의 키는 client `ROTATION_ACK_KEY`다 */
export const ROTATION_ENABLED_KEY = "ext.account-rotation.enabled";

/** 설정 키 하나에 쓸 값. 바뀌는 키만 담는다 */
export interface RotationWrite {
  readonly key: string;
  readonly value: boolean;
}

/** 회전 스위치를 바꾼 결과: 위험 확인 대화 상자를 먼저 열거나, 바로 쓴다 */
export type RotationStep =
  | { readonly kind: "ask" }
  | { readonly kind: "write"; readonly writes: readonly RotationWrite[] };

/**
 * 스위치를 `next`로 바꿨을 때의 행동(L4.desktop-ux §6.15). 끄면 켜기 키만 `false`로 쓴다.
 * 켜는 쪽은 고지에 동의하지 않았으면 위험 확인 대화 상자를 먼저 연다. 동의했으면 켜기 키만 쓰고, 이미 켜져 있으면 아무것도 쓰지 않는다.
 */
export function rotationStepOf(
  input: { readonly pluginEnabled: boolean; readonly acknowledged: boolean },
  next: boolean,
): RotationStep {
  if (!next) {
    return {
      kind: "write",
      writes: input.pluginEnabled ? [{ key: ROTATION_ENABLED_KEY, value: false }] : [],
    };
  }
  if (!input.acknowledged) return { kind: "ask" };
  return {
    kind: "write",
    writes: input.pluginEnabled ? [] : [{ key: ROTATION_ENABLED_KEY, value: true }],
  };
}

/**
 * 위험 확인 대화 상자의 "위험을 알고 켜기"가 쓰는 값. 동의 키를 먼저 쓰고, 플러그인이 꺼져 있었으면 켜기 키를 잇는다.
 */
export function rotationConfirmOf(input: {
  readonly pluginEnabled: boolean;
}): readonly RotationWrite[] {
  return [
    { key: ROTATION_ACK_KEY, value: true },
    ...(input.pluginEnabled ? [] : [{ key: ROTATION_ENABLED_KEY, value: true }]),
  ];
}

/** 키 이름으로 설정 항목을 찾는다. 탭에 없으면 `undefined`다 */
export function fieldOfKey<F extends Pick<FieldVM, "key">>(
  fields: readonly F[],
  key: string,
): F | undefined {
  return fields.find((field) => field.key === key);
}

// ── 모델 쓰기·막기 ───────────────────────────────────────────────────────

/** 모델 목록의 줄. 카탈로그 모델(쓸 수 있음)과 막은 목록의 원소(꺼짐)를 한 목록에 둔다 */
export interface ModelAccessRow {
  /** 모델 참조나 `provider/*` 패턴 */
  readonly ref: string;
  readonly provider: string;
  /** 보일 이름. 막은 모델은 카탈로그에 없어 모델 id다 */
  readonly label: string;
  readonly usable: boolean;
  /** `provider/*` 패턴 줄(제공자 전체 막음) */
  readonly pattern: boolean;
  /** 카탈로그 원소(쓸 수 있는 모델). 막은 줄은 null */
  readonly entry: ModelEntry | null;
}

export interface ModelAccessGroup {
  readonly provider: string;
  readonly rows: readonly ModelAccessRow[];
}

function isPattern(ref: string): boolean {
  return ref.endsWith("/*");
}

/**
 * 모델 목록 묶음. 엔진 카탈로그(`models.list`)는 막은 모델을 빼고 주므로, 막은 목록(`l1.models.deniedModels`)의 원소를 꺼진 줄로 다시 더한다.
 * 그래서 끈 모델이 목록에서 사라지지 않는다. 제공자 이름순, 묶음 안은 패턴 줄 → 이름순이다. `query`가 있으면 이름·참조에 든 줄만.
 */
export function modelAccessGroupsOf(
  models: readonly ModelEntry[],
  denied: readonly string[],
  query: string,
): readonly ModelAccessGroup[] {
  const rows: ModelAccessRow[] = models.map((entry) => ({
    ref: entry.ref,
    provider: providerOfRef(entry.ref),
    label: entry.name === "" ? entry.ref.slice(entry.ref.indexOf("/") + 1) : entry.name,
    usable: true,
    pattern: false,
    entry,
  }));
  for (const ref of denied) {
    if (rows.some((row) => row.ref === ref)) continue;
    const provider = providerOfRef(ref);
    rows.push({
      ref,
      provider,
      label: isPattern(ref) ? providerNameOf(provider) : ref.slice(ref.indexOf("/") + 1),
      usable: false,
      pattern: isPattern(ref),
      entry: null,
    });
  }
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? rows
      : rows.filter(
          (row) =>
            row.label.toLowerCase().includes(needle) || row.ref.toLowerCase().includes(needle),
        );
  const providers = [...new Set(shown.map((row) => row.provider))].toSorted();
  return providers.map((provider) => ({
    provider,
    rows: shown
      .filter((row) => row.provider === provider)
      .toSorted((a, b) => {
        if (a.pattern !== b.pattern) return a.pattern ? -1 : 1;
        return a.label.localeCompare(b.label, "en", { numeric: true });
      }),
  }));
}

/** 줄 스위치: 끄면 막은 목록에 더하고, 켜면 뺀다 */
export function withModelUsable(
  denied: readonly string[],
  ref: string,
  usable: boolean,
): readonly string[] {
  if (usable) return denied.filter((item) => item !== ref);
  return denied.includes(ref) ? denied : [...denied, ref];
}

/** 규칙 목록(허용 목록)에 원소 하나를 더하거나 뺀다 */
export function withRule(list: readonly string[], rule: string): readonly string[] {
  return list.includes(rule) ? list : [...list, rule];
}

export function withoutRule(list: readonly string[], rule: string): readonly string[] {
  return list.filter((item) => item !== rule);
}

/** 허용 규칙 형식: `provider/model` 또는 `provider/*`(엔진 `matchesModelPattern`과 같은 두 형식) */
const RULE = /^[a-z0-9][a-z0-9._-]{0,63}\/(?:\*|[^\s/][^\s]{0,199})$/;

export function isModelRule(text: string): boolean {
  return RULE.test(text.trim());
}

/** 문자열 목록 설정 값. 목록이 아니거나 글 아닌 원소가 있으면 null */
export function stringListOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

// ── 사용량 게이지 ────────────────────────────────────────────────────────

/**
 * 게이지의 채움 비율(0~100). 한도를 모르거나 한도가 0 이하이면 `null`이다. 비율을 지어내지 않는다(caustic `Progress`는 모르면 indeterminate).
 */
export function usageFractionOf(gauge: UsageGauge): number | null {
  if (gauge.limit === null || gauge.limit <= 0) return null;
  return Math.min(100, (gauge.used / gauge.limit) * 100);
}
