import { Type, type Static, type TLiteral, type TUnion, type TUnsafe } from "typebox";
import type { Clock, SchemaProof } from "../../base/index.ts";
import type { CapabilityId } from "../ids.ts";
import {
  CacheUsageSchema,
  CostUnitNameSchema,
  IsoDateSchema,
  type BrowseActInput,
  type BrowsePage,
  type BrowseReadInput,
  type BrowseReadOutput,
  type BrowseSnapshot,
  type CacheUsage,
  type ContentMode,
  type Cost,
  type FetchFormat,
  type Freshness,
  type PassageKind,
  type Recency,
  type RenderMode,
} from "./web.ts";

// L2.web.spec §3.6. 플러그인 provider는 능력 API 전체가 아니라 이 좁은 인터페이스만 구현한다.
// 앞단(cap-web)이 정책, 캐시, 비용, 인용 처리를 공통으로 감싼다.

/** ADR-0005 §3.4. 웹 provider의 탐침 실패 사유 */
export const ProviderUnavailableReasonSchema: TUnion<
  [
    // 플러그인 키 미등록
    TLiteral<"no-key">,
    // 주소 응답 없음(SearXNG 등)
    TLiteral<"unreachable">,
    // SearXNG format=json 403
    TLiteral<"json-disabled">,
    // Anthropic web_search 400(조직 관리자 차단)
    TLiteral<"org-disabled">,
    // 현재 provider·모델에 hosted 검색 없음
    TLiteral<"unsupported-model">,
  ]
> = Type.Union([
  Type.Literal("no-key"),
  Type.Literal("unreachable"),
  Type.Literal("json-disabled"),
  Type.Literal("org-disabled"),
  Type.Literal("unsupported-model"),
]);
export type ProviderUnavailableReason = Static<typeof ProviderUnavailableReasonSchema>;

export const WebServiceKindSchema: TUnion<
  [TLiteral<"search">, TLiteral<"fetch">, TLiteral<"browse">, TLiteral<"research">]
> = Type.Union([
  Type.Literal("search"),
  Type.Literal("fetch"),
  Type.Literal("browse"),
  Type.Literal("research"),
]);
export type WebServiceKind = Static<typeof WebServiceKindSchema>;

export type PricingTable = {
  asOf: string;
  sourceUrl: string;
  currency: "USD";
  /** 단위 이름 → 단위당 USD. 예: { search: 0.005, page_content: 0.001 } */
  units: Record<string, number>;
  freeAllowance?: {
    period: "month";
    /** 매월 무료 금액(크레딧형) */
    usd?: number;
    /** 매월 무료 단위(횟수형) */
    units?: Record<string, number>;
  };
};
const pricingTableShape = Type.Object({
  asOf: IsoDateSchema,
  sourceUrl: Type.String({ maxLength: 512 }),
  currency: Type.Literal("USD"),
  units: Type.Record(CostUnitNameSchema, Type.Number({ minimum: 0 })),
  freeAllowance: Type.Optional(
    Type.Object({
      period: Type.Literal("month"),
      usd: Type.Optional(Type.Number({ minimum: 0 })),
      units: Type.Optional(Type.Record(CostUnitNameSchema, Type.Number({ minimum: 0 }))),
    }),
  ),
});
export const PricingTableSchema: TUnsafe<PricingTable> = Type.Unsafe<PricingTable>(
  pricingTableShape satisfies SchemaProof<PricingTable, typeof pricingTableShape>,
);

