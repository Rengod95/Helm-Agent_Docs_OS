// 용어 원본의 타입과 읽기(ADR-0022 §3.1 4번, §3.6, i18n-term-lint 설계 §4). 내용은 `terms.json`이고 사람이 고치는 유일한 곳이다.
// 한국어 문장은 코드가 아니라 데이터에 둔다(`xeon/hardcoded-korean`은 JSON 카탈로그를 스캔하지 않는다).
// 파생물은 `just terms gen`이 만든다: 카탈로그 `term.*` 키(locales/ko.json, en.json)와 선택적으로 목업 용어 파일.
// 검사는 `just terms check`(T-01~T-05 원본 검사, C-01·02·03·06 카탈로그 검사, M-01 목업 파생물).
// 지금은 0단계라 옛 이름 금지(`forbid`)는 적어 두기만 하고 아무것도 막지 않는다. 화면 라벨은 사용자가 검토 중이라 모두 `proposed`다.
import { parse, type ParseError, type Result } from "@fresnel/contracts";
import { Type } from "typebox";
import raw from "./terms.json";

const LocalizedSchema = Type.Object({ ko: Type.String(), en: Type.String() });
const StringsSchema = Type.Array(Type.String());

const TermDeclSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("concept"),
    Type.Literal("layer"),
    Type.Literal("operation"),
    Type.Literal("state"),
    Type.Literal("surface"),
    Type.Literal("product"),
  ]),
  /** 문서·용어집이 쓰는 이름 */
  doc: LocalizedSchema,
  /** 화면 라벨. null이면 화면에 쓰지 않는다(surfaces는 ["none"]) */
  ui: Type.Union([LocalizedSchema, Type.Null()]),
  /** 도움말 한 줄. 아직 정하지 않은 항목은 생략한다 */
  help: Type.Optional(LocalizedSchema),
  surfaces: Type.Array(
    Type.Union([
      Type.Literal("chat"),
      Type.Literal("workbench"),
      Type.Literal("settings"),
      Type.Literal("none"),
    ]),
  ),
  /** 화면에 mono로 함께 보일 수 있는 기계 이름(코드·wire·설정 id) */
  ids: Type.Optional(StringsSchema),
  /** 금지 별칭. 0단계에서는 적어 두기만 한다 */
  forbid: Type.Optional(
    Type.Object({ ui: Type.Optional(StringsSchema), docs: Type.Optional(StringsSchema) }),
  ),
  /** 같은 화면 라벨을 일부러 나눠 쓰는 다른 개념의 키. 양쪽이 서로를 적어야 T-01을 통과한다 */
  sharesLabelWith: Type.Optional(StringsSchema),
  /** 근거 문서 id(`docs-route` 색인에 있어야 한다) */
  sources: StringsSchema,
  status: Type.Union([Type.Literal("proposed"), Type.Literal("decided")]),
});

interface Localized {
  readonly ko: string;
  readonly en: string;
}

export interface TermDecl {
  readonly kind: "concept" | "layer" | "operation" | "state" | "surface" | "product";
  readonly doc: Localized;
  readonly ui: Localized | null;
  readonly help?: Localized;
  readonly surfaces: readonly ("chat" | "workbench" | "settings" | "none")[];
  readonly ids?: readonly string[];
  readonly forbid?: { readonly ui?: readonly string[]; readonly docs?: readonly string[] };
  readonly sharesLabelWith?: readonly string[];
  readonly sources: readonly string[];
  readonly status: "proposed" | "decided";
}

const TermsSchema = Type.Record(Type.String(), TermDeclSchema);

/** 원본 데이터를 검사해 읽는다. 모양이 맞지 않으면 parse 오류를 돌려준다 */
export function loadTerms(data: unknown): Result<Readonly<Record<string, TermDecl>>, ParseError> {
  return parse(TermsSchema, data);
}

/** 시험에서 작은 원본을 만들 때 쓴다. 검사는 하지 않는다 */
export function defineTerms(
  terms: Readonly<Record<string, TermDecl>>,
): Readonly<Record<string, TermDecl>> {
  return terms;
}

/** 이 패키지가 싣는 원본(`terms.json`)을 검사해 읽는다 */
export function loadShippedTerms(): Result<Readonly<Record<string, TermDecl>>, ParseError> {
  return loadTerms(raw);
}
