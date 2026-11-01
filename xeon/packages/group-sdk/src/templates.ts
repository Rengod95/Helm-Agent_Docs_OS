import {
  Type,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";

// 그룹 템플릿 색인(L3.slots.spec §3.3.3). 생성 명령(L4)이 JSON으로 읽는 데이터 형식이라 코드 import 없이 쓴다.

/** 템플릿 종류. drive는 구동 그룹, policy는 도구 호출 정책, observe는 관찰·기록 그룹 */
export type TemplateKind = "drive" | "policy" | "observe";

export const TemplateKindSchema: TUnion<
  [TLiteral<"drive">, TLiteral<"policy">, TLiteral<"observe">]
> = Type.Union([Type.Literal("drive"), Type.Literal("policy"), Type.Literal("observe")]);

/** 치환 자리. 파일 내용과 파일 경로 모두에 적용한다. 그 밖의 템플릿 문법은 없다 */
export const TEMPLATE_PLACEHOLDERS: readonly ["__ID__", "__TITLE__", "__VERSION__"] = [
  "__ID__",
  "__TITLE__",
  "__VERSION__",
];

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export interface TemplateEntry {
  readonly description: string;
  /** templates/ 기준 상대 경로. 공통 파일은 "common/…" */
  readonly files: readonly string[];
  readonly usesDrive: boolean;
}

export interface TemplateIndex {
  readonly schemaVersion: 1;
  readonly templates: { readonly [K in TemplateKind]: TemplateEntry };
}

const TemplateEntrySchema: TObject<{
  description: TString;
  files: TArray<TString>;
  usesDrive: TBoolean;
}> = Type.Object(
  {
    description: Type.String({ maxLength: 200 }),
    files: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    usesDrive: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** TemplateIndex와 같은 모양. 정적 타입과의 일치는 시험의 대입 검사로 확인한다(isolatedDeclarations 때문에 Static 유도 대신 짝으로 쓴다) */
export const TemplateIndexSchema: TObject<{
  schemaVersion: TLiteral<1>;
  templates: TObject<{
    drive: typeof TemplateEntrySchema;
    policy: typeof TemplateEntrySchema;
    observe: typeof TemplateEntrySchema;
  }>;
}> = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    templates: Type.Object(
      {
        drive: TemplateEntrySchema,
        policy: TemplateEntrySchema,
        observe: TemplateEntrySchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
