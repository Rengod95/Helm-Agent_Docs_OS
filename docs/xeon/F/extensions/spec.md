---
id: F.extensions.spec
layer: F
domain: extensions
kind: spec
status: draft
depends_on: [F.conversation.spec, F.records.spec, F.capabilities.spec, eng.context-map.design]
binds: [xeon/packages/contracts/src/extensions/**]
---

# F 확장 계약 (extensions)

서브패스: `@xeon/contracts/extensions`

라우팅 표(`_routing/routes.yaml` `by_task.extension`)가 이 문서를 확장 작업의 필수 문서로 지정한다. L1, X, L3 문서는 지점 이름, fold, 페이로드 타입, 매니페스트 필드를 이 문서에서 인용한다.

## 1. 목적과 범위

확장 계약을 정한다. 확장의 로딩, 신뢰, 실행은 X의 몫이고, F는 그 사이에서 공유되는 선언과 타입만 둔다.

근거:

- [결정] 확장 지점은 on(fold tap/first/chain), post, drive(배타 임대), scope 4연산이다(`_research/decisions-log.md` 20행, 2026-10-21 계획 v2).
- 계획 v2 본문의 확장 지점 절과 층 사이 규칙(`_research/layer-plan-v2-notes.md`).
- 안 1과 안 3 결합안(`_research/ext-points.md` §5 안 1, §6).
- pi 이벤트 41종 대조(`_research/notes/F-1.md`).
- L1의 확장 지점 선언(지점 이름, fold, 페이로드 타입)은 F4에 두고 L1과 X가 공유한다(`_research/foundation-plan.md` §3 층 순위와 의존 방향).

정하는 것:

- `ExtensionManifest` TypeBox 스키마와 정적 검사 `validateManifest`, `validateUsage`, `validateManifestSet`
- 4연산의 타입: `on`, `post`, `drive`, `scope`, 그리고 `LoopHandle`, `DriveLease`, `ScopeDef`, `ScopeApi`
- 지점 선언 표 전체(pi 이벤트 41종)와 `POINTS` 상수, `PointDecl` 타입
- fold별 실패 규칙과 재생 계약
- 그룹 간 레코드 `GroupRecord`, 확장 레코드 종류 등록 `RecordKindDecl`, 접두 규칙
- X가 쓰는 호스트 포트 타입(`ports.ts`, §3.2.1)

다루지 않는 것:

- 확장 로딩, 신뢰 판정, 프로세스 격리, 매니페스트 파일 탐색: `X.loading-trust.spec`
- on/post/drive/scope의 동작 구현(디스패치, 임대 중재, 토글 적용): `X.primitives.spec`
- 운영 규칙(안전 모드, 시작 시 끄기, 핸들러 시간 예산, 실행 순서 tier): `X.operations.spec`(`X.readme` §2 소유 경계)
- 각 지점을 실제로 발화하는 코드: `L1.loop.spec`, `L1.tools.spec`, `L1.context.spec`, `L1.models.spec`, `L1.persistence.spec`
- 도구·명령·provider 등록(리소스 등록). pi API 형태를 따르며 X가 정한다(`_research/layer-plan-v2-notes.md` 확장 지점 절)

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 확장 (extension) | 매니페스트 하나와 엔트리 모듈 하나로 이루어진 설치 단위. 종류는 plugin과 group 둘 |
| 플러그인 (plugin) | 능력 provider, 도구, 관찰·형성 핸들러를 제공하는 확장. `drive`를 쓰지 않는다 |
| 그룹 (group) | L3 의도 그룹. 여러 지점, 입력 주입, 구동을 한 단위로 묶어 켜고 끈다. Helm과 학습 그룹은 L3 기본 그룹이다 |
| 지점 (point) | 확장이 `on`으로 핸들러를 거는 이름 붙은 위치. 이름은 pi 이벤트명을 그대로 쓴다 |
| 지점 종류 (kind) | `input`, `request`, `tool`, `boundary`, `session` 다섯 가지 |
| fold | 한 지점에 걸린 여러 핸들러의 결과를 합치는 규칙. `tap`, `first`, `chain` 세 가지. 지점 선언이 정하고 확장은 고르지 않는다 |
| 페이로드 (payload) | 지점이 핸들러에 넘기는 읽기 전용 값 |
| 결정 (decision) | `first` 지점에서 핸들러가 돌려주는 값 |
| 현재값 (value), 패치 (patch) | `chain` 지점에서 핸들러가 받는 누적 값과 돌려주는 변경 |
| scope | 한 확장의 등록 묶음. 상태 문서, 정리 동작, 켜기·끄기 상태를 가진다 |
| drive 임대 (lease) | 루프를 구동할 배타 권한. 한 번에 그룹 하나만 가진다 |
| 그룹 레코드 | 그룹이 다른 그룹에게 공개하는 내구 레코드. F에 스키마가 있는 형식으로만 쓴다 |

턴과 step [제안]:

- pi의 `turn_start`, `turn_end`는 모델 요청 한 번과 그 도구 라운드 단위로 발화한다. Xeon 용어로 이 단위는 step이다. 그래서 pi `turn_*` 지점은 Xeon의 step 경계에서 발화한다.
- Xeon의 turn은 입력 하나가 들어와 정착(settle)할 때까지다. pi의 `agent_start`, `agent_end`, `agent_before_settle`, `agent_settled`가 Xeon turn 경계에서 발화한다.
- 이 대응은 F.conversation.spec §2 용어표(thread, turn, step, item)와 §2.1을 따른다. pi의 세션(session)은 Xeon의 thread다.

다른 F 도메인에서 가져오는 이름:

- F.conversation.spec: `ThreadId`, `TurnId`, `StepId`, `ItemId`(§3.2), `AgentMessage`, `Message`, `ToolResultMessage`, `TextContent`, `ImageContent`, `JsonValue`, `Usage`(§3.1 pi-ai 재노출, `AgentMessage`는 §3.1.1 F 정의).
- F.records.spec: `EventKind`, `ExtensionEventKind`, `EXTENSION_KIND_PATTERN`(§3.2), `EventEnvelope`, `DurableEventDraft`(§3.1).
- 멱등 키 `requestId`는 브랜드 없는 문자열(1~64자)이다 [제안]. F.conversation.spec의 `TurnStartedPayload.requestId`, `ItemRecord(kind: "user").requestId`와 같은 뜻이고 `RequestId` 타입 이름은 두지 않는다(F.capabilities.spec §2, F.wire-settings.spec §3.0과 같다).

## 3. 인터페이스

### 3.1 매니페스트 (`manifest.ts`)

Claude Code `plugin.json`의 레이아웃과 메타 필드를 따르고 Xeon 필드를 더한다(`_research/ref-synthesis.md` F 계약 표 확장 매니페스트 행, `_research/refs/claude-code.md` 96-99행).

```ts
import { Type, type Static, type TSchema } from "typebox";
import { CapabilityIdSchema, SemVerSchema, SemVerRangeSchema } from "../capabilities/index.ts";
import { PointNameSchema } from "./points.ts";                                          // §3.3
import { RecordKindDeclJsonSchema, RECORD_KIND_READ_PATTERN } from "./group-record.ts";   // §3.6

/** [결정: review.decisions-2 U-18] 소문자·숫자·하이픈 2~32자. 밑줄은 쓰지 않는다.
 *  확장 테이블 접두는 "x_<이름의 하이픈을 밑줄로>_"이고 지역 테이블 이름에는 밑줄을 쓰지 않는다 */
export const EXTENSION_NAME_PATTERN = "^[a-z][a-z0-9-]{1,31}$";
export const ExtensionNameSchema = Type.String({ pattern: EXTENSION_NAME_PATTERN });
export type ExtensionName = string;

export const ExtensionLayerSchema = Type.Union([
  Type.Literal("L1"), Type.Literal("L2"), Type.Literal("L3"), Type.Literal("plugin"),
]);
export const ExtensionKindSchema = Type.Union([Type.Literal("plugin"), Type.Literal("group")]);

export const CapabilityRequirementSchema = Type.Object({
  id: CapabilityIdSchema,
  range: SemVerRangeSchema,
});
export const CapabilityProvisionSchema = Type.Object({
  id: CapabilityIdSchema,
  version: SemVerSchema,
});

/** [가정] 등급 이름은 X.loading-trust.spec이 확정한다 */
export const TrustRequestSchema = Type.Object({
  level: Type.Union([
    Type.Literal("builtin"), Type.Literal("user"), Type.Literal("project"), Type.Literal("untrusted"),
  ]),
  reason: Type.Optional(Type.String({ maxLength: 512 })),
});

/** 사용자 설정 항목. 값의 스키마와 저장 위치는 F.wire-settings.spec의 설정 키가 정한다 */
export const UserConfigEntrySchema = Type.Object({
  /** F.wire-settings.spec 설정 키. 형식 "ext.<name>.<key>"(F.wire-settings.spec §3.8.1, §3.8.3) */
  setting: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 64 }),
  description: Type.Optional(Type.String()),
  /** 참이면 값은 비밀 참조(secret://)로만 저장한다(L0.secrets.spec) */
  sensitive: Type.Optional(Type.Boolean()),
  required: Type.Optional(Type.Boolean()),
});

export const ExtensionManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  // Claude Code plugin.json 메타 필드
  name: ExtensionNameSchema,
  version: SemVerSchema,
  displayName: Type.Optional(Type.String({ maxLength: 64 })),
  description: Type.Optional(Type.String({ maxLength: 1024 })),
  author: Type.Optional(Type.Object({
    name: Type.String(), email: Type.Optional(Type.String()), url: Type.Optional(Type.String()),
  })),
  homepage: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
  license: Type.Optional(Type.String()),
  keywords: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
  defaultEnabled: Type.Optional(Type.Boolean()),
  /** Claude Code 구성요소 경로. 해석은 X */
  components: Type.Optional(Type.Object({
    skills: Type.Optional(Type.Array(Type.String())),
    commands: Type.Optional(Type.Array(Type.String())),
    agents: Type.Optional(Type.Array(Type.String())),
    mcpServers: Type.Optional(Type.String()),
  })),
  userConfig: Type.Optional(Type.Record(Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$" }), UserConfigEntrySchema)),
  // Xeon 필드
  layer: ExtensionLayerSchema,
  kind: ExtensionKindSchema,
  /** 확장 루트 기준 상대 경로. 예: "./src/index.ts" */
  entry: Type.String({ minLength: 1 }),
  requires: Type.Optional(Type.Array(CapabilityRequirementSchema)),
  optional: Type.Optional(Type.Array(CapabilityRequirementSchema)),
  provides: Type.Optional(Type.Array(CapabilityProvisionSchema)),
  /** on을 거는 지점 목록. 정적 선언. 빈 배열 허용 */
  points: Type.Array(PointNameSchema),
  usesPost: Type.Optional(Type.Boolean()),
  usesDrive: Type.Boolean(),
  /** 이 확장이 쓰는 레코드 종류 */
  recordKinds: Type.Optional(Type.Array(RecordKindDeclJsonSchema)),
  /** 이 확장이 읽는 다른 그룹의 레코드 종류. 끝의 ".*"는 접두 일치 */
  readsRecordKinds: Type.Optional(Type.Array(Type.String({ pattern: RECORD_KIND_READ_PATTERN }))),
  isolation: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("process")])),
  trust: Type.Optional(TrustRequestSchema),
});
export type ExtensionManifest = Static<typeof ExtensionManifestSchema>;

/** 항등 함수. TS 모듈로 매니페스트를 쓰는 내장 패키지용 */
export function defineManifest<const M extends ExtensionManifest>(manifest: M): M;
```

- 파일 위치 [제안]: 외부 확장은 `.xeon-plugin/plugin.json`에 둔다(Claude Code `.claude-plugin/plugin.json` 레이아웃). 내장 패키지(`core-*`, `cap-*`, `group-*`)는 엔트리 모듈이 `manifest` 상수를 export하고 X가 같은 스키마로 검사한다. 탐색 규칙은 X.loading-trust.spec이 정한다.
- 알 수 없는 최상위 키는 지우고 경고한다. `userConfig` 항목과 `components` 안의 알 수 없는 키는 오류다(Claude Code 규칙, `_research/refs/claude-code.md` 99행).
- Claude Code의 `dependencies`(확장 사이 직접 의존)는 채택하지 않는다 [제안]. 그룹끼리 직접 참조하지 않는다는 층 사이 규칙 3 때문이다. 확장 사이 의존은 능력 요구(`requires`, `optional`)와 레코드 종류(`readsRecordKinds`)로만 표현한다.
- `layer`의 `plugin`은 층 패키지가 아닌 외부 플러그인을 뜻한다. 외부 플러그인은 L2 능력 provider, 관찰·형성 핸들러, 도구 등록을 할 수 있다.
- `CapabilityIdSchema`, `SemVerSchema`, `SemVerRangeSchema`는 F.capabilities.spec §3.1을 그대로 import한다. 두 문서의 능력 ID 형식은 같다.

### 3.2 4연산 타입 (`ops.ts`, `drive.ts`, `scope.ts`)

타입만 정한다. 구현은 X.primitives.spec이다.

```ts
// ops.ts
import type { ServiceKey } from "../capabilities/index.ts";