export type WebProviderManifest = {
  /** provider 짧은 이름. 플러그인의 ProviderId는 "plugin:<확장 이름>"이고 이 값은 표시용 */
  name: string;
  displayName: string;
  services: WebServiceKind[];
  /** 이 provider가 요청을 보낼 수 있는 호스트. 사용자 도메인 정책과 별도로 이 목록만 허용한다 */
  endpoints: string[];
  auth: {
    kind: "none" | "header" | "bearer" | "query";
    /** 비밀 설정 키와 주입 위치. 값은 GuardedHttp가 전송 직전에 치환한다 */
    secrets: { setting: string; header?: string; query?: string }[];
    keyless?: { rateNote: string };
  };
  pricing: PricingTable;
  termsFlags: {
    cachePolicy: CacheUsage;
    mayTrainOn: boolean | "unknown";
    redistribution: "no" | "attribution" | "yes" | "unknown";
    reviewedAt?: string;
  };
  privacy: {
    zdr: "none" | "enterprise" | "architectural" | "unknown";
    sendsTelemetry: boolean;
  };
  limits: {
    rps?: number;
    rpm?: number;
    maxResults?: number;
    domainFilter?: { max: number; mixAllowDeny: boolean };
  };
  experimental?: boolean;
};
const webProviderManifestShape = Type.Object({
  name: Type.String({ pattern: "^[a-z][a-z0-9-]{1,47}$" }),
  displayName: Type.String({ minLength: 1, maxLength: 64 }),
  services: Type.Array(WebServiceKindSchema, { minItems: 1, maxItems: 4, uniqueItems: true }),
  endpoints: Type.Array(Type.String({ pattern: "^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$" }), {
    maxItems: 16,
  }),
  auth: Type.Object({
    kind: Type.Union([
      Type.Literal("none"),
      Type.Literal("header"),
      Type.Literal("bearer"),
      Type.Literal("query"),
    ]),
    secrets: Type.Array(
      Type.Object({
        setting: Type.String({ pattern: "^ext\\.[a-z][a-z0-9-]*\\.[a-z][A-Za-z0-9]*$" }),
        header: Type.Optional(Type.String({ maxLength: 64 })),
        query: Type.Optional(Type.String({ maxLength: 64 })),
      }),
      { maxItems: 4 },
    ),
    keyless: Type.Optional(Type.Object({ rateNote: Type.String({ maxLength: 200 }) })),
  }),
  pricing: PricingTableSchema,
  termsFlags: Type.Object({
    cachePolicy: CacheUsageSchema,
    mayTrainOn: Type.Union([Type.Boolean(), Type.Literal("unknown")]),
    redistribution: Type.Union([
      Type.Literal("no"),
      Type.Literal("attribution"),
      Type.Literal("yes"),
      Type.Literal("unknown"),
    ]),
    reviewedAt: Type.Optional(IsoDateSchema),
  }),
  privacy: Type.Object({
    zdr: Type.Union([
      Type.Literal("none"),
      Type.Literal("enterprise"),
      Type.Literal("architectural"),
      Type.Literal("unknown"),
    ]),
    sendsTelemetry: Type.Boolean(),
  }),
  limits: Type.Object({
    rps: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    rpm: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
    domainFilter: Type.Optional(
      Type.Object({ max: Type.Integer({ minimum: 0 }), mixAllowDeny: Type.Boolean() }),
    ),
  }),
  experimental: Type.Optional(Type.Boolean()),
});
export const WebProviderManifestSchema: TUnsafe<WebProviderManifest> =
  Type.Unsafe<WebProviderManifest>(
    webProviderManifestShape satisfies SchemaProof<
      WebProviderManifest,
      typeof webProviderManifestShape
    >,
  );

/** 앞단이 provider에게 주는 HTTP. 정책, SSRF, endpoints, 비밀 치환, 바이트 상한을 거친다 */
export interface GuardedHttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}
export interface GuardedHttpResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}
export interface GuardedHttp {
  request(req: GuardedHttpRequest, signal: AbortSignal): Promise<GuardedHttpResponse>;
}

export interface WebProviderContext {
  readonly http: GuardedHttp;
  readonly clock: Clock;
  /** 자기 확장의 ext.<name>.* 설정 읽기. 비밀 키는 SecretRef 문자열만 보인다 */
  readonly setting: (key: string) => unknown;
}

export interface SearchDirectives {
  readonly site: readonly string[];
  readonly excludeSite: readonly string[];
  /** YYYY-MM-DD */
  readonly after?: string;
  readonly before?: string;
  readonly filetype: readonly string[];
  readonly intitle: readonly string[];
  readonly phrases: readonly string[];
  readonly exclude: readonly string[];
}

/** 정규화한 검색 요청. 쿼리 지시어는 앞단이 이미 풀었다(§4.8.5) */
export interface ProviderSearchRequest {
  readonly terms: string;
  readonly directives: SearchDirectives;
  readonly objective?: string;
  readonly limit: 10 | 20;
  readonly recency?: Recency;
  readonly domains: { readonly allow: readonly string[]; readonly deny: readonly string[] };
  readonly content: ContentMode;
  readonly freshness: Freshness;
}
export interface ProviderSearchItem {
  readonly url: string;
  readonly title?: string;
  readonly publishedAt?: string;
  readonly passages: readonly {
    readonly text: string;
    readonly kind: PassageKind;
    readonly score?: number;
  }[];
}
/** provider가 직접 적용한 필터 차원. 나머지는 앞단이 결과를 다시 거른다 */
export type NativeFilterDimension =
  | "recency"
  | "domains"
  | "site"
  | "filetype"
  | "intitle"
  | "phrase"
  | "exclude"
  | "date";
