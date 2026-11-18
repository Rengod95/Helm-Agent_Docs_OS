import type { SchemaProof } from "@fresnel/contracts";
import { CompositionDeclSchema, type CompositionDecl } from "@fresnel/contracts/extensions";
import type { ExtensionKind } from "@fresnel/contracts/services";
import { Type, type TUnsafe } from "typebox";

// L3.authoring.spec §4.1 제작 대화 단계 머신의 상태 문서. 모든 전이는 이 문서의 커밋이다.
// 도구는 요청(`pending`)만 커밋하고, 사람 확인이 필요한 단계는 drive가 `loop.ask`로 받은 뒤 실행하고 결과를 커밋한다.

export const AUTHORING_PHASES = [
  "idle",
  "intent",
  "compose",
  "scaffold",
  "validate",
  "fix",
  "trial",
  "replay",
  "package",
  "done",
] as const;
export type AuthoringPhase = (typeof AUTHORING_PHASES)[number];

/** drive가 사람 확인 뒤에 실행할 요청. 제출(`authoring_submit`)은 확인을 묻지 않는다(group-tools.ts 주석) */
export type PendingAction = "trial" | "package" | "fix_limit";

interface TrialResult {
  readonly threadId: string;
}
interface PackageResult {
  readonly path: string;
  readonly sha256: string;
  readonly files: number;
}
/** 검토함으로 보낸 결과(`pluginReview.submitDraft`가 만든 항목). 설치가 아니라서 검토 항목의 id를 적는다 */
interface SubmitResult {
  readonly draftId: string;
  readonly itemId: string;
}

export interface AuthoringState {
  readonly phase: AuthoringPhase;
  readonly sessionId: string | null;
  readonly kind: ExtensionKind | null;
  readonly name: string | null;
  /** 대상 폴더(절대 경로). 쓰기 범위 가드가 읽는다 */
  readonly dir: string | null;
  readonly displayName: string | null;
  /** intent 단계의 `loop.ask`에서 종류와 이름을 확인했는가 */
  readonly intentConfirmed: boolean;
  readonly composition: CompositionDecl | null;
  /** 뼈대가 만든 파일(dir 기준 상대 경로) */
  readonly files: readonly string[];
  /** 마지막 검사의 오류 지문(정렬한 코드와 경로). 같으면 고치기 반복이 제자리다 */
  readonly lastErrorKey: string | null;
  readonly sameErrorRuns: number;
  /** drive가 실행을 기다리는 요청 */
  readonly pending: PendingAction | null;
  /** package 요청의 `out`. 없으면 기본 위치 */
  readonly packOut: string | null;
  readonly replay: "none" | "dev_mode_required" | "passed" | "failed";
  readonly trial: TrialResult | null;
  readonly packaged: PackageResult | null;
  readonly submitted: SubmitResult | null;
  /** 사용자가 확인을 거절한 요청. 같은 요청을 다시 하면 새 확인을 받는다(`askRound`가 오른다) */
  readonly denied: PendingAction | null;
  /** 확인 질문마다 오르는 번호. requestId를 가르는 값이라 거절 뒤 다시 물을 수 있다 */
  readonly askRound: number;
  /** 사용자가 맡긴 목적 한 문장(맡기기의 `purpose`, 또는 `authoring_start`의 `purpose`). 초안 매니페스트의 `purpose`가 된다(M5c §4.9.6) */
  readonly purpose: string | null;
  /** 상주 모드(`authoring_start`의 `resident`). 참이면 검토함으로 보낸 뒤에도 물러나지 않고 다음 사용자 입력을 기다린다(M5c §4.8.6) */
  readonly resident: boolean;
  /** 기존 플러그인의 원본 폴더에서 시작했다(`authoring_start`에 이름만 줬다). 뼈대를 만들지 않고 검사부터 한다(M5c §4.9.3) */
  readonly fromSource: boolean;
}

export const INITIAL_AUTHORING_STATE: AuthoringState = {
  phase: "idle",
  sessionId: null,
  kind: null,
  name: null,
  dir: null,
  displayName: null,
  intentConfirmed: false,
  composition: null,
  files: [],
  lastErrorKey: null,
  sameErrorRuns: 0,
  pending: null,
  packOut: null,
  replay: "none",
  trial: null,
  packaged: null,
  submitted: null,
  denied: null,
  askRound: 0,
  purpose: null,
  resident: false,
  fromSource: false,
};

/**
 * 상태 문서 판. v2에서 `installed`(설치 결과)가 `submitted`(검토 제출 결과)로 바뀌었다.
 * v3에서 종류는 플러그인 하나뿐이 되었다(옛 그룹 종류로 저장된 `kind`는 `authoringStateMigrations`가 옮긴다). 옛 판은 그 표가 한 판씩 옮긴다.
 * v4에서 목적(`purpose`), 상주(`resident`), 원본 폴더 시작(`fromSource`)이 더해졌다. 옛 문서는 셋 다 꺼진 값으로 옮긴다
 */