export type Unsubscribe = () => void;

export interface HandlerContext<S> {
  readonly scopeId: ScopeId;
  /** 디스패치 시작 시점에 마지막으로 커밋된 scope 상태 */
  readonly state: Readonly<S>;
  readonly threadId: ThreadId;
  readonly signal: AbortSignal;
}

/** fold에 따라 핸들러 시그니처가 좁혀진다 */
export type Handler<N extends PointName, S = unknown> =
  PointSignatures[N] extends TapSig<infer P>
    ? (payload: Readonly<P>, ctx: HandlerContext<S>) => void | Promise<void>
  : PointSignatures[N] extends FirstSig<infer P, infer D>
    ? (payload: Readonly<P>, ctx: HandlerContext<S>) => D | undefined | Promise<D | undefined>
  : PointSignatures[N] extends ChainSig<infer P, infer V, infer X>
    ? (payload: Readonly<P>, current: Readonly<V>, ctx: HandlerContext<S>) => X | undefined | Promise<X | undefined>
  : never;

export type PostWhen = "steer" | "followUp" | "next";

export type PostContent = string | readonly (TextContent | ImageContent)[];

export type PostItem =
  /** 사용자 메시지로 들어간다 */
  | { readonly kind: "user"; readonly content: PostContent }
  /** 확장 메시지. 모델 컨텍스트에 들어가고 display가 참이면 UI에도 보인다 */
  | {
      readonly kind: "context";
      readonly customType: RecordKind;   // XeonCustomMessage.customType(F.conversation.spec §3.5.2)
      readonly content: PostContent;
      readonly display: boolean;
      readonly details?: JsonValue;
    };

export interface PostOptions {
  readonly when: PostWhen;
  /** 대화 범위 멱등 키(1~64자). 같은 키의 두 번째 post는 큐에 넣지 않는다 */
  readonly requestId: string;
}

export interface PostReceipt {
  readonly requestId: string;
  /** 같은 requestId가 이미 있어 아무것도 넣지 않았으면 참 */
  readonly duplicate: boolean;
}

export interface ExtensionOps<S> {
  on<N extends PointName>(point: N, handler: Handler<N, S>): Unsubscribe;
  post(item: PostItem, options: PostOptions): Promise<PostReceipt>;
  /** 그룹만 쓴다. 등록만 하고 임대는 X가 중재한다 */
  drive(fn: DriveFn<S>, options?: DriveOptions): void;
}
```

```ts
// drive.ts
export interface DriveLimits {
  readonly maxTurns?: number;
  readonly maxSpawns?: number;
  readonly maxTokens?: number;
}

export interface DriveOptions {
  /** 그룹이 요청하는 상한. 없는 필드는 X 기본값 x.primitives.driveDefaultLimits를 쓰고, 천장 x.primitives.driveLimits보다 클 수 없다(§6) */
  readonly limits?: DriveLimits;
}

/** 남은 예산. null은 상한 없음 */
export interface LeaseBudget {
  readonly turns: number | null;
  readonly spawns: number | null;
  readonly tokens: number | null;
}

export interface TurnInput {
  readonly input: PostItem;
  /** 생략하면 X가 `${leaseId}:${순번}`으로 결정적으로 만든다 */
  readonly requestId?: string;
}

export interface TurnOutcome {
  readonly turnId: TurnId;
  readonly status: "completed" | "aborted" | "error";
  /** 마지막 어시스턴트 아이템 */
  readonly finalItemId?: ItemId;
}

export interface SpawnSpec {
  /** 서브에이전트 정의 이름(L1.agents.spec) */
  readonly agent: string;
  readonly task: string;
  readonly requestId?: string;
  readonly background?: boolean;
}

export interface SpawnOutcome {
  readonly childThreadId: ThreadId;
  readonly status: "completed" | "aborted" | "error";
  readonly answer?: string;
}

/** drive 함수가 루프에 효과를 내는 유일한 통로(post와 scope commit 제외) */
export interface LoopHandle {
  turn(input: TurnInput): Promise<TurnOutcome>;
  spawn(spec: SpawnSpec): Promise<SpawnOutcome>;
  readonly budget: LeaseBudget;
  /** 임대가 회수되면 중단 신호가 켜진다 */
  readonly signal: AbortSignal;
}

/** 경계마다 마지막 커밋 상태로 다시 호출된다(§4.6) */
export type DriveFn<S> = (loop: LoopHandle, state: Readonly<S>) => Promise<void>;

export type LeaseId = string;

export interface DriveLease {
  readonly leaseId: LeaseId;
  readonly scopeId: ScopeId;
  readonly limits: DriveLimits;
  readonly status: "active" | "releasing" | "released";
}
```

```ts
// scope.ts
/** 확장 이름, 또는 "<확장 이름>/<하위 이름>" */
export type ScopeId = string;
export const SCOPE_ID_PATTERN = "^[a-z][a-z0-9-]{1,31}(/[a-z][a-z0-9-]{0,31})?$";

export interface StateDecl<S> {
  readonly schema: TSchema;
  readonly initial: S;
  /** 상태 문서 스키마 버전. 올리면 X가 마이그레이션 훅을 요구한다 */
  readonly version: number;
}

export interface ScopeDef<S> {
  readonly state?: StateDecl<S>;
  readonly defaultEnabled?: boolean;
}

export interface RecordQuery {
  readonly kind: RecordKind | `${string}.*`;
  readonly subject?: RecordSubject;
  readonly limit?: number;
}

export interface ScopeApi<S> extends ExtensionOps<S> {
  readonly id: ScopeId;
  state(): Readonly<S>;
  /** 상태 문서를 교체 커밋한다. 커밋된 값을 돌려준다 */
  commit(next: S): Promise<Readonly<S>>;
  /** 그룹 레코드를 쓴다. kind는 매니페스트 recordKinds에 있어야 한다 */
  record(kind: RecordKind, subject: RecordSubject, payload: JsonValue): Promise<void>;
  /** 다른 그룹 레코드를 읽는다. kind는 매니페스트 readsRecordKinds에 있어야 한다 */
  readRecords(query: RecordQuery): Promise<readonly GroupRecord[]>;
  /** 비공개 기록. kind는 자기 접두(그룹 grp.<name>.*, 플러그인 x.<name>.*)만 받는다.
   *  다른 확장의 readRecords로 조회되지 않는다. 의미와 멱등 키 규칙은 X.primitives.spec이 정한다
   *  [결정: review.decisions-2 T-21] */
  recordPrivate(kind: RecordKind, payload: JsonValue): Promise<void>;
  /** 능력 서비스 API. key의 능력은 매니페스트 requires나 optional에 있어야 한다 */
  capability<Api>(key: ServiceKey<Api>): Api;
  /** 비활성화나 언로드 때 실행할 정리 동작 */
  onDispose(fn: () => void | Promise<void>): void;
}

/** setup이 시작할 수 없다고 알리는 값. 디렉터리 준비나 저장소 열기 같은 예상 가능한 시작 실패다(eng.typescript.guide TY-24) */
export interface SetupRefusal {
  /** 짧은 이유 이름. 예: 그 모듈 시작 오류의 kind */
  readonly reason: string;
  readonly cause: unknown;
}

/** setup은 시작할 수 없으면 err(SetupRefusal)을 돌려준다. X는 이 값을 던져 fiber를 닫고 setup 실패(failure.code scope_setup_failed)로 기록한다 */
export type ScopeSetupResult = void | Result<void, SetupRefusal>;

export type ScopeSetup<S> = (g: ScopeApi<S>) => ScopeSetupResult | Promise<ScopeSetupResult>;

export type ScopeStatus = "enabled" | "enabling" | "disabled" | "disabling";

export interface ScopeHandle {
  readonly id: ScopeId;
  readonly status: ScopeStatus;
  /** 요청만 기록한다. 적용은 다음 경계(§4.5) */
  enable(): void;
  disable(): void;
}

export type ScopeFn = <S>(id: ScopeId, def: ScopeDef<S>, setup: ScopeSetup<S>) => ScopeHandle;

/** 확장 엔트리 모듈의 default export 형식 [제안] */
export type ExtensionEntry = (host: {
  readonly manifest: ExtensionManifest;
  readonly scope: ScopeFn;
}) => void | Promise<void>;
```

#### 3.2.1 부가 API와 호스트 포트 (`ports.ts`)

[제안] `ScopeApi`는 4연산과 상태·레코드·능력 조회만 둔다. 능력 공급자 등록(`provide`), 포트 제공·조회, 리소스 등록(도구, 명령, provider, MCP 서버 등), 상태 마이그레이션은 X의 공식 부가 API `hostOf(g)`(`X.primitives.spec` §3.8 `ScopeHostApi`)로 한다. `ScopeApi`에 `provide`를 넣지 않는 이유는 공급자 등록이 Cordis 서비스 이름 유도(`cap:<id>`)와 fiber 추적을 함께 요구해 X 구현과 떨어질 수 없기 때문이다. 공급 대상 능력은 매니페스트 `provides`에 있어야 한다(§4.7).

[결정: review.decisions-2 U-14, D-04] X가 L0·L1을 import하지 않고 루프, 입력 큐, 기록, 투영기 등록, 접두 테이블, 프로세스, 리소스 등록을 쓰도록 호스트 포트 타입을 F에 둔다. 아래 블록이 이름과 필드의 정본이다(`architecture.layers.spec` §4.3.3 결론 2번). `X.primitives.spec` §3.6·§3.9, `X.loading-trust.spec` §3.2·§3.7·§3.8, `X.operations.spec` §3.7에 있던 블록을 이 파일로 옮겼다. ext-host는 이 이름을 `import type`으로 가져와 다시 export하고 자기 정의를 두지 않는다. 기록 포트(`RecordCommitPort`)는 `SessionService.ext`가 쓰므로 records에 두고 여기서 다시 export한다(`F.records.spec` §3.9).

```ts
// ports.ts
import type { TSchema } from "typebox";
import type { ThreadId, JsonValue, Usage } from "../conversation/index.ts";
import type { ToolName } from "../capabilities/index.ts";
import type { ProjectorRegistry, StoreService, RecordCommitPort, StoreError } from "../records/index.ts";
import type { Result } from "../base/index.ts";
import type { Unsubscribe, PostItem, PostWhen } from "./ops.ts";
import type { LeaseId, TurnOutcome, SpawnSpec, SpawnOutcome } from "./drive.ts";
import type { ScopeId } from "./scope.ts";
import type { ExtensionName } from "./manifest.ts";

// ── 키와 조회 ───────────────────────────────────────────────────────
declare const portApi: unique symbol;
/** Cordis 서비스 이름과 API 타입을 함께 실어 나르는 키. 런타임 값은 name과 member뿐이다 */
export interface PortKey<Api> {
  readonly name: `xeon.${string}`;
  /** 있으면 서비스 객체의 이 속성이 포트다. 서비스 메서드 이름이 포트와 겹칠 때 쓴다(예: xeon.session의 ext) */
  readonly member?: string;
  readonly [portApi]?: Api;
}
/** 포트 조회. 포트가 아직 등록되지 않았거나 내려갔으면 undefined. member가 있으면 그 속성을 돌려준다 */
export interface PortLookup {
  get<Api>(key: PortKey<Api>): Api | undefined;
}