export interface ProviderSearchResult {
  readonly items: readonly ProviderSearchItem[];
  readonly answer?: {
    readonly text: string;
    readonly citations: readonly { readonly itemIndex: number; readonly citedText?: string }[];
  };
  readonly appliedNatively: readonly NativeFilterDimension[];
  /** reported만. 없으면 앞단이 가격표로 추정 */
  readonly cost?: Cost;
  readonly warnings: readonly string[];
}

export type ProviderAvailabilityWeb =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ProviderUnavailableReason; readonly detail?: string };

export interface WebSearchProvider {
  /** ProviderId */
  readonly id: string;
  readonly manifest: WebProviderManifest;
  isAvailable(signal: AbortSignal): Promise<ProviderAvailabilityWeb>;
  search(request: ProviderSearchRequest, signal: AbortSignal): Promise<ProviderSearchResult>;
}

export interface ProviderFetchRequest {
  readonly url: string;
  readonly format: FetchFormat;
  readonly render: RenderMode;
  readonly maxBytes: number;
}
export interface ProviderFetchResult {
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly markdown: string;
  readonly title?: string;
  readonly publishedAt?: string;
  readonly cost?: Cost;
  readonly warnings: readonly string[];
}
export interface WebFetchProvider {
  readonly id: string;
  readonly manifest: WebProviderManifest;
  isAvailable(signal: AbortSignal): Promise<ProviderAvailabilityWeb>;
  fetch(request: ProviderFetchRequest, signal: AbortSignal): Promise<ProviderFetchResult>;
}

export interface BrowserOpenOptions {
  readonly profile: "ephemeral" | `named:${string}`;
  readonly headless: boolean;
  /**
   * 모든 브라우저 트래픽이 지나는 앞단 필터 프록시(§4.10.2). 프록시를 띄우지 않는 조립(MCP stdio 경로)에서는 없다.
   * 그때 트래픽 필터는 샌드박스 네트워크 필터가 맡고(§10 미결 8) 앞단은 이동 URL만 검사한다
   */
  readonly proxy?: { readonly server: string };
  readonly allowedOrigins: readonly string[];
}
export interface BrowserStep {
  readonly page: BrowsePage;
  readonly code?: string;
  readonly snapshot?: BrowseSnapshot;
  /** 이 동작 중 일어난 최상위 문서 이동. 앞단이 리다이렉트 재검사에 쓴다 */
  readonly navigations: readonly string[];
}
export interface BrowserSessionHandle {
  navigate(url: string, signal: AbortSignal): Promise<BrowserStep>;
  act(action: BrowseActInput, signal: AbortSignal): Promise<BrowserStep>;
  read(request: BrowseReadInput, signal: AbortSignal): Promise<Omit<BrowseReadOutput, "meta">>;
  /** 이 동작이 사람 확인 대상인지 판정할 재료(요소 역할, 이름, 폼 action) */
  describe(
    target: { readonly ref: string },
    signal: AbortSignal,
  ): Promise<{ readonly role: string; readonly name?: string; readonly formAction?: string }>;
  close(): Promise<void>;
}
/** 브라우저 provider. 앞단이 정책, 상한, 확인을 감싼다(§4.10) */
export interface WebBrowseProvider {
  readonly id: string;
  readonly manifest: WebProviderManifest;
  isAvailable(signal: AbortSignal): Promise<ProviderAvailabilityWeb>;
  open(options: BrowserOpenOptions, signal: AbortSignal): Promise<BrowserSessionHandle>;
}

/** 플러그인 엔트리가 X 후보 등록 API에 넘기는 값 */
export type WebProviderRegistration =
  | {
      readonly capability: "web.search";
      readonly create: (ctx: WebProviderContext) => WebSearchProvider;
    }
  | {
      readonly capability: "web.fetch";
      readonly create: (ctx: WebProviderContext) => WebFetchProvider;
    }
  | {
      readonly capability: "web.browse";
      readonly create: (ctx: WebProviderContext) => WebBrowseProvider;
    };

/** 등록이 가리키는 능력 ID. 같은 확장 안에서 능력 ID와 등록의 짝을 검사할 때 쓴다. 순수 함수 */
export function webRegistrationCapability(reg: WebProviderRegistration): CapabilityId {
  return reg.capability;
}
