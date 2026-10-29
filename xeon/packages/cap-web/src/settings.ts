import { Type } from "typebox";
import { parse } from "@xeon/contracts";
import { PROVIDER_ID_PATTERN } from "@xeon/contracts/capabilities";
import {
  defineSettings,
  resolveSetting,
  validateSettingValue,
  SCOPE_PRECEDENCE,
  type ScopeStack,
  type SettingDef,
  type SettingScope,
} from "@xeon/contracts/settings";

// L2.web.spec §6. 키 문법은 `l2.web.<이름>`이다. 표 전체를 선언한다(L2.web.plan B11). 읽는 쪽은 이 파일의
// `readWebSettings`이고, 브라우저·조사 키(browse.*, research.*)는 그 기능이 들어오는 트랙이 읽는다.

const ALL_SCOPES = ["managed", "user", "project", "local", "session"] as const;
const NO_SESSION = ["managed", "user", "project", "local"] as const;
const NO_PROJECT = ["managed", "user", "local"] as const;
/** project만 뺀 범위. 저장소 설정이 방어를 푸는 키(허용 목록, 대화에 없던 URL)가 쓴다. 저장소는 `ask`·`deny`에는 더할 수 있다 */
const NO_PROJECT_KEEP_SESSION = ["managed", "user", "local", "session"] as const;
const USER_ONLY = ["managed", "user"] as const;

/** 도메인 패턴: `example.com`, `*.example.com`, `*`. 끝이 `*`인 패턴(`example.*`)은 거부한다(§4.5.1) */
export const DOMAIN_PATTERN_SOURCE: string =
  "^(\\*|(\\*\\.)?([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$";

const DomainPatternType = Type.String({ pattern: DOMAIN_PATTERN_SOURCE, maxLength: 253 });
const ProviderChoiceType = Type.String({ pattern: PROVIDER_ID_PATTERN, maxLength: 96 });