// ── 루프 (서비스 xeon.loop, 제공 core-loop) ───────────────────────────
export interface LoopTurnRequest {
  readonly threadId: ThreadId;
  readonly scopeId: ScopeId;
  readonly leaseId: LeaseId;
  /** 펜싱 값. 포트는 현재 임대 차수보다 작은 값의 요청을 거부한다 */
  readonly leaseEpoch: number;
  /** (scopeId, requestId) 쌍이 thread 안에서 멱등 키다 */
  readonly requestId: string;
  readonly input: PostItem;
  readonly signal: AbortSignal;
}
export interface LoopTurnResult {
  readonly outcome: TurnOutcome;
  /** 이미 커밋된 turn의 기록을 돌려줬으면 참 */
  readonly replayed: boolean;
  /** 이 turn의 모델 사용량 합. replayed면 기록된 값 */
  readonly usage: Usage | null;
}
export interface LoopSpawnRequest {
  readonly threadId: ThreadId;
  readonly scopeId: ScopeId;
  readonly leaseId: LeaseId;
  readonly leaseEpoch: number;
  readonly requestId: string;
  readonly spec: SpawnSpec;
  readonly signal: AbortSignal;
}
export interface LoopSpawnResult {
  readonly outcome: SpawnOutcome;
  readonly replayed: boolean;
  readonly usage: Usage | null;
}
export interface LoopPort {
  status(threadId: ThreadId): "idle" | "running";
  /** 유휴일 때 turn을 시작하고, 정착한 뒤 결과를 돌려준다. 실행 중이면 현재 turn이 정착한 뒤 시작한다 */
  runTurn(request: LoopTurnRequest): Promise<LoopTurnResult>;
  spawn(request: LoopSpawnRequest): Promise<LoopSpawnResult>;
  /** 유휴 상태에서 fn을 실행하는 동안 새 turn 시작을 막는다. 실행 중이면 정착 뒤 실행한다 */
  whenIdle<T>(threadId: ThreadId, fn: () => Promise<T>): Promise<T>;
}
export const LoopPortKey: PortKey<LoopPort>;                       // { name: "xeon.loop" }

// ── 입력 큐 (서비스 xeon.tasks, 제공 core-tasks) ─────────────────────
export interface EnqueueRequest {
  readonly threadId: ThreadId;
  readonly scopeId: ScopeId;
  /** PostOptions.requestId 그대로. (scopeId, requestId) 쌍이 thread 안 멱등 키다 */
  readonly requestId: string;
  readonly when: PostWhen;
  readonly item: PostItem;
}
export interface EnqueueResult {
  readonly duplicate: boolean;
}
/** 입력 큐가 항목을 받지 않은 이유. 저장소 실패와 닫힌 thread는 예상 가능한 거부다(eng.typescript.guide TY-24, review.open-issues N-05) */
export type EnqueueError =
  | StoreError
  | { readonly kind: "invalid_request_id"; readonly requestId: string }
  | { readonly kind: "mode_not_supported"; readonly mode: string }
  | { readonly kind: "thread_closed"; readonly threadId: ThreadId };
export interface InputQueuePort {
  /** 입력 큐 항목(input.queued, source.type "extension")을 커밋한다. 멱등은 커밋 키가 맡는다(review.decisions-2 U-05). 거부는 EnqueueError 값으로 돌려주고 Bug를 던지지 않는다 */
  enqueue(request: EnqueueRequest): Promise<Result<EnqueueResult, EnqueueError>>;
}
export const InputQueuePortKey: PortKey<InputQueuePort>;           // { name: "xeon.tasks" }

// ── 기록 (서비스 xeon.session의 ext 속성, 제공 core-persistence) ──────
/** 정의는 F.records.spec §3.9 session-service.ts. records가 extensions보다 낮아 그쪽에 둔다 */
export type {
  RecordCommitPort, ExtCommitRequest, ExtCommitRejectCode, ExtCommitResult,
  StoredScopeState, OpenLease, ExtThreadSnapshot, ExtRecordQuery, ExtRecordRow,
} from "../records/index.ts";
export const RecordCommitPortKey: PortKey<RecordCommitPort>;       // { name: "xeon.session", member: "ext" }

// ── 확장 투영기 등록 (서비스 xeon.session의 projectors 속성) ──────────
/** SessionService.projectors(ProjectorRegistry, F.records.spec §3.9 projector.ts)의 부분형.
 *  투영기 name은 "ext.<확장 이름>"이다 */
export type ProjectorRegistryPort = Pick<ProjectorRegistry, "register" | "onFailure">;
export const ProjectorRegistryPortKey: PortKey<ProjectorRegistryPort>;  // { name: "xeon.session", member: "projectors" }

// ── 접두 테이블 (서비스 xeon.store, 제공 platform-store) ──────────────
/** StoreService(F.records.spec §3.9)의 부분형. scoped(owner)는 그 소유자 접두 테이블만 쓰는 StoreDb를 돌려준다 */
export type ScopedStorePort = Pick<StoreService, "scoped">;
export const ScopedStorePortKey: PortKey<ScopedStorePort>;         // { name: "xeon.store" }

// ── 프로세스 실행 (서비스 xeon.process, 제공 platform-process) ────────
/** 격리 확장 자식 프로세스(2차). 사용처: X.loading-trust.spec §3.8 */
export interface IsolationSpawnSpec {
  /** 자식 런타임 진입점. ext-host의 isolation/child-main.ts 절대 경로 */
  readonly main: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** 허용 목록으로만 만든다. DB 경로와 비밀은 넣지 않는다(X.loading-trust.spec §4.9.6) */
  readonly env: Readonly<Record<string, string>>;
  readonly label: string;   // "ext:<name>:<generation>"
}
export interface IsolatedChild {
  readonly pid: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}
export interface IsolationProcessPort {
  spawn(spec: IsolationSpawnSpec): Promise<IsolatedChild>;
}
/** 외부 훅 실행. 사용처: X.operations.spec §3.7 */
export interface HookRunSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly maxStdoutChars: number;
  readonly maxStderrChars: number;
  readonly signal: AbortSignal;
}
export interface HookRawRun {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}
export interface HookProcessPort {
  run(spec: HookRunSpec): Promise<HookRawRun>;
}
export interface ProcessPort extends IsolationProcessPort, HookProcessPort {}
export const ProcessPortKey: PortKey<ProcessPort>;                 // { name: "xeon.process" }

// ── 임대 정책 (서비스 xeon.groups, 제공 group-kit, 선택) ─────────────
export interface LeaseCandidate {
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  readonly loadIndex: number;
  readonly defaultEnabled: boolean;
  /** 그 thread 활성 가지의 마지막 `scope.changed{status:"enabled"}` seq. 기록이 없으면 null */
  readonly enabledAtSeq: number | null;
}
export interface LeaseArbiterPort {
  /** 후보 중 하나를 고른다. null이면 아무에게도 주지 않는다 */
  choose(threadId: ThreadId, candidates: readonly LeaseCandidate[]): ScopeId | null;
}
export const LeaseArbiterPortKey: PortKey<LeaseArbiterPort>;       // { name: "xeon.groups" }

// ── 리소스 등록 (X.primitives.spec §3.9, §4.8) ───────────────────────
export interface ToolResourceDef {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: TSchema;
  readonly replay: "safe" | "unsafe";
  execute(args: JsonValue, ctx: { readonly threadId: ThreadId; readonly signal: AbortSignal }): Promise<unknown>;
}
/** 모양은 L1.models.spec이 정한다 */
export type ProviderResourceDef = JsonValue;
/** 모양은 L2.mcp.spec(McpServerDefSchema)이 정한다 */
export type McpServerResourceDef = JsonValue;
/** 도구 등록 실패. 확장 조합이 같은 도구 이름을 내면 정상 운영 중에도 생긴다(eng.typescript.guide TY-24) */
export interface ToolRegisterError { readonly kind: "name_conflict"; readonly toolName: string }
/** ToolService(xeon.tools)가 포함하는 등록 부분형. 이름이 겹치면 등록은 통째로 실패하고 도구 표는 그대로다 */
export interface ToolsPort { register(owner: ScopeId, def: ToolResourceDef): Result<Unsubscribe, ToolRegisterError> }
/** ModelService(xeon.models)가 포함하는 등록 부분형 */
export interface ModelsPort { registerProvider(owner: ScopeId, name: string, config: ProviderResourceDef): Unsubscribe }
/** McpService(xeon.mcp)가 포함하는 등록 부분형 */
export interface McpPort { registerServer(owner: ScopeId, name: string, config: McpServerResourceDef): Unsubscribe }
export const ToolsPortKey: PortKey<ToolsPort>;                     // { name: "xeon.tools" }
export const ModelsPortKey: PortKey<ModelsPort>;                   // { name: "xeon.models" }
export const McpPortKey: PortKey<McpPort>;                         // { name: "xeon.mcp" }

// ── 로더 포트 (Cordis 서비스가 아니다. 조립 루트가 LoaderDeps로 넘긴다, X.loading-trust.spec §3.5) ──
/** 탐색이 쓰는 파일 접근. 구현 L0.os */
export interface LoaderFs {
  /** 없으면 null */
  readText(path: string): Promise<string | null>;
  /** 없으면 null. 항목 이름은 정렬하지 않은 원본 */
  listDir(path: string): Promise<readonly { readonly name: string; readonly kind: "file" | "dir" | "symlink" }[] | null>;
  exists(path: string): Promise<boolean>;
  /** 심볼릭 링크를 푼 정규 경로 */
  realpath(path: string): Promise<string>;
}
/** 설치 위치의 OS별 경로. 값은 L0.os가 정한다 */
export interface LoaderPaths {
  /** 예: ~/.xeon */
  readonly userDir: string;
  /** 관리 정책 디렉터리. 없으면 null */
  readonly managedDir: string | null;
  readonly homeDir: string;
}
/** 신뢰 파일 접근. 잠금과 원자 교체(임시 파일 + rename)는 구현(L0.os)이 맡는다 */
export interface TrustStoreBackend {
  /** 파일이 없으면 { ok: true, text: null } */
  read(): Promise<{ readonly ok: true; readonly text: string | null } | { readonly ok: false; readonly reason: string }>;
  /** 잠금을 잡고 현재 내용을 fn에 넘겨 반환값으로 교체한다 */
  update(fn: (current: string | null) => string): Promise<void>;
}
export type TrustChoiceKind = "folder" | "parent" | "session";
export interface TrustChoice {
  readonly kind: TrustChoiceKind;
  readonly verdict: "allow" | "deny";
}
export interface TrustUpdate {
  readonly path: string;
  /** null은 항목 삭제 */
  readonly verdict: "allow" | "deny" | null;
  readonly via: "prompt" | "point" | "command";
}
export interface TrustOption {
  readonly choice: TrustChoice;
  readonly label: string;
  readonly updates: readonly TrustUpdate[];
  readonly savedPath: string | null;
}
export interface TrustPromptRequest {
  readonly projectRoot: string;
  readonly parent: string | null;
  /** 찾은 신뢰 필요 자원(프로젝트 루트 기준 상대 경로) */
  readonly resources: readonly string[];
  readonly options: readonly TrustOption[];
}
/** 대화형 클라이언트(L4)가 구현한다. 취소나 닫힘은 undefined */
export interface TrustPrompter {
  ask(request: TrustPromptRequest, signal: AbortSignal): Promise<TrustChoice | undefined>;
}
```

| 포트 | 서비스 이름(속성) | 제공 | 같은 서비스의 F 인터페이스 | 옮겨 온 블록 |
|---|---|---|---|---|
| `LoopPort` | `xeon.loop` | core-loop | `LoopService extends LoopPort`(`F.capabilities.spec` §3.12) | `X.primitives.spec` §3.6 |
| `InputQueuePort` | `xeon.tasks` | core-tasks | `TaskService extends InputQueuePort` | `X.primitives.spec` §3.6 |
| `RecordCommitPort` | `xeon.session`(`ext`) | core-persistence | `SessionService.ext`(`F.records.spec` §3.9) | `X.primitives.spec` §3.6 |
| `ProjectorRegistryPort` | `xeon.session`(`projectors`) | core-persistence | `SessionService.projectors` | `X.primitives.spec` §3.6 |
| `ScopedStorePort` | `xeon.store` | platform-store | `StoreService`(`F.records.spec` §3.9) | `X.primitives.spec` §3.6 |
| `ProcessPort` | `xeon.process` | platform-process | `ProcessService extends ProcessPort` | `X.primitives.spec` §3.6, `X.loading-trust.spec` §3.8, `X.operations.spec` §3.7 |
| `LeaseArbiterPort` | `xeon.groups` | group-kit | `GroupService extends LeaseArbiterPort`(`F.capabilities.spec` §3.12 `services/groups.ts`) | `X.primitives.spec` §3.6 |
| `ToolsPort` | `xeon.tools` | core-tools | `ToolService extends ToolsPort` | `X.primitives.spec` §3.9 |
| `ModelsPort` | `xeon.models` | core-models | `ModelService extends ModelsPort` | `X.primitives.spec` §3.9 |
| `McpPort` | `xeon.mcp` | cap-mcp | `McpService extends McpPort`(`F.capabilities.spec` §3.12 `services/mcp.ts`) | `X.primitives.spec` §3.9 |
| `LoaderFs`, `LoaderPaths`, `TrustStoreBackend` | 없음(조립 루트 주입) | platform-os | 없음 | `X.loading-trust.spec` §3.2, §3.7 |
| `TrustPrompter` | 없음(조립 루트 주입) | L4 클라이언트 | 없음 | `X.loading-trust.spec` §3.7 |

- 서비스 인터페이스가 같은 이름의 포트를 확장하므로 서비스 이름 하나에는 인터페이스 하나만 등록된다(`F.capabilities.spec` §3.12 규칙 2). 서비스 메서드 이름이 포트와 겹치는 `xeon.session`만 `PortKey.member`로 하위 속성을 가리킨다(`L1.persistence.spec` §3.3 `ext` 하위 객체).
- `ExtHostPortKey`(`xeon.ext`)는 X 타입 `ExtHost`를 실으므로 F에 두지 않고 ext-host가 둔다(`eng.context-map.design` §5.3 DR-14 예외 4).
- [가정] `IsolatedChild`의 스트림 타입은 `NodeJS` 전역 타입이다. contracts의 tsconfig가 Bun 타입을 포함한다는 전제이고, 포함하지 않으면 웹 스트림 타입으로 바꾼다. 격리는 2차라 M1 타입 검사에는 들지 않는다.
- 로더 포트의 값 판정 함수(`discover`, `resolveProjectTrust`, `trustOptions`)와 신뢰 파일 스키마(`TrustFileSchema`)는 X에 남는다. F에는 L0·L4가 구현하는 포트 모양만 둔다.

- 모든 확장은 최소 하나의 scope를 만든다 [제안]. 주 scope의 id는 매니페스트 `name`이다. 상태가 없는 플러그인은 `state`를 생략한다. 이렇게 하면 플러그인과 그룹이 같은 등록·토글·정리 경로를 쓴다.
- Helm 의사코드(`_research/layer-plan-v2-notes.md` 확장 지점 절)의 `g.on("request", …)`, `g.on("tool.before", …)`, `g.on("turn.end", …)`는 예시 표기다. 이 계약에서는 `g.on("before_provider_request", …)`, `g.on("tool_call", …)`, `g.on("turn_end", …)`처럼 pi 이벤트명을 쓴다(§4.10 [미결]).

### 3.3 지점 선언 타입 (`points.ts`, `points/<kind>.ts`)

```ts
export type Fold = "tap" | "first" | "chain";
export type PointKind = "input" | "request" | "tool" | "boundary" | "session";

