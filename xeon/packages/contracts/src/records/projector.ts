import type { Result } from "../base/index.ts";
import type { EventId } from "../conversation/index.ts";
import type { CommitKey } from "./commit.ts";
import type { DurableEventEnvelope } from "./envelope.ts";
import type { EventKind } from "./kinds.ts";
import type { SqlRow, SqlValue } from "./sql.ts";

/** records는 extensions보다 낮아 같은 모양을 적는다(F.extensions.spec Unsubscribe) */
export type Unsubscribe = () => void;

/** 투영기가 받는 SQL 핸들. 소유 테이블 밖 문장은 테스트·디버그 빌드에서 Bug("store.prefix_not_owned") */
export interface ProjectionTx {
  run(sql: string, params?: readonly SqlValue[]): void;
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
}

export interface Projector {
  /** "core" | "cap.<도메인>" | "ext.<확장 이름>" */
  readonly name: string;
  /** 투영 규칙 버전. payload version과 독립(F.records.spec §3.7 규칙 5) */
  readonly version: number;
  /** 소유 테이블. core는 p_* 와 step_checkpoints, ext.<name>은 x_<name의 '-'를 '_'로>_<지역 이름> 만(지역 이름에 밑줄 없음) */
  readonly tables: readonly string[];
  /** 소유 테이블 DDL. 재생성 때 이 순서로 실행한다 */
  readonly ddl: readonly string[];
  /** 관심 kind. "all"이면 모든 내구 이벤트 */
  readonly kinds: readonly EventKind[] | "all";
  /** 업캐스트된 이벤트를 받는다. 동기, 순수, I/O 없음(EV-06) */
  apply(tx: ProjectionTx, event: DurableEventEnvelope): void;
}

export type ProjectorRegisterError =
  | { readonly kind: "name_taken"; readonly name: string }
  /** "core" */
  | { readonly kind: "name_reserved"; readonly name: string }
  | { readonly kind: "table_not_owned"; readonly name: string; readonly table: string }
  | { readonly kind: "table_taken"; readonly table: string; readonly owner: string };

export interface ProjectorFailure {
  readonly projector: string;
  readonly event: { readonly id: EventId; readonly kind: EventKind; readonly seq: number };
  readonly requestId: CommitKey;
  readonly message: string;
}

export interface ProjectorRegistry {
  /** 버전이 projector_state와 다르면 등록 전에 그 투영기만 재생성한다. 해제하면 테이블은 남는다 */
  register(projector: Projector): Result<{ dispose(): void }, ProjectorRegisterError>;
  list(): readonly {
    readonly name: string;
    readonly version: number;
    readonly tables: readonly string[];
  }[];
  /** 확장 투영기 apply 예외로 커밋이 롤백되었을 때 알린다. X가 확장을 끄는 데 쓴다 */
  onFailure(listener: (failure: ProjectorFailure) => void): Unsubscribe;
}
