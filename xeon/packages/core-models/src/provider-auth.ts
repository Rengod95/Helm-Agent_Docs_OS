import type { FetchFunction } from "@earendil-works/pi-ai";
import { attempt, parseJson } from "@fresnel/contracts";
import type { ProviderAuthCheck, ProviderAuthKind } from "@fresnel/contracts/services";

// L1.models.spec §3.13, provider.checkAuth. 사용자가 연결 시험을 누른 설정 동작이라 모델 호출이나 도구 호출이 아니다.
// 그래서 샌드박스와 웹 정책(cap-web의 허용·거부 도메인)을 받지 않는다. 대신 provider의 설정 주소(baseUrl 설정 → 등록부 → 기본 주소)로만 간다.
// 값 없는 GET 하나만 보낸다. 생성 호출은 하지 않는다. 키 값은 이 모듈의 반환 값, 요청 헤더, 호출자 밖으로 나가지 않는다.

/** 확인 요청의 시한. 넘으면 `timeout`이다 */
export const PROVIDER_AUTH_TIMEOUT_MS = 8_000;

/** 오류 본문을 읽는 최대 바이트. 사유 글을 뽑는 데만 쓴다 */
const BODY_LIMIT_BYTES = 8_192;
const REASON_MAX_CHARS = 200;
const MASK = "••••";
/** 키 조각을 가리는 최소 길이. 짧은 조각은 일반 글자와 겹쳐 가리지 않는다 */
const FRAGMENT_MIN_CHARS = 8;
/** 구독 OAuth 토큰 접두. API 키가 아니므로 접두만 보고 네트워크 호출 없이 거절한다 */
const OAUTH_TOKEN_PREFIX = "sk-ant-oat";
/** Anthropic API 버전 헤더 값 [미확인: 공식 버전 문서를 가져오지 못했다] */
const ANTHROPIC_VERSION = "2023-06-01";

interface ProbeSpec {
  /** base 주소 뒤에 붙는 경로. 기본 주소의 모양을 따른다(`openai`는 base에 /v1이 있다) */
  readonly path: string;
  readonly headers: (key: string) => Readonly<Record<string, string>>;
}

/**
 * 내장 provider id → 값 없는 확인 GET. 목록에 없는 provider(사용자 정의 OpenAI 호환 등)는 경로를 모르므로 `unsupported`다.
 * OpenRouter는 공식 참조 페이지의 `GET /key`(기본 주소 `https://openrouter.ai/api/v1` 아래)를 쓴다.
 */
const PROBES: ReadonlyMap<string, ProbeSpec> = new Map<string, ProbeSpec>([
  [
    "anthropic",
    {
      path: "/v1/models",
      headers: (key) => ({ "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION }),
    },
  ],
  ["openai", { path: "/models", headers: (key) => ({ authorization: `Bearer ${key}` }) }],
  ["google", { path: "/models", headers: (key) => ({ "x-goog-api-key": key }) }],
  ["openrouter", { path: "/key", headers: (key) => ({ authorization: `Bearer ${key}` }) }],
]);

/** 키 값 전체와 8자 이상인 앞·뒤 조각을 모두 찾는 목록이다. 긴 것부터라 전체가 조각 때문에 먼저 깨지지 않는다 */
function keyFragmentsOf(key: string): readonly string[] {
  if (key.length === 0) return [];
  const fragments = new Set<string>([key]);
  for (let length = FRAGMENT_MIN_CHARS; length < key.length; length += 1) {
    fragments.add(key.slice(0, length));
    fragments.add(key.slice(key.length - length));
  }
  return [...fragments].toSorted((a, b) => b.length - a.length);
}

/** 키 값이나 그 8자 이상 조각이 든 곳을 `••••`로 가린다 */
export function maskKeyIn(text: string, key: string): string {
  let masked = text;
  for (const fragment of keyFragmentsOf(key)) masked = masked.split(fragment).join(MASK);
  return masked;
}

/** 오류 본문의 사유 글. `error.message`(중첩 가능)나 짧은 평문만 쓴다. HTML 같은 본문은 사유가 아니다 */
function messageOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("message" in value && typeof value.message === "string") return value.message;
  if ("error" in value) {
    const inner = value.error;
    if (typeof inner === "string") return inner;
    return messageOf(inner);
  }
  return undefined;
}

function plainTextOf(body: string): string | undefined {
  const text = body.trim();
  if (text === "" || text.startsWith("<")) return undefined;
  return text;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** 사유 글. 가린 뒤에 자른다. 자르고 나서 가리면 잘린 조각이 남을 수 있다 */
function reasonOf(body: string, key: string): string | undefined {
  const parsed = parseJson(body);
  const raw = parsed.ok ? messageOf(parsed.value) : plainTextOf(body);
  if (raw === undefined || raw.trim() === "") return undefined;
  return truncate(maskKeyIn(raw.trim(), key), REASON_MAX_CHARS);
}

const BILLING_WORDS = /billing|quota|credit|payment|balance|insufficient/i;
const KEY_WORDS = /api[ _-]?key|apikey|authenticat|unauthori|credential|key not valid|invalid key/i;

/** HTTP 상태와 가린 본문으로 결과 종류를 고른다. 2xx는 호출하는 곳에서 먼저 `ok`로 거른다 */
function kindOfFailure(status: number, maskedBody: string): ProviderAuthKind {
  if (status === 401 || status === 403) return "rejected";
  if (status === 402 || status === 429) return "quotaOrBilling";
  if (status === 404 || (status >= 300 && status < 400)) return "badAddress";
  if (status >= 400 && status < 500) {
    if (BILLING_WORDS.test(maskedBody)) return "quotaOrBilling";
    // Google은 잘못된 키를 400으로 돌려준다
    if (KEY_WORDS.test(maskedBody)) return "rejected";
  }
  return "upstream";
}

function checkOf(kind: ProviderAuthKind, status?: number, reason?: string): ProviderAuthCheck {
  return {
    kind,
    ...(status === undefined ? {} : { status }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** base 주소에 경로를 붙인 URL. 해석할 수 없거나 http·https가 아니면 undefined다 */
function urlOf(baseUrl: string, path: string): string | undefined {
  const joined = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const parsed = attempt(() => new URL(joined));
  if (!parsed.ok) return undefined;
  const { protocol } = parsed.value;
  if (protocol !== "https:" && protocol !== "http:") return undefined;
  return parsed.value.href;
}

/**
 * 본문을 `limit` 바이트까지만 읽는다. 오류 본문이 커도 메모리를 아낀다. 넘는 부분은 버리고 읽기를 끊는다.
 * 읽기는 변환 스트림 하나로 이어서 한 번만 기다린다(반복문 안의 기다림을 피한다).
 */
function readCapped(response: Response, limit: number): Promise<string> {
  if (response.body === null) return Promise.resolve("");
  let seen = 0;
  const capped = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const room = limit - seen;
        seen += chunk.byteLength;
        if (chunk.byteLength <= room) {
          controller.enqueue(chunk);
          return;
        }
        if (room > 0) controller.enqueue(chunk.subarray(0, room));
        controller.terminate();
      },
    }),
  );
  return new Response(capped).text();
}

function networkReasonOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const { code } = caught;
    if (typeof code === "string") return `connection failed (${code})`;
  }
  return "connection failed";
}

