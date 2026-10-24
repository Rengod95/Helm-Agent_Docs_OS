import type { Clock, Logger } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type {
  EventKindRegistry,
  FaultInjector,
  LeaseHolder,
  LeaseService,
  MigrationRunner,
  StoreDb,
  StoreService,
} from "@xeon/contracts/records";

/** `l1.persistence.*` 중 이 패키지가 읽는 값(L1.persistence.spec §6.1) */
export interface PersistenceSettings {
  /** 한 turn의 재개 시도 상한(수동·자동 공통). 기본 3 */
  readonly maxResumeAttempts: number;
  /** 서비스 모드에서 열 때 표식이 남은 thread를 자동 재개한다. 기본 거짓(M3) */
  readonly autoResume: boolean;
}

/**
 * `createSessionService`가 받는 의존. 조립 루트(L4 host)가 platform-store의 루트 `StoreDb`를 core-persistence에만 넘긴다
 * (eng.transactions.design §4.2). 이 패키지는 platform-store를 import하지 않고 F 타입으로만 받는다(DR-14, CM-05).
 */
export interface SessionDeps {
  /** 세션 테이블에 쓸 수 있는 루트 핸들(`scoped`가 아니다). 이 패키지 밖에 넘기지 않는다 */
  readonly db: StoreDb;
  /** xeon.store의 임대 API. 커밋 트랜잭션 안에서 `holds(tx, token)`로 소유를 확인한다(TX-10) */
  readonly leases: LeaseService;
  /** xeon.store의 마이그레이션 실행기. 시작할 때 비투영 테이블 DDL을 적용한다 */
  readonly migrations: MigrationRunner;
  /** xeon.store의 blob 읽기. 없으면 detached 필드를 되돌리지 못한다(hydrate가 Bug) */
  readonly readBlob?: StoreService["readBlob"];
  /** xeon.store의 blob 쓰기. 큰 문자열 분리(detachLarge)에 쓴다. 없으면 상한을 넘는 envelope는 store.event_too_large다 */
  readonly putBlob?: StoreService["putBlob"];
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** 구독자 예외 같은 운영 기록. 없으면 남기지 않는다 */
  readonly logger?: Logger;
  /** 테스트용 장애 주입. 운영 빌드는 생략한다 */
  readonly faults?: FaultInjector;
  /** 확장 kind 등록부. 없으면 코어·도메인 카탈로그만 안다 */
  readonly eventKinds?: EventKindRegistry;
  /** 현재 설정 값. 호출 때마다 읽는다(`live` 키). 생략하면 기본값 */
  readonly settings?: () => PersistenceSettings;
  /** 이 엔진 인스턴스의 임대 홀더. 자식 thread 임대(`inheritOwnerFrom`)에 필요하다 */
  readonly holder?: LeaseHolder;
  /** 하트비트가 임대를 잃었다고 알렸을 때. 그 thread의 메모리 작업을 취소하는 일은 호출자 몫이다 */
  readonly onLeaseLost?: (threadId: ThreadId) => void;
}

export const DEFAULT_PERSISTENCE_SETTINGS: PersistenceSettings = {
  maxResumeAttempts: 3,
  autoResume: false,
};