export interface TapSig<P> { readonly fold: "tap"; readonly payload: P }
export interface FirstSig<P, D> { readonly fold: "first"; readonly payload: P; readonly decision: D }
export interface ChainSig<P, V, X> { readonly fold: "chain"; readonly payload: P; readonly value: V; readonly patch: X }

/** 지점 이름 → 정적 시그니처. §3.4 표와 같은 41행 */
export interface PointSignatures {
  input: ChainSig<InputPayload, InputValue, InputPatch>;
  user_bash: FirstSig<UserBashPayload, UserBashDecision>;
  // … §3.4 표의 모든 행
  turn_end: ChainSig<TurnEndPayload, BoundaryValue, BoundaryPatch>;
}
export type PointName = keyof PointSignatures & string;
export const PointNameSchema: TSchema;   // POINTS 키의 Type.Union(Literal…)

export type OnError = "record" | "deny" | "skip";
export type FoldOnError<F extends Fold> = F extends "tap" ? "record" : F extends "first" ? "deny" : "skip";

export interface PiSource {
  readonly event: string;            // pi 이벤트명. 지점 이름과 같다
  readonly def: string;              // 정의 위치. 예: "types.ts:1228/1426"
  readonly emit: string;             // 합성 위치. 예: "runner.ts:1242 emitToolCall"
  readonly piFold: "tap" | "tap-mutate" | "first" | "chain" | "collect";
}

export interface PointDecl<N extends PointName = PointName> {
  readonly name: N;
  readonly kind: PointKind;
  readonly fold: PointSignatures[N]["fold"];
  readonly onError: FoldOnError<PointSignatures[N]["fold"]>;
  /** tap만 detached 허용. detached는 디스패처가 완료를 기다리지 않는다 */
  readonly dispatch: "await" | "detached";
  readonly payload: TSchema;
  /** first: decision 스키마, chain: patch 스키마, tap: 없음 */
  readonly result?: TSchema;
  /** boundary 지점의 최종 검증 여부(§4.1) */
  readonly finalize?: "boundary";
  /** M1 스모크에서 페이로드를 정확화한 지점 */
  readonly m1: boolean;
  readonly pi: PiSource;
}

export const POINTS: { readonly [N in PointName]: PointDecl<N> };

/** first 지점의 거부값. 핸들러 예외는 이 값으로 바뀐다 */
export const FIRST_DENY: { readonly [N in FirstPointName]: PointSignatures[N]["decision"] };

/** chain 지점의 병합·중단 규칙. 순수 함수 */
export interface ChainRule<V, X> {
  readonly merge: (current: V, patch: X) => V;
  readonly stop?: (value: V) => boolean;
}
export const CHAIN_RULES: {
  readonly [N in ChainPointName]: ChainRule<PointSignatures[N]["value"], PointSignatures[N]["patch"]>;
};

export type FirstPointName = { [N in PointName]: PointSignatures[N]["fold"] extends "first" ? N : never }[PointName];
export type ChainPointName = { [N in PointName]: PointSignatures[N]["fold"] extends "chain" ? N : never }[PointName];
```

- 페이로드 스키마는 지점 종류별 파일 `points/input.ts`, `points/request.ts`, `points/tool.ts`, `points/boundary.ts`, `points/session.ts`에 둔다.
- 페이로드 형태 규칙: pi 이벤트 인터페이스에서 `type` 필드를 빼고 필드 이름을 그대로 쓴다. pi coding-agent 고유 타입(`BashOperations`, `CompactionPreparation`, `SessionEntry` 등)은 F 타입으로 바꾼다. 바꿀 F 타입이 아직 없으면 그 필드를 `Type.Unknown()`으로 두고 M1 이후 정확화한다. pi coding-agent 패키지에는 의존하지 않는다.

### 3.4 지점 선언 표

- 표의 지점 이름은 pi 이벤트명과 같다. 이름 표기는 snake_case가 정본이다 [제안].
- pi 위치 약어: 정의는 `~/projects/_ref/pi-src/packages/coding-agent/src/core/extensions/types.ts`의 줄(이벤트/결과), 합성은 같은 디렉터리 `runner.ts`의 줄이다. `cache-warmer.ts`는 `core/cache-warmer.ts`다. 줄 번호는 pi 1.1.0 소스 기준이다(`_research/notes/F-1.md` §2).
- 실패 열은 fold에서 파생된다(§4.1). `record` = 기록 후 계속, `deny` = 거부값(`FIRST_DENY`)으로 처리, `skip` = 그 핸들러의 패치만 버림.
- M1 열의 ●는 M1 스모크에서 페이로드를 정확화하는 지점이다(F.extensions.plan).
- pi 차이 열은 Xeon fold가 pi 합성과 다른 점이다. 41종의 pi fold 분포는 tap 22, 제자리 변경 tap 1, first 7, chain 9, collect 2다(`_research/notes/F-1.md` §2.6). Xeon 표에서는 tap 22, first 7, chain 12다.

| # | 지점 | kind | fold | 페이로드 | 반환 | 실패 | M1 | pi 정의 | pi 합성 | pi와 차이 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `input` | input | chain | InputPayload | InputPatch | skip | ● | types.ts:1143/1156 | runner.ts:1520 emitInput | `handled`는 `stop` 규칙으로 표현 |
| 2 | `user_bash` | input | first | UserBashPayload | UserBashDecision | deny | | types.ts:1125/1438 | runner.ts:1262 emitUserBash | 결정에 `deny` 변형 추가. pi는 예외를 다시 던짐 |
| 3 | `before_agent_start` | input | chain | BeforeAgentStartPayload | BeforeAgentStartPatch | skip | | types.ts:919/1468 | runner.ts:1420 emitBeforeAgentStart | pi의 message 수집은 merge(추가)로, `systemPromptOptions` 제자리 변경은 지원하지 않음 |
| 4 | `context` | request | chain | ContextPayload | ContextPatch | skip | ● | types.ts:871/1415 | runner.ts:1298 emitContext 1단계 | 제자리 수정 대신 패치 반환만 |
| 5 | `context_with_system` | request | chain | ContextPayload | ContextPatch | skip | | types.ts:881/1415 | runner.ts:1298 emitContext 2단계 | 같음 |
| 6 | `cache_warming_decision` | request | chain | CacheWarmingDecisionPayload | CacheWarmingPatch | skip | | cache-warmer.ts:112/117 | runner.ts:1121 emitCacheWarmingDecision | pi collect(마지막 정의값). 핸들러가 원본 payload를 받으므로 결과가 같다 |
| 7 | `before_provider_request` | request | chain | BeforeProviderRequestPayload | ProviderPayloadPatch | skip | ● | types.ts:887/1422 | runner.ts:1361 emitBeforeProviderRequest | 같음 |
| 8 | `before_provider_headers` | request | chain | BeforeProviderHeadersPayload | HeadersPatch | skip | | types.ts:897/— | runner.ts:1392 emitBeforeProviderHeaders | pi는 제자리 변경 tap. Xeon은 헤더 패치(null은 삭제) |
| 9 | `after_provider_response` | request | tap | AfterProviderResponsePayload | void | record | | types.ts:903 | runner.ts:1089 emit | 같음 |
| 10 | `provider_stream_event` | request | tap | ProviderStreamPayload | void | record | | types.ts:910 | runner.ts:1089 emit | 같음 |
| 11 | `model_select` | request | tap | ModelSelectPayload | void | record | | types.ts:1106 | runner.ts:1089 emit | 같음 |
| 12 | `thinking_level_select` | request | tap | ThinkingLevelSelectPayload | void | record | | types.ts:1114 | runner.ts:1089 emit (대기 안 함) | `dispatch: detached` |
| 13 | `tool_call` | tool | first | ToolCallPayload | ToolCallDecision | deny | ● | types.ts:1228/1426 | runner.ts:1242 emitToolCall | `input` 제자리 변경 미지원(§10). 비차단 결과는 없음 |
| 14 | `tool_result` | tool | chain | ToolResultPayload | ToolResultPatch | skip | ● | types.ts:1303/1455 | runner.ts:1183 emitToolResult | 같음(필드별 병합) |
| 15 | `tool_execution_start` | tool | tap | ToolExecutionStartPayload | void | record | | types.ts:1066 | runner.ts:1089 emit | 같음 |
| 16 | `tool_execution_update` | tool | tap | ToolExecutionUpdatePayload | void | record | | types.ts:1076 | runner.ts:1089 emit | 같음 |
| 17 | `tool_execution_end` | tool | tap | ToolExecutionEndPayload | void | record | | types.ts:1087 | runner.ts:1089 emit | 같음 |
| 18 | `agent_start` | boundary | tap | AgentStartPayload | void | record | | types.ts:932 | runner.ts:1089 emit | Xeon turn 시작 |
| 19 | `turn_start` | boundary | tap | TurnStartPayload | void | record | ● | types.ts:1030 | runner.ts:1089 emit | Xeon step 시작 |
| 20 | `message_start` | boundary | tap | MessageStartPayload | void | record | | types.ts:1047 | runner.ts:1089 emit | 같음 |
| 21 | `message_update` | boundary | tap | MessageUpdatePayload | void | record | | types.ts:1053 | runner.ts:1089 emit | 같음 |
| 22 | `message_end` | boundary | chain | MessageEndPayload | MessageEndPatch | skip | | types.ts:1060/1463 | runner.ts:1144 emitMessageEnd | 같음(role 불일치 패치는 건너뜀) |
| 23 | `turn_end` | boundary | chain | TurnEndPayload | BoundaryPatch | skip | ● | types.ts:1037/994 | runner.ts:1029 emitBoundary | Xeon step 끝. 최종 검증(`finalize`) |
| 24 | `agent_before_settle` | boundary | chain | AgentBeforeSettlePayload | BoundaryPatch | skip | ● | types.ts:1000/994 | runner.ts:1029 emitBoundary | Xeon turn 정착 직전. 최종 검증(`finalize`) |
| 25 | `agent_end` | boundary | tap | AgentEndPayload | void | record | | types.ts:937 | runner.ts:1089 emit | 같음 |
| 26 | `agent_settled` | boundary | tap | AgentSettledPayload | void | record | ● | types.ts:1005 | runner.ts:1089 emit | Xeon turn 끝 |
| 27 | `project_trust` | session | first | ProjectTrustPayload | ProjectTrustDecision | deny | | types.ts:686/693 | runner.ts:295 emitProjectTrustEvent | pi는 예외를 모으고 계속(fail-open). Xeon은 불신(no) |
| 28 | `resources_discover` | session | chain | ResourcesDiscoverPayload | ResourcesPatch | skip | | types.ts:711/718 | runner.ts:1474 emitResourcesDiscover | pi collect. merge가 경로를 확장 이름과 함께 추가 |
| 29 | `mcp_servers_change` | session | tap | McpServersChangePayload | void | record | | types.ts:730 | runner.ts:459 emit (대기 안 함) | `dispatch: detached` |
| 30 | `session_start` | session | tap | SessionStartPayload | void | record | ● | types.ts:741 | runner.ts:1089 emit | 같음 |
| 31 | `session_info_changed` | session | tap | SessionInfoChangedPayload | void | record | | types.ts:750 | runner.ts:1089 emit (대기 안 함) | `dispatch: detached` |
| 32 | `session_before_switch` | session | first | SessionBeforeSwitchPayload | SessionCancelDecision | deny | | types.ts:757/1474 | runner.ts:1089 emit (cancel 중단 1096-1103) | pi fail-open. Xeon은 예외 시 취소 |
| 33 | `session_before_fork` | session | first | SessionBeforeForkPayload | SessionBeforeForkDecision | deny | | types.ts:764/1478 | runner.ts:1089 emit | 같은 차이 |
| 34 | `session_before_compact` | session | first | SessionBeforeCompactPayload | SessionBeforeCompactDecision | deny | | types.ts:771/1483 | runner.ts:1089 emit | pi는 cancel 외 필드를 마지막 정의값으로 모음. Xeon은 첫 결정 |
| 35 | `session_compact` | session | tap | SessionCompactPayload | void | record | | types.ts:784 | runner.ts:1089 emit | 같음 |
| 36 | `session_compact_failed` | session | tap | SessionCompactFailedPayload | void | record | | types.ts:795 | runner.ts:1089 emit | 같음 |
| 37 | `session_before_tree` | session | first | SessionBeforeTreePayload | SessionBeforeTreeDecision | deny | | types.ts:833/1488 | runner.ts:1089 emit | 34번과 같은 차이 |
| 38 | `session_tree` | session | tap | SessionTreePayload | void | record | | types.ts:840 | runner.ts:1089 emit | 같음 |
| 39 | `session_shutdown` | session | tap | SessionShutdownPayload | void | record | ● | types.ts:810 | runner.ts:258 emitSessionShutdownEvent | 같음 |
| 40 | `ui_prompt_start` | session | tap | UIPromptPayload | void | record | | types.ts:1014 | runner.ts:611 emitUIPromptEvent (대기 안 함) | `dispatch: detached` |
| 41 | `ui_prompt_end` | session | tap | UIPromptPayload | void | record | | types.ts:1022 | runner.ts:595, 611 (대기 안 함) | `dispatch: detached` |

집계: kind는 input 3, request 9, tool 5, boundary 9, session 15다. fold는 tap 22, first 7, chain 12다. pi에서 결과를 돌려받는 지점은 18개(반환 기반)와 제자리 변경 1개(`before_provider_headers`)이고 나머지 22개는 관찰 전용이다(`_research/notes/F-1.md` §4 정정 2).

### 3.5 M1 지점의 페이로드와 반환 타입

M1 열 ● 지점은 아래 형태로 확정한다. M1 밖 지점 중 소유 문서가 제안한 것은 §3.5.1에 둔다. 나머지 지점은 §3.3의 페이로드 형태 규칙으로 같은 PR에서 표를 채운다.

```ts
// points/input.ts
export interface InputPayload {
  readonly text: string;
  readonly images?: readonly ImageContent[];
  readonly source: "interactive" | "rpc" | "extension";
  readonly streamingBehavior?: "steer" | "followUp";
}
export interface InputValue {
  readonly text: string;
  readonly images?: readonly ImageContent[];
  readonly handled: boolean;
}
export type InputPatch =
  | { readonly action: "transform"; readonly text: string; readonly images?: readonly ImageContent[] }
  | { readonly action: "handled" };