const webSettings = defineSettings("l2.web", {
  "search.provider": {
    type: ProviderChoiceType,
    default: "auto",
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "text",
      order: 100,
      label: "검색 provider",
      help: "auto 또는 provider ID",
    },
    since: "0.1.0",
  },
  "search.order": {
    type: Type.Array(ProviderChoiceType, { maxItems: 32 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: {
      tab: "tools",
      widget: "list",
      order: 101,
      label: "검색 도구 순서",
      help: "등록된 검색 도구를 끌어 옮겨 정한다. 목록에 없는 도구는 뒤에 붙고 플러그인이 마지막이다",
    },
    since: "0.1.0",
  },
  "search.parallel": {
    type: Type.Integer(),
    default: 1,
    range: { min: 1, max: 4 },
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: {
      tab: "tools",
      widget: "number",
      order: 103,
      label: "동시 질의 검색 도구 수",
      help: "1이면 순서대로 하나씩 쓴다. 2 이상이면 순서의 앞에서부터 그 수만큼 동시에 질의해 결과를 합친다. 검색어가 여러 수신자에게 나간다",
      unit: "개",
    },
    since: "0.1.0",
  },
  "search.searxng.url": {
    type: Type.String({ pattern: "^(|https?://[^\\s]+)$", maxLength: 2048 }),
    default: "",
    runtimeChange: "nextTurn",
    allowedScopes: NO_PROJECT,
    ui: {
      tab: "tools",
      widget: "text",
      order: 102,
      label: "SearXNG 주소",
      help: "비워 두면 SearXNG를 쓰지 않는다. 주소를 찾아 나서지 않는다",
    },
    since: "0.1.0",
  },
  "search.wrapper.model": {
    type: Type.String({ minLength: 1, maxLength: 128 }),
    default: "auto",
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "text",
      order: 104,
      label: "검색 래퍼 모델",
      help: "auto 또는 모델 ID",
    },
    since: "0.1.0",
  },
  "search.wrapper.maxContinuations": {
    type: Type.Integer(),
    default: 3,
    range: { min: 0, max: 10 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 105, label: "래퍼 pause_turn 재요청 상한" },
    since: "0.1.0",
  },
  "search.modelTool": {
    type: Type.String(),
    default: "auto",
    range: { enum: ["auto", "hosted", "function", "off"] },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "select", order: 106, label: "모델용 검색 도구" },
    since: "0.1.0",
  },
  "fetch.extractor": {
    type: Type.String(),
    default: "readability",
    range: { enum: ["readability", "defuddle"] },
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "select", order: 110, label: "본문 추출기" },
    since: "0.1.0",
  },
  "fetch.maxChars": {
    type: Type.Integer(),
    default: 15000,
    range: { min: 2000, max: 500000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 111, label: "읽기 최대 글자 수", unit: "자" },
    since: "0.1.0",
  },
  "fetch.timeoutSeconds": {
    type: Type.Integer(),
    default: 30,
    range: { min: 1, max: 120 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 112, label: "읽기 제한 시간", unit: "초" },
    since: "0.1.0",
  },
  "fetch.promote": {
    type: Type.String(),
    default: "auto",
    range: { enum: ["auto", "never"] },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "select", order: 113, label: "빈 본문 승격" },
    since: "0.1.0",
  },
  "fetch.pluginOrder": {
    type: Type.Array(ProviderChoiceType, { maxItems: 32 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "list", order: 114, label: "읽기 승격 플러그인 순서" },
    since: "0.1.0",
  },
  "policy.allow": {
    type: Type.Array(DomainPatternType, { maxItems: 500 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: NO_PROJECT_KEEP_SESSION,
    ui: { tab: "tools", widget: "list", order: 120, label: "허용 도메인" },
    since: "0.1.0",
  },
  "policy.ask": {
    type: Type.Array(DomainPatternType, { maxItems: 500 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "list", order: 121, label: "확인 도메인" },
    since: "0.1.0",
  },
  "policy.deny": {
    type: Type.Array(DomainPatternType, { maxItems: 500 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "list", order: 122, label: "차단 도메인" },
    since: "0.1.0",
  },
  "policy.allowPrivateNetwork": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: NO_PROJECT,
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 123,
      label: "사설망 허용",
      help: "루프백과 메타데이터 주소는 계속 막는다",
    },
    since: "0.1.0",
  },
  "policy.unseenUrl": {
    type: Type.String(),
    default: "ask",
    range: { enum: ["ask", "allow", "deny"] },
    runtimeChange: "nextTurn",
    allowedScopes: NO_PROJECT_KEEP_SESSION,
    ui: { tab: "tools", widget: "select", order: 124, label: "대화에 없던 URL" },
    since: "0.1.0",
  },
  "policy.robots": {
    type: Type.String(),
    default: "never",
    range: { enum: ["auto", "always", "never"] },
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: {
      tab: "tools",
      widget: "select",
      order: 125,
      label: "robots.txt 적용",
      help: "never(기본)는 따르지 않는다. auto는 자동 수집 경로만, always는 모든 fetch에 적용한다",
    },
    since: "0.1.0",
  },
  "cache.searchTtlMinutes": {
    type: Type.Integer(),
    default: 20,
    range: { min: 0, max: 1440 },
    runtimeChange: "live",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "number", order: 130, label: "검색 캐시 유지 시간", unit: "분" },
    since: "0.1.0",
  },
  "cache.fetchTtlMinutes": {
    type: Type.Integer(),
    default: 15,
    range: { min: 0, max: 1440 },
    runtimeChange: "live",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "number", order: 131, label: "읽기 캐시 유지 시간", unit: "분" },
    since: "0.1.0",
  },
  "cache.maxMegabytes": {
    type: Type.Integer(),
    default: 256,
    range: { min: 16, max: 8192 },
    runtimeChange: "live",
    allowedScopes: USER_ONLY,
    ui: { tab: "tools", widget: "number", order: 132, label: "디스크 캐시 상한", unit: "MB" },
    since: "0.1.0",
  },
  "limits.searchPerSession": {
    type: Type.Integer(),
    default: 100,
    range: { min: 0, max: 100000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 140,
      label: "세션당 검색 상한",
      help: "0이면 제한 없음",
      unit: "회",
    },
    since: "0.1.0",
  },
  "limits.fetchPerSession": {
    type: Type.Integer(),
    default: 300,
    range: { min: 0, max: 100000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 141,
      label: "세션당 읽기 상한",
      help: "0이면 제한 없음",
      unit: "회",
    },
    since: "0.1.0",
  },
  "browse.provider": {
    type: ProviderChoiceType,
    default: "auto",
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "text",
      order: 150,
      label: "브라우저 provider",
      help: "auto 또는 provider ID",
    },
    since: "0.1.0",
  },
  "browse.order": {
    type: Type.Array(ProviderChoiceType, { maxItems: 32 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: {
      tab: "tools",
      widget: "list",
      order: 161,
      label: "브라우저 도구 순서",
      help: "등록된 브라우저 도구를 끌어 옮겨 정한다. 목록에 없는 도구는 뒤에 붙고 플러그인이 마지막이다",
    },
    since: "0.1.0",
  },
  "browse.headless": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "toggle", order: 151, label: "헤드리스 실행" },
    since: "0.1.0",
  },
  "browse.runtime": {
    type: Type.String(),
    default: "auto",
    range: { enum: ["auto", "bun", "node"] },
    runtimeChange: "restart",
    allowedScopes: USER_ONLY,
    ui: { tab: "tools", widget: "select", order: 152, label: "브라우저 런타임" },
    since: "0.1.0",
  },
  "browse.executablePath": {
    type: Type.String({ maxLength: 4096 }),
    default: "",
    runtimeChange: "restart",
    allowedScopes: NO_PROJECT,
    ui: { tab: "tools", widget: "text", order: 153, label: "브라우저 실행 파일 경로" },
    since: "0.1.0",
  },
  "browse.maxMinutes": {
    type: Type.Integer(),
    default: 30,
    range: { min: 1, max: 480 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 154,
      label: "브라우저 세션 시간 상한",
      unit: "분",
    },
    since: "0.1.0",
  },
  "browse.maxActions": {
    type: Type.Integer(),
    default: 200,
    range: { min: 1, max: 10000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 155, label: "브라우저 동작 상한", unit: "회" },
    since: "0.1.0",
  },
  "browse.maxUsd": {
    type: Type.Number(),
    default: 0.5,
    range: { min: 0, max: 100 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 156,
      label: "브라우저 세션 비용 상한",
      unit: "USD",
    },
    since: "0.1.0",
  },
  "browse.maxSessions": {
    type: Type.Integer(),
    default: 3,
    range: { min: 1, max: 16 },
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "number", order: 157, label: "동시 브라우저 세션 수" },
    since: "0.1.0",
  },
  "browse.allowNamedProfiles": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: USER_ONLY,
    ui: { tab: "tools", widget: "toggle", order: 158, label: "이름 있는 프로필 허용" },
    since: "0.1.0",
  },
  "browse.allowJavascriptExec": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: NO_PROJECT,
    ui: { tab: "tools", widget: "toggle", order: 159, label: "페이지 스크립트 실행 허용" },
    since: "0.1.0",
  },
  "browse.allowFileUpload": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: NO_PROJECT,
    ui: { tab: "tools", widget: "toggle", order: 160, label: "파일 업로드 허용" },
    since: "0.1.0",
  },
  "research.provider": {
    type: ProviderChoiceType,
    default: "auto",
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "text",
      order: 170,
      label: "조사 provider",
      help: "auto 또는 provider ID",
    },
    since: "0.2.0",
  },
  "research.maxBudgetUsd": {
    type: Type.Number(),
    default: 5,
    range: { min: 0.01, max: 100 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 171, label: "조사 비용 상한", unit: "USD" },
    since: "0.2.0",
  },
  "research.keepUnverified": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "toggle", order: 172, label: "검증 못한 주장 유지" },
    since: "0.2.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const WEB_SETTING_DEFS: readonly SettingDef[] = Object.values(webSettings.defs);

