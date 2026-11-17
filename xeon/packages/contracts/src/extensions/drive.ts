import { Type, type TUnsafe } from "typebox";
import type { SchemaProof, SchemaSound } from "../base/schema-proof.ts";
import {
  ItemIdSchema,
  JsonObjectSchema,
  JsonValueSchema,
  StopReasonSchema,
  ThreadIdSchema,
  TurnIdSchema,
  type ItemId,
  type JsonObject,
  type JsonValue,
  type ThreadId,
  type TurnId,
} from "../conversation/index.ts";
import type {
  PluginModelMessage,
  PluginModelValue,
  ToolResultView,
} from "../capabilities/index.ts";
import {
  QuestionApprovalDetailSchema,
  type ApprovalResolvedPayload,
  type QuestionAnswerJson,
  type QuestionApprovalDetail,
} from "../records/index.ts";
import { PostItemSchema, type PostItem } from "./post.ts";
import { ExtensionNameSchema } from "./name.ts";
import type { DriveLockId, RegistrationId } from "./registration-id.ts";

export interface DriveLimits {
  readonly maxTurns?: number;
  readonly maxSpawns?: number;
  readonly maxTokens?: number;
}

export interface DriveOptions {
  /** 그룹이 요청하는 상한. 없는 필드는 X 기본값 `x.primitives.driveDefaultLimits`를 쓰고, 천장 `x.primitives.driveLimits`보다 클 수 없다 */
  readonly limits?: DriveLimits;
}

/** 남은 예산. null은 상한 없음 */
export interface DriveLockBudget {
  readonly turns: number | null;
  readonly spawns: number | null;
  readonly tokens: number | null;
}

/** drive 함수의 `loop.turn()` 입력. wire의 TurnStartInput과 모양이 달라 이름을 나눈다 */
export interface TurnInput {
  readonly input: PostItem;
  /**
   * 생략하면 X가 `${leaseId}:${순번}`으로 결정적으로 만든다. 같은 순서의 재호출은 커밋된 결과를 돌려받는다.
   * 명시하면 같은 커밋 상태와 페이로드에서 같은 값이 나와야 한다(ADR-0015 §3.4 1)
   */
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
  /** 사람에게 보일 이름(승인 카드의 출처). 예: "렌즈 실패 사례". 1~64자, 생략하면 정의 이름 */
  readonly label?: string;
}

export interface SpawnOutcome {
  readonly childThreadId: ThreadId;
  readonly status: "completed" | "aborted" | "error";
  readonly answer?: string;
}

/** `loop.ask`가 사용자에게 보이는 질문 카드. ADR-0018 question kind의 본문과 같다(질문 1~4개) */
export type AskCard = QuestionApprovalDetail;

export interface AskRequest {
  /**
   * 필수, 1~64자. 같은 대화에서 같은 `requestId`의 재호출은 새 승인을 만들지 않고 기록된 답을 돌려준다.
   * 결정적이어야 한다(ADR-0015 §3.4). Registration id로 시작하는 이름을 권한다
   */
  readonly requestId: string;
  readonly card: AskCard;
  /** 승인 카드 제목 1~120자. 생략하면 플러그인 그룹 표시 이름 */
  readonly title?: string;
}

/** 승인 응답의 결과. 질문에 답했거나(`answered`), 거부·취소·만료·비대화형 처리로 끝났다(`denied`) */
export type AskOutcome =
  | { readonly status: "answered"; readonly answer: QuestionAnswerJson }
  | {
      readonly status: "denied";
      readonly resolvedBy: ApprovalResolvedPayload["resolvedBy"];
      readonly feedback?: string;
    };

