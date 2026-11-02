import { Type, type TLiteral, type TUnion, type TUnsafe } from "typebox";
import type { SchemaProof, SchemaSound } from "../base/schema-proof.ts";
import { CapabilityIdTypedSchema, type CapabilityId } from "../capabilities/index.ts";
import { RecordKindSchema, type RecordKind } from "./group-record.ts";
import { PluginIdSchema } from "./registration-id.ts";
import { HookNameSchema, type HookName } from "./hooks.ts";

// F.extensions.spec §3.1.2 구성 선언(X-16, L4.desktop-ux.spec §6.28). 플러그인 그룹의 `group.composition`에 두는, 작성자가 선언하는 읽기용 설계 모델이다.
// 런타임에는 블록이 없고 플러그인 선언(hooks, requires, drives, usesPost)과 setup(g) 코드가 실제 동작을 정한다.
// 선언이 없으면 구성기는 "구성 정보 없음" 블록 하나로 보인다. Hook 이름으로 추정하지 않는다.

/** 블록 id와 단계 id */
export const COMPOSITION_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,47}$";

export const COMPOSITION_OPS = ["on", "post", "drive", "record", "register"] as const;
export type CompositionOp = (typeof COMPOSITION_OPS)[number];
export const CompositionOpSchema: TUnion<
  [TLiteral<"on">, TLiteral<"post">, TLiteral<"drive">, TLiteral<"record">, TLiteral<"register">]
> = Type.Union([
  Type.Literal("on"),
  Type.Literal("post"),
  Type.Literal("drive"),
  Type.Literal("record"),
  Type.Literal("register"),
]);

/** 블록이 내는 것: 공개 기록(`grp.<그룹>.*`), 입력 큐 post, 비공개 상태 문서 */
export type CompositionProduct =
  | { readonly kind: "record"; readonly recordKind: RecordKind }
  | { readonly kind: "post" }
  | { readonly kind: "state" };
const CompositionProductUnion = Type.Union([
  Type.Object(
    { kind: Type.Literal("record"), recordKind: RecordKindSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("post") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("state") }, { additionalProperties: false }),
]);
export const CompositionProductSchema: TUnsafe<CompositionProduct> =
  Type.Unsafe<CompositionProduct>(
    CompositionProductUnion satisfies SchemaSound<
      CompositionProduct,
      typeof CompositionProductUnion
    >,
  );

export interface CompositionBlock {
  /** 플러그인 그룹 안에서 유일 */
  readonly id: string;
  /** Stage 이름(역할). 작성자가 붙이는 자유 이름이고 목록은 제작 확장 카탈로그가 정한다 [제안] */
  readonly stage: string;
  readonly op: CompositionOp;
  /** 이 블록이 속한 플러그인 id. 생략하면 루트 플러그인. `hooks`와 `consumes`는 그 플러그인의 선언과 대조한다 */
  readonly plugin?: string;
  readonly title?: string;
  /** 한 줄 요약 */
  readonly summary?: string;
  /** `op: "on"`일 때만, 이 블록이 거는 Hook. 소속 플러그인의 `hooks`의 부분집합이어야 한다 */
  readonly hooks?: readonly HookName[];
  /** 이 블록이 읽는 기능 id. 소속 플러그인의 `requires`·`optional`에 있어야 한다 */
  readonly consumes?: readonly CapabilityId[];
  readonly produces?: readonly CompositionProduct[];
}
const CompositionBlockShape = Type.Object(
  {
    id: Type.String({ pattern: COMPOSITION_ID_PATTERN }),
    stage: Type.String({ pattern: COMPOSITION_ID_PATTERN }),
    op: CompositionOpSchema,
    plugin: Type.Optional(PluginIdSchema),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    summary: Type.Optional(Type.String({ maxLength: 256 })),
    hooks: Type.Optional(Type.Array(HookNameSchema, { maxItems: 64 })),
    consumes: Type.Optional(Type.Array(CapabilityIdTypedSchema, { maxItems: 32 })),
    produces: Type.Optional(Type.Array(CompositionProductSchema, { maxItems: 32 })),
  },
  { additionalProperties: false },
);
export const CompositionBlockSchema: TUnsafe<CompositionBlock> = Type.Unsafe<CompositionBlock>(
  CompositionBlockShape satisfies SchemaProof<CompositionBlock, typeof CompositionBlockShape>,
);

/** 단계 머신 노드 종류. 구성기 흐름 보기의 팔레트와 같다(L4.desktop-ux.spec §6.28.2) */
export const PHASE_NODE_KINDS = [
  "phase",
  "turn",
  "spawn",
  "gather",
  "capability",
  "human",
  "record",
  "end",
] as const;
export type PhaseNodeKind = (typeof PHASE_NODE_KINDS)[number];

export interface PhaseNodeDecl {
  readonly id: string;
  readonly kind: PhaseNodeKind;
  readonly title?: string;
  /** `kind: "human"`일 때 풀리는 drive 원시 `loop.ask`의 카드 제목 키 [제안] */
  readonly askTitle?: string;
}
export interface PhaseTransitionDecl {
  readonly from: string;
  readonly to: string;
  /** 전이를 일으키는 이벤트 이름(설명용) */
  readonly event?: string;
  /** 조건 한 줄(설명용). 평가하지 않는다 */
  readonly when?: string;
}
export interface PhasesDecl {
  /** 시작 노드 id */
  readonly initial: string;
  readonly nodes: readonly PhaseNodeDecl[];
  readonly transitions: readonly PhaseTransitionDecl[];
}
const PhasesDeclShape = Type.Object(
  {
    initial: Type.String({ pattern: COMPOSITION_ID_PATTERN }),
    nodes: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: COMPOSITION_ID_PATTERN }),
          kind: Type.Union(PHASE_NODE_KINDS.map((name) => Type.Literal(name))),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
          askTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
    transitions: Type.Array(
      Type.Object(
        {
          from: Type.String({ pattern: COMPOSITION_ID_PATTERN }),
          to: Type.String({ pattern: COMPOSITION_ID_PATTERN }),
          event: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
          when: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
  },
  { additionalProperties: false },
);
export const PhasesDeclSchema: TUnsafe<PhasesDecl> = Type.Unsafe<PhasesDecl>(
  PhasesDeclShape satisfies SchemaProof<PhasesDecl, typeof PhasesDeclShape>,
);

export interface CompositionDecl {
  readonly blocks: readonly CompositionBlock[];
  /** 선택. drive 블록의 단계 머신 */
  readonly phases?: PhasesDecl;
}
const CompositionDeclShape = Type.Object(
  {
    blocks: Type.Array(CompositionBlockSchema, { minItems: 1, maxItems: 64 }),
    phases: Type.Optional(PhasesDeclSchema),
  },
  { additionalProperties: false },
);
export const CompositionDeclSchema: TUnsafe<CompositionDecl> = Type.Unsafe<CompositionDecl>(
  CompositionDeclShape satisfies SchemaProof<CompositionDecl, typeof CompositionDeclShape>,
);