export interface WebSettings {
  readonly search: {
    readonly provider: string;
    readonly order: readonly string[];
    /** 동시에 질의하는 검색 도구 수(1이면 순서대로 하나씩) */
    readonly parallel: number;
    readonly searxng: { readonly url: string };
    readonly wrapper: { readonly model: string; readonly maxContinuations: number };
    readonly modelTool: "auto" | "hosted" | "function" | "off";
  };
  readonly browse: {
    readonly provider: string;
    readonly order: readonly string[];
    readonly headless: boolean;
    readonly maxMinutes: number;
    readonly maxActions: number;
    readonly maxUsd: number;
    readonly maxSessions: number;
    readonly allowNamedProfiles: boolean;
    readonly allowJavascriptExec: boolean;
    readonly allowFileUpload: boolean;
  };
  readonly fetch: {
    readonly extractor: "readability" | "defuddle";
    readonly maxChars: number;
    readonly timeoutSeconds: number;
    readonly promote: "auto" | "never";
    readonly pluginOrder: readonly string[];
  };
  readonly policy: {
    /** 모든 범위의 값을 합친 목록(§4.5.2). 중복은 한 번만 */
    readonly allow: readonly string[];
    readonly ask: readonly string[];
    readonly deny: readonly string[];
    readonly allowPrivateNetwork: boolean;
    readonly unseenUrl: "ask" | "allow" | "deny";
    readonly robots: "auto" | "always" | "never";
  };
  readonly cache: {
    readonly searchTtlMinutes: number;
    readonly fetchTtlMinutes: number;
    readonly maxMegabytes: number;
  };
  readonly limits: { readonly searchPerSession: number; readonly fetchPerSession: number };
}

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  search: {
    provider: "auto",
    order: [],
    parallel: 1,
    searxng: { url: "" },
    wrapper: { model: "auto", maxContinuations: 3 },
    modelTool: "auto",
  },
  browse: {
    provider: "auto",
    order: [],
    headless: true,
    maxMinutes: 30,
    maxActions: 200,
    maxUsd: 0.5,
    maxSessions: 3,
    allowNamedProfiles: false,
    allowJavascriptExec: false,
    allowFileUpload: false,
  },
  fetch: {
    extractor: "readability",
    maxChars: 15000,
    timeoutSeconds: 30,
    promote: "auto",
    pluginOrder: [],
  },
  policy: {
    allow: [],
    ask: [],
    deny: [],
    allowPrivateNetwork: false,
    unseenUrl: "ask",
    robots: "never",
  },
  cache: { searchTtlMinutes: 20, fetchTtlMinutes: 15, maxMegabytes: 256 },
  limits: { searchPerSession: 100, fetchPerSession: 300 },
};

