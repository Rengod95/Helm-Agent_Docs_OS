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

/** drive가 사람 확인 뒤에 실행할 요청 */
export type PendingAction = "trial" | "package" | "install" | "fix_limit";

interface TrialResult {
  readonly threadId: string;
}
interface PackageResult {
  readonly path: string;
  readonly sha256: string;
  readonly files: number;
}
interface InstallResult {
  readonly name: string;
  readonly version: string;
  readonly location: string;
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
  readonly installed: InstallResult | null;
  /** 사용자가 확인을 거절한 요청. 같은 요청을 다시 하면 새 확인을 받는다(`askRound`가 오른다) */
  readonly denied: PendingAction | null;
  /** 확인 질문마다 오르는 번호. requestId를 가르는 값이라 거절 뒤 다시 물을 수 있다 */
  readonly askRound: number;
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
  installed: null,
  denied: null,
  askRound: 0,
};

const nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()]);

const shape = Type.Object(
  {
    phase: Type.Union(AUTHORING_PHASES.map((phase) => Type.Literal(phase))),
    sessionId: nullable(Type.String({ minLength: 1, maxLength: 80 })),
    kind: Type.Union([Type.Literal("single-plugin"), Type.Literal("plugin-group"), Type.Null()]),
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
      Type.Literal("install"),
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
    installed: Type.Union([
      Type.Object(
        {
          name: Type.String({ maxLength: 64 }),
          version: Type.String({ maxLength: 64 }),
          location: Type.String({ maxLength: 1024 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    denied: Type.Union([
      Type.Literal("trial"),
      Type.Literal("package"),
      Type.Literal("install"),
      Type.Literal("fix_limit"),
      Type.Null(),
    ]),
    askRound: Type.Integer({ minimum: 0 }),
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
