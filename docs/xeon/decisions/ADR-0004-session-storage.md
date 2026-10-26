---
id: adr.0004
layer: adr
domain: session-storage
kind: adr
status: accepted
depends_on: [adr.0001, adr.0002]
binds: [xeon/packages/platform-store/**, xeon/packages/core-persistence/**, xeon/packages/contracts/src/records/**]
---

# ADR-0004 세션 저장: SQLite 이벤트 소싱 + 투영, 단일 DB (C안)

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] "세션 저장 C안 확정(SQLite 이벤트 소싱+투영, 단일 DB, 확장 접두사 테이블)"(`_research/decisions-log.md` 2026-10-21 결정(2차), `_research/layer-plan-v2-notes.md` 이번에 확정한 것).
- 개정: 2026-10-21 `review.decisions-2` U-09(§3.4 쓰기 소유 펜싱), U-10(§3.2 3번 도구별 효과 커밋 보충), U-18(§3.3 확장 테이블 접두). C안 결정을 뒤집지 않는 보충이라 같은 ADR 안에서 고쳤다(`adr.readme` §1.4). 세 항목은 사용자 확인을 거친 [결정]이다(2026-10-22). U-09 세부 정정은 `review.decisions-2` U-09 행을 따른다.

## 2. 맥락

세션 저장소는 런타임에서 세 가지 일을 한다(`_research/session-storage.md` 머리말).

1. 모델에 보낼 대화 이력을 다시 조립하는 원천
2. 크래시나 재시작 뒤 이어서 실행하는 근거(continuation: replay·resume)
3. 학습·검색·UI가 과거 대화를 읽는 자료

여기에 Xeon 고유 요구가 붙는다. 확장(L3 그룹)의 기록을 세션 기록과 한 커밋으로 저장해야 하고, 앱·CLI·서비스가 같은 세션을 열 수 있어야 한다(ADR-0006).

다섯 방식을 비교했다(`_research/session-storage.md` 다섯 방식, 기준별 비교).

| 방식 | 구조 | 쓰는 곳 |
|---|---|---|
| A. JSONL 단일 로그 | 세션당 파일 하나, 줄 단위 덧붙임 | Claude Code |
| B. JSONL 트리 | A + `id`/`parentId`, leaf 포인터로 현재 가지 선택 | pi, oh-my-pi |
| C. SQLite 이벤트 소싱 + 투영 | 불변 이벤트 테이블 + 같은 트랜잭션에서 조회 테이블 갱신 | opencode v2 |
| D. SQLite 체크포인트 | 불변 엔트리 + 실행 상태 레코드를 커밋마다 교체 | pi durable, LangGraph |
| E. 외부 내구 실행 엔진 | Postgres나 별도 서버가 단계 결과를 저장, 재실행 때 캐시 반환 | absurd, Temporal |

| 기준 | A | B | C | D | E |
|---|---|---|---|---|---|
| 쓰기 원자성 | 줄 단위, 크래시 때 마지막 줄 잘림 가능 | A와 같음 | 트랜잭션 단위 | 트랜잭션 단위 | 엔진이 보장 |
| 여러 기록을 한 번에 커밋 | 불가 | 불가 | 가능(메시지 + 확장 기록 + 작업 상태) | 가능 | 가능 |
| 내구성 | fsync 직접 호출 필요(조사한 세 곳 모두 호출 안 함) | 같음 | `synchronous=FULL`이면 커밋 직후 디스크 보장 | 같음(pi durable은 NORMAL) | 엔진 설정 |
| 분기·되감기 | 어려움(파일 복사) | 쉬움(포인터 이동) | `parentId` 열로 B와 같게 가능 | 체크포인트 선택 | 제한적 |
| 실행 재개 | 이력을 다시 읽고 추론 | 같음 | 이벤트에서 상태 재구성, 중간 상태 기록 가능 | 마지막 체크포인트에서 바로 | 핸들러 재실행 + 단계 캐시 |
| 여러 프로세스 동시 접근 | 잠금 직접 구현 | 같음 | WAL로 읽기 여럿 + 쓰기 하나 | 같음 | 기본 지원 |

나머지 기준(이력 보존, 조회·검색, 사람이 읽기, 스키마 변경, 구현 비용, 배포 의존성)은 `_research/session-storage.md` 기준별 비교 표에 있다.

참고 사례:

- opencode v2는 이벤트와 투영을 한 트랜잭션에서 갱신하고, 같은 seq가 다시 들어오면 ID·타입·created·데이터가 완전히 같을 때만 무시하고 다르면 "Replay diverged" 결함으로 처리한다(`_research/refs/opencode.md §3.8`).
- pi durable은 의도 커밋 → 외부 효과 → 결과 커밋의 "효과 샌드위치"와 도구별 `replay: "safe" | "unsafe"`(기본 unsafe)를 둔다. durable `docs/spec.md` 1917-1927(효과 샌드위치), 2082-2108(orphaned, replay-unsafe), 3136-3170(재생 시 정책 해석)이 근거다(`_research/refs/pi-durable.md §3.8`, `_research/durable-and-search-facts.md §A-6`). 이 줄 번호는 `_ref` 사본 기준이다(ADR-0003 §3.2).
- 기존 Helm 설계 `docs/design/09-event-store.md`는 이벤트 envelope(§3.2), 정규화 JSON과 해시(§3.2.1, §3.2.2), 이벤트 카탈로그(§3.4)를 정했다. Xeon은 이벤트 이름 규칙과 카탈로그 분류만 참고하고, 해시 체인과 정본 envelope은 가져오지 않는다. 커널 단독 상태 변경 전제(`_research/decisions-log.md` 2026-10-19 이견)가 Xeon과 다르기 때문이다.

## 3. 결정

### 3.1 기본 구조

- [결정] C안을 쓴다. SQLite 이벤트 소싱 + 투영이다. 불변 이벤트 테이블에 쌓고 같은 트랜잭션에서 투영 테이블(메시지, 파트 등)을 갱신한다.
- [결정] DB 파일은 하나다. 세션, 작업 상태, 확장 기록이 모두 같은 파일에 있다.
- [결정] 확장 기록은 확장별 접두사 테이블에 둔다.
- [결정] 드라이버는 `bun:sqlite`이고 평소 WAL 모드다(ADR-0001, `_research/foundation-plan.md §2` DB 행).
- [제안] 내구 이벤트의 `seq`는 저장소(DB) 전체에서 단조 증가하고 간격이 없다. 세션별 수열을 따로 두지 않는다. 저장소 하나에 seq 수열 하나라는 전제 위에 구독 커서와 재전송이 선다. 정본은 `F.records.spec` §4.1(`../F/records/spec.md`)과 `F.wire-settings.spec` §3.4.1(`../F/wire-settings/spec.md`)의 `StreamPosition{storeId, seq}`다.

### 3.2 세부 규칙

| # | 규칙 | 표지 | 근거 |
|---|---|---|---|
| 1 | 이벤트에 `parentId`를 둔다. B안의 분기·되감기를 포인터 이동으로 지원한다 | [결정] | `_research/session-storage.md` 권장안. 사용자가 확정한 C안 권장안의 일부 |
| 2 | 단계 체크포인트 테이블을 둔다. D안처럼 마지막 단계에서 바로 재개한다. 체크포인트는 이벤트에서 다시 만들 수 있는 파생 데이터다 | [결정] | 같음 |
| 3 | 도구 실행은 의도 → 실행 → 결과 세 이벤트(`effect.intent`, `effect.exec`, `effect.result`)로 기록한다. 결과 없는 의도는 `replay: "safe" \| "unsafe"` 규칙으로 처리한다. 기본값은 `unsafe`이고, `unsafe`는 재개 때 다시 실행하지 않고 "중단됨" 결과를 합성한다. 저장된 정책과 현재 선언이 모두 `safe`일 때만 저장된 인자로 다시 실행한다. 보충: 세 이벤트는 도구 호출마다 각각 별도 커밋(E1 의도, E2 실행 시작, E3 결과 + toolResult `item.recorded`)으로 쓰고 단계 경계 커밋을 기다리지 않는다. 한 단계의 커밋 수는 `3 + 3n`(n은 도구 호출 수)이다. 커밋 지점 표의 정본은 `L1.persistence.spec` §4.2다 | [결정] 3이벤트·replay 규칙 / [제안] 기본값과 승격 금지 세부 / 도구별 커밋 [결정: review.decisions-2 U-10] | `_research/session-storage.md` 권장안, `_research/process.md §6.3` 6번, durable spec 1917-1927·2082-2108·3136-3170 |
| 4 | 큰 도구 출력은 블롭 파일로 빼고 이벤트에는 해시만 남긴다(oh-my-pi 방식) | [결정] 방식 / [제안] 크기 임계와 해시 함수는 `L0.store.spec` | `_research/session-storage.md` 권장안, `_research/packages.md §2.3` 블롭 저장 행 |
| 5 | 단계 경계 커밋은 `PRAGMA synchronous=FULL`로 디스크까지 보장하고, 평소는 WAL이다. 구현은 쓰기 연결을 항상 FULL로 두어 효과 커밋(E1~E3)도 FULL이다(`L0.store.spec` §4.3) | [결정] | `_research/foundation-plan.md §2` DB 행 "WAL, 단계 경계 FULL" |
| 6 | 스트리밍 토큰 델타는 휘발 이벤트로 UI에만 흘리고 저장하지 않는다. 완성된 메시지 파트만 저장한다 | [결정] | `_research/session-storage.md` 방식별 장단점, `_research/process.md §6.1` |
| 7 | 세션을 JSONL로 내보내는 명령을 둔다. 디버깅과 이식에 쓴다 | [결정] 명령 존재 / [제안] 명령 이름은 `L4.cli.spec` | `_research/session-storage.md` 권장안 |
| 8 | 재생 결과와 투영이 어긋나면 검출한다. 같은 seq가 다시 들어오면 내용이 같을 때만 무시하고 다르면 오류로 처리한다(opencode v2 선례) | [제안] | `_research/refs/opencode.md §3.8` 재생 검증 |

- [제안] 단계 경계 FULL의 구현 방식은 `L0.store.spec`이 정한다. `L0.store.spec` §4.3은 쓰기 연결을 항상 FULL로 둔다. 한 단계의 커밋 수가 `3 + 3n`이므로 fsync도 그만큼 든다. 이 비용은 모델 호출 시간에 비해 작다고 본다 [가정]. 측정은 `L0.store.plan` ST-17이다.
- [제안] 이벤트 레코드는 `F.records.spec` §3.1(`../F/records/spec.md`)의 `DurableEventEnvelope`를 쓴다. 이름과 필드는 F가 정본이다. 아래는 이 ADR의 결정과 관련된 필드만 옮긴 발췌다. 표 모양은 opencode `event(id, aggregate_id, seq, created, type, data)`를 참고했지만(`_research/packages.md §2.4`), seq 유일성은 opencode의 `unique(aggregate_id, seq)`와 달리 DB 전체 기준이다(§3.1).

  ```ts
  // F.records.spec §3.1 발췌. 나머지 필드(turnId, stepId, causationId, correlationId, detached)는 F 문서를 본다
  export interface DurableEventEnvelope {
    id: EventId;                    // evt_<ULID>
    kind: EventKind;                // "<영역>.<이름>", 이름 규칙은 F.records.spec §3.2
    version: number;                // kind별 payload 버전, 정수 ≥ 1
    threadId: ThreadId;
    durable: true;
    seq: number;                    // DB 전체 단조, 무간격, 정수 ≥ 1. 저장소가 채운다
    parentId: EventId | null;       // 분기·되감기(규칙 1). thread 첫 이벤트만 null
    recordedAt: number;             // ms 정수, 저장소가 채운다
    payload: unknown;               // kind·version별 스키마로 검증
  }
  ```

### 3.3 확장 기록과 원자성

- 기존 설계는 확장마다 SQLite 파일을 따로 두는 안이었다. SQLite는 여러 파일을 `ATTACH`해 한 트랜잭션으로 묶을 수 있지만, WAL 모드에서는 파일 하나하나의 원자성만 보장하고 여러 파일에 걸친 원자성은 보장하지 않는다(`_research/session-storage.md` 놓치기 쉬운 제약).
- [결정] 그래서 파일 하나 + 확장 접두사 테이블(1안)을 쓴다. 확장을 지울 때는 그 접두사의 테이블만 지운다.
- [결정: review.decisions-2 U-18] 확장 id는 `^[a-z][a-z0-9-]{1,31}$`(소문자, 숫자, 하이픈)이고 밑줄을 쓰지 않는다. 테이블 접두는 `x_<확장 id의 하이픈을 밑줄로 바꾼 값>_`이다. 예: `acme-notes` → `x_acme_notes_`. 접두 뒤 지역 테이블 이름에는 밑줄을 쓰지 않는다. 그래서 확장 `a`의 삭제가 `a-b`의 테이블(`x_a_b_…`)을 접두 일치로 지우는 일이 생기지 않는다. 코어 테이블은 이 접두사를 쓰지 않는다. 구현은 `L0.store.spec`, 접두 소유표는 `eng.context-map.design`이 정한다.
- [결정] outbox(2안)는 별도 프로세스로 격리한 확장에만 쓴다. 세션 DB에 "확장 기록 예정"을 함께 커밋하고 확장 쪽에는 나중에 멱등하게 반영한다. 프로세스 격리는 2차 선택 기능이다(`_research/decisions-log.md` 2차 "확장 프로세스 격리는 기본값 아님 검토").

### 3.4 단일 소유

- [결정] 세션 실행(루프 구동)의 쓰기 소유자는 세션 단위로 하나다. 세션 id를 키로 한 OS 잠금(omp 방식)으로 생존을 판정한다. 경로 대신 id를 키로 쓰고, 프로세스가 죽으면 커널이 잠금을 해제하므로 stale 대기가 없다(`_research/process.md §5`, `§6.3` 1번).
- [결정: review.decisions-2 U-09] 쓰기 소유 판정은 OS 잠금(생존 판정)과 `sys_leases.epoch` 펜싱을 함께 쓴다. 잠금을 얻은 프로세스는 `sys_leases` 행(`session:<threadId>`)의 epoch를 올리고 `LeaseToken`을 받는다. 모든 커밋은 같은 트랜잭션 안에서 `sys_leases` 행을 다시 읽어 epoch를 대조하고, 다르면 롤백한다(`ownership_lost`). OS 잠금은 트랜잭션 안에서 확인할 수 없어, 잠금을 잃었거나 공유하지 않는 이전 소유자(OS 잠금이 없는 후퇴안에서 만료로 인수당한 프로세스, 잠금 디렉터리가 다른 프로세스)의 늦은 쓰기를 막지 못하기 때문이다. flock이 있으면 멈춘 소유자는 잠금을 쥔 채라 인수당하지 않고, 깨어나거나 죽을 때까지 세션이 잠긴다(알려진 한계, `L0.store.spec` §4.7.1). 세부는 `L0.store.spec` §3.1, `L1.persistence.spec` §3.6, `eng.transactions.design` TX-10이다.
- [결정] 읽기는 잠금 없이 한다. WAL은 읽기 여럿 + 쓰기 하나를 허용하므로 조회·검색·관찰 UI는 잠금을 잡지 않는다(`_research/process.md §6.3` 2번).
- 소유 표시(`kind`, `pid`, `host`, `heartbeatAt`)는 `sys_leases` 행이 겸한다. 별도 소유 표시 테이블(`session_owner`)을 두지 않는다 [결정: review.decisions-2 U-09].
- 잠금을 못 얻었을 때의 위임·관찰·분기 선택지는 ADR-0006과 `L0.process.spec`이 정한다(`_research/process.md §6.3` 3~5번). 복구 표식은 `L1.persistence.spec`의 `p_threads` 열(`running_since`, `resume_attempts`)이다.

### 3.5 시작 시 FTS5 검사

- [결정] 시작 시 FTS5를 확인하는 검사를 둔다. macOS는 `Database.setCustomSQLite`로 FTS5가 포함된 SQLite를 지정한다(`_research/foundation-plan.md §2` DB 행, `§7`).
- [제안] 검사 순서는 아래로 고정하고 L0 `platform-store` 안에 둔다. OS 분기는 소비자 코드에 두지 않는다(`_research/decisions-log.md` 2026-10-19 설계 규칙). 근거는 `_research/notes/arch-3.md §3.4`다.
  1. 플랫폼별 dylib 경로를 정한다. macOS에서만 커스텀 경로를 쓴다.
  2. `Database.setCustomSQLite(path)`를 호출한다. 첫 `Database`를 열기 전이어야 한다. 이미 로드된 뒤 다른 경로를 지정하면 "SQLite already loaded" 오류가 난다(`JSSQLStatement.cpp:1235-1236`). 반환값은 판별에 쓰지 않는다(1.4.3은 비-macOS에서도 `true`).
  3. 임시 in-memory DB에서 `CREATE VIRTUAL TABLE temp.<접두사>_probe USING fts5(x)`를 실행하고 닫는다. 이 탐침 결과가 FTS5 가용성의 기준이다.
  4. 진단용으로 `PRAGMA compile_options`에서 `ENABLE_FTS5`를 찾아 기록한다.
- [제안] 프로세스 안에서 `bun:sqlite` 외 다른 SQLite 로더(예: `node:sqlite`)를 쓰지 않는다. macOS에서는 두 모듈이 같은 라이브러리를 공유한다(`_research/notes/arch-3.md §3.2`, `§3.4`).

## 4. 결과

### 4.1 좋은 점

- 원자 커밋. 메시지, 확장 기록, 작업 상태를 한 트랜잭션으로 저장한다. 도구 의도 기록과 확장 기록이 엇갈리지 않는다.
- 단계 경계 FULL로 "응답한 것은 잃지 않는다"를 보장한다. pi durable의 NORMAL(전원 장애 때 최신 커밋 유실 가능, `_research/refs/pi-durable.md §3.8` (1))보다 강하다.
- 조회와 검색. SQL과 FTS5 전문 검색을 쓸 수 있어 학습 그룹(L3)과 지식 능력(L2)이 과거 대화를 직접 질의한다.
- WAL로 여러 프로세스가 동시에 읽는다. 앱·CLI·서비스가 데몬 없이 DB 폴링만으로 완성된 기록을 따라갈 수 있다(`_research/process.md §6.1`).
- 전체 이력이 보존된다. 이벤트가 원본이므로 투영을 지우고 다시 만들 수 있고, 분기·되감기는 `parentId`로 한다.
- 재개가 빠르다. 단계 체크포인트에서 바로 재개하고, 체크포인트가 없거나 깨지면 이벤트에서 다시 만든다.

### 4.2 감수할 점

- 투영 코드와 이벤트 버전 관리 비용이 든다. 이벤트 타입마다 버전을 두고, 구버전을 읽는 업그레이드 디코더와 투영 재생성 경로가 필요하다(`_research/session-storage.md` 기준별 비교 "스키마 변경" 행).
- 사람이 바로 읽기 어렵다. `sqlite3`가 필요하다. JSONL 내보내기 명령(규칙 7)으로 보완한다.
- `bun:sqlite`의 FTS5 가용성이 플랫폼마다 다르다. Linux·Windows는 소스 정의로 포함되지만 실행 확인은 하지 않았고, macOS는 시스템 라이브러리의 FTS5 포함 여부가 확인되지 않았다(`_research/stack-status.md §7-D`, `_research/notes/arch-3.md §1`). 그래서 시작 시 검사(§3.5)가 필요하고, `setCustomSQLite` 호출 순서 제약을 지켜야 한다(`_research/foundation-plan.md §7`).
- 확장이 같은 DB 파일을 쓰므로 확장의 잘못된 쿼리가 세션 테이블에 영향을 줄 수 있다. 접두사 밖 테이블 접근을 막는 장치(쿼리 래퍼 등)가 필요하다. 세부는 `L0.store.spec`과 `X.loading-trust.spec`이 정한다.
- 큰 출력 블롭은 DB 밖 파일이라 DB 트랜잭션에 포함되지 않는다. 블롭을 먼저 쓰고 해시를 커밋하며, 참조 없는 블롭은 GC로 지운다(oh-my-pi의 GC 유예 방식, `_research/packages.md §2.3`).
- 결과 불명 도구는 정확히 한 번 실행을 보장하지 않는다. `safe` 도구는 최소 한 번, 나머지는 최대 한 번 + 불명 표시다(`_research/refs/pi-durable.md §3.8` (4)). 외부 효과가 있는 `safe` 도구는 자체 멱등성이 필요하다.

## 5. 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| A. JSONL 단일 로그 | 줄 단위 커밋이라 여러 기록을 한 번에 커밋할 수 없다. 조사한 구현은 fsync를 호출하지 않고, pi는 잘린 줄을 경고 없이 버린다. 다중 프로세스 잠금을 직접 만들어야 한다(`_research/session-storage.md` 방식별 장단점) |
| B. JSONL 트리 | 분기는 쉽지만 원자성·내구성·검색 문제가 A와 같다. 분기 장점은 C에 `parentId`를 넣어 얻는다 |
| D. SQLite 체크포인트 | 재개는 빠르지만 실행 상태를 덮어써 중간 이력이 사라진다. 상태 레코드 마이그레이션이 필요하다. 장점은 C 위의 단계 체크포인트 테이블로 얻는다. pi durable 구현은 NORMAL이고 이벤트 저널이 비목표다(ADR-0003) |
| E. 외부 내구 실행 엔진 | Postgres나 상주 서버가 필요하다. 개인 데스크톱 앱에서 시작해 배포하는 런타임에는 운영 부담이 크다 |
| 확장별 DB 파일 + `ATTACH` | WAL 모드에서 여러 파일에 걸친 원자성을 보장하지 않는다. 세션 기록과 확장 기록을 한 번에 커밋할 수 없다. outbox를 쓰면 가능하지만 모든 확장에 outbox를 강제하는 비용이 크다(`_research/session-storage.md` 놓치기 쉬운 제약) |
| Helm 설계 09 해시 체인 + 정본 envelope | 커널 단독 상태 변경과 감사용 정본 기록을 전제로 한 설계다. Xeon은 그 전제를 버렸으므로 해시 계산과 정규화 JSON 비용을 들일 이유가 없다 |

## 6. 미결 사항

- [미결] FTS5 가용성은 플랫폼별 스파이크가 필요하다. Linux x64·arm64, Windows, macOS(arm64, x64)에서 배포 바이너리와 `bun build --compile` 산출물로 탐침(§3.5 3번)을 실행해 확인한다(`_research/stack-status.md §7-D` 결론, `_research/notes/arch-3.md §4`).
- [미결] 세션 잠금 구현을 네이티브 flock(바인딩)으로 할지 `proper-lockfile`(mtime 갱신 방식, 크래시 뒤 수 초 대기)로 할지. Node 표준 라이브러리에는 flock이 없다(`_research/process.md §6.3` 1번). Bun의 FFI나 내장 API로 가능한지도 확인한다.
- [미결] macOS에서 FTS5가 포함된 dylib을 찾지 못할 때의 처리. 시작을 중단할지, FTS5 기능만 끄고 시작할지(`_research/notes/arch-3.md` 미결 사항).
- 닫음(`review.m3-design-inputs` §3.8 C-052): 번들 SQLite를 쓰고 설정 키를 두지 않는다.
- [미결] 블롭 분리 임계 크기와 해시 함수.
- [결정: review.m3-design-inputs D-M3-21 a] 이벤트는 기본으로 지우지 않는다. 설정 화면에서 기간을 정할 수 있고, 참조 없는 블롭만 GC한다.
- [미결] 투영 재생성 시점(마이그레이션 때만 대 요청 시). 옛 질문: 이벤트 보관 기간과 투영 재생성 시점. L4 설정 화면의 "세션과 컨텍스트" 탭(보관 기간, 내보내기)과 연결된다(`_research/layer-plan-v2-notes.md` L4 설정 화면 구성안).