/** 호출 한 번이 읽는 설정 층. 파일 범위와 세션 범위를 합친 스택을 돌려준다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface WebSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

function def(key: keyof typeof webSettings.defs): SettingDef {
  return webSettings.defs[key];
}

function effective(key: keyof typeof webSettings.defs, layers: ScopeStack): unknown {
  return resolveSetting(def(key), layers).setting.value;
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

const StringListSchema = Type.Array(Type.String());

function stringList(value: unknown): readonly string[] {
  const parsed = parse(StringListSchema, value);
  return parsed.ok ? parsed.value : [];
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  for (const candidate of allowed) {
    if (candidate === value) return candidate;
  }
  return fallback;
}

/**
 * 도메인 목록 세 키는 우선순위로 하나를 고르지 않고 모든 범위의 값을 합친다(§4.5.2). 키의 allowedScopes에 없는 범위와
 * 값 검사를 통과하지 못한 범위는 건너뛴다.
 */
function unionOfScopes(key: keyof typeof webSettings.defs, layers: ScopeStack): readonly string[] {
  const settingDef = def(key);
  const seen = new Set<string>();
  const out: string[] = [];
  const scopes: readonly SettingScope[] = SCOPE_PRECEDENCE;
  for (const scope of scopes) {
    if (!settingDef.allowedScopes.includes(scope)) continue;
    const layer = layers.find((candidate) => candidate.scope === scope);
    if (layer === undefined || !layer.values.has(settingDef.key)) continue;
    const value = layer.values.get(settingDef.key);
    if (!validateSettingValue(settingDef, value).ok) continue;
    for (const item of stringList(value)) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readWebSettings(layers: ScopeStack): WebSettings {
  const fallback = DEFAULT_WEB_SETTINGS;
  return {
    search: {
      provider: stringOr(effective("search.provider", layers), fallback.search.provider),
      order: stringList(effective("search.order", layers)),
      parallel: integerOr(effective("search.parallel", layers), fallback.search.parallel),
      searxng: {
        url: stringOr(effective("search.searxng.url", layers), fallback.search.searxng.url),
      },
      wrapper: {
        model: stringOr(effective("search.wrapper.model", layers), fallback.search.wrapper.model),
        maxContinuations: integerOr(
          effective("search.wrapper.maxContinuations", layers),
          fallback.search.wrapper.maxContinuations,
        ),
      },
      modelTool: choice(
        effective("search.modelTool", layers),
        ["auto", "hosted", "function", "off"],
        fallback.search.modelTool,
      ),
    },
    browse: {
      provider: stringOr(effective("browse.provider", layers), fallback.browse.provider),
      order: stringList(effective("browse.order", layers)),
      headless: booleanOr(effective("browse.headless", layers), fallback.browse.headless),
      maxMinutes: integerOr(effective("browse.maxMinutes", layers), fallback.browse.maxMinutes),
      maxActions: integerOr(effective("browse.maxActions", layers), fallback.browse.maxActions),
      maxUsd: numberOr(effective("browse.maxUsd", layers), fallback.browse.maxUsd),
      maxSessions: integerOr(effective("browse.maxSessions", layers), fallback.browse.maxSessions),
      allowNamedProfiles: booleanOr(
        effective("browse.allowNamedProfiles", layers),
        fallback.browse.allowNamedProfiles,
      ),
      allowJavascriptExec: booleanOr(
        effective("browse.allowJavascriptExec", layers),
        fallback.browse.allowJavascriptExec,
      ),
      allowFileUpload: booleanOr(
        effective("browse.allowFileUpload", layers),
        fallback.browse.allowFileUpload,
      ),
    },
    fetch: {
      extractor: choice(
        effective("fetch.extractor", layers),
        ["readability", "defuddle"],
        fallback.fetch.extractor,
      ),
      maxChars: integerOr(effective("fetch.maxChars", layers), fallback.fetch.maxChars),
      timeoutSeconds: integerOr(
        effective("fetch.timeoutSeconds", layers),
        fallback.fetch.timeoutSeconds,
      ),
      promote: choice(
        effective("fetch.promote", layers),
        ["auto", "never"],
        fallback.fetch.promote,
      ),
      pluginOrder: stringList(effective("fetch.pluginOrder", layers)),
    },
    policy: {
      allow: unionOfScopes("policy.allow", layers),
      ask: unionOfScopes("policy.ask", layers),
      deny: unionOfScopes("policy.deny", layers),
      allowPrivateNetwork: booleanOr(
        effective("policy.allowPrivateNetwork", layers),
        fallback.policy.allowPrivateNetwork,
      ),
      unseenUrl: choice(
        effective("policy.unseenUrl", layers),
        ["ask", "allow", "deny"],
        fallback.policy.unseenUrl,
      ),
      robots: choice(
        effective("policy.robots", layers),
        ["auto", "always", "never"],
        fallback.policy.robots,
      ),
    },
    cache: {
      searchTtlMinutes: integerOr(
        effective("cache.searchTtlMinutes", layers),
        fallback.cache.searchTtlMinutes,
      ),
      fetchTtlMinutes: integerOr(
        effective("cache.fetchTtlMinutes", layers),
        fallback.cache.fetchTtlMinutes,
      ),
      maxMegabytes: integerOr(effective("cache.maxMegabytes", layers), fallback.cache.maxMegabytes),
    },
    limits: {
      searchPerSession: integerOr(
        effective("limits.searchPerSession", layers),
        fallback.limits.searchPerSession,
      ),
      fetchPerSession: integerOr(
        effective("limits.fetchPerSession", layers),
        fallback.limits.fetchPerSession,
      ),
    },
  };
}
