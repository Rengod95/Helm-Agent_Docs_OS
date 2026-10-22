import type { TSchema } from "typebox";
import type { Result } from "../base/index.ts";
import type { ServiceKey } from "../capabilities/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import type { GroupRecord, RecordKind, RecordSubject } from "./group-record.ts";
import type { ExtensionManifest } from "./manifest.ts";
import type { ExtensionOps } from "./ops.ts";
import type { ScopeId } from "./scope-id.ts";

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
  /**
   * 비공개 기록. kind는 자기 접두(그룹 grp.<name>.*, 플러그인 x.<name>.*)만 받는다.
   * 다른 확장의 readRecords로 조회되지 않는다. 의미와 멱등 키 규칙은 X.primitives.spec이 정한다
   * [결정(잠정): review.decisions-2 T-21]
   */
  recordPrivate(kind: RecordKind, payload: JsonValue): Promise<void>;
  /** 능력 서비스 API. key의 능력은 매니페스트 requires나 optional에 있어야 한다 */
  capability<Api>(key: ServiceKey<Api>): Api;
  /** 비활성화나 언로드 때 실행할 정리 동작 */
  onDispose(fn: () => void | Promise<void>): void;
}

/** setup이 시작할 수 없다고 알리는 값. 디렉터리 준비 실패나 저장소 열기 실패 같은 예상 가능한 시작 실패다(TY-24) */
export interface SetupRefusal {
  /** 짧은 이유 이름. 예: 그 모듈 시작 오류의 kind */
  readonly reason: string;
  readonly cause: unknown;
}

/** 시작할 수 없으면 err(SetupRefusal)을 돌려준다. 던지면 버그나 확장 코드의 실패로 기록된다 */
export type ScopeSetupResult = void | Result<void, SetupRefusal>;

export type ScopeSetup<S> = (g: ScopeApi<S>) => ScopeSetupResult | Promise<ScopeSetupResult>;

export type ScopeStatus = "enabled" | "enabling" | "disabled" | "disabling";

export interface ScopeHandle {
  readonly id: ScopeId;
  readonly status: ScopeStatus;
  /** 요청만 기록한다. 적용은 다음 단계 경계(F.extensions.spec §4.5) */
  enable(): void;
  disable(): void;
}

export type ScopeFn = <S>(id: ScopeId, def: ScopeDef<S>, setup: ScopeSetup<S>) => ScopeHandle;

/** 확장 엔트리 모듈의 default export 형식 [제안]. F 코드는 default export를 쓰지 않는다 */
export type ExtensionEntry = (host: {
  readonly manifest: ExtensionManifest;
  readonly scope: ScopeFn;
}) => void | Promise<void>;
