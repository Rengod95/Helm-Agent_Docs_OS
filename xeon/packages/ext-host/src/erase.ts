import type { ServiceKey } from "@xeon/contracts/capabilities";
import type {
  DriveFn,
  Handler,
  PointName,
  PortKey,
  ScopeDef,
  ScopeSetup,
  ChainPointName,
  ChainRule,
  CollectPointName,
  CollectRule,
} from "@xeon/contracts/extensions";
import { CHAIN_RULES, COLLECT_RULES } from "@xeon/contracts/extensions";
import type {
  ExtReaders,
  ExtTableReader,
  ExtTableWriter,
  ExtWriters,
} from "./operations/storage/table-types.ts";
import type { ExtTableDefs } from "./operations/storage/tables.ts";
import type { AnyState, DriveCall } from "./primitives/erased-types.ts";
import type {
  AnyDispatchOptions,
  AnyDispatchOutcome,
  DispatchOptions,
  DispatchOutcome,
} from "./primitives/dispatch-types.ts";
import type { HandlerEntry } from "./primitives/registry.ts";

// 타입 지움과 복원이 일어나는 유일한 파일이다(eng.typescript.guide TY-06 허용 목록 A3).
// 이종 레지스트리(핸들러, 포트, 능력, scope 정의)는 값을 `unknown`이나 지운 타입으로 보관하고,
// 키에 실린 타입 매개변수로만 되돌린다. 단언은 모두 이 파일에 있고 줄마다 사유를 단다.

/** 서비스 키로 보관해 둔 값을 키의 타입으로 되돌린다. 공급자가 같은 키로 provide했다(F.capabilities.spec §3.5) */
export function serviceAs<Api>(_key: ServiceKey<Api>, service: unknown): Api {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 키 레지스트리 조회: ServiceKey<Api>의 Api는 팬텀 타입이고 공급자가 같은 키로 provide했다 (eng.typescript.guide TY-06)
  return service as Api;
}

/** 포트 키로 보관해 둔 값을 키의 타입으로 되돌린다. 공급자가 같은 키로 provide했다(F.extensions.spec §3.2.1) */
export function portAs<Api>(_key: PortKey<Api>, service: unknown): Api {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 키 레지스트리 조회: PortKey<Api>의 Api는 팬텀 타입이고 공급자가 같은 키로 provide했다 (eng.typescript.guide TY-06)
  return service as Api;
}

/** 지점 종류를 지운 핸들러 함수. 디스패처가 POINTS[point].fold에 맞는 인자로만 부른다(X.primitives.spec §4.2) */
export function eraseHandler<N extends PointName>(handler: Handler<N>): HandlerEntry["fn"] {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: 핸들러 시그니처는 fold별 조건부 타입이다 (eng.typescript.guide TY-06)
  return handler as unknown as HandlerEntry["fn"];
}

/** 상태 타입 S를 지운 drive 함수. 호출은 StateDecl.schema로 검증된 문서만 넘긴다(X.primitives.spec §4.4.3) */
export function eraseDrive<S>(fn: DriveFn<S>): DriveCall {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: 상태 타입 S를 지운다 (eng.typescript.guide TY-06)
  return fn as unknown as DriveCall;
}

/** 상태 타입 S를 지운 scope 정의와 setup. 같은 정의에서 만든 g만 setup에 넘긴다 */
export function eraseScope<S>(
  def: ScopeDef<S>,
  setup: ScopeSetup<S>,
): { readonly def: ScopeDef<AnyState>; readonly setup: ScopeSetup<AnyState> } {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: 상태 타입 S를 지운 보관용 정의 (eng.typescript.guide TY-06)
    def: def as unknown as ScopeDef<AnyState>,
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: setup은 g: ScopeApi<S>를 받고 같은 정의의 g만 넘긴다 (eng.typescript.guide TY-06)
    setup: setup as unknown as ScopeSetup<AnyState>,
  };
}

/** 타입만 싣는 증인. 값은 없고 반환 타입 T를 호출자가 정한다(erase.ts가 primitives를 import하지 않게 하는 장치) */
export interface TypeWitness<T> {
  readonly witness?: T;
}

