import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../base/schema-proof.ts";

// F.extensions.spec §3.1.1 확장 메서드 선언(ADR-0021 §3.4.2). 확장 수준 `methods`의 원소이고 Plugin UI와 따로 쓸 수 있다.

/** 확장 메서드 동사. wire 메서드 이름 `ext.<확장id>.<동사>`의 마지막 마디와 같은 문법이다(METHOD_NAME_PATTERN) */
export const EXT_VERB_PATTERN: string = "^[a-z][A-Za-z0-9]{0,47}$";

/** 메서드 라벨 길이 상한(글자 수) */
export const EXT_LABEL_MAX: number = 48;

/** JSON Schema 문서. 모양 검사는 하지 않고 크기만 제한한다(스키마 컴파일은 X) */
const JsonSchemaDocSchema = Type.Record(Type.String(), Type.Unknown());

export interface ExtMethodDecl {
  /** wire 메서드 `ext.<확장이름>.<verb>` */
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  /** 참이면 사용자 조작 없이 부를 수 있다 */
  readonly readOnly: boolean;
  /** 참이면 호출 전에 표준 승인 카드를 거친다. readOnly와 함께 참일 수 없다 */
  readonly approval?: boolean;
  /** 프레임 `call` 확인 줄이 동사 대신 보이는 글(1~48자). 확장이 쓴 글이라 셸이 제어·방향 제어 글자를 지우고 보인다 */
  readonly label?: string;
  /**
   * 참이면 이 쓰기 메서드는 이 플러그인의 자기 데이터(상태, 기록, 자기 저장소)만 바꾼다고 플러그인이 밝힌 것이다. 화면이 부를 때 확인 줄 없이 실행되고,
   * 이 표시는 검토 카드에 실려 사람이 승인 전에 본다. 엔진은 이 메서드가 다른 확장이나 대화에 닿는 길(post, 기능 호출, 포트, 효과 요청, 주도 시작)을 쓰면 거부한다.
   * `readOnly`나 `approval`과 함께 참일 수 없다. 표시가 없는 쓰기는 지금처럼 매번 확인한다 [결정: 2026-11-23 사용자, AGE-78 질문 5]
   */
  readonly ownDataOnly?: boolean;
}
const ExtMethodDeclShape = Type.Object(
  {
    verb: Type.String({ pattern: EXT_VERB_PATTERN }),
    params: JsonSchemaDocSchema,
    result: JsonSchemaDocSchema,
    readOnly: Type.Boolean(),
    approval: Type.Optional(Type.Boolean()),
    label: Type.Optional(Type.String({ minLength: 1, maxLength: EXT_LABEL_MAX })),
    ownDataOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const ExtMethodDeclSchema: TUnsafe<ExtMethodDecl> = Type.Unsafe<ExtMethodDecl>(
  ExtMethodDeclShape satisfies SchemaProof<ExtMethodDecl, typeof ExtMethodDeclShape>,
);