export const AUTHORING_STATE_VERSION = 4;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * v1 → v2. 설치 결과는 검토 항목 id가 없어 `submitted`로 옮길 수 없으므로 null이다([제안]).
 * 설치로 끝난 대화는 단계 `done`이 그대로 남는다. 설치 요청이던 `pending`과 `denied`의 "install"은 v2에 없어 null이다.
 * 이미 v2 모양인 문서는 그대로 둔다(같은 판에서 다시 옮겨도 같다). 모양이 아닌 입력은 그대로 돌려주고, 검사는 스키마가 Result로 거른다.
 */
function v1ToV2(previous: unknown): unknown {
  if (!isRecord(previous)) return previous;
  const { installed: _installed, ...rest } = previous;
  return {
    ...rest,
    pending: rest.pending === "install" ? null : (rest.pending ?? null),
    denied: rest.denied === "install" ? null : (rest.denied ?? null),
    submitted: rest.submitted ?? null,
  };
}

/**
 * v2 → v3. 종류는 플러그인 하나뿐이라 옛 그룹 종류로 저장된 `kind`는 `single-plugin`으로 옮긴다
 * (review/m5/profile-project-loader.md §4.9.5: 옛 종류로 만든 폴더는 플러그인으로 읽는다). 다른 값은 그대로 둔다(검사는 스키마가 Result로 거른다).
 * 옛 종류 문자열이 코드에 남는 자리는 이 함수뿐이다.
 */
function v2ToV3(previous: unknown): unknown {
  if (!isRecord(previous) || previous["kind"] !== "plugin-group") return previous;
  return { ...previous, kind: "single-plugin" };
}

/**
 * v3 → v4. 목적, 상주, 원본 폴더 시작은 옛 문서에 없었으므로 null·거짓이다. 이미 있는 값은 그대로 둔다(같은 판에서 다시 옮겨도 같다).
 * 모양이 아닌 입력은 그대로 돌려주고, 검사는 스키마가 Result로 거른다
 */
function v3ToV4(previous: unknown): unknown {
  if (!isRecord(previous)) return previous;
  return { purpose: null, resident: false, fromSource: false, ...previous };
}

/** GroupDef.migrations. 키는 출발 판(L3.group-sdk.spec §4.7). 판 1은 키 1, 판 2는 키 2로 한 판씩 옮긴다 */
export const authoringStateMigrations: Readonly<Record<number, (previous: unknown) => unknown>> = {
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
};

const nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()]);

const shape = Type.Object(
  {
    phase: Type.Union(AUTHORING_PHASES.map((phase) => Type.Literal(phase))),
    sessionId: nullable(Type.String({ minLength: 1, maxLength: 80 })),
    kind: Type.Union([Type.Literal("single-plugin"), Type.Null()]),
    name: nullable(Type.String({ minLength: 1, maxLength: 64 })),
    dir: nullable(Type.String({ minLength: 1, maxLength: 1024 })),
    displayName: nullable(Type.String({ maxLength: 120 })),
    intentConfirmed: Type.Boolean(),
    composition: Type.Union([CompositionDeclSchema, Type.Null()]),
    files: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 512 }),
    lastErrorKey: nullable(Type.String({ maxLength: 2048 })),
    sameErrorRuns: Type.Integer({ minimum: 0 }),
    pending: Type.Union([
      Type.Literal("trial"),
      Type.Literal("package"),
      Type.Literal("fix_limit"),
      Type.Null(),
    ]),
    packOut: nullable(Type.String({ maxLength: 1024 })),
    replay: Type.Union([
      Type.Literal("none"),
      Type.Literal("dev_mode_required"),
      Type.Literal("passed"),
      Type.Literal("failed"),
    ]),
    trial: Type.Union([
      Type.Object({ threadId: Type.String({ maxLength: 128 }) }, { additionalProperties: false }),
      Type.Null(),
    ]),
    packaged: Type.Union([
      Type.Object(
        {
          path: Type.String({ maxLength: 1024 }),
          sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
          files: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    submitted: Type.Union([
      Type.Object(
        {
          draftId: Type.String({ minLength: 1, maxLength: 128 }),
          itemId: Type.String({ minLength: 1, maxLength: 128 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    denied: Type.Union([
      Type.Literal("trial"),
      Type.Literal("package"),
      Type.Literal("fix_limit"),
      Type.Null(),
    ]),
    askRound: Type.Integer({ minimum: 0 }),
    purpose: nullable(Type.String({ minLength: 1, maxLength: 200 })),
    resident: Type.Boolean(),
    fromSource: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuthoringStateSchema: TUnsafe<AuthoringState> = Type.Unsafe<AuthoringState>(
  shape satisfies SchemaProof<AuthoringState, typeof shape>,
);

/** 대화가 열려 있는가(쓰기 범위 가드가 켜진다). 끝났거나 시작 전이면 풀린다 */
export function sessionOpen(state: Readonly<AuthoringState>): boolean {
  return state.phase !== "idle" && state.phase !== "done" && state.dir !== null;
}

/** 오류 지문. 같은 오류가 남았는지 본다 */
export function errorKeyOf(
  issues: readonly { readonly severity: string; readonly code: string; readonly path: string }[],
): string | null {
  const keys = issues
    .filter((entry) => entry.severity === "error")
    .map((entry) => `${entry.code}@${entry.path}`)
    .toSorted();
  return keys.length === 0 ? null : keys.join("|");
}
