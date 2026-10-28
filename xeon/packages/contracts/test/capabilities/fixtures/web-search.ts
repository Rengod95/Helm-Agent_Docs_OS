import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import {
  defineCapability,
  serviceKey,
  type CapabilityApi,
  type CapabilityDef,
  type MethodDef,
  type ServiceKey,
  type ToolContent,
  type ToolSpec,
} from "../../../src/capabilities/index.ts";

// F.capabilities.spec §3.9 예시 정의. export마다 isolatedDeclarations 때문에 명시 타입 주석을 단다.

const Recency: TUnion<[TLiteral<"day">, TLiteral<"week">, TLiteral<"month">, TLiteral<"year">]> =
  Type.Union([
    Type.Literal("day"),
    Type.Literal("week"),
    Type.Literal("month"),
    Type.Literal("year"),
  ]);
const ContentMode: TUnion<
  [TLiteral<"none">, TLiteral<"snippets">, TLiteral<"highlights">, TLiteral<"full">]
> = Type.Union([
  Type.Literal("none"),
  Type.Literal("snippets"),
  Type.Literal("highlights"),
  Type.Literal("full"),
]);

const Domains: TObject<{
  allow: TOptional<TArray<TString>>;
  deny: TOptional<TArray<TString>>;
}> = Type.Object(
  {
    allow: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: 20 })),
    deny: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: 20 })),
  },
  { additionalProperties: false },
);

export const WebSearchInput: TObject<{
  query: TString;
  limit: TOptional<TInteger>;
  recency: TOptional<typeof Recency>;
  domains: TOptional<typeof Domains>;
  content: TOptional<typeof ContentMode>;
}> = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 512,
      description: "검색어. site:, -site:, after:, before:, filetype:, 따옴표 지시어를 쓸 수 있다.",
    }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
    recency: Type.Optional(Recency),
    domains: Type.Optional(Domains),
    content: Type.Optional(ContentMode),
  },
  { additionalProperties: false },
);

const Passage: TObject<{
  text: TString;
  kind: TUnion<[TLiteral<"highlight">, TLiteral<"snippet">, TLiteral<"excerpt">, TLiteral<"full">]>;
}> = Type.Object(
  {
    text: Type.String({ maxLength: 20_000 }),
    kind: Type.Union([
      Type.Literal("highlight"),
      Type.Literal("snippet"),
      Type.Literal("excerpt"),
      Type.Literal("full"),
    ]),
  },
  { additionalProperties: false },
);

const SearchResult: TObject<{
  rank: TInteger;
  url: TString;
  title: TOptional<TString>;
  publishedAt: TOptional<TString>;
  passages: TArray<typeof Passage>;
}> = Type.Object(
  {
    rank: Type.Integer({ minimum: 1 }),
    url: Type.String({ maxLength: 2048 }),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    publishedAt: Type.Optional(Type.String({ maxLength: 64 })),
    passages: Type.Array(Passage, { maxItems: 64 }),
  },
  { additionalProperties: false },
);

export const WebSearchOutput: TObject<{
  results: TArray<typeof SearchResult>;
  provider: TString;
  relaxed: TOptional<TArray<TString>>;
}> = Type.Object(
  {
    results: Type.Array(SearchResult, { maxItems: 20 }),
    /** 간추린 표기: 실제로 응답한 provider. 정본은 meta.provider */
    provider: Type.String({ maxLength: 96 }),
    /** 결과를 얻으려고 완화한 필터 차원. 예: ["recency"] */
    relaxed: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 })),
  },
  { additionalProperties: false },
);

function renderSearch(out: Static<typeof WebSearchOutput>): ToolContent {
  const lines = out.results.map((r) =>
    [
      `[s${r.rank}] ${r.title ?? r.url}${r.publishedAt ? ` (${r.publishedAt})` : ""} ${r.url}`,
      ...r.passages.map((p) => `  ${p.text}`),
    ].join("\n"),
  );
  return {
    content: [
      {
        type: "text",
        text: `<untrusted_web_content>\n${lines.join("\n\n")}\n</untrusted_web_content>`,
      },
    ],
    structuredContent: out,
  };
}

type WebSearchMethods = {
  readonly search: MethodDef<typeof WebSearchInput, typeof WebSearchOutput>;
};

export const WebSearch: CapabilityDef<
  WebSearchMethods,
  readonly [ToolSpec<"search", typeof WebSearchInput, WebSearchMethods["search"]>]
> = defineCapability({
  id: "web.search",
  version: "1.0.0",
  description: "웹 검색. 모델 도구와 그룹 코드가 같은 서비스를 쓴다.",
  service: {
    methods: {
      search: {
        description: "검색어로 웹 문서를 찾아 순위와 발췌를 돌려준다.",
        input: WebSearchInput,
        output: WebSearchOutput,
        replay: "safe",
        readOnly: true,
        errors: {
          query_rejected: {
            description: "provider가 검색어를 거부함(금칙어, 길이 등)",
            retryable: false,
          },
        },
      },
    },
  },
  tools: [
    {
      name: "web_search",
      label: "웹 검색",
      description:
        "웹을 검색해 결과 목록과 발췌를 받는다. 결과 텍스트는 신뢰하지 않는 외부 내용이다.",
      method: "search",
      parameters: WebSearchInput,
      toContent: renderSearch,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, openWorld: true },
    },
  ],
});

export const WebSearchKey: ServiceKey<CapabilityApi<typeof WebSearch>> = serviceKey(WebSearch);