const AskRequestShape = Type.Object(
  {
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    card: QuestionApprovalDetailSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);
export const AskRequestSchema: TUnsafe<AskRequest> = Type.Unsafe<AskRequest>(
  AskRequestShape satisfies SchemaProof<AskRequest, typeof AskRequestShape>,
);

/** 엔진이 단계 함수에 주는 프레임 정보. `frameDepth`는 코어 0, 첫 플러그인 프레임 1이다 */
export interface DriveFrameInfo {
  /** frameDepth는 코어 0, 첫 플러그인 프레임 1 */
  readonly frameDepth: number;
  /** 맡긴 쪽 플러그인 이름(`handoff`, E3). 사용자 명령이나 프로필 시작이면 null */
  readonly calledBy: string | null;
  /** 맡길 때 넘긴 입력(E3). 없으면 null */
  readonly input: JsonValue | null;
}

/**
 * 주도권 스택의 프레임 하나를 읽는 모양(`drive.frames`, drive-isolation.md 2.6). 스택 전체를 아래에서 위 순서로 준다.
 * 맨 아래 프레임이 코어 루프(depth 0)이고 plugin·versionId·leaseId가 null이다. 플러그인 프레임의 depth는
 * 스택 인덱스(`lease.acquired.depth`)에 1을 더한 값이다.
 */
export interface DriveFrameView {
  /** 코어 루프 0, 첫 플러그인 프레임 1 */
  readonly depth: number;
  /** 플러그인 이름. 코어 루프면 null */
  readonly plugin: string | null;
  /** 그 플러그인의 versionId. 코어 루프이거나 기록에 없으면 null */
  readonly versionId: string | null;
  /** 임대 id(`lease.acquired.leaseId`). 코어 루프면 null */
  readonly leaseId: string | null;
  /** driving: 주도 중. waiting: 맡겨서 위 프레임을 기다림. asking: 사람의 답을 기다림(임대는 반납하지 않는다) */
  readonly state: "driving" | "waiting" | "asking";
  /** 이 프레임이 쓴 양. 스택 아래 프레임의 사용량에도 더해진다 */
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
  /** 이 프레임의 상한. 없는 필드는 그 항목에 상한이 없다 */
  readonly limits: { readonly turns?: number; readonly spawns?: number; readonly tokens?: number };
}

const DriveFrameViewShape = Type.Object(
  {
    depth: Type.Integer({ minimum: 0 }),
    plugin: Type.Union([ExtensionNameSchema, Type.Null()]),
    versionId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    leaseId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    state: Type.Union([Type.Literal("driving"), Type.Literal("waiting"), Type.Literal("asking")]),
    used: Type.Object(
      {
        turns: Type.Integer({ minimum: 0 }),
        spawns: Type.Integer({ minimum: 0 }),
        tokens: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    limits: Type.Object(
      {
        turns: Type.Optional(Type.Integer({ minimum: 0 })),
        spawns: Type.Optional(Type.Integer({ minimum: 0 })),
        tokens: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const DriveFrameViewSchema: TUnsafe<DriveFrameView> = Type.Unsafe<DriveFrameView>(
  DriveFrameViewShape satisfies SchemaProof<DriveFrameView, typeof DriveFrameViewShape>,
);

/** 단계 함수의 입력. 엔진이 한 단계마다 새로 만들어 준다 */
export interface DriveStepInput<S> {
  /** 플러그인의 커밋된 상태 문서 */
  readonly state: Readonly<S>;
  /** 직전 명령의 결과. 이 호출의 첫 단계이면 null */
  readonly last: StepResult | null;
  /** 남은 한도를 값으로 준다 */
  readonly budget: DriveLockBudget;
  readonly frame: DriveFrameInfo;
}

/** `turn`, `model`, `tool`, `spawn`의 명령 공통: 생략하면 엔진이 `${lineageId}:${상태 판}.${단계 번호}`로 결정적으로 만든다(ADR-0015 §3.4 1) */
export interface DriveCommandBase {
  readonly requestId?: string;
}

/** `model` 명령의 메시지 한 개. 모델 호출의 값(`PluginModelMessage`)과 같다 */
export type DriveModelMessage = PluginModelMessage;

/**
 * 단계 함수가 돌려주는 명령 하나(drive-isolation.md §1.1). `turn`, `model`, `tool`, `ask`, `spawn`, `commit`, `yield`, `done`은
 * 엔진이 실행한다. `handoff`는 자리만 있고 E2 엔진은 `{ kind: "refused", code: "command_unavailable" }`를 `last`로 돌려준다(예외 아님)
 */
export type DriveCommand<S> =
  | (DriveCommandBase & { readonly do: "turn"; readonly input: PostItem; readonly note?: string })
  | (DriveCommandBase & {
      readonly do: "model";
      readonly messages: readonly DriveModelMessage[];
      readonly label?: string;
    })
  /** 도구 실행 한 번. 관문 전체를 지난다(`ToolsPort.executeForPlugin`). 횟수 한도는 없고 토큰 소진만 막는다 */
  | (DriveCommandBase & { readonly do: "tool"; readonly name: string; readonly args: JsonValue })
  | {
      readonly do: "ask";
      readonly card: AskCard;
      /** 필수 아님: 생략하면 엔진이 만든 요청 id를 쓴다. 승인 카드 제목 1~120자 */
      readonly title?: string;
      readonly requestId?: string;
    }
  | (DriveCommandBase & {
      readonly do: "spawn";
      readonly agent: string;
      readonly task: string;
      readonly background?: boolean;
      readonly label?: string;
    })
  | { readonly do: "handoff"; readonly to: string; readonly input: JsonValue }
  /** 상태를 남기고 `next`를 이어서 실행한다. `next`가 또 `commit`이어도 된다. (스펙 초안의 `then`은 unicorn/no-thenable이 막아 `next`로 했다) */
  | { readonly do: "commit"; readonly state: S; readonly next: DriveCommand<S> }
  /** 지금은 할 일 없음. 주도권은 유지하고 다음 경계에 다시 묻는다 */
  | { readonly do: "yield" }
  /** 끝. 주도권을 내려놓는다(반납 사유 `done`) */
  | { readonly do: "done"; readonly result?: JsonValue };

/** 훅이나 정책이 명령을 만든 쪽 */
export interface StepHookSource {
  readonly plugin: string | null;
  readonly hook: string | null;
}

/**
 * 엔진이 다음 단계의 `last`로 주는 값(drive-isolation.md §1.1). 명령 결과, 훅의 결정, 사용자 메시지, 맡기기 복귀의 합집합이다.
 * `turn`과 `spawn`의 `value`는 정본 결과 모양이고(둘 다 JSON), `model`은 응답 글과 사용량, `tool`은 도구 결과 뷰다
 */
export type StepResult =
  | { readonly kind: "ok"; readonly of: "turn"; readonly value: TurnOutcome }
  | { readonly kind: "ok"; readonly of: "spawn"; readonly value: SpawnOutcome }
  | { readonly kind: "ok"; readonly of: "model"; readonly value: PluginModelValue }
  | { readonly kind: "ok"; readonly of: "tool"; readonly value: ToolResultView }
  | {
      readonly kind: "ask";
      readonly answer: "answered" | "cancelled" | "expired" | "noninteractive";
      readonly value: JsonValue | null;
    }
  | { readonly kind: "blocked"; readonly by: StepHookSource; readonly reason: string }
  | {
      readonly kind: "denied";
      readonly by: "policy" | "human" | "noninteractive";
      readonly reason: string | null;
    }
  | { readonly kind: "replaced"; readonly by: StepHookSource; readonly value: JsonValue | null }
  /** 깊이 상한, 아직 없는 명령(`command_unavailable`) 같은 거부. 예외가 아니다 */
  | { readonly kind: "refused"; readonly code: string }
  | { readonly kind: "aborted" }
  | { readonly kind: "user"; readonly message: PostItem }
  | {
      readonly kind: "handoff";
      readonly status: "done" | "aborted";
      readonly result: JsonValue | null;
    };

/**
 * 주도 단계 함수. 엔진이 입력을 주면 명령 하나를 돌려준다. 클로저 지역 변수에 진행 상태를 두지 않는다:
 * 같은 단계가 재시작 뒤 다시 돌 수 있으므로 상태 문서와 `last`만 보고 정한다(F.extensions.spec §4.6)
 */
export type DriveStep<S> = (input: DriveStepInput<S>) => Promise<DriveCommand<S>>;

export interface DriveLock {
  readonly leaseId: DriveLockId;
  readonly scopeId: RegistrationId;
  readonly limits: DriveLimits;
  readonly status: "active" | "releasing" | "released";
}

// ── 격리 프로토콜의 검사 모양(drive-isolation.md 1.1, 3.2). 엔진이 자식이 돌려준 명령과 자식이 받은 `last`를 여기로 검사한다 ──

const DriveLimitsShape = Type.Object(
  {
    maxTurns: Type.Optional(Type.Integer({ minimum: 0 })),
    maxSpawns: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
/** 한도 옵션의 검사. 프로토콜의 `drive` 선언과 `drive.step` 응답이 쓴다 */
export const DriveLimitsSchema: TUnsafe<DriveLimits> = Type.Unsafe<DriveLimits>(
  DriveLimitsShape satisfies SchemaProof<DriveLimits, typeof DriveLimitsShape>,
);

const DriveLockBudgetShape = Type.Object(
  {
    turns: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    spawns: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    tokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
/** 남은 예산(`null`은 상한 없음)의 검사 */
export const DriveLockBudgetSchema: TUnsafe<DriveLockBudget> = Type.Unsafe<DriveLockBudget>(
  DriveLockBudgetShape satisfies SchemaProof<DriveLockBudget, typeof DriveLockBudgetShape>,
);

const DriveFrameInfoShape = Type.Object(
  {
    frameDepth: Type.Integer({ minimum: 0 }),
    calledBy: Type.Union([ExtensionNameSchema, Type.Null()]),
    input: Type.Union([JsonValueSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
/** 프레임 정보의 검사(`DriveStepInput.frame`) */
export const DriveFrameInfoSchema: TUnsafe<DriveFrameInfo> = Type.Unsafe<DriveFrameInfo>(
  DriveFrameInfoShape satisfies SchemaProof<DriveFrameInfo, typeof DriveFrameInfoShape>,
);

const StepHookSourceShape = Type.Object(
  {
    plugin: Type.Union([Type.String(), Type.Null()]),
    hook: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

const StepResultShape = Type.Union([
  Type.Object({
    kind: Type.Literal("ok"),
    of: Type.Literal("turn"),
    value: Type.Object(
      {
        turnId: TurnIdSchema,
        status: Type.Union([
          Type.Literal("completed"),
          Type.Literal("aborted"),
          Type.Literal("error"),
        ]),
        finalItemId: Type.Optional(ItemIdSchema),
      },
      { additionalProperties: false },
    ),
  }),
  Type.Object({
    kind: Type.Literal("ok"),
    of: Type.Literal("spawn"),
    value: Type.Object(
      {
        childThreadId: ThreadIdSchema,
        status: Type.Union([
          Type.Literal("completed"),
          Type.Literal("aborted"),
          Type.Literal("error"),
        ]),
        answer: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  }),
  Type.Object({
    kind: Type.Literal("ok"),
    of: Type.Literal("model"),
    value: Type.Object(
      {
        text: Type.String(),
        usage: Type.Union([
          Type.Object(
            { input: Type.Number(), output: Type.Number(), total: Type.Number() },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
        stopReason: StopReasonSchema,
      },
      { additionalProperties: false },
    ),
  }),
  Type.Object({
    kind: Type.Literal("ok"),
    of: Type.Literal("tool"),
    value: Type.Object(
      {
        content: Type.String(),
        structuredContent: Type.Union([JsonValueSchema, Type.Null()]),
        isError: Type.Boolean(),
        details: Type.Union([JsonValueSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
  }),
  Type.Object({
    kind: Type.Literal("ask"),
    answer: Type.Union([
      Type.Literal("answered"),
      Type.Literal("cancelled"),
      Type.Literal("expired"),
      Type.Literal("noninteractive"),
    ]),
    value: JsonValueSchema,
  }),
  Type.Object({ kind: Type.Literal("blocked"), by: StepHookSourceShape, reason: Type.String() }),
  Type.Object({
    kind: Type.Literal("denied"),
    by: Type.Union([Type.Literal("policy"), Type.Literal("human"), Type.Literal("noninteractive")]),
    reason: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("replaced"), by: StepHookSourceShape, value: JsonValueSchema }),
  Type.Object({ kind: Type.Literal("refused"), code: Type.String() }),
  Type.Object({ kind: Type.Literal("aborted") }),
  Type.Object({ kind: Type.Literal("user"), message: PostItemSchema }),
  Type.Object({
    kind: Type.Literal("handoff"),
    status: Type.Union([Type.Literal("done"), Type.Literal("aborted")]),
    result: JsonValueSchema,
  }),
]);
/** 직전 명령의 결과(`StepResult`)이거나 첫 단계의 null. 격리 자식이 `drive.step`의 `last`를 받을 때 쓴다 */
const DriveStepLastShape = Type.Union([StepResultShape, Type.Null()]);
export const DriveStepLastSchema: TUnsafe<StepResult | null> = Type.Unsafe<StepResult | null>(
  DriveStepLastShape satisfies SchemaSound<StepResult | null, typeof DriveStepLastShape>,
);

const DriveCommandCyclic = Type.Cyclic(
  {
    DriveCommand: Type.Union([
      Type.Object(
        {
          do: Type.Literal("turn"),
          input: PostItemSchema,
          note: Type.Optional(Type.String()),
          requestId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          do: Type.Literal("model"),
          messages: Type.Array(
            Type.Object(
              {
                role: Type.Union([
                  Type.Literal("system"),
                  Type.Literal("user"),
                  Type.Literal("assistant"),
                ]),
                content: Type.String(),
              },
              { additionalProperties: false },
            ),
          ),
          label: Type.Optional(Type.String()),
          requestId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          do: Type.Literal("tool"),
          name: Type.String(),
          args: JsonValueSchema,
          requestId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          do: Type.Literal("ask"),
          card: QuestionApprovalDetailSchema,
          title: Type.Optional(Type.String()),
          requestId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          do: Type.Literal("spawn"),
          agent: Type.String(),
          task: Type.String(),
          requestId: Type.Optional(Type.String()),
          background: Type.Optional(Type.Boolean()),
          label: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { do: Type.Literal("handoff"), to: Type.String(), input: JsonValueSchema },
        { additionalProperties: false },
      ),
      Type.Object(
        { do: Type.Literal("commit"), state: JsonObjectSchema, next: Type.Ref("DriveCommand") },
        { additionalProperties: false },
      ),
      Type.Object({ do: Type.Literal("yield") }, { additionalProperties: false }),
      Type.Object(
        { do: Type.Literal("done"), result: Type.Optional(JsonValueSchema) },
        { additionalProperties: false },
      ),
    ]),
  },
  "DriveCommand",
);
/**
 * 단계 함수가 돌려준 명령의 검사(격리 자식이 낸 것). 상태 문서는 JSON 객체다(엔진 안의 `StateDecl`도 객체다).
 * 모양이 맞지 않으면 엔진은 그 단계를 오류로 처리한다(drive-isolation.md 2.4, 3.3)
 */
export const DriveCommandSchema: TUnsafe<DriveCommand<JsonObject>> = Type.Unsafe<
  DriveCommand<JsonObject>
>(DriveCommandCyclic satisfies SchemaSound<DriveCommand<JsonObject>, typeof DriveCommandCyclic>);