// CHAIN_RULES.input: transform → text·images 교체, handled → handled=true. stop: value.handled

// points/request.ts
export interface ContextPayload { readonly messages: readonly AgentMessage[] }
export interface ContextValue { readonly messages: readonly AgentMessage[] }
export interface ContextPatch { readonly messages: readonly AgentMessage[] }      // 교체

export interface BeforeProviderRequestPayload {
  readonly provider: string;
  readonly modelId: string;
  readonly role: string;          // L1.models.spec ModelRole
  readonly payload: unknown;
}
export interface ProviderPayloadValue { readonly payload: unknown }
export interface ProviderPayloadPatch { readonly payload: unknown }              // 교체

// points/tool.ts
export interface CapabilityRef { readonly id: CapabilityId; readonly method: string }

export interface ToolCallPayload {
  readonly toolCallId: string;
  /** 다른 도구가 낸 호출이면 부모 호출 id */
  readonly parentToolCallId?: string;
  readonly toolName: ToolName;
  readonly input: Readonly<Record<string, JsonValue>>;
  /** 능력 도구면 대응 능력과 메서드(F.capabilities.spec §7) */
  readonly capability?: CapabilityRef;
}
export interface ToolCallDecision {
  readonly block: true;
  readonly reason: string;
  /** 이 배치의 모든 결과가 terminate면 배치 뒤 멈춘다(pi-agent-core 1.3.0 규칙을 옮긴 core-loop tool-batch.ts, adr.0009 §3.3) */
  readonly terminate?: boolean;
}
// FIRST_DENY.tool_call = { block: true, reason: "extension handler failed", terminate: false }

export interface ToolResultPayload extends Omit<ToolCallPayload, "input"> {
  readonly input: Readonly<Record<string, JsonValue>>;
}
export interface ToolResultValue {
  readonly content: readonly (TextContent | ImageContent)[];
  readonly details?: JsonValue;
  readonly structuredContent?: JsonValue;
  readonly isError: boolean;
  readonly usage?: Usage;
}
export type ToolResultPatch = Partial<ToolResultValue>;
// CHAIN_RULES.tool_result: 정의된 필드만 덮어쓴다. content를 바꾸고 structuredContent를 주지 않으면
// structuredContent를 지운다(pi types.ts:1450-1455 주석과 같은 규칙)

// points/boundary.ts
export interface TurnStartPayload {           // Xeon step 시작
  readonly stepIndex: number;
  readonly stepId: StepId;
  readonly timestamp: number;
}
export interface BoundaryContextPreview {
  readonly contextMessages: readonly AgentMessage[];
  readonly llmMessages: readonly Message[];
  readonly pendingMessages: readonly AgentMessage[];
  readonly canContinue: boolean;
}
export interface BoundaryValue {
  /** 경계에서 커밋할 내구 이벤트 초안. F.records.spec §3.1의 DurableEventDraft */
  readonly entries: readonly DurableEventDraft[];
  /** 참이면 다음 모델 요청을 정확히 한 번 더 보낸다 */
  readonly continue: boolean;
}
export interface BoundaryPatch {
  /** 교체. 누적하려면 current.entries를 읽어 전체 목록을 돌려준다 */
  readonly entries?: readonly DurableEventDraft[];
  readonly continue?: boolean;
}
export interface TurnEndPayload {             // Xeon step 끝
  readonly stepIndex: number;
  readonly stepId: StepId;
  readonly message: AgentMessage;
  readonly toolResults: readonly ToolResultMessage[];
  readonly messageItemId: ItemId;
  readonly toolResultItemIds: readonly ItemId[];
  readonly context: BoundaryContextPreview;
}
export interface AgentBeforeSettlePayload {   // Xeon turn 정착 직전
  readonly turnId: TurnId;
  readonly context: BoundaryContextPreview;
  readonly outcome: "completed" | "aborted" | "error";
}
export interface AgentSettledPayload { readonly turnId: TurnId; readonly aborted: boolean }

// points/session.ts
export interface SessionStartPayload {
  readonly reason: "startup" | "reload" | "new" | "resume" | "fork";
  readonly threadId: ThreadId;
  readonly previousThreadId?: ThreadId;
}
export interface SessionShutdownPayload {
  readonly reason: "quit" | "reload" | "new" | "resume" | "fork";
  readonly targetThreadId?: ThreadId;
}
```

- pi 필드 이름 중 파일 경로나 엔트리 id를 담는 것은 Xeon ID로 바꾼다(`messageEntryId` → `messageItemId`, `previousSessionFile` → `previousThreadId`, `targetSessionFile` → `targetThreadId`). `SessionStartPayload.threadId`는 pi에 없는 필드이고 시작한 thread를 가리킨다. 그 밖의 이름은 pi와 같다.
- `BoundaryContextPreview`에서 pi의 `contextEntries: ProjectedSessionEntry[]`는 F.records.spec의 투영 타입이 정해진 뒤 추가한다.

#### 3.5.1 M1 밖 지점 중 소유 문서가 제안한 페이로드 [제안]

소유 문서(`L1.context.spec` §7.2, `L1.models.spec` §7.2, `X.loading-trust.spec` §3.7, `L2.mcp.spec` §7)의 제안을 받아 확정한다. 확장은 L1 타입을 import할 수 없으므로 모델 역할과 바인딩은 JSON 수준 모양으로 적는다. 여기 없는 M1 밖 지점은 §3.3 규칙으로 해당 소유 문서와 함께 채운다.

```ts
// points/request.ts (계속)
export interface ModelBindingJson { readonly role: string; readonly provider: string; readonly modelId: string; readonly thinkingLevel: ModelThinkingLevel }
export interface BeforeProviderHeadersPayload {
  readonly provider: string; readonly modelId: string; readonly role: string;
  /** 인증 헤더 값은 "[secret]"로 가린다 */
  readonly headers: Readonly<Record<string, string | null>>;
}
export interface HeadersPatch { readonly set: Readonly<Record<string, string | null>> }   // null은 삭제
export interface AfterProviderResponsePayload {
  readonly provider: string; readonly modelId: string; readonly role: string;
  readonly status: number; readonly headers: Readonly<Record<string, string>>;   // 인증·쿠키 헤더 제외
}
export interface ProviderStreamPayload { readonly provider: string; readonly api: string; readonly model: string; readonly data: unknown }
export interface ModelSelectPayload {
  readonly binding: ModelBindingJson;
  readonly previous: ModelBindingJson | null;
  readonly source: "set" | "route" | "restore" | "fallback";
}
export interface ThinkingLevelSelectPayload { readonly role: string; readonly level: ModelThinkingLevel; readonly previousLevel: ModelThinkingLevel | null }

// points/session.ts (계속)
export interface ProjectTrustPayload { readonly cwd: string }
/** pi ProjectTrustEventResult에서 "undecided"를 뺀 것. 결정하지 않으려면 undefined를 돌려준다 */
export interface ProjectTrustDecision { readonly trusted: "yes" | "no"; readonly remember?: boolean }
// FIRST_DENY.project_trust = { trusted: "no" }

export interface McpServersChangePayload {
  readonly servers: readonly { readonly id: string; readonly status: "connected" | "disconnected" | "error" | "disabled" }[];
  readonly toolsAdded: readonly string[];      // 도구 기계 이름
  readonly toolsRemoved: readonly string[];
}

export interface SessionBeforeCompactPayload {
  readonly threadId: ThreadId;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly willRetry: boolean;
  readonly preparation: {
    readonly firstKeptEventId: EventId;
    readonly tokensBefore: number;
    readonly isSplitTurn: boolean;
    readonly previousSummary: string | null;
    readonly messagesToSummarize: number;      // 개수만. 본문은 핸들러가 xeon.session으로 읽는다
  };
  readonly instructions: string | null;
}
export type SessionBeforeCompactDecision =
  | { readonly cancel: true; readonly reason: string }
  | { readonly cancel: false; readonly compaction: { readonly summary: string; readonly firstKeptEventId: EventId; readonly details: JsonValue | null } };
// FIRST_DENY.session_before_compact = { cancel: true, reason: "extension handler failed" }

export interface SessionCompactPayload {
  readonly threadId: ThreadId;
  readonly eventId: EventId;                   // thread.compacted
  readonly reason: "manual" | "threshold" | "overflow";
  readonly willRetry: boolean;
  readonly fromExtension: string | null;
  readonly tokensBefore: number;
}
export interface SessionCompactFailedPayload {
  readonly threadId: ThreadId;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly errorMessage: string | null;        // 중단이면 null
}
```

- `McpServersChangePayload.servers[].status` 값 집합은 [가정]이다. `L2.mcp.spec`의 서버 상태 이름이 다르면 그쪽 이름으로 고친다.
- pi `model_select`의 `source: "cycle"`은 Xeon에 대응 기능이 없어 뺐다(`L1.models.spec` §7.2).

### 3.6 그룹 간 레코드 (`group-record.ts`)

```ts
import type { ExtensionEventKind } from "../records/kinds.ts";