export interface ProviderAuthProbe {
  readonly providerId: string;
  /** 저장소에서 풀어 낸 키. 이 함수 밖으로 나가지 않는다 */
  readonly key: string;
  /** 설정 주소(baseUrl 설정 → 등록부 → 기본 주소). 모르면 null */
  readonly baseUrl: string | null;
  readonly fetch: FetchFunction;
  /** 호출자의 취소. 끊기면 이 함수가 던진다. 취소는 값이 아니라서 와이어가 `request.cancelled`로 옮긴다 */
  readonly signal: AbortSignal;
  /** 시한. 시험이 짧은 시한을 넣을 수 있게 열어 둔다. 기본은 `PROVIDER_AUTH_TIMEOUT_MS` */
  readonly timeoutMs?: number;
}

/**
 * 저장된 키로 provider 인증을 한 번 확인한다. 순서: 구독 토큰 접두 → 확인 경로가 없는 provider → 주소 → 네트워크.
 * 네트워크 호출은 `redirect: "manual"`이라 다른 주소로 넘어가지 않는다(3xx는 `badAddress`).
 */
export async function probeProviderAuth(input: ProviderAuthProbe): Promise<ProviderAuthCheck> {
  const { key } = input;
  if (key.startsWith(OAUTH_TOKEN_PREFIX)) return { kind: "oauthTokenNotApiKey" };
  const probe = PROBES.get(input.providerId);
  if (probe === undefined) return { kind: "unsupported" };
  if (input.baseUrl === null) return { kind: "badAddress", reason: "no base URL" };
  const url = urlOf(input.baseUrl, probe.path);
  if (url === undefined) return { kind: "badAddress", reason: "invalid base URL" };

  const timer = AbortSignal.timeout(input.timeoutMs ?? PROVIDER_AUTH_TIMEOUT_MS);
  const signal = AbortSignal.any([input.signal, timer]);
  try {
    const response = await input.fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...probe.headers(key) },
      redirect: "manual",
      signal,
    });
    if (response.ok) {
      await response.body?.cancel();
      return checkOf("ok", response.status);
    }
    const body = await readCapped(response, BODY_LIMIT_BYTES);
    const kind = kindOfFailure(response.status, maskKeyIn(body, key));
    const redirected = response.status >= 300 && response.status < 400;
    const reason = reasonOf(body, key) ?? (redirected ? "redirect not followed" : undefined);
    return checkOf(kind, response.status, reason);
  } catch (caught) {
    // 호출자가 끊었으면 취소다. 던져서 와이어가 request.cancelled로 옮기게 한다
    if (input.signal.aborted) throw caught;
    if (timer.aborted) return { kind: "timeout" };
    return { kind: "badAddress", reason: networkReasonOf(caught) };
  }
}
