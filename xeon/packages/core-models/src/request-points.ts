import type { ThreadId, ModelThinkingLevel } from "@xeon/contracts/conversation";
import type { ModelBinding, ModelRole } from "@xeon/contracts/services";

// L1.models.spec §4.3 6~9번, §7. 요청 지점 6개의 발화 입력과 순수 도우미다. X의 ExtHost.dispatch를 plugin.ts가
// 이 모양으로 감싼다. 이 파일은 Cordis도 ext-host도 import하지 않는다.

/** 모든 발화에 붙는 공통 입력 */
export interface PointInput {
  readonly threadId: ThreadId;
  /** 결정적 키. pi-ai 재시도로 같은 요청에 다시 불려도 같은 값이다 */
  readonly dispatchKey: string;
  readonly signal?: AbortSignal;
}

export interface RequestPointInput extends PointInput {
  readonly provider: string;
  readonly modelId: string;
  readonly role: ModelRole;
}

export interface BeforeProviderRequestInput extends RequestPointInput {
  readonly payload: unknown;
}

export interface BeforeProviderHeadersInput extends RequestPointInput {
  /** 이름은 소문자. 인증 헤더 값은 "[secret]"로 가린 사본이다 */
  readonly headers: Readonly<Record<string, string>>;
}

export interface AfterProviderResponseInput extends RequestPointInput {
  readonly status: number;
  /** 인증·쿠키 헤더를 뺀 응답 헤더 */
  readonly headers: Readonly<Record<string, string>>;
}

export interface ProviderStreamEventInput extends PointInput {
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  readonly data: unknown;
}

export type ModelSelectSource = "set" | "route" | "restore" | "fallback";

export interface ModelSelectInput extends PointInput {
  readonly binding: ModelBinding;
  readonly previous: ModelBinding | null;
  readonly source: ModelSelectSource;
}

export interface ThinkingLevelSelectInput extends PointInput {
  readonly role: ModelRole;
  readonly level: ModelThinkingLevel;
  readonly previousLevel: ModelThinkingLevel | null;
}

/**
 * 요청 지점을 발화하는 쪽. beforeProviderRequest 외에는 선택이라 없으면 그 지점을 발화하지 않는다.
 * 핸들러가 던진 실패는 X가 지점 종류별 규칙(skip, record)으로 흡수한다
 */
export interface ProviderDispatcher {
  /** chain 지점. 핸들러 패치를 적용한 최종 페이로드를 돌려준다 */
  beforeProviderRequest(input: BeforeProviderRequestInput): Promise<unknown>;
  /**
   * guard 지점(`guard.model.before`, M3-REQ-109). `beforeProviderRequest`의 최종 페이로드로 부른다. 차단이면 `{ block: true, reason }`,
   * 의견이 없으면 undefined다. 없으면 가드를 발화하지 않는다. 던지면 차단으로 본다(fail-closed)
   */
  guardProviderRequest?(
    input: BeforeProviderRequestInput,
  ): Promise<{ readonly block: true; readonly reason: string } | undefined>;
  /** chain 지점. 패치를 적용한 최종 헤더(소문자 이름)를 돌려준다. 값이 없는 이름은 삭제된 것이다 */
  beforeProviderHeaders?(
    input: BeforeProviderHeadersInput,
  ): Promise<Readonly<Record<string, string>>>;
  afterProviderResponse?(input: AfterProviderResponseInput): Promise<void>;
  providerStreamEvent?(input: ProviderStreamEventInput): Promise<void>;
  modelSelect?(input: ModelSelectInput): Promise<void>;
  /** detached 지점. 요청을 기다리게 하지 않는다 */
  thinkingLevelSelect?(input: ThinkingLevelSelectInput): Promise<void>;
}

// ── 헤더 ─────────────────────────────────────────────────────────────────

export const MASKED_VALUE = "[secret]";

/** 인증 값을 싣는 헤더 이름. authorization, x-api-key, x-goog-api-key, api-key, 토큰·쿠키류를 가린다 */
const SENSITIVE_NAME = /authorization|api-?key|token|secret|cookie/i;

/** 응답 헤더에서 빼는 이름(인증·쿠키) */
const RESPONSE_DROPPED = /authorization|api-?key|cookie/i;

function isSensitive(lower: string, extra: ReadonlySet<string>): boolean {
  return SENSITIVE_NAME.test(lower) || extra.has(lower);
}

export interface HeaderPlan {
  /** 핸들러에 보이는 사본: 소문자 이름, 인증 헤더 값은 "[secret]", 삭제 표시(null)는 뺀다 */
  readonly visible: Readonly<Record<string, string>>;
  /**
   * 핸들러가 낸 최종 헤더를 실제 요청 헤더로 되돌린다. 인증 헤더는 어떤 패치도 받지 않고 원래 값을 쓴다.
   * ignored는 패치하려다 무시된 인증 헤더 이름이다
   */
  finalize(final: Readonly<Record<string, string>>): {
    readonly headers: Record<string, string | null>;
    readonly ignored: readonly string[];
  };
}

/**
 * 요청 헤더를 핸들러에 보여 줄 사본과 되돌리기 함수로 나눈다. extraSensitive는 등록부가 비밀 참조에서 푼 헤더 이름(소문자)이다.
 * 이름 대소문자는 원래 것을 되살린다(HTTP 헤더는 대소문자를 구분하지 않으므로 의미는 같다)
 */
export function planHeaders(
  headers: Readonly<Record<string, string | null>>,
  extraSensitive: ReadonlySet<string> = new Set(),
): HeaderPlan {
  const originals = new Map<string, { readonly name: string; readonly value: string | null }>();
  for (const [name, value] of Object.entries(headers)) {
    originals.set(name.toLowerCase(), { name, value });
  }
  const visible: Record<string, string> = {};
  for (const [lower, original] of originals) {
    if (original.value === null) continue;
    visible[lower] = isSensitive(lower, extraSensitive) ? MASKED_VALUE : original.value;
  }
  return {
    visible,
    finalize(final) {
      const out: Record<string, string | null> = {};
      const ignored: string[] = [];
      for (const [lower, original] of originals) {
        if (isSensitive(lower, extraSensitive)) {
          out[original.name] = original.value;
          if (original.value !== null && final[lower] !== MASKED_VALUE) ignored.push(lower);
          continue;
        }
        const next = final[lower];
        out[original.name] = next ?? null;
      }
      for (const [lower, value] of Object.entries(final)) {
        if (originals.has(lower)) continue;
        // 인증 헤더 이름은 핸들러가 새로 만들 수도 없다
        if (isSensitive(lower, extraSensitive)) ignored.push(lower);
        else out[lower] = value;
      }
      return { headers: out, ignored };
    },
  };
}

/** after_provider_response에 싣는 헤더: 소문자 이름, 인증·쿠키류 제외 */
export function publicResponseHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!RESPONSE_DROPPED.test(lower)) out[lower] = value;
  }
  return out;
}