/** 상태 타입 S를 지운 보관 값을 증인의 타입으로 되돌린다. 보관한 쪽이 같은 정의에서 만들었다(예: scope의 부가 API) */
export function restoreAs<T>(_witness: TypeWitness<T>, stored: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 복원: 보관한 값은 증인의 타입과 같은 정의에서 만들어졌다 (eng.typescript.guide TY-06)
  return stored as T;
}

/** 스키마 검사를 거친 상태 문서를 지운 상태 타입으로 본다 */
export function stateAs(doc: unknown): AnyState {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: 문서는 StateDecl.schema 검사를 거친 값이다 (eng.typescript.guide TY-06)
  return doc as AnyState;
}

/** 지점 종류를 지운 병합 규칙. 입력은 PointDecl.result 스키마 검사를 거친 값뿐이다(X.primitives.spec §4.2) */
export function chainRuleOf(point: ChainPointName): ChainRule<unknown, unknown> {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: 지점별 병합 규칙의 제네릭 인자를 지운다 (eng.typescript.guide TY-06)
  return CHAIN_RULES[point] as unknown as ChainRule<unknown, unknown>;
}

/** 지점 종류를 지운 collect 병합 규칙. 기여는 PointDecl.result 스키마 검사를 거친 값뿐이다 */
export function collectRuleOf(point: CollectPointName): CollectRule<unknown, unknown> {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 지움: 지점별 병합 규칙의 제네릭 인자를 지운다 (eng.typescript.guide TY-06)
  return COLLECT_RULES[point] as unknown as CollectRule<unknown, unknown>;
}

/** 지점 이름 N이 옵션의 조건부 타입을 정한다. 지운 타입으로의 넓힘이라 단언이 필요 없다(X.primitives.spec §3.3) */
export function eraseDispatchOptions<N extends PointName>(
  options: DispatchOptions<N>,
): AnyDispatchOptions {
  return options;
}

/** 결과의 fold는 POINTS[N].fold와 항상 일치한다 */
export function restoreOutcome<N extends PointName>(
  outcome: Promise<AnyDispatchOutcome>,
  _point: N,
): Promise<DispatchOutcome<N>> {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 복원: 결과의 fold가 지점 표와 일치한다 (eng.typescript.guide TY-06)
  return outcome as unknown as Promise<DispatchOutcome<N>>;
}

type AnyRow = Readonly<Record<string, unknown>>;

/** 지역 이름 → 쓰기 도구. 키 집합은 defs와 같고 행 타입은 정의 D에서 유도되며 런타임 구조는 같다(X.operations.spec §3.4) */
export function writersOf<D extends ExtTableDefs>(
  defs: D,
  make: (local: string) => ExtTableWriter<AnyRow>,
): ExtWriters<D> {
  const entries = Object.keys(defs).map((local): [string, ExtTableWriter<AnyRow>] => [
    local,
    make(local),
  ]);
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 복원: 행 타입은 정의 D에서 유도된다 (eng.typescript.guide TY-06)
  return Object.fromEntries(entries) as unknown as ExtWriters<D>;
}

/** 지역 이름 → 읽기 도구. writersOf와 같은 사유다 */
export function readersOf<D extends ExtTableDefs>(
  defs: D,
  make: (local: string) => ExtTableReader<AnyRow>,
): ExtReaders<D> {
  const entries = Object.keys(defs).map((local): [string, ExtTableReader<AnyRow>] => [
    local,
    make(local),
  ]);
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 복원: 행 타입은 정의 D에서 유도된다 (eng.typescript.guide TY-06)
  return Object.fromEntries(entries) as unknown as ExtReaders<D>;
}

/** 지역 이름 → 실제 테이블 이름. 키 집합은 defs와 같다 */
export function namesOf<D extends ExtTableDefs>(
  defs: D,
  make: (local: string) => string,
): { readonly [K in keyof D]: string } {
  const entries = Object.keys(defs).map((local): [string, string] => [local, make(local)]);
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A3 타입 복원: 키 집합은 defs와 같다 (eng.typescript.guide TY-06)
  return Object.fromEntries(entries) as { readonly [K in keyof D]: string };
}