/** "grp.<groupId>.<영역>.<이름>" 또는 "x.<extensionName>.<영역>.<이름>". F.records.spec §3.2의 확장 kind와 같은 형식 */
export type RecordKind = ExtensionEventKind;
/** F.records.spec EXTENSION_KIND_PATTERN과 같은 값 */
export const RECORD_KIND_PATTERN = "^(x|grp)\\.[a-z][a-z0-9-]{1,31}\\.[a-z][a-z0-9_]{0,31}\\.[a-z][a-z_]*$";
/** 끝의 ".*"는 접두 일치. 확장 단위("grp.learning.*")와 영역 단위("grp.learning.skill.*")를 허용한다 */
export const RECORD_KIND_READ_PATTERN =
  "^(x|grp)\\.[a-z][a-z0-9-]{1,31}\\.(\\*|[a-z][a-z0-9_]{0,31}\\.(\\*|[a-z][a-z_]*))$";

export type GroupId = ExtensionName;      // kind가 group인 확장의 name

export interface RecordSubject {
  readonly type: "thread" | "turn" | "step" | "item" | "task" | "external";
  readonly id: string;
}

export interface GroupRecord {
  readonly groupId: GroupId;
  readonly kind: RecordKind;
  /** payload 스키마 버전. 1부터 */
  readonly version: number;
  readonly subject: RecordSubject;
  readonly payload: JsonValue;
}
export const GroupRecordSchema: TSchema;

/** 확장 레코드 종류 등록 */
export interface RecordKindDecl {
  readonly kind: RecordKind;
  readonly version: number;
  readonly description: string;
  readonly payload: TSchema;
}
/** 매니페스트 JSON에 싣는 형태. payload는 JSON Schema 객체 */
export const RecordKindDeclJsonSchema: TSchema;

export function isRecordKindOf(kind: string, owner: { kind: "group" | "plugin"; name: string }): boolean;
```

`validateGroupRecord`는 import 순환을 피하려고 `validate.ts`에 둔다(§3.7).

- 그룹 레코드는 세션 이벤트 로그에 이벤트로 저장된다. 이벤트 종류(`EventKind`)는 레코드의 `kind` 문자열을 그대로 쓰고, `EventEnvelope`가 감싼다. `RecordKind`는 F.records.spec §3.2의 `ExtensionEventKind`와 같은 타입이므로 `parseEventKind`를 통과한다. 코어 커밋과 같은 트랜잭션으로 쓴다.
- 접두 규칙 [제안]: 이벤트 kind, 레코드 kind, `XeonCustomMessage.customType`(`PostItem.customType`)은 모두 이 형식 하나를 쓴다. 플러그인은 `x.<확장 이름>.`, 그룹은 `grp.<그룹 이름>.`이다. 설정 키와 wire 메서드의 `ext.` 접두는 다른 규칙이다(F.wire-settings.spec §3.8.1).
- 그룹의 비공개 상태는 확장 접두 테이블(세션 저장 C안)에 둔다. 비공개 상태는 다른 그룹이 읽지 않는다. 공개할 정보는 그룹 레코드로만 낸다.

### 3.7 검증 함수 (`validate.ts`)

```ts
export interface ManifestIssue {
  readonly severity: "error" | "warning";
  readonly code: ManifestIssueCode;
  /** JSON Pointer. 집합 검사면 확장 이름 접두. 예: "acme-notes/points/2" */
  readonly path: string;
  readonly message: string;
}

export type ManifestIssueCode =
  // validateManifest
  | "schema" | "unknown_key" | "name_invalid" | "name_reserved" | "version_invalid"
  | "layer_kind_mismatch" | "drive_requires_group" | "entry_invalid"
  | "point_unknown" | "point_duplicate"
  | "capability_invalid" | "range_invalid" | "capability_duplicate" | "capability_both"
  | "provides_reserved" | "record_kind_prefix" | "record_kind_duplicate" | "read_kind_invalid"
  | "user_config_invalid" | "isolation_invalid" | "trust_invalid"
  // validateUsage
  | "point_undeclared" | "point_unused" | "post_undeclared" | "drive_undeclared"
  | "capability_undeclared" | "record_kind_undeclared" | "read_kind_undeclared"
  // validateManifestSet
  | "name_conflict" | "drive_conflict" | "capability_unprovided"
  // validateGroupRecord
  | "record_kind_unregistered" | "record_payload_invalid" | "record_version_unknown";

export interface ManifestResult {
  /** 오류가 없으면 정규화된 매니페스트(알 수 없는 최상위 키 제거) */
  readonly manifest?: ExtensionManifest;
  readonly issues: readonly ManifestIssue[];
}

/** 매니페스트 하나. 입력은 JSON 파싱 결과 그대로. 순수 함수 */
export function validateManifest(input: unknown): ManifestResult;

/** setup 동안 실제로 한 등록 */
export interface ExtensionUsage {
  readonly on: readonly PointName[];
  readonly post: boolean;
  readonly drive: boolean;
  readonly capabilities: readonly CapabilityId[];
  readonly recordKinds: readonly RecordKind[];
  readonly readsRecordKinds: readonly string[];
}

/** 선언과 실제 등록을 대조한다. X가 setup 직후와 등록 호출마다 쓴다. 순수 함수 */
export function validateUsage(manifest: ExtensionManifest, usage: ExtensionUsage): readonly ManifestIssue[];

/** 설치된 매니페스트 집합. 순수 함수 */
export function validateManifestSet(manifests: readonly ExtensionManifest[]): readonly ManifestIssue[];

/** 그룹 레코드 하나. decl이 없으면 record_kind_unregistered. 순수 함수 */
export function validateGroupRecord(record: GroupRecord, decl: RecordKindDecl | undefined): readonly ManifestIssue[];
```

## 4. 동작 규칙

### 4.1 fold 규칙

[결정] 실패 정책은 세 줄이다(`_research/layer-plan-v2-notes.md` 확장 지점 절).

1. `tap`: 모든 핸들러를 실행한다. 핸들러 예외는 기록하고 다음 핸들러로 간다. 반환값은 쓰지 않는다.
2. `first`: 등록 순서대로 실행하고 `undefined`가 아닌 첫 반환값을 결정으로 쓴다. 뒤 핸들러는 실행하지 않는다. 핸들러 예외는 그 지점의 거부값(`FIRST_DENY`)을 결정으로 쓴다(fail-closed).
3. `chain`: 지점이 초기값을 만들고, 핸들러마다 `(payload, current)`를 넘긴다. 반환 패치가 있으면 `CHAIN_RULES[point].merge(current, patch)`로 다음 값을 만든다. 핸들러 예외나 병합 거부(예: `message_end`의 role 불일치)는 그 핸들러의 패치만 버리고 계속한다. `stop(value)`가 참이면 뒤 핸들러를 실행하지 않는다.

chain의 보충 규칙 [제안]:

- 핸들러가 받는 `payload`는 디스패치 내내 원본 그대로다. 누적은 `current`에만 쌓인다. 이 분리로 pi의 collect 2종(`resources_discover`, `cache_warming_decision`)과 `before_agent_start`의 message 수집을 chain 하나로 표현한다. 핸들러가 원본을 받으므로 `cache_warming_decision`의 반례(`_research/notes/F-1.md` §3.3)가 생기지 않는다.
- 병합 규칙은 지점별 순수 함수(`CHAIN_RULES`)로 F에 둔다. 기본은 교체이고, `tool_result`는 필드별 병합, `resources_discover`와 `before_agent_start.message`는 추가다.
- boundary의 최종 검증(`finalize: "boundary"`): `turn_end`와 `agent_before_settle`은 모든 핸들러 뒤에 L1이 최종 값을 검증한다. 엔트리로 컨텍스트를 재구성할 수 없으면 `{ entries: [], continue: false }`로 바꾼다(`runner.ts:1075-1077`과 같다). 중간 단계의 무효 상태는 허용하고 기록만 한다. `continue`는 L1이 `canContinue`로 다시 승인한다. 검증 로직은 L1.loop.spec이 정하고 F는 표지만 둔다.
- [미결] boundary의 "엔트리 추가 + 계속" 합성을 위의 chain 교체 + `finalize` 표지로 확정할지, fold 4번째(collect)나 지점별 예외 표를 둘지. `_research/notes/F-1.md` §3.1은 chain 하나로 표현된다고 판정했고, §3.4는 collect 추가를 최소 보완안으로 제시했다. [제안] fold 3종을 유지한다.
- [미결] first의 fail-closed를 모든 first 지점에 그대로 적용할지. pi는 `session_before_*`와 `project_trust`에서 fail-open이다(`_research/ext-points.md` §6.1 질문 2). 현재 표는 [결정]의 세 줄 규칙을 그대로 적용하고, pi와의 차이는 §3.4 표의 "pi와 차이" 열에 있다.

### 4.2 디스패치 순서

- [제안] 한 지점의 핸들러 순서는 tier, 확장 로드 순서, 등록 순서의 사전식 순서다. tier 정의와 핸들러 시간 예산은 X.operations.spec이 정한다(`_research/item-catalog.md` X절 실행 순서와 tier 행).
- 디스패치 시작 시 핸들러 목록을 스냅샷한다. 디스패치 도중의 등록·해제·토글은 그 디스패치에 반영되지 않는다(pi `runner.ts:269-271`과 같다).
- `dispatch: "detached"` tap 지점은 디스패처가 완료를 기다리지 않는다. 나머지는 순차 await다.

### 4.3 재생 계약

[결정] on 핸들러는 다시 실행해도 되는 질의다(`_research/layer-plan-v2-notes.md` 확장 지점 절).

- 소비 커밋 전에 프로세스가 끝나면 같은 지점이 같은 페이로드로 다시 발화하고 핸들러가 다시 실행될 수 있다(pi durable 훅 규칙, `_research/ext-points.md` §3).
- 재실행된 핸들러의 `ctx.state` [제안]: 페이로드는 처음 실행과 같지만 `ctx.state`와 `g.state()`는 같지 않을 수 있다. 처음 실행에서 상태 커밋이 끝났으면 재시작 뒤의 `ctx.state`는 X가 `RecordCommitPort.loadThread`로 읽은 판, 곧 이미 커밋된 판이다. 핸들러는 `ctx.state`가 자기 갱신이 반영되기 전의 판이라고 가정하지 않는다. 이 판으로 계산한 부수 결과(post 본문, record payload)는 처음 실행과 다를 수 있다. 세부 규칙은 `X.primitives.spec` §4.6.1 재실행 규칙이다.
- 핸들러는 외부 효과를 내지 않는다. 효과가 필요하면 `post`(멱등 키 필수), `commit`, `record`를 쓴다. 이 세 연산은 커밋 단위로 기록되므로 재실행해도 중복되지 않는다.
- 재실행된 핸들러의 상태 커밋 [제안]: 멱등 키와 지문은 키의 신원 부분(scope, 디스패치 키, 순번)만으로 만든다. doc 본문과 기대 판은 지문에 넣지 않는다. 재실행에서 같은 키의 커밋은 `replayed`가 되고, X는 그때 저장된 상태(`ExtCommitResult.stored`)를 캐시에 두고 `commit`의 반환값으로 돌려준다. 핸들러가 다시 계산한 값은 버린다. 그래서 상태 갱신 함수는 이미 반영된 갱신을 다시 적용해도 결과가 같은 멱등 reducer로 쓴다. 저장소 거부 코드의 변환(`ownership_lost` → `lease_lost`, `key_reused` → `invalid`, 잠금 대기 초과 → `busy`, `disk_full`·`read_only` → `storage`)과 세부 규칙은 `X.primitives.spec` §4.6.1이 정본이다.
- 핸들러 결과를 고정해야 하면 scope 상태에 저장한다. durable `api.memo`에 해당하는 고정 API를 X에 둘지는 X.primitives.spec이 정한다.

### 4.4 post

- `when`의 뜻 [제안]:
  - `steer`: 현재 step의 도구 라운드 뒤, 다음 모델 요청 전에 넣는다.
  - `followUp`: 현재 turn이 정착한 뒤 새 turn의 입력으로 넣는다.
  - `next`: 다음 경계 뒤에 모델 요청을 정확히 한 번 일으키는 입력으로 넣는다.
  - pi `deliverAs`의 `steer`, `followUp`, `nextTurn`과 같은 순서다(`_research/ext-points.md` §1.4).
- `requestId`는 필수다. 같은 대화에서 같은 `requestId`의 두 번째 post는 `duplicate: true`를 돌려주고 큐에 넣지 않는다.
- `post`는 플러그인과 그룹 모두 쓸 수 있다. 매니페스트 `usesPost`가 참이어야 한다.

### 4.5 켜기·끄기

- [결정] 켜기와 끄기는 경계에서 적용되고, 정리는 Cordis dispose로 실행된다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 5).
- [결정: review.decisions-2 U-01] 적용 시점은 단계 경계(step 종료 직후, 도구 결과 커밋 뒤, `turn_end` 처리 뒤)다(F.conversation.spec §2, §2.1). drive 임대 교대도 같은 시점이다. turn의 마지막 step이 끝나는 시점도 단계 경계이므로 turn 정착 시점을 따로 두지 않는다. 실행 중인 turn이 없을 때의 적용 시점은 X.primitives.spec이 정한다. drive 임대의 반납은 `loop.turn()` 호출 사이에서만 일어난다. 실행 중인 step이나 `loop.turn()`은 중간에 끊지 않는다.
- `enable()`, `disable()`은 요청만 기록한다. 상태는 `enabling`, `disabling`을 거쳐 적용 지점에서 바뀐다.
- 비활성화 적용 순서 [제안]: on 핸들러 제외 → drive 임대 반납 → `onDispose` 정리 동작 실행. 큐에 이미 들어간 post 항목은 그대로 둔다.

### 4.6 drive 임대

- [결정] drive 임대는 한 번에 그룹 하나만 가진다. on, post, 백그라운드 위임은 여러 그룹이 함께 쓴다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 4).
- [결정] Helm과 학습 그룹은 L3 기본 그룹이다. 학습 그룹은 drive를 쓰지 않는다. 검토 포크는 L1 백그라운드 위임 서비스로 실행한다. 그래서 Helm이 구동 중이어도 학습 그룹을 함께 켤 수 있다(`_research/layer-plan-v2-notes.md` "Hermes 학습 루프를 별도 그룹으로", `_research/decisions-log.md` 20행).
- `drive`는 `kind: "group"`이고 `usesDrive: true`인 확장만 쓴다. 등록만으로 임대가 생기지 않는다. 임대 중재(누가 언제 받는지)는 X.primitives.spec이 정한다.
- 재생 규율 [결정]: drive 함수는 경계마다 마지막 커밋 상태로 다시 호출되고, 효과는 `loop.turn`, `loop.spawn`, `post`로만 낸다(`_research/decisions-log.md` 20행). 상태 변경은 `commit`으로만 한다.
  - 다시 호출되는 시점: 임대를 받을 때, 프로세스 재시작 뒤 재개할 때, `loop.turn()`이 끝난 뒤 함수가 반환했는데 그룹이 아직 활성일 때.
  - `loop.turn`과 `loop.spawn`의 기본 `requestId`는 `${leaseId}:${순번}`이다. 재호출된 함수가 같은 순서로 같은 호출을 하면 이미 커밋된 turn과 spawn은 다시 실행되지 않고 기록된 결과를 돌려받는다.
  - 클로저 지역 변수에 진행 상태를 두는 drive 함수는 재개 뒤 다르게 동작한다. 이 위반은 타입으로 막을 수 없다. 결정성 검사(`Date.now`, `Math.random` 금지 등)는 L3.group-kit.spec의 lint 규칙으로 보완한다(`_research/packages.md` §4.6 L3-a).
- 예산: [결정] 일반 대화 turn에는 기본 상한을 두지 않고 상한은 drive 임대에만 건다(`_research/decisions-log.md` 20행 "예산은 pi 방식"). `LeaseBudget`은 남은 양이고 `null`은 상한 없음이다. 상한에 이르면 `loop.turn`과 `loop.spawn`은 거부되고 임대는 `releasing`이 된다.
  - [결정: review.decisions-2 U-12] drive는 사용자 입력 없이 turn을 만들므로 pi 방식의 예외로 기본 상한을 둔다. 상한을 명시하지 않은 임대는 X 설정 `x.primitives.driveDefaultLimits`(기본 4/8/400000)를 쓰고, 그룹은 자기 설정(Helm은 `l3.helm.driveLimits`, 기본 4/8/400000)으로 덮어쓴다. 천장 `x.primitives.driveLimits`(기본 없음)를 넘지 못한다. 세 키 모두 설정 화면에서 조정한다(`X.primitives.spec` §4.4.2, §6).

### 4.7 정적 검사 규칙

`validateManifest(input)`:

| 코드 | 심각도 | 조건 |
|---|---|---|
| `schema` | error | `ExtensionManifestSchema` 위반 |
| `unknown_key` | warning | 알 수 없는 최상위 키(제거됨) |
| `name_invalid` / `name_reserved` | error | 이름 형식 위반 / `core`, `ext`, `grp`, `x`, `xeon` 또는 L2 도메인 이름을 외부 확장(`trust.level`이 `builtin`이 아님)이 씀. 입력 출처 키 `user`, `deleg`, `timer`(F `RESERVED_SOURCE_KEYS`)는 신뢰 등급과 무관하게 모든 확장에 금지한다(review.decisions-2 U-13, `eng.transactions.design` §4.7) |
| `layer_kind_mismatch` | error | `kind: "group"`인데 `layer`가 `L3`가 아님, 또는 `layer: "L3"`인데 `kind`가 `group`이 아님 |
| `drive_requires_group` | error | `usesDrive: true`인데 `kind`가 `group`이 아님 |
| `entry_invalid` | error | `entry`가 절대 경로이거나 `..`로 확장 루트 밖을 가리킴 |
| `point_unknown` / `point_duplicate` | error | `points`에 `POINTS`에 없는 이름 / 같은 이름 두 번 |
| `capability_invalid` / `range_invalid` | error | 능력 ID 또는 범위 형식 위반 |
| `capability_duplicate` / `capability_both` | error | 같은 목록 안 중복 / `requires`와 `optional`에 동시에 있음 |
| `provides_reserved` | error | 예약 접두(F.capabilities.spec §3.1) 능력을 provide |
| `record_kind_prefix` | error | 그룹은 `grp.<name>.`, 플러그인은 `x.<name>.` 접두가 아닌 레코드 종류를 선언하거나, `RECORD_KIND_PATTERN`(4마디) 형식이 아님 |
| `record_kind_duplicate` | error | 같은 `kind`를 두 번 선언 |
| `read_kind_invalid` | error | `readsRecordKinds`가 자기 접두를 가리킴(자기 레코드는 선언 없이 읽음) 또는 형식 위반 |
| `user_config_invalid` | error | `userConfig` 항목 안의 알 수 없는 키, 빈 `setting` |
| `isolation_invalid` / `trust_invalid` | error | 허용 값 밖 |

`validateUsage(manifest, usage)`:

| 코드 | 심각도 | 조건 |
|---|---|---|
| `point_undeclared` | error | `on`을 건 지점이 `points`에 없음 |
| `post_undeclared` | error | `post`를 썼는데 `usesPost`가 참이 아님 |
| `drive_undeclared` | error | `drive`를 썼는데 `usesDrive`가 참이 아님 |
| `capability_undeclared` | error | `capability(key)`의 능력이 `requires`, `optional`에 없음 |
| `record_kind_undeclared` / `read_kind_undeclared` | error | `record`, `readRecords`의 종류가 선언에 없음 |
| `point_unused` | warning | `points`에 선언했지만 `on`을 걸지 않은 지점 |

`validateManifestSet(manifests)`:

| 코드 | 심각도 | 조건 |
|---|---|---|
| `name_conflict` | error | 같은 `name`의 확장이 둘 이상 |
| `drive_conflict` | warning | `usesDrive: true`이고 `defaultEnabled`가 참(생략 포함)인 그룹이 둘 이상. 실행 중에는 X가 임대를 하나만 준다 |
| `capability_unprovided` | warning | 어떤 확장의 `requires` 능력을 집합 안의 누구도 `provides`하지 않음 |

### 4.8 그룹 간 통신

- [결정] 그룹끼리 직접 참조하지 않는다. 그룹 사이 통신은 F4 형식의 이벤트와 그룹 레코드로만 한다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 3).
- [결정: review.decisions-2 D-10] F는 그룹 레코드의 형식(kind 접두, `GroupRecord`, `RecordKindDecl`)만 두고 그룹 사이 레코드의 payload 스키마는 두지 않는다. payload 스키마는 쓰는 그룹이 매니페스트 `recordKinds`에 선언한다. 그룹은 다른 그룹의 비공개 기록(`ScopeApi.recordPrivate`)을 읽지 않는다.
- 그룹 패키지는 다른 그룹 패키지를 import하지 않는다(같은 층 import 금지, `_research/foundation-plan.md` §3). check-layers가 이를 거부한다.
- 그룹 레코드 쓰기는 `ScopeApi.record`만 쓴다. 쓰는 그룹은 매니페스트 `recordKinds`에 `RecordKindDecl`을 선언한다. X는 쓰기 시 `validateGroupRecord`로 payload를 검사한다.
- 읽기는 `ScopeApi.readRecords`만 쓴다. 읽는 그룹은 `readsRecordKinds`에 종류나 `grp.<id>.*`를 선언한다. 대상 그룹이 설치되어 있지 않으면 빈 목록이다(오류 아님).
- 비공개 기록 쓰기는 `ScopeApi.recordPrivate`만 쓴다. kind는 자기 접두만 받고 `readsRecordKinds`와 다른 확장의 `readRecords`로 조회되지 않는다.

### 4.9 열거형 확장 예약 (2차)

- 확장이 추가하는 이벤트 종류, 파트 종류, 레코드 종류는 접두로 구분한다(`_research/layer-plan-v2.json` F4 "열거형 확장 예약", 2차).
- [제안] 그룹은 `grp.<groupId>.`, 플러그인은 `x.<extensionName>.` 접두를 쓴다(§3.6, F.records.spec §3.2). 코어 종류 이름은 이 두 접두와 `_` 접두를 쓰지 않는다(`_` 접두는 ACP v2 관례, `_research/item-catalog.md` F절 열거형 확장 예약 행).
- 타입 수준 확장은 선언 병합으로 한다. 대상은 agent-core `CustomAgentMessages`이고 모듈 이름은 `@earendil-works/pi-agent-core`다(`_research/notes/F-2.md` §5.2).
- M0에서는 `RecordKind`의 접두 검사만 구현한다. 파트·이벤트 종류의 접두 검사와 선언 병합 규칙은 M2 이후다.

### 4.10 지점 이름 표기

- [제안] 지점 이름의 정본은 pi 이벤트명(snake_case)이다. 계획 v2는 "지점 이름은 pi 이벤트명을 그대로 씁니다"라고 적었다(`_research/layer-plan-v2-notes.md` 확장 지점 절).
- [미결] 같은 자료의 Helm 의사코드와 `_research/ext-points.md` §5는 `request`, `tool.before`, `tool.after`, `turn.end` 같은 점 표기를 쓴다. [제안] 점 표기는 예시 표기로 보고 계약에 쓰지 않는다. 별칭(점 표기 → pi 이름)을 X가 받을지 사용자 확인이 필요하다.

## 5. 실패와 경계 사례

1. 매니페스트에 없는 지점에 `on`을 호출함: `validateUsage`가 `point_undeclared` 오류를 낸다. X는 그 등록을 거부하고 확장 로드를 실패로 처리한다(처리 방식은 X.loading-trust.spec).
2. first 핸들러가 `undefined`도 결정 타입도 아닌 값을 돌려줌: 결정 스키마(`PointDecl.result`) 위반은 예외와 같게 거부값으로 처리한다.
3. chain 핸들러가 패치 스키마를 위반함: 그 핸들러의 패치를 버린다(skip).
4. detached tap 핸들러가 끝나기 전에 세션이 종료됨: 결과를 기다리지 않는다. 핸들러 예외는 기록만 한다.
5. 두 그룹이 동시에 drive 임대를 요청함: X가 하나에만 임대를 준다. 다른 그룹의 drive 함수는 호출되지 않는다. 사용자는 L4 설정에서 어느 그룹이 구동할지 고른다. 설정 키는 `x.primitives.activeDriveGroup` 하나다(소유 X.primitives.spec).
6. drive 함수가 예외를 던짐: 임대를 반납하고 그룹의 drive 등록을 오류 상태로 표시한다. on 핸들러는 계속 동작한다 [제안]. 재시도 여부는 X.primitives.spec.
7. drive 함수가 `loop.turn` 없이 반환함: 다음 경계에서 다시 호출된다. 같은 상태로 연속 두 번 아무 효과 없이 반환하면 X가 임대를 반납한다 [제안].
8. `readRecords`의 대상 그룹이 제거됨: 이미 기록된 레코드는 이벤트 로그에 남으므로 계속 읽힌다. 새 레코드만 없다.
9. 레코드 `version`이 읽는 쪽이 아는 버전보다 큼: `record_version_unknown` 경고와 함께 payload를 원형 그대로 돌려준다. 해석 실패 처리는 읽는 그룹 몫이다.
10. pi 확장을 그대로 올릴 때 `tool_call`의 `event.input` 제자리 수정에 의존하는 경우: 페이로드가 읽기 전용이라 동작하지 않는다. `tool_call`은 인자 변경을 지원하지 않는다(허용·거부·결과 대체만) [결정: review.decisions-2 U-06]. 인자 변경이 필요하면 2차에 chain 지점을 따로 더한다.

## 6. 설정 노출

이 문서는 설정 값의 스키마를 정하지 않는다. 설정 키의 최종 이름과 스키마, 범위는 F.wire-settings.spec이 정한다. 이 문서는 아래 연결만 정한다.

| 연결 | 내용 | L4 노출 |
|---|---|---|
| 매니페스트 `userConfig` | 항목마다 F.wire-settings 설정 키 하나(`ext.<name>.<userConfig 키>`)를 가리킨다. `sensitive`면 비밀 참조로 저장한다 | 설정 화면 "플러그인과 그룹" 탭의 확장별 설정 |
| 확장 켜기·끄기 | 키 `ext.<name>.enabled` 하나다. 플러그인과 L3 그룹이 같은 키를 쓴다(`l3.<그룹>.*` 켜기 키는 두지 않는다). 범위 `managed`, `user`, `project`, `local`, `session`, 적용 `live`(실제 켜짐·꺼짐은 단계 경계, §4.5). 기본값은 매니페스트 `defaultEnabled`, 없으면 `true`. 예약 키이고 X 로더가 정의한다(F.wire-settings.spec §3.8.3, 소유 X.loading-trust.spec §6) [결정: review.decisions-2 K-04] | 같은 탭의 토글, 명령, 설정 파일 |
| drive 임대 상한 | 기본값 키 `x.primitives.driveDefaultLimits`(기본 4/8/400000)와 천장 키 `x.primitives.driveLimits`(`DriveLimits` 형식, 소유 X.primitives.spec, [결정: review.decisions-2 U-12]). `DriveOptions.limits`는 기본값을 덮어쓰고 천장보다 클 수 없다 | 같은 탭(`_research/layer-plan-v2-notes.md` L4 설정 화면 구성안 "drive 임대 상한") |
| 구동 그룹 | 키 `x.primitives.activeDriveGroup` 하나(소유 X.primitives.spec) [결정: review.decisions-2 S-15] | 같은 탭 "구동 그룹" 선택 |
| 격리 | [제안] 키 `ext.<name>.isolation`(예약 키, 소유 X.loading-trust.spec). 매니페스트 `isolation`은 요청이고 실제 값은 사용자 설정이 정한다(2차) | 같은 탭 |

## 7. 확장 지점

이 문서가 지점을 정의한다(§3.4). 지점을 발화하는 쪽과 대응은 다음과 같다.

| kind | 발화하는 문서 |
|---|---|
| input | L1.loop.spec(`input`, `user_bash`, `before_agent_start`) |
| request | L1.context.spec, L1.models.spec |
| tool | L1.tools.spec |
| boundary | L1.loop.spec |
| session | L1.persistence.spec(아래 나머지), L1.context.spec(`session_before_compact`, `session_compact`, `session_compact_failed`), L1.tools.spec(`ui_prompt_start`, `ui_prompt_end`. 승인 프로토콜), X.loading-trust.spec(`project_trust`, `resources_discover`), L2.mcp.spec(`mcp_servers_change`) |

- [제안] 지점별 발화 문서는 `L1.readme` §6 소유표와 같다. 컴팩션은 core-context가 수행하므로 `session_*compact*`는 L1.context, 승인 화면 알림은 승인 프로토콜 소유라 `ui_prompt_*`는 L1.tools가 발화한다. `input` 지점은 L1.loop가 발화한다(`architecture.runtime-flow` 그림의 tasks 표기는 그쪽 문서가 고친다).

- 능력 도구 호출은 tool 지점을 지난다. 페이로드의 `capability` 필드로 능력을 식별한다(F.capabilities.spec §7).
- [미결] 지점 5종 밖 이벤트(승인 요청·응답, 서브에이전트 생성, 그룹 레코드 쓰기, scope 토글 등 Xeon 고유 이벤트)를 지점으로 둘지, 관찰 전용 이벤트 버스로 둘지.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `ExtensionManifest`, `ExtensionManifestSchema`, `defineManifest`, `validateManifest`, `validateUsage`, `validateManifestSet` | X.loading-trust.spec, 모든 확장 패키지 |
| `PointName`, `PointSignatures`, `PointDecl`, `POINTS`, `FIRST_DENY`, `CHAIN_RULES`, 페이로드·결정·패치 타입 | X.primitives.spec, L1.loop.spec, L1.tools.spec, L1.context.spec, L1.models.spec, L1.persistence.spec |
| `Handler`, `HandlerContext`, `ExtensionOps`, `PostItem`, `PostOptions`, `PostReceipt`, `DriveFn`, `LoopHandle`, `DriveLease`, `DriveLimits`, `ScopeDef`, `ScopeApi`, `ScopeHandle`, `ScopeFn`, `ExtensionEntry` | X.primitives.spec, L3.group-kit.spec, L3.helm.spec, L3.learning.spec |
| `GroupRecord`, `RecordKind`, `RecordKindDecl`, `RecordSubject`, `validateGroupRecord` | L3 전체, L1.persistence.spec |
| `PortKey`, `PortLookup`, `LoopPort`, `InputQueuePort`, `ProjectorRegistryPort`, `ScopedStorePort`, `ProcessPort`(`IsolationProcessPort`, `HookProcessPort` 포함), `LeaseArbiterPort`, `ToolsPort`, `ModelsPort`, `McpPort`와 부속 타입, 각 `*PortKey`, `RecordCommitPort` 재노출 | X.primitives.spec, X.operations.spec, L0.store.spec, L0.process.spec, L1.loop.spec, L1.tasks.spec, L1.persistence.spec, L1.tools.spec, L1.models.spec, L2.mcp.spec, L3.group-kit.spec, F.capabilities.spec §3.12 |
| `LoaderFs`, `LoaderPaths`, `TrustStoreBackend`, `TrustPrompter`, `TrustPromptRequest`, `TrustOption`, `TrustUpdate`, `TrustChoice`, `TrustChoiceKind` | X.loading-trust.spec, L0.os.spec(구현), L4.cli.spec·L4.desktop.spec(프롬프트 구현) |

요구:

| 이름 | 출처 |
|---|---|
| `CapabilityId`, `CapabilityIdSchema`, `SemVerSchema`, `SemVerRangeSchema`, `ServiceKey`, `ToolName` | F.capabilities.spec |
| `EventKind`, `ExtensionEventKind`, `EXTENSION_KIND_PATTERN`, `EventEnvelope`, `DurableEventDraft`, 확장 접두 테이블 규칙 [가정] | F.records.spec |
| `ThreadId`, `TurnId`, `StepId`, `ItemId`, `AgentMessage`, `Message`, `ToolResultMessage`, `TextContent`, `ImageContent`, `JsonValue`, `Usage`, 용어표(thread, turn, step), `requestId` 필드의 뜻 | F.conversation.spec |
| 바운디드 컨텍스트와 소유 경계(그룹 레코드와 비공개 상태의 소유) | eng.context-map.design |
| 설정 키 형식 | F.wire-settings.spec |

## 9. 수용 기준

1. 매니페스트 `points`에 없는 지점에 `on`을 건 사용 기록은 `validateUsage`가 `point_undeclared` 오류를 낸다.
2. `POINTS`의 41행 모두 `fold`, `kind`, `payload` 스키마, `onError`, `pi` 출처를 가진다. `first` 행은 `FIRST_DENY`에, `chain` 행은 `CHAIN_RULES`에 항목이 있다.
3. `POINTS`의 지점 이름은 중복이 없고, pi `ExtensionEvent` 합집합(`types.ts:1377-1409`)을 펼친 41개 이름과 집합이 같다.
4. `drive`를 쓰고 기본 활성인 그룹 매니페스트 두 개를 `validateManifestSet`에 넣으면 `drive_conflict` 경고가 나온다.
5. `Handler<"tool_call">`의 반환 타입은 `ToolCallDecision | undefined`(Promise 포함)이고, `Handler<"turn_end">`는 `(payload, current: BoundaryValue, ctx)`를 받아 `BoundaryPatch | undefined`를 반환하며, `Handler<"session_start">`는 `void`를 반환한다(타입 테스트).
6. `kind: "group"`이 아닌 매니페스트에 `usesDrive: true`면 `drive_requires_group` 오류다.
7. 그룹 `learning`이 `grp.helm.item.tagged` 종류를 선언하면 `record_kind_prefix` 오류다. `grp.learning.skill.proposed`는 통과하고 F.records.spec의 `parseEventKind`도 통과한다.
8. `ExtensionManifest`의 `requires[].id` 스키마는 F.capabilities.spec의 `CapabilityIdSchema`와 같은 객체다(동일 참조 테스트).
9. `CHAIN_RULES.tool_result`로 `content`만 바꾸면 `structuredContent`가 사라지고, 둘 다 주면 둘 다 유지된다.
10. `CHAIN_RULES.input`에서 `handled` 패치 뒤 `stop`이 참이다.
11. 스펙 §3.4 표의 지점 이름·kind·fold와 코드 `POINTS`가 일치한다(문서 대조 스크립트, F.extensions.plan E9).
12. `ports.ts`의 모든 `*PortKey` 상수의 `name`은 `xeon.`으로 시작하고 §3.2.1 표의 서비스 이름과 같다. `RecordCommitPortKey.member`는 `"ext"`, `ProjectorRegistryPortKey.member`는 `"projectors"`이고 나머지 키에는 `member`가 없다(값 테스트).
13. `F.capabilities.spec` §3.12의 `LoopService`, `TaskService`, `ProcessService`, `ToolService`, `ModelService`, `McpService`, `GroupService`는 각각 `LoopPort`, `InputQueuePort`, `ProcessPort`, `ToolsPort`, `ModelsPort`, `McpPort`, `LeaseArbiterPort`에 대입 가능하다. `StoreService`는 `ScopedStorePort`에, `SessionService["ext"]`는 `RecordCommitPort`에, `SessionService["projectors"]`는 `ProjectorRegistryPort`에 대입 가능하다(타입 테스트).
14. `ports.ts`가 import하는 F 소스는 base, conversation, capabilities, records와 extensions 안의 파일뿐이다(`F.readme` §3 순서 검사).

## 10. 미결 사항

- [미결] boundary fold: chain 교체 + `finalize` 표지로 확정할지, 4번째 fold(collect)나 지점별 예외 표를 둘지(§4.1). 계획 v2의 fold 3종 결정(`_research/decisions-log.md` 20행)을 바꾸는 사안이다.
- [미결] first fail-closed를 `session_before_*`, `project_trust`에도 적용할지(§4.1).
- [결정: review.decisions-2 U-06] `tool_call`의 인자 변경은 지원하지 않는다(fold `first`, 허용·거부·결과 대체만). 인자를 바꾸면 의도 커밋과 실행 인자가 달라져 재생 판정이 복잡해진다. 인자 변경이 필요하면 2차에 pi 밖 이름의 chain 지점을 따로 더한다.
- [미결] 지점 5종 밖 이벤트(Xeon 고유 이벤트) 처리(§7).
- [미결] 지점 이름 표기: pi snake_case 정본과 조사 자료 점 표기의 별칭 허용 여부(§4.10).
- [미결] 능력·확장 이름 네임스페이스(예약 이름 목록, 외부 확장의 L2 도메인 이름 사용 금지). F.capabilities.spec §10과 함께 정한다.
- [미결] 매니페스트 신뢰 필드 범위: `trust.level` 값 집합과 매니페스트가 요청할 수 있는 범위. X.loading-trust.spec과 함께 정한다.
- 닫음: session 지점 15종의 발화 문서 배정(§7 표, `L1.readme` §6).
- [결정: review.decisions-2 U-07] 매니페스트 선택 필드 `storage`·`hooks`(`X.operations.spec` §10), 위임 선언 `delegates`(`L3.group-kit.spec`), `HandlerContext.ui` 포트는 M1에 넣지 않는다. M1 테스트 그룹은 on, post, drive, scope만 쓴다. 소비 문서는 이 필드에 의존하지 않는다.
- [결정: review.decisions-2 U-01] 켜기·끄기와 drive 임대 교대는 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에 적용한다(§4.5). F.conversation.spec §10 1번, F.readme §8 1번과 같은 항목이다.
- [미결] Cordis dispose와 `onDispose`의 관계. 정리 동작을 Cordis effect로만 둘지 F 타입에 남길지(X.primitives.spec과 함께).
