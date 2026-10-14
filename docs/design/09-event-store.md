# 09. 이벤트 저장소

- 소유: P5 (도메인)
- 작성: 2026-10-11, 1단계 초안
- 패키지: `@helm/store` (SQLite 이벤트 로그, 투영 테이블, 마이그레이션, 백업), 이벤트 타입 정의는 `@helm/domain/src/events/`
- 기준 결정: 브리프 결정 1~57(사용자 결정 1~25·38~43·47~57, 조정자 기본값 26~37, 조정자 판정 44~46), 판정 J-01~J-240
- 함께 읽을 문서: [08-domain-model.md](08-domain-model.md) (레코드 타입, 상태 기계, 쓰기 시점 제약), `10-kernel.md` (명령과 검증), `12-runtime-engine.md` (크래시 복구, 스케줄러), `17-daemon-and-operations.md` (데몬 수명주기, 백업 일정), `19-client-protocol.md` (재전송)

## 1. 목적과 범위

### 1.1 목적

Helm의 기준 원본인 이벤트 로그의 형식과 저장 방식을 정한다. 이벤트 envelope, 이벤트 이름 카탈로그 전체, 영속 이벤트와 휘발 이벤트의 구분, SQLite DDL, 쓰기 경로(단일 쓰기, 부팅 epoch), 멱등 처리, 해시 체인과 무결성 검사, 투영 테이블과 재구성, 마이그레이션, 백업·복구, 데이터 파일 위치, 성능 예상치와 보존 정책을 다룬다. 구현자가 이 문서와 08만 보고 `@helm/store`를 만들 수 있어야 한다.

### 1.2 다루는 것

1. 개념: 명령, 영속 이벤트, 휘발 이벤트, 투영, 운영 상태 (§3.1)
2. 이벤트 envelope 타입, 정규화 JSON, 해시 필드 (§3.2)
3. 이벤트 이름 규칙 (§3.3)
4. 이벤트 카탈로그 전체와 payload 스키마 (§3.4). 다른 문서가 쓰는 이벤트 이름의 기준이다
5. 휘발 이벤트 (§3.5)
6. SQLite: 파일 배치, PRAGMA, DDL (§3.6, §3.7)
7. 쓰기 경로: 단일 쓰기 보장, 부팅 epoch, 트랜잭션 단계 (§3.8)
8. 명령 inbox와 멱등 처리, 낙관적 동시성 (§3.9)
9. 해시 체인과 무결성 검사 (§3.10)
10. 투영 테이블, 투영기, 재구성 알고리즘, 조회 API (§3.11)
11. blob 저장 (§3.12)
12. 마이그레이션 (§3.13)
13. 백업·복구·내보내기 (§3.14)
14. 성능 예상치와 보존 정책 (§3.15)
15. `@helm/store` 공개 인터페이스 (§3.16)

### 1.3 다루지 않는 것

| 다루지 않는 것 | 소유 문서 |
|---|---|
| 레코드 필드, 상태 기계, 쓰기 시점 제약의 내용 | 08 |
| 명령 이름과 명령 payload, 검증 순서, 거부 코드 목록, `decide()` 구현 | 10 |
| 복귀 요약·모델 컨텍스트 같은 투영의 생성 알고리즘 (이 문서는 그 입력이 되는 읽기 모델과 조회만 정한다) | 12 |
| 크래시 복구 절차의 순서 (이 문서는 복구가 쓰는 조회와 이벤트를 정한다) | 12 |
| 데몬 수명주기, systemd 단위, 백업 일정, restic 연동, 디스크 감시 | 17 |
| HMAC 키 관리 정책, 데이터 파일 권한 감사, 도구 실행 격리 | 18 |
| 프로토콜 메시지와 휘발 이벤트의 전송 형식, 구독 필터 | 19 |

## 2. 전제와 결정

### 2.1 브리프 결정에서 이 문서가 따르는 것

| 근거 | 반영 |
|---|---|
| [제안: 결정 29 기본값] 기준 원본은 Helm 이벤트 로그(SQLite, WAL, WSL ext4). 모든 상태는 로그에서 재구성 가능. pi 세션 파일이나 pi-durable 저장소를 기준 원본으로 쓰지 않는다 | 이벤트 테이블 하나가 정본이다. 대화 기록(모델 메시지)도 런타임 이벤트와 blob으로 같은 DB에 둔다(§3.4.12) |
| [제안: 결정 30 기본값] 실행 의도 → 실행 → 결과 순으로 기록, 재시작 시 중단된 도구 호출 정리, 안전한 도구만 재실행 | `toolcall.started`를 실행 전에 커밋한다(write-ahead). 부팅 epoch로 늦은 쓰기를 막는다(§3.8) |
| [제안: 결정 31 기본값] 이벤트는 단조 증가 시퀀스 번호, 재접속 시 `lastSeq`부터 재전송, 큰 데이터는 HTTP | 전역 단조·무간격 `seq`(§3.2). 프로토콜은 이 seq를 그대로 쓴다. 큰 데이터는 blob(§3.12)으로 두고 해시로 가리킨다 |
| [제안: 결정 36 기본값], [판정 44] TypeScript 6.0 strict, Node.js 24 LTS, better-sqlite3(동기, WAL, 타입은 `@types/better-sqlite3`), TypeBox | §3.7, §3.16 |
| [결정 22·24] 데몬 상주, 혼자 쓰는 앱 | 쓰기 프로세스는 데몬 하나. 다중 사용자 권한·테넌트 분리는 두지 않는다 |
| [근거: 브리프 §2.5 운영 환경 사실] `~/projects`는 Syncthing 동기화 폴더라 DB를 두면 깨질 수 있다. 런타임 데이터는 `/srv/volumes/<서비스>/` | 데이터 디렉터리는 17이 정한 `/srv/volumes/helm/data`다. `~/projects`·`/mnt/*`·tmpfs 아래면 시작을 거부한다(§3.6.2) |
| [근거: 브리프 §2.5 운영 환경 사실] 비밀은 SOPS, 실행 시 `secrets run`으로 주입 | 해시 체인 HMAC 키 `HELM_LEDGER_HMAC_KEY`는 이 체계에서 17의 SecretStore로 받는다. 키가 없으면 데몬이 시작하지 않는다(§3.10.3) |
| [결정 13·14, 불변조건 3] 투영은 정본을 쓰지 않는다. 모델은 제안하고 커널이 상태를 바꾼다 | `projection.`으로 시작하는 이벤트 이름을 금지한다. 투영 테이블은 이벤트로만 갱신되며 재구성할 수 있다 |

### 2.2 이 문서가 정한 것 [제안]

| 번호 | 결정 | 근거 |
|---|---|---|
| D09-1 | 데몬 하나가 모든 프로젝트를 DB 하나, 전역 `seq` 하나로 기록한다 | 프로토콜 재전송을 seq 하나로 할 수 있다(결정 31). 여러 프로젝트를 한 홈에서 보는 요구(08 D08-7). 프로젝트별 DB로 나누면 클라이언트가 커서를 여러 개 관리해야 한다 |
| D09-2 | `seq`는 1부터 시작하는 빈칸 없는 정수다. 쓰기 트랜잭션 안에서 `head + 1`로 부여한다 | 클라이언트가 빈칸으로 누락을 알 수 있다. 쓰기 프로세스가 하나라서 가능하다 |
| D09-3 | 명령의 처리 결과는 거부·충돌·게이트를 포함해 모두 inbox(`commands`)에 저장하고, 같은 멱등 키로 다시 오면 저장된 결과를 그대로 돌려준다. 거부·충돌·게이트는 `command.rejected` 이벤트로도 남긴다. 커널 오류(`error`)만 저장하지 않는다(고친 뒤 같은 키로 다시 시도할 수 있게) | helm-kernel-v02의 SQLite판은 거부를 저장하고 in-memory판은 저장하지 않았다(helm-canon-2 §9.6). 같은 키에 다른 결과가 나오면 재시도 결과가 비결정적이 된다. 거부된 시도도 기록에 남아야 한다(A14) |
| D09-4 | 낙관적 동시성은 전역 커서가 아니라 레코드별 버전(`revisionSeq` = 사람에게 의미 있는 변경을 마지막으로 만든 이벤트의 seq)으로 한다. 사람 명령은 화면이 본 시점(`basisSeq`)을 싣고, 비교는 커널이 한다(10 V-VER-01) | helm-kernel-v02는 모든 명령에 전역 `expectedCursor`를 요구했다. 데몬에서는 런타임 이벤트(도구 호출 등)가 계속 쌓이므로 전역 커서는 무관한 변경에도 충돌을 낸다. 사람이 본 질문·합의의 버전만 맞으면 된다(L14 "Gate는 cursor에 묶어야") |
| D09-5 | 투영 테이블은 이벤트를 추가하는 같은 트랜잭션 안에서 갱신한다. 투영기 오류는 그 쓰기 전체를 되돌린다. outbox 테이블은 두지 않고 내부 소비자마다 커서를 둔다 | 커널의 판단 입력(10 KernelState)이 이 투영과 같은 이벤트에서 만들어진다. 투영이 이벤트보다 늦으면 커널이 낡은 상태로 판단한다. helm-kernel-v02는 매 명령마다 전체 이벤트를 다시 읽었고 이벤트 수에 비례해 느려졌다(helm-canon-2 §9.6) |
| D09-6 | 해시 체인은 정규화 JSON(RFC 8785 JCS)의 SHA-256으로 만들고, 1,000건마다와 정상 종료·백업 때 HMAC 체크포인트를 남긴다 | 체인만으로는 우발 손상과 단순 편집을 찾는다(L17 "checksum은 서명이 아니다"). 도구 실행 환경에 주지 않는 키로 만든 HMAC은 체인 전체를 다시 계산한 위조를 찾는다(bash로 기록을 고치는 문제, 대화 L2343) |
| D09-7 | 단일 쓰기는 세 겹으로 보장한다: systemd 단위 하나, 잠금 전용 SQLite 파일(`data/helmd.lock`)의 배타 트랜잭션(17 §3.1.4), 쓰기 트랜잭션마다 부팅 epoch 대조(fencing) | Node에는 flock이 기본으로 없다. SQLite 잠금은 POSIX 레코드 잠금이라 프로세스가 어떻게 죽든 풀린다. 마지막 방어는 DB 안의 epoch 대조다 |
| D09-8 | 모델 메시지 본문, 도구 인자·출력, 모델에 준 컨텍스트 투영은 이벤트가 아니라 blob에 두고 이벤트에는 해시만 둔다 | envelope를 작게 유지해 해시·재전송·재구성이 빠르다. 오래된 큰 blob은 해시를 남기고 지울 수 있다(§3.15) |
| D09-9 | 이벤트 이름에 평면 접두사(`normative.`, `epistemic.`)를 붙이지 않는다. 평면은 카탈로그의 `plane` 열과 envelope 필드로 둔다 | 브리프 공통 계약의 `<대상>.<과거형 동사>` 규칙. v0.2 실행 후보의 이름(`normative.choice.committed`)은 부록 A에서 대응시킨다 |
| D09-10 | 부팅 epoch는 ULID 문자열이다 | 12·17·19가 모두 ULID로 쓴다. 정수 카운터는 복원한 DB에서 되돌아갈 수 있다. ULID는 앞부분이 생성 시각이라 복원 뒤에도 이전 값보다 크다 |
| D09-11 | 이벤트와 별도로 해시 체인 밖의 `trace` 테이블을 둔다. 모델 요청, 컨텍스트 압축, 입력 큐, 실행 단계, 탐구 단계 같은 실행 기록을 여기에 둔다. 도메인 상태(State)에 들어가지 않는다 | 12·14·15가 요구한 실행 기록은 양이 많고 재구성에 필요 없다. 이벤트 로그에 넣으면 체인·재전송·투영 재구성이 느려진다. 같은 쓰기 트랜잭션에 넣어 순서는 이벤트와 맞춘다 |
| D09-12 | 저장소마다 `storeId`(ULID)를 둔다. 복원으로 seq 연속성이 끊기면 새로 만든다 | 19가 재접속 때 저장소가 바뀌었는지 알아야 한다(17 §2). 같은 seq가 다른 이벤트를 가리키게 되면 클라이언트는 storeId 비교로 그 사실을 확인한다 |

## 3. 명세 본문

### 3.1 개념

| 개념 | 뜻 | 저장 | 해시 체인 |
|---|---|---|---|
| 명령 (command) | 행위자가 상태를 바꾸려는 의도. 아직 일어난 일이 아니다 | `commands` (inbox, 결과 포함) | 아니오 |
| 영속 이벤트 (event) | 커널이 명령·관찰·타이머를 평가해 기록한 불변 전이 기록. 내용의 진실을 보장하지 않는다(F10 C3) | `events` | 예 |
| 휘발 이벤트 | 화면 갱신용 흐름(토큰 스트림, 도구 출력 진행, 접속 상태). 재구성에 필요 없음 | 저장하지 않음 | 아니오 |
| 투영 (read model) | 이벤트를 접어 만든 테이블. 커널의 판단 입력이자 화면·프로토콜의 조회 대상 | `p_*` | 아니오 (재구성 가능) |
| 운영 상태 | 이벤트에서 재구성할 필요가 없는 값(기기 마지막 접속, 내부 소비자 커서, 외부 로그 읽기 오프셋, 도구 출력 임시 버퍼) | 운영 테이블 | 아니오 |
| blob | 큰 내용. 내용 해시로 가리킨다 | `blobs` + 파일 | 해시만 envelope에 들어감 |

```text
State(seq_n) = fold(apply, State0, Events[1..n])   (F05 §2)
```

이 식이 성립해야 한다. 운영 상태와 휘발 이벤트는 `State`에 들어가지 않는다. 투영 테이블은 `State`의 물리적 형태이며 언제든 `events`에서 다시 만들 수 있다.

관측성 흐름 구분(helm-canon-2 §1.22): 도메인 의미 전이는 이벤트 로그, 지연·재시도·예외 같은 운영 로그는 파일·journald(06·17), 실험 측정은 16, 원시 런타임 기록은 런타임 이벤트와 blob이다. 서버 오류나 토큰 사용량을 도메인 이벤트로 만들지 않는다. 토큰 사용량은 런타임 이벤트(`run.message_recorded`)의 필드다.

### 3.2 이벤트 envelope

```ts
// @helm/domain/src/events/envelope.ts
import { Type, type Static } from "typebox";

export const EVENT_ENVELOPE_VERSION = 1 as const;

export const EventCategory = Type.Union([
  Type.Literal("domain"),     // N/E 레코드의 생성·전이
  Type.Literal("governance"), // A/P: 기기, Grant, 다이얼, 관찰 에이전트 제안, 복귀 요약 확인
  Type.Literal("runtime"),    // 실행·도구 호출·메시지 (M 실행 기록)
  Type.Literal("kernel"),     // 커널 파생: 거부 기록, 낡음·대체·재검증
  Type.Literal("system"),     // 부팅, 마이그레이션, 무결성, 백업
  Type.Literal("measurement"),// 실험 측정 (16): 화면 열람, 놀람 보고, 복귀 점검, 자기 보고. 도메인 상태를 바꾸지 않는다
]);

/** 권한 근거 문법. 상태를 바꾸는 이벤트는 1개 이상 (F05 Event 불변 2) */
export const AUTHORITY_PATTERN =
  "^(capability|human|question|agreement|grant|policy|rule|timer|migration|recovery):[A-Za-z0-9_:@.\\-]{1,200}$";
export const AuthorityBasis = Type.String({ pattern: AUTHORITY_PATTERN });
// 예: "capability:propose", "human:device:dv_01J...", "agreement:ag_01J...@2",
//     "grant:gr_01J...", "policy:auto_verifiable", "rule:stale_propagation",
//     "timer:expectation_deadline:ex_01J...", "migration:legacy-jsonl",
//     "question:qs_01J..." (질문 답이 근거, 10 authorityBasis kind question_answer), "recovery:01J..." (부팅 복구)
// 10의 구조화 authorityBasis[] { kind, ref }는 "<kind>:<ref>" 문자열로 저장한다

export const EventScope = Obj({
  projectId: Nullable(ProjectId),
  goalId: Nullable(GoalId),
  concernId: Nullable(ConcernId),
  workUnitId: Nullable(WorkUnitId),
  runId: Nullable(RunId),
});

export const EventEnvelope = Obj({
  v: Type.Literal(EVENT_ENVELOPE_VERSION),
  seq: Seq,                                // 전역 단조, 빈칸 없음 (D09-2)
  id: EventId,                             // ev_<ULID>
  type: EventTypeSchema,                   // §3.4 카탈로그
  typeVersion: Type.Integer({ minimum: 1 }),
  category: EventCategory,
  plane: Nullable(Plane),                  // system 범주는 null
  occurredAt: Ms,                          // 효력 시각 (관찰 시각, 기한 시각 등)
  recordedAt: Ms,                          // 기록 시각 (데몬 시계)
  actor: ActorRefSchema,                   // 08 §3.3.2
  via: Via,                                // 실제 출처 (기기, 로컬 CLI, 실행, 시스템)
  authority: Type.Array(AuthorityBasis),   // 상태 변경 이벤트는 minItems 1 (카탈로그 검사)
  subject: Nullable(AnyRecordId),          // 주 대상 레코드. 시스템 이벤트는 null
  refs: Type.Array(AnyRecordId),           // 영향받은 다른 레코드 (중복 없음, 최대 256)
  scope: EventScope,                       // 조회용 소속 (투영기가 아니라 커널이 채운다)
  commandId: Nullable(CommandId),          // 이 이벤트를 만든 명령
  causationId: Nullable(IdAny("ev", "cm")),// 원인 (파생 이벤트는 필수: F05 Event 불변 3)
  correlationId: Nullable(Type.String({ minLength: 1, maxLength: 64 })), // 묶음 (예: 실행 id, 질문 묶음 키)
  bootEpoch: Type.String({ pattern: "^[0-9A-HJKMNP-TV-Z]{26}$" }),   // ULID (D09-10)
  /** 판정 재현 정보 (10 E-6, A11). 커널 판정이면 규칙 버전, 모델 채널이면 컨텍스트 투영 id */
  provenance: Nullable(Obj({
    rulesVersion: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    contextRef: Nullable(Id("cp")),
    adapterId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
  })),
  /** payload에서 지운 민감 필드 이름 (재전송·투영 응답·관찰 입력용 사본에서만 채운다. 저장본은 빈 배열) */
  redactions: Type.Array(Type.String({ minLength: 1, maxLength: 64 })),
  payload: Type.Record(Type.String(), Type.Unknown()), // §3.4의 타입별 스키마로 검증
});
export type EventEnvelope = Static<typeof EventEnvelope>;

/** 사람 접속 상태 (19 §3.7.8, 20 §3.9.12)의 저장 값 ([판정 J-119]). offline은 연결이 없을 때 데몬이 정한다.
 *  부재(away)는 저장하지 않고 14 §3.13.8의 파생 함수가 기기 종류별 문턱(휴대폰 active 2분, 데스크톱 5분)으로 계산한다.
 *  urgencyOf, 푸시 계획, 복귀 판정은 모두 그 함수를 쓴다. locked는 쓰지 않는다(J-118) */
export const PresenceState = Enum(["active", "idle", "hidden", "offline"]);

/** 저장된 이벤트 = envelope + 해시 필드 */
export const StoredEvent = Obj({
  ...EventEnvelope.properties,
  prevHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  hash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});
export type StoredEvent = Static<typeof StoredEvent>;
/** 클라이언트로 나가는 형태 (19). 해시 대신 무효화 태그를 붙이고 민감 필드는 지운다 */
export type DeliveredEvent = EventEnvelope & { invalidates: string[] };
```

필드 규칙:

1. `seq`, `id`, `recordedAt`, `bootEpoch`, `prevHash`, `hash`는 저장소가 채운다. 커널이 만든 초안(`EventDraft`, §3.16)에는 없다.
2. `occurredAt`은 기본값이 `recordedAt`이다. 관찰은 `observedAt`, 타이머 이벤트는 기한 시각, 사람 명령은 데몬 수신 시각이다(08 §3.3.1). 늦게 들어온 외부 관찰도 현재 seq에 기록하고 `occurredAt`만 과거로 둔다.
3. `subject`가 null인 이벤트는 카탈로그 표의 subject 열에 null이 적힌 것뿐이다: `system`·`measurement` 범주 전부, 사용자 층 `dial.set`·`dial.unset`, `setting.changed`, `auth.*`, `tools.*`, `observer_run.*`, 프로젝트 없는 `brief.*`, 대상 없는 `boundary.reached`. 원전(F05 Event 불변 1)은 subject를 필수로 두었으나, 부팅·백업 같은 시스템 이벤트와 사람 단위 설정에는 대상 레코드가 없어 예외로 둔다. 10의 V-INV-08은 이 예외를 따른다(§5.2).
4. `authority`가 빈 배열일 수 있는 이벤트는 `system`·`measurement` 범주와 `command.rejected`뿐이다. 나머지는 1개 이상이다(카탈로그의 `needsAuthority`).
5. `actor`가 `kernel`·`scheduler`인 이벤트는 `causationId`가 필수다.
6. envelope의 정규화 JSON 크기는 256 KiB 이하다(19·20이 질문 전달 payload 크기로 요구). 넘는 내용은 blob으로 옮긴다. 넘으면 커널 버그로 보고 쓰기를 거부한다(`invalid.event_too_large`).
7. payload 안의 시각은 모두 ms 정수다. ISO 문자열 변환은 프로토콜(19)의 일이다.
8. 외부 도구 결과는 원본 식별자 또는 내용 해시를 보존한다(F05 Event 불변 5): 관찰의 `source.externalId`·`contentHash`, 도구 호출의 `execution.fingerprint`, 결과 blob 해시.
9. `recordedAt`은 단조 증가다. 데몬 시계가 뒤로 가면 직전 `recordedAt`을 쓰고 `clock.skew_detected`를 남긴다(17).
10. 저장된 envelope의 `redactions`는 항상 빈 배열이다. 민감 필드(카탈로그 `sensitiveFields`, 예: `tokenHash`)는 저장본에 있고, 재전송·투영 응답·관찰 입력으로 나가는 사본에서 지운 뒤 지운 이름을 `redactions`에 적는다. 해시는 저장본으로 계산한다.

#### 3.2.1 정규화 JSON

해시와 멱등 지문은 정규화 JSON으로 계산한다.

```ts
// @helm/domain/src/canonical-json.ts
/**
 * RFC 8785 (JSON Canonicalization Scheme) 규칙 [지식]:
 * - 객체 키를 UTF-16 코드 단위 순으로 정렬, 공백 없음
 * - 숫자는 ECMAScript Number→String 직렬화. NaN, Infinity 금지
 * - 문자열은 JSON.stringify 이스케이프 (유니코드 정규화는 하지 않음)
 * - undefined 값의 키는 제거, 배열의 undefined는 오류
 */
export declare function canonicalJson(value: unknown): string;
export declare function sha256Hex(text: string): string; // 순수 JS 구현 또는 주입 (도메인은 node:crypto를 import하지 않는다)
```

`@helm/domain`은 I/O 없는 패키지이므로 해시 함수는 주입받는다. `@helm/store`가 `node:crypto`로 구현을 넘긴다.

#### 3.2.2 해시

```text
prevHash(1) = "0" × 64
hash(n)     = SHA-256( prevHash(n) + "\n" + canonicalJson(envelope(n)) )   (소문자 hex)
prevHash(n) = hash(n - 1)
```

`envelope(n)`은 `prevHash`·`hash`를 뺀 §3.2의 객체 전체다(payload 포함). DB의 `envelope` 열은 이 정규화 문자열을 바이트 그대로 저장한다. 검사는 §3.10.

### 3.3 이벤트 이름 규칙

1. 형식: `<대상>.<과거형 동사>`. 대상과 동사는 소문자 `snake_case`. 정규식 `^[a-z][a-z_]*\.[a-z][a-z_]*$`.
2. 대상이 두 단어면 밑줄로 잇는다(`loop_plan.adopted`, `open_question.recorded`). 점은 하나만 쓴다.
3. 금지 접두사: `projection.` (불변조건 3, F10 C4), `ui.`, `notification.`. 화면과 알림은 이벤트가 아니다.
4. 평면 접두사(`normative.`, `epistemic.`)를 쓰지 않는다(D09-9). 평면은 envelope의 `plane`이다.
5. 벤더 이름(pi, claude, codex)을 이벤트 이름에 넣지 않는다(F10 §8 "vendor별 이름을 코어 schema에 넣지 않는다"). 런타임 이벤트(`run.*`, `toolcall.*`)는 어느 런타임에도 쓰는 중립 어휘다.
6. 이름은 바꾸지 않는다. 의미가 바뀌면 `typeVersion`을 올리고 업캐스터를 둔다(§3.13.3). 이벤트를 없애면 카탈로그에 `retired: true`로 남기고 투영기는 계속 읽을 수 있어야 한다.
7. 명령 이름(10)과 이벤트 이름은 다르다. 명령은 명령형(`agreement.confirm`), 이벤트는 과거형(`agreement.confirmed`)이다. 명령 하나가 이벤트 여러 개를 만들 수 있다.

### 3.4 이벤트 카탈로그

이 절이 이벤트 이름의 정본이다. 다른 문서는 여기 있는 이름을 쓴다. 새 이름이 필요하면 이 표에 더한다.

표의 열:

- 범주·평면: §3.2의 `category`와 `plane`
- 행위자: 이 이벤트의 `actor`로 허용되는 값. `agent:*`는 능력표(08 §3.3.4)가 허용하는 역할만
- subject: envelope `subject`의 레코드 종류
- 상태 효과: 08의 상태 기계 절

payload 스키마는 표 다음의 코드 블록에 있다. `XCore`는 08에서 정의한 레코드 생성 필드다.

#### 3.4.1 프로젝트·Goal

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `project.created` | domain·N | human | pj | Project active. 같은 트랜잭션에 자리표시 Goal(`goal.proposed`+`goal.activated`, placeholder)과 가벼운 작업 Concern(`concern.opened`, kind light_work) |
| `project.updated` | domain·N | human | pj | 이름·경로·외부 세션 관찰 여부 변경 |
| `project.archived` | domain·N | human | pj | archived |
| `goal.proposed` | domain·N | human, agent:work, kernel(자리표시) | gl | 08 §3.22.1 |
| `goal.activated` | domain·N | human, kernel(자리표시) | gl | proposed → active, goalVersion 1 |
| `goal.revision_proposed` | domain·N | human, agent:work | gl | pendingRevision |
| `goal.revised` | domain·N | human | gl | goalVersion + 1 |
| `goal.revision_rejected` | domain·N | human | gl | pendingRevision 해제 |
| `goal.paused`, `goal.resumed` | domain·N | human | gl | paused ⇄ active |
| `goal.achievement_claimed` | domain·N | human, agent:work | gl | achievement_claimed |
| `goal.achieved`, `goal.achievement_rejected` | domain·N | human | gl | achieved / active |
| `goal.superseded`, `goal.retired` | domain·N | human | gl | 종료 |

#### 3.4.2 Concern·구조

`runtime`이 행위자인 구조 이벤트는 오케스트레이터가 모델 선언을 반영해 보낸 것이다. 이때 `via = { kind: "run", runId: declaredBy }`이고 능력 검사는 그 run의 역할로 한다(08 §3.3.4, 10 K-13). 코드 규칙만으로 정한 것은 `kernel`이다.

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `concern.opened` | domain·N | human, agent:work, runtime, kernel | cn | 08 §3.22.2 open |
| `concern.updated` | domain·N | human, agent:work | cn | 제목·설명 (뜻이 바뀌지 않는 수정) |
| `concern.reframed` | domain·N | human, agent:work, runtime | cn | 문제 관점 재정의. 같은 트랜잭션의 `choice.committed` 필수 (08 §3.22.2) |
| `concern.activated` | domain·N | kernel | cn | open → active |
| `concern.held`, `concern.resumed` | domain·N | human, agent:work, runtime, kernel | cn | held ⇄ active |
| `concern.completed` | domain·N | human, agent:work, runtime, kernel | cn | completed (R-34) |
| `concern.closed` | domain·N | human, agent:work, runtime | cn | closed |
| `concern.reopened` | domain·N | human, kernel, scheduler(hold_revisit) | cn | active |
| `concern.merged` | domain·N | human, agent:work, runtime, kernel | cn | merged |
| `structure.changed` | domain·N | human, agent:work, runtime, kernel | sc | StructureChange 생성 (08 §3.6.2). 같은 트랜잭션에 하위 `concern.opened`, `boundary_item.recorded`, `concern.merged`·`held`·`closed` |
| `boundary_item.recorded` | domain·N | human, agent:work, runtime, kernel | bd | open |
| `boundary_item.checked`, `boundary_item.dropped` | domain·N | human, agent:work, kernel | bd | checked / dropped |
| `entry.evaluated` | domain·N | kernel, runtime | ea | 진입 판정 레코드 생성 (08 §3.6.4. 혼자 정한 결정, 이의 대상). 이전 판정은 superseded |

#### 3.4.3 WorkUnit

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `workunit.proposed` | domain·M | human, agent:work, runtime, kernel | wu | 08 §3.22.3 proposed |
| `workunit.started` | domain·M | runtime, kernel | wu | → in_progress (탐침이면 Probe running) |
| `workunit.paused`, `workunit.resumed` | domain·M | human, kernel, runtime | wu | paused ⇄ in_progress |
| `workunit.scope_exceeded` | domain·M | kernel | wu | → scope_exceeded |
| `workunit.scope_resolved` | domain·M | human, kernel | wu | → in_progress |
| `workunit.concluded` | domain·M | agent:work, runtime, kernel | wu | → concluded |
| `workunit.cancelled` | domain·M | human, kernel | wu | → cancelled |
| `workunit.superseded` | domain·M | human, agent:work, kernel | wu | → superseded |

WorkUnit의 negotiating, delegated, submitted, accepted, integrated, rejected는 합의·결과·확인·반영 이벤트에서 파생한다(08 §3.22.3). 같은 사실을 두 이벤트로 기록하지 않는다.

#### 3.4.4 E 레코드: 관찰, 전제, 열린 질문

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `observation.recorded` | domain·E | runtime, kernel, scheduler, human | ob | 관찰 생성 (R-06). 반응 관찰이 `triad` 질문을 가리키면 같은 트랜잭션에서 `question.answered`(kernel 파생)를 낸다 (08 §3.22.7) |
| `observation.annotated` | domain·E | agent:work, agent:verifier, agent:observer, kernel, human | ob | 주석 추가 |
| `observation.retracted` | domain·E | human, runtime | ob | `retracted` (반응 철회, 19·15). 이 관찰을 근거로 한 기준·주장에 낡음 전파 |
| `assumption.recorded` | domain·E | kernel(강등·질문), agent:work, human | as | active |
| `assumption.confirmed`, `assumption.invalidated`, `assumption.retired` | domain·E | human, agent:work, kernel | as | 08 §3.22.10 |
| `open_question.recorded` | domain·E | agent:work, agent:branch, human, kernel | oq | open |
| `open_question.resolved`, `open_question.dropped` | domain·E | agent:work, human | oq | resolved / dropped |

#### 3.4.5 Claim: 해석, 가능성, 구분 확인, 판단

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `interpretation.proposed` | domain·E | agent:work, agent:branch, human | in | active |
| `interpretation.retracted` | domain·E | agent:work, human | in | retracted |
| `possibility.proposed` | domain·E | agent:work, agent:branch, human | ps | open |
| `possibility.rejected` | domain·E | agent:work, human | ps | rejected |
| `possibility.marked_undecidable` | domain·E | agent:work, kernel | ps | undecidable |
| `possibility.withdrawn` | domain·E | agent:work, agent:branch, human | ps | withdrawn |
| `possibility.dismissed` | domain·E | human | ps | dismissed (15) |
| `possibility.merged` | domain·E | agent:work, human | ps | merged |
| `possibility.pinned`, `possibility.unpinned` | domain·E | human | ps | pinned 토글 |
| `claim.evidence_linked` | domain·E | agent:work, agent:verifier, human, kernel | in·ps·fd | 링크, 판단이면 contested 가능 |
| `claim.counter_searched` | domain·E | agent:work, agent:verifier, human | in·ps·fd | 반대 근거 탐색 기록 |
| `claim.counter_resolved` | domain·E | agent:work, human | in·ps·fd | 링크 resolution |
| `check.declared` | domain·E | agent:work, agent:verifier, human | dc | declared |
| `check.observed` | domain·E | agent:work, agent:verifier, human | dc | observed, verdicts |
| `check.voided` | domain·E | agent:work, human, kernel | dc | void |
| `check.pinned`, `check.unpinned` | domain·E | human | dc | 사람의 확인 순서 고정·해제 (J-95) |
| `finding.promoted` | domain·E | kernel (명령 행위자는 causation으로) | fd | 판단 생성, 원 주장 promoted |
| `finding.confirmed` | domain·E | human | fd | confirmed (accepted) |
| `finding.withdrawn` | domain·E | human | fd | withdrawn |

`finding.promoted`의 `actor`는 `kernel`이다. 승격을 요청한 행위자는 `causationId`의 명령과 `via`로 남는다. 승격은 커널 이벤트로만 일어난다(대화 L2232).

#### 3.4.6 선택·이의·결정 확인

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `choice.committed` | domain·N | human, agent:work, agent:router, runtime, kernel, scheduler, migration | ch | committed (R-15) |
| `choice.revoked` | domain·N | human | ch | revoked |
| `objection.filed` | domain·E | human | ct | open(또는 note_only면 noted), 대상 contested. 대상이 계획(`lp`)이면 `payload.objection.target.id`로 그 계획의 `loop_plan.adopted`를 찾는다. 16의 계획 이의 비율(`authoredBy`별)이 이 연결을 쓴다 ([판정 J-188]) |
| `objection.resolved` | domain·E | human, kernel | ct | upheld / withdrawn / dismissed |
| `decision.confirmed` | domain·N | human | 첫 대상 레코드 (나머지는 refs) | 혼자 정한 결정을 사람이 확인함. `quality.confirmedSeq` (R-55) |

#### 3.4.7 합의·Grant

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `agreement.proposed` | domain·N | agent:work, runtime, human | ag | proposed |
| `agreement.revised` | domain·N | agent:work, human | ag | revision + 1 (proposed 상태) |
| `agreement.confirmed` | domain·N | human | ag | active |
| `agreement.activated_by_grant` | domain·N | agent:work, runtime | ag | active (Activation.grant에 Autonomy) |
| `agreement.activated_by_rule` | domain·N | kernel | ag | active (쓰기 없는 탐구 합의, 14 §3.20.1) |
| `agreement.activated_by_choice` | domain·N | kernel | ag | active (사람이 직접 고른 선택의 범위 안 합의, R-56, [판정 J-133]) |
| `agreement.declined` | domain·N | human | ag | declined |
| `agreement.discarded` | domain·N | agent:work, human, kernel | ag | 확정 전 초안 폐기 → declined (14) |
| `agreement.scope_change_requested` | domain·N | agent:work | ag | pendingScopeChange |
| `agreement.narrowed` | domain·N | agent:work, runtime, kernel, human | ag | narrowedScope (R-51) |
| `agreement.restored` | domain·N | agent:work, runtime, kernel, human | ag | narrowedScope 해제 |
| `agreement.renegotiated` | domain·N | human | ag | revision + 1 (active 상태) |
| `agreement.stop_condition_met` | domain·N | agent:work, runtime, kernel | ag | WorkUnit paused |
| `agreement.violation_detected` | domain·N | kernel, runtime | ag | violations 추가, WorkUnit paused |
| `agreement.fulfilled` | domain·N | kernel | ag | fulfilled |
| `agreement.released` | domain·N | human, kernel | ag | released |
| `agreement.expired` | domain·N | scheduler | ag | expired |
| `grant.issued` | governance·P | human | gr | active |
| `grant.revoked` | governance·P | human | gr | revoked |
| `grant.expired` | governance·P | scheduler | gr | expired |
| `grant.exhausted` | governance·P | kernel | gr | exhausted |

#### 3.4.8 결과 제출·확인·반영

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `result.submitted` | domain·E | agent:work, runtime, human | rs | submitted, WorkUnit submitted |
| `attestation.recorded` | domain·E | agent:verifier, human | at | 증언 |
| `acceptance.recorded` | domain·N | human | ac | 결과·WorkUnit 전이 (08 §3.22.3, §3.22.5) |
| `integration.opened` | domain·N | kernel | ig | open |
| `integration.completed` | domain·N | kernel | ig | completed, WorkUnit integrated |
| `obligation.added` | domain·N | kernel, agent:work, agent:verifier, human | io | open |
| `obligation.resolved` | domain·N | human, kernel | io | resolved |
| `obligation.deferred` | domain·N | human, agent:work | io | deferred |
| `obligation.reopened` | domain·N | scheduler, kernel, human | io | open |
| `obligation.transferred` | domain·N | human, agent:work | io | transferred |
| `obligation.waived` | domain·N | human | io | waived |
| `reflection.recorded` | domain·N | human, agent:work | rf | - |

#### 3.4.9 질문·기대·예측·승인

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `question.recorded` | domain·N | agent:work, agent:verifier, agent:branch, runtime, kernel, human | qs | pending |
| `question.updated` | domain·N | kernel | qs | dedupe 병합 (근거 합집합 등, 08 §3.22.7) |
| `question.delivery_planned` | domain·N | agent:mediator, kernel | qs | plannedDelivery (Autonomy 포함) |
| `delivery.planned` | domain·N | agent:mediator, kernel | 묶음의 첫 질문 (나머지는 refs) | 중재자의 전달 계획 전체. 질문마다 `question.delivery_planned`가 같은 트랜잭션에 따른다 (11) |
| `question.delivered` | domain·N | runtime | qs | delivered |
| `question.seen` | domain·N | human | qs | seenAt |
| `question.deferred` | domain·N | human | qs | deferrals 추가, pending |
| `question.delegated` | domain·N | human | qs | delegated |
| `question.reframe_requested` | domain·N | human | qs | reframeRequest |
| `question.escalated` | domain·N | kernel, scheduler, human | qs | 즉시 전달 |
| `question.answered` | domain·N | human, kernel(반응 관찰 파생) | qs | answered |
| `question.assumed` | domain·N | kernel, scheduler | qs | assumed |
| `question.withdrawn` | domain·N | agent:work, runtime, kernel | qs | withdrawn |
| `question.expired` | domain·N | kernel, scheduler | qs | expired |
| `approval.issued` | domain·N | kernel | qs | approval issued (send 승인) |
| `approval.consumed` | domain·N | kernel | qs | approval consumed (같은 트랜잭션의 `toolcall.started`) |
| `approval.expired` | domain·N | scheduler, kernel | qs | approval expired 또는 revoked |
| `autonomous.seen` | domain·N | human | 첫 결정 레코드 (나머지는 refs) | 사람이 혼자 정한 결정 목록을 이 seq까지 봄 (19). 상태 변화 없음 |
| `expectation.created` | domain·N | runtime, agent:work, human | ex | open |
| `expectation.revised` | domain·N | agent:work, human | ex | 기한·내용 변경 (19) |
| `expectation.fulfilled` | domain·N | runtime, kernel, human | ex | fulfilled / late_fulfilled |
| `expectation.timed_out` | domain·N | scheduler | ex | timed_out (+ no_response 관찰) |
| `expectation.cancelled` | domain·N | agent:work, human | ex | cancelled |
| `prediction.recorded` | domain·E | agent:work, agent:branch, human | pr | open |
| `prediction.checked` | domain·E | agent:work, agent:verifier, human | pr | checked |
| `prediction.voided` | domain·E | agent:work, human, kernel | pr | void |

#### 3.4.10 루프·상황·모드·다이얼·탐침·지속 관찰

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `loop_plan.adopted` | domain·N | agent:work, runtime, kernel, human | lp | active (이전 계획 superseded). `authoredBy`(code·model·human)와 `modelDraftRejects`를 싣는다 ([판정 J-188], [결정 53]) |
| `loop.transitioned` | domain·E | agent:work, runtime, kernel, human | lt | Concern currentLoop. 계획 이탈은 이벤트가 아니고 16이 이 이벤트에서 계산한다 ([판정 J-163]) |
| `situation.assessed` | domain·E | agent:work, runtime, kernel, human | sa | current (이전 판정 superseded) |
| `mode.assigned` | domain·N | agent:router, runtime, kernel, human | md | active |
| `dial.set` | governance·P | human | 대상 Concern·WorkUnit (사용자 층이면 null) | p_dials |
| `dial.unset` | governance·P | human | 위와 같음 | p_dials 행 삭제 (19) |
| `probe.planned` | domain·N | agent:work, runtime, human | pb | planned |
| `probe.concluded` | domain·N | agent:work, runtime, kernel | pb | grown / folded / inconclusive / exhausted |
| `probe.cancelled` | domain·N | human, kernel | pb | cancelled |
| `watch.defined` | domain·N | agent:work, runtime, kernel, human | wt | watching |
| `watch.window_closed` | domain·N | scheduler | wt | 판정 요청 |
| `watch.judged` | domain·N | agent:work, runtime, kernel, human | wt | judged |
| `watch.cancelled` | domain·N | human, kernel | wt | cancelled |

#### 3.4.11 탐구·자극·선호 모델·렌즈

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `inquiry.opened` | domain·E | agent:work, runtime, human | iq | open |
| `inquiry.anchored` | domain·E | agent:work, runtime | iq | 출발점 기록 (15) |
| `inquiry.perspective_added` | domain·E | agent:work, runtime, human | iq | 관점과 칸 추가 |
| `inquiry.round_started` | domain·E | kernel, runtime | iq | 라운드 n 시작 (planHash) |
| `inquiry.round_ended` | domain·E | kernel, runtime | iq | leaderRef 기록. 반응 없이 닫힌 `stimulus_round` 질문을 `question.withdrawn`(round_closed)으로 닫는다 (08 §3.22.7) |
| `inquiry.stage_completed` | domain·E | runtime | iq | 탐구 단계 완료 (15) |
| `inquiry.cell_closed` | domain·E | agent:work, agent:branch, runtime, kernel | iq | 칸 filled / not_applicable |
| `inquiry.stop_rule_met` | domain·E | kernel, runtime | iq | 멈춤 규칙 충족 기록 (15가 계산) |
| `inquiry.stopped` | domain·E | kernel, runtime, human | iq | stopped. `then`(`proceed`·`handoff`·`decide_now`)을 싣는다 ([판정 J-157]) |
| `contrast.presented` | domain·E | runtime | st | 통제 쌍 제시 (15) |
| `lens.added` | domain·E | human, kernel(seed 적재) | ln | active |
| `lens.updated` | domain·E | human, kernel(seed 갱신, userModified false만) | ln | 필드 갱신 |
| `lens.retired` | domain·E | human | ln | retired |
| `stimulus.created` | domain·E | agent:work, agent:branch, runtime, human | st | created |
| `stimulus.presented` | domain·E | runtime, kernel | st | presented |
| `stimulus.withdrawn` | domain·E | agent:work, human | st | withdrawn |
| `preference_model.created` | domain·N | runtime, kernel, human | pm | active (I.want 탐구를 열 때 모델이 없으면 엔진이 R 채널로, 15 §3.6.2) |
| `preference_model.versioned` | domain·N | kernel | pm | modelVersion + 1 (기준 변경과 같은 트랜잭션) |
| `preference.criterion_confirmed` | domain·N | human | pm | 기준 추가, 가능성 confirmed |
| `preference.criterion_revised` | domain·N | human | pm | 무게·이름 변경 |
| `preference.criterion_retired` | domain·N | human | pm | 기준 retired |
| `preference.example_marked` | domain·N | human, agent:work | pm | 좋았던·싫었던 예 |
| `preference.divergence_noted` | domain·N | agent:work, human | pm | 말한 기준과 실제 반응의 차이 |
| `preference.divergence_shown` | domain·N | runtime | pm | `shownToUserSeq` (숨기지 않음의 기록) |

#### 3.4.12 런타임: 실행, 메시지, 도구 호출, 되돌릴 지점

[제안: 결정 29·30 기본값. 이름은 벤더 중립 어휘(audit §3.8 "Helm 중립 이벤트 어휘"). 상태 기계 정본은 12, 08 §3.22.13~14]

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `thread.opened`, `thread.closed` | runtime·M | runtime | th | open / closed |
| `run.queued` | runtime·M | runtime | rn | queued |
| `run.started` | runtime·M | runtime | rn | running. `attempt`, `ownerEpoch` |
| `run.context_projected` | runtime·M | runtime | rn | 모델 요청마다 준 컨텍스트 투영의 메타 (A11, F05 I7) |
| `run.message_recorded` | runtime·M | runtime | rn | 대화 기록 한 항목 (본문은 blob) |
| `run.steered` | runtime·M | human | rn | 실행 중 조종 입력 |
| `run.awaiting` | runtime·M | runtime | rn | awaiting_human / awaiting_recovery |
| `run.stopping` | runtime·M | runtime, human, kernel | rn | stopping |
| `run.interrupted` | runtime·M | runtime (`internal:recovery`) | rn | interrupted (부팅 복구) |
| `run.ended` | runtime·M | runtime, human | rn | ended (reason) |
| `budget.charged` | runtime·M | runtime | rn | 사용량 누적 (p_budget) |
| `budget.exhausted` | kernel·M | kernel | rn 또는 wu | 예산 소진 판정. 실행 정지 신호 |
| `toolcall.requested` | runtime·M | runtime | tc | requested (`modelArgs`. 고쳐서 허락이면 `editedFrom`) |
| `toolcall.blocked` | runtime·M | kernel | tc | blocked (관찰 없음) |
| `toolcall.approval_requested` | runtime·M | kernel | tc | awaiting_approval |
| `toolcall.approved` | runtime·M | kernel | tc | requested (다시 검사). `editedArgs` |
| `toolcall.denied` | runtime·M | kernel | tc | denied |
| `toolcall.started` | runtime·M | runtime | tc | started. **실행 전에 커밋** (`execution`) |
| `toolcall.not_executed` | runtime·M | runtime | tc | not_executed. `reason`은 08 `NotExecutedReason`(restart·cancel·steering·superseded·unknown_tool·invalid_args·truncated_response·approval_expired·batch_stopped, [판정 J-214]). A2의 `rejection.kind`는 `unknown_tool`·`invalid_args`·`truncated_response`이면 같은 이름의 reason, `aborted_before_execute`이면 `cancel`로 옮긴다. `blocked`는 `toolcall.blocked`, `hook_error`는 run 실패다 (07 A2·E5, [판정 J-58]) |
| `toolcall.completed` | runtime·M | runtime | tc | completed (+ `observation.recorded` tool_result) |
| `toolcall.interrupted` | runtime·M | runtime | tc | interrupted (+ 관찰 tool_interrupted) |
| `toolcall.outcome_uncertain` | runtime·M | runtime | tc | outcome_uncertain (+ 관찰) |
| `toolcall.replay_started` | runtime·M | runtime | tc | replaying |
| `toolcall.recovered` | runtime·M | human, agent:verifier, runtime | tc | recovered |
| `rollback_point.registered` | runtime·M | runtime, kernel | rb | available |
| `rollback_point.used` | runtime·M | runtime, human | rb | used |
| `rollback_point.expired` | runtime·M | scheduler, kernel | rb | expired |
| `directive.applied` | runtime·M | runtime | rn | 사람의 방향 바꾸기(Goal·기준·범위·다이얼·멈춤 명령)를 런타임이 다음 턴 경계에서 반영함 (12·16 D 칸 지표) |
| `workspace.unlinked_change_observed` | runtime·M | runtime | pj | 실행 전후 작업 공간 diff 중 WorkUnit에 연결되지 않은 변경 (13·16 CA-1). 명령 `workspace.record_change`(10)가 낸다 |
| `boundary.reached` | runtime·M | runtime, scheduler | 해당 Concern·WorkUnit 또는 null | 런타임 경계 도달 (08 `WorkBoundaryKind` 7개). 질문 전달 시점 판정 입력 (11·12·14) |

`run.message_recorded`는 결정 29의 "모든 상태는 로그에서 재구성"을 위해 대화 기록을 정본에 둔다. pi 세션은 메모리에서만 돌리고 재시작 때 이 이벤트들로 복원하는 방식(v0.3 14 §3.2 (b))을 쓸 수 있다. 사람의 메시지는 같은 트랜잭션에서 `observation.recorded`(utterance)도 만든다(08 §3.18). 복원 절차는 12. 모델 요청, 재시도, 컨텍스트 압축, 입력 큐, 실행 단계(stage)는 trace(§3.7)에 둔다.

도구 호출의 종결 기록은 하나다(first-writer-wins, 12). 결과 기록의 멱등 키 `tc:<tcId>:result`(§3.9.3)와 커널의 상태 검사(이미 종결이면 `conflict.invalid_transition`)가 함께 지킨다.

읽기 빠른 경로: `primitive = read`인 도구 호출은 `toolcall.requested`·`started`·`completed`와 결과 관찰을 한 트랜잭션에 남길 수 있다(08 §3.18.2, 10 K-3). 이벤트 수는 줄지 않지만 커밋 수가 셋에서 하나로 준다.

오염 상태 `taint.web`([판정 J-190 (3)], [결정 55])은 run 단위 상태이고 별도 이벤트가 없다. 웹·브라우저 도구(`web_fetch`·`web_search`·`browser_*`)의 `toolcall.completed` 가운데 본문이 모델에게 들어간 것(`modelContent`가 있는 것, 실패한 호출 포함)이 run의 `taint.web`을 세운다. 부팅 복구는 thread의 이 기록과 `toolcall.requested`의 도구 이름으로 다시 세운다. 같은 thread로 넘긴 새 run과 하위 run은 이 값을 물려받고, 하위 run이 세운 값은 부모 run에도 올린다([판정 J-215], 12 §3.2.5).

#### 3.4.13 통치·커널·시스템

| 이벤트 | 범주·평면 | 행위자 | subject | 상태 효과 |
|---|---|---|---|---|
| `pairing.code_created` | governance·A | human | pc | active |
| `pairing.code_consumed` | governance·A | runtime | pc | consumed (같은 트랜잭션에 `device.paired`) |
| `pairing.code_failed` | governance·A | runtime | pc (코드를 찾지 못하면 `auth.denied`로 남김) | 틀린 시도 (묶어서 기록, 18 §3.13.2). attemptsLeft 0이면 exhausted |
| `pairing.code_expired`, `pairing.code_cancelled` | governance·A | scheduler / human | pc | expired / cancelled |
| `device.paired` | governance·A | runtime, human(SSH 발급) | dv | active |
| `device.push_registered` | governance·A | human(그 기기의 명령) | dv | Device.push 설정·교체 (26 §3.4.6) |
| `device.push_unregistered` | governance·A | human, runtime | dv | Device.push = null |
| `device.bound_to_node` | governance·A | runtime, human | dv | tailnetNodeId 묶음·다시 묶음 |
| `device.renamed` | governance·A | human | dv | 이름 |
| `device.token_rotated` | governance·A | human, runtime | dv | tokenHash 교체 |
| `device.expired` | governance·A | scheduler | dv | expired |
| `device.revoked` | governance·A | human | dv | revoked |
| `device.connected`, `device.disconnected` | governance·A | runtime | dv | 접속 기록 (감사) |
| `presence.changed` | governance·A | runtime | dv | 사람 접속 상태 변화 (active·idle·hidden·offline, [판정 J-119]). 질문 전달 판정 입력 (11). 같은 상태가 이어지면 남기지 않는다 |
| `auth.denied` | governance·A | runtime | dv 또는 null | 인증 거부 (묶어서 기록) |
| `auth.policy_relaxed` | governance·A | human | null | 인증 정책 완화 (18) |
| `tools.sandbox_disabled`, `tools.sandbox_enabled` | governance·P | human | null | 샌드박스 끔·켬 (13·18) |
| `tools.git_config_suspicious` | governance·P | runtime | null | 상태 변화 없음. 저장소 실행 지점 설정이 보이거나 `.git`·`.gitmodules`가 새로 생긴 감사 기록. 키 이름만 싣는다 (18 R-13) |
| `permission.overridden` | governance·P | human | tc 또는 null | 권한 레이어 판정을 사람이 덮음 (18) |
| `setting.changed` | governance·P | human | null | 설정 키 변경 (16, 10 `setting.change`, J-94). 값이 비밀이면 키 이름만. 결과 확인 알림 설정 `notifications.resultReview`·`notifications.resultReviewDigestAt`도 이 이벤트로 남는다 ([판정 J-189], [결정 56]) |
| `policy_proposal.submitted` | governance·P | agent:observer | pp | open |
| `policy_proposal.evidence_updated` | governance·P | agent:observer | pp | 근거 갱신 |
| `policy_proposal.accepted`, `policy_proposal.dismissed`, `policy_proposal.deferred` | governance·P | human | pp | accepted / dismissed / deferred |
| `policy_proposal.reopened` | governance·P | scheduler | pp | open |
| `policy_proposal.withdrawn` | governance·P | agent:observer, human | pp | withdrawn |
| `policy_proposal.expired` | governance·P | scheduler | pp | expired |
| `policy_proposal.application_opened` | governance·P | kernel | pp | applying |
| `policy_proposal.applied` | governance·P | kernel | pp | applied |
| `policy_proposal.application_abandoned` | governance·P | human | pp | dismissed |
| `policy_proposal.effect_measured` | governance·P | kernel (관찰 에이전트 보고) | pp | effect 체크포인트 |
| `policy_proposal.reverted` | governance·P | human | pp | reverted |
| `procedure.adopted` | governance·P | human | pd | active (trial) |
| `procedure.trust_changed` | governance·P | human, kernel(채택된 demotion) | pd | trial·trusted·demoted |
| `procedure.retired` | governance·P | human | pd | retired |
| `observer_run.started`, `observer_run.completed`, `observer_run.failed` | governance·P | agent:observer | null | 관찰 실행 기록 (16) |
| `brief.acknowledged` | governance·A | human | pj 또는 null | 사람이 복귀 요약을 이 seq까지 읽음 (19의 마지막 확인 커서). 휴대폰에서 줄여 본 확인은 `compact: true` ([판정 J-137]) |
| `brief.corrected` | governance·A | human | pj 또는 null | 복귀 요약의 잘못을 사람이 고침 (19) |
| `command.rejected` | kernel·(대상 평면 또는 null) | 명령의 행위자 | 대상 레코드 또는 null | 없음 (거부·충돌·게이트 기록, A14) |
| `record.staled` | kernel·(대상 평면) | kernel, scheduler | 임의 레코드 | quality.stale |
| `record.revalidated` | kernel·(대상 평면) | kernel, human, agent:verifier | 임의 레코드 | stale 해제 |
| `record.superseded` | kernel·(대상 평면) | kernel | 임의 레코드 | supersededBy, 상태 superseded |
| `daemon.booted` | system | runtime | null | 부팅 epoch 시작 |
| `push.sent` | system | runtime | dv | 푸시 송신 결과 (감사, 16 지표). 상태 변화 없음 (26) |
| `daemon.stopped` | system | runtime | null | 정상 종료 기록 (가능할 때만) |
| `daemon.mode_changed` | system | runtime | null | normal·read_only·safe 전이 (17) |
| `daemon.safe_mode_entered`, `daemon.safe_mode_exited` | system | runtime, human | null | 안전 모드 (17, 크래시 루프 전용. J-67) |
| `config.reloaded` | system | runtime | null | 바뀐 키 이름 (값 없음) |
| `secrets.reloaded` | system | runtime | null | 다시 읽은 비밀 키 이름 (값 없음) |
| `clock.skew_detected` | system | runtime | null | 시계가 뒤로 감 (§3.2 규칙 9) |
| `store.migrated` | system | runtime | null | 스키마 이전 기록 |
| `store.restored` | system | runtime | null | 복원으로 새 `storeId` (§3.14.2) |
| `integrity.verified` | system | runtime | null | 체인 검사 결과 |
| `integrity.recovered` | system | human | null | 손상 복구 조치 기록 |
| `ledger.hmac_key_rotated` | system | human | null | HMAC 키 교체 (새 keyId) |
| `backup.created`, `backup.failed`, `backup.pruned` | system | runtime | null | 백업 결과 (17) |
| `drill.completed` | system | runtime | null | 복구 훈련 결과 (17) |
| `lens_seed.loaded` | system | kernel | null | 렌즈 seed 버전 해시 기록 (15) |
| `blob.redacted` | system | human | null | blob 내용 삭제 (해시는 남음). 명령 `blob.redact`(10, 사람 전용)가 낸다. 가림 절차는 §3.12 |
| `import.completed` | system | migration | null | 가져오기 보고서 (선택 기능) |

`command.rejected`의 `actor`는 명령을 보낸 행위자다. 거부된 시도를 누가 했는지가 이 기록의 의미이기 때문이다. `scope.concernId`는 명령이 대상으로 한 Concern이고, 대상 Concern이 없으면 null이다. 계획 초안 검사에서 거부된 것은 `ruleId`에 V-PLAN 번호(V-PLAN-01~07, 10 §3.8.1)를 싣는다. `authority`는 빈 배열이다.

#### 3.4.14 측정 (16)

범주 `measurement`. 실험 지표의 원천이며 도메인 상태를 바꾸지 않는다. subject는 보통 null이고, 관련 레코드는 refs에 둔다. 분석 투영은 16이 비동기로 만든다.

| 이벤트 | 행위자 | 내용 |
|---|---|---|
| `view.opened` | human | 화면 열람 (화면 id, 머문 시간 범주, 감사 깊이 `depth`). 대상 레코드는 refs ([판정 J-84]) |
| `surprise.reported` | human | 사람이 놀람을 보고 |
| `resumption_check.opened`, `resumption_check.answered`, `resumption_check.scored` | opened: runtime, answered: human, scored: runtime·kernel | 복귀 이해도 점검. 기대 답은 이벤트에 넣지 않고 해시만 둔다(16 §3.24.1) |
| `self_report.recorded` | human | 자기 보고 |
| `experiment.condition_set` | human | 실험 조건 설정 |
| `observer_report.recorded` | agent:observer | 관찰 보고서 (blob) |

#### 3.4.15 payload 스키마

```ts
// @helm/domain/src/events/payloads.ts
const P = Obj;
/** 19 ListenerKind (판정 §2): 리스너 이름 */
const ListenerKind = Enum(["tailnet", "loopback", "local"]);
/** 예산 계정 (12 §3.11, J-22) */
const BudgetScope = Type.String({ pattern: "^(rn|wu|iq|ag)_[0-9A-HJKMNP-TV-Z]{26}$|^(act|day|month):[A-Za-z0-9_:-]{1,64}$|^observer$" });
/** 13 ChangeSet: 실행 전후 작업 공간 변경 */
const ChangeSet = P({
  measured: Type.Boolean(),
  method: Type.String({ minLength: 1, maxLength: 32 }),
  roots: Type.Array(Type.String({ maxLength: 4096 })),
  changes: Type.Array(P({ path: Type.String({ maxLength: 4096 }),
                          kind: Enum(["created", "modified", "deleted", "renamed", "mode"]),
                          beforeSha256: Nullable(Type.String()), afterSha256: Nullable(Type.String()) }), { maxItems: 1000 }),
  truncated: Type.Boolean(),
  ignoredNotMeasured: Type.Array(Type.String({ maxLength: 4096 })),
  concurrentWritersPossible: Type.Boolean(),
});
const Reason = Obj({ reason: ShortText });

export const EventPayloads = {
  // ── 프로젝트·Goal ──
  "project.created": P({ project: ProjectCore }),
  "project.updated": P({ name: Type.Optional(Title), rootPaths: Type.Optional(ProjectCore.properties.rootPaths),
                         observeExternalSessions: Type.Optional(Type.Boolean()),
                         sessionLogRootOverride: Type.Optional(Nullable(Type.String({ maxLength: 4096 }))) }),
  "project.archived": Reason,
  "goal.proposed": P({ goal: GoalCore, questionId: Nullable(QuestionId) }),
  "goal.activated": P({ content: GoalContent }),
  "goal.revision_proposed": P({ content: GoalContent, basis: GoalRevisionDraft.properties.basis,
                                reason: ShortText, questionId: QuestionId }),
  "goal.revised": P({ goalVersion: Type.Integer({ minimum: 2 }), content: GoalContent,
                      basis: Nullable(GoalRevisionDraft.properties.basis), reason: Nullable(ShortText) }),
  "goal.revision_rejected": Reason,
  "goal.paused": Reason, "goal.resumed": Reason,
  "goal.achievement_claimed": P({ conditions: Type.Array(P({ condition: ShortText, refs: Type.Array(EvidenceRecordId, { minItems: 1 }) }), { minItems: 1 }) }),
  "goal.achieved": P({}), "goal.achievement_rejected": Reason,
  "goal.superseded": P({ by: GoalId }), "goal.retired": Reason,

  // ── Concern·구조 ──
  "concern.opened": P({ concern: ConcernCore }),
  "concern.updated": P({ title: Type.Optional(Title), description: Type.Optional(Text) }),
  "concern.reframed": P({ choiceId: ChoiceId, description: Text }),
  "concern.activated": P({ cause: AnyRecordId }),
  "concern.held": P({ structureChangeId: StructureChangeId }),
  "concern.resumed": Reason,
  "concern.completed": P({ acceptanceIds: Type.Array(AcceptanceId, { minItems: 1 }) }),
  "concern.closed": P({ force: Type.Boolean(), reason: ShortText,
                        cancelledWorkUnits: Type.Array(WorkUnitId), waivedObligations: Type.Array(ObligationId),
                        deferredObligations: Type.Array(ObligationId) }),
  "concern.reopened": P({ cause: AnyRecordId, trigger: TransitionTrigger }),
  "concern.merged": P({ into: ConcernId, structureChangeId: StructureChangeId }),
  "structure.changed": P({ change: StructureChangeCore }),
  "boundary_item.recorded": P({ item: BoundaryItemCore }),
  "boundary_item.checked": P({ refs: Type.Array(EvidenceRecordId) }),
  "boundary_item.dropped": Reason,
  "entry.evaluated": P({ assessment: EntryAssessmentCore }),

  // ── WorkUnit ──
  "workunit.proposed": P({ workUnit: WorkUnitCore }),
  "workunit.started": P({ runId: Nullable(RunId) }),
  "workunit.paused": P({ pause: PauseReason }),
  "workunit.resumed": P({ note: Nullable(ShortText) }),
  "workunit.scope_exceeded": P({ toolCallId: ToolCallId, questionId: QuestionId, requested: Type.Array(ResourceScope, { minItems: 1 }),
                                 primitive: PrimitiveSchema, note: Nullable(ShortText) }),
  "workunit.scope_resolved": P({ questionId: QuestionId, decision: Type.Union([Type.Literal("expanded"), Type.Literal("kept"), Type.Literal("renegotiate")]) }),
  "workunit.concluded": P({ reason: Type.Union([Type.Literal("stop_condition"), Type.Literal("budget"), Type.Literal("human"), Type.Literal("probe_outcome")]), note: Nullable(ShortText) }),
  "workunit.cancelled": Reason,
  "workunit.superseded": P({ by: WorkUnitId }),

  // ── 관찰·전제·열린 질문 ──
  "observation.recorded": P({ observation: ObservationCore }),
  "observation.annotated": P({ annotation: Type.Omit(Annotation, ["by", "seq"]) }),
  "observation.retracted": P({ reason: Nullable(ShortText), supersededBy: Nullable(ObservationId) }),
  "assumption.recorded": P({ assumption: AssumptionCore }),
  "assumption.confirmed": P({ refs: Type.Array(EvidenceRecordId), note: Nullable(ShortText) }),
  "assumption.invalidated": P({ refs: Type.Array(EvidenceRecordId), note: Nullable(ShortText) }),
  "assumption.retired": Reason,
  "open_question.recorded": P({ openQuestion: OpenQuestionCore }),
  "open_question.resolved": P({ refs: Type.Array(EvidenceRecordId, { minItems: 1 }) }),
  "open_question.dropped": Reason,

  // ── Claim ──
  "interpretation.proposed": P({ interpretation: InterpretationCore }),
  "interpretation.retracted": Reason,
  "possibility.proposed": P({ possibility: PossibilityCore }),
  "possibility.rejected": P({ refs: Type.Array(EvidenceRecordId, { minItems: 1 }), note: ShortText }),
  "possibility.marked_undecidable": P({ note: ShortText }),
  "possibility.withdrawn": Reason,
  "possibility.dismissed": P({ note: Nullable(ShortText) }),
  "possibility.merged": P({ into: PossibilityId, note: Nullable(ShortText) }),
  "possibility.pinned": P({}), "possibility.unpinned": P({}),
  "claim.evidence_linked": P({ claimId: ClaimId, link: Type.Omit(EvidenceLink, ["linkedBy", "linkedSeq", "resolution"]) }),
  "claim.counter_searched": P({ claimId: ClaimId, search: Type.Omit(CounterSearch, ["by", "seq"]) }),
  "claim.counter_resolved": P({ claimId: ClaimId, target: ObservationId, resolution: Type.Omit(CounterResolution, ["by", "seq"]) }),
  "check.declared": P({ check: DiscriminatingCheckCore }),
  "check.observed": P({ observationIds: Type.Array(ObservationId, { minItems: 1 }), outcome: OutcomeLabel,
                        posthoc: Type.Boolean(), verdicts: Type.Array(CheckVerdict) }),
  "check.voided": Reason,
  "check.pinned": P({}), "check.unpinned": P({}),
  "finding.promoted": P({ finding: FindingCore }),
  "finding.confirmed": P({ via: Type.Union([Type.Literal("direct"), Type.Literal("choice_commit")]) }),
  "finding.withdrawn": Reason,

  // ── 선택·이의 ──
  "choice.committed": P({ choice: ChoiceCore }),
  "choice.revoked": Reason,
  "objection.filed": P({ objection: ObjectionCore }),
  "objection.resolved": P({ resolution: Type.Union([Type.Literal("upheld"), Type.Literal("withdrawn"), Type.Literal("dismissed")]),
                            refs: Type.Array(AnyRecordId), note: Nullable(ShortText) }),
  "decision.confirmed": P({ targets: Type.Array(AnyRecordId, { minItems: 1, maxItems: 200 }) }),

  // ── 합의·Grant ──
  "agreement.proposed": P({ agreement: AgreementCore, checkBack: Nullable(CheckBack) }),
  "agreement.revised": P({ revision: Type.Integer({ minimum: 2 }), content: AgreementContent, reason: Nullable(ShortText) }),
  "agreement.confirmed": P({ revision: Type.Integer({ minimum: 1 }),
                             viaAcceptanceId: Nullable(AcceptanceId) }),   // 반영 범위 합의를 결과 확인과 같은 조작으로 확정 ([판정 J-126])
  "agreement.activated_by_choice": P({ revision: Type.Integer({ minimum: 1 }), choiceId: ChoiceId, questionId: QuestionId,
                                      optionKey: Type.String({ minLength: 1 }),
                                      /** 사람이 고른 선택지의 Scope. 커널이 합의 범위 ⊆ 이 값을 검사한 근거다 ([판정 J-133]) */
                                      scope: Scope }),
  "agreement.activated_by_grant": P({ revision: Type.Integer({ minimum: 1 }), grantId: GrantId, autonomy: AutonomousDecision }),
  "agreement.activated_by_rule": P({ revision: Type.Integer({ minimum: 1 }), ruleId: Type.String({ minLength: 1 }) }),
  "agreement.declined": Reason,
  "agreement.discarded": Reason,
  "agreement.narrowed": P({ narrowed: Scope, reason: ShortText, linkedQuestionId: Nullable(QuestionId), autonomy: Autonomy }),
  "agreement.restored": P({ reason: ShortText, restoredTo: Nullable(Scope) }),   // null이면 현재 개정판 범위로
  "agreement.scope_change_requested": P({ requested: Scope, reason: ShortText, questionId: QuestionId }),
  "agreement.renegotiated": P({ fromRevision: Type.Integer({ minimum: 1 }), revision: Type.Integer({ minimum: 2 }),
                                content: AgreementContent, reason: ShortText }),
  "agreement.stop_condition_met": P({ condition: ShortText, evidence: Type.Array(ObservationId) }),
  "agreement.violation_detected": P({ observationId: ObservationId, note: ShortText }),
  "agreement.fulfilled": P({ acceptanceId: AcceptanceId }),
  "agreement.released": Reason,
  "agreement.expired": P({}),
  "grant.issued": P({ grant: GrantCore }),
  "grant.revoked": Reason, "grant.expired": P({}), "grant.exhausted": P({}),

  // ── 결과·확인·반영 ──
  "result.submitted": P({ result: ResultSubmissionCore, producerRunIds: Type.Array(RunId) }),
  "attestation.recorded": P({ attestation: AttestationCore }),
  "acceptance.recorded": P({ acceptance: AcceptanceCore, independence: Acceptance.properties.independence,
                             /** 결과 확인 화면에서 함께 답한 질문들 (11 §3.15). 각 질문은 같은 트랜잭션의 question.answered */
                             bundledAnswers: Type.Array(QuestionId) }),
  "integration.opened": P({ integration: IntegrationCore }),
  "integration.completed": P({}),
  "obligation.added": P({ obligation: ObligationCore }),
  "obligation.resolved": P({ refs: Type.Array(AnyRecordId), note: Nullable(ShortText) }),
  "obligation.deferred": P({ reason: ShortText, revisitTrigger: Trigger }),
  "obligation.reopened": P({ cause: Type.String({ minLength: 1 }) }),
  "obligation.transferred": P({ to: IdAny("cn", "wu"), newObligationId: Nullable(ObligationId) }),
  "obligation.waived": Reason,
  "reflection.recorded": P({ reflection: ReflectionCore }),

  // ── 질문·기대·예측 ──
  "question.recorded": P({ question: QuestionCore }),
  "question.updated": P({ addedEvidence: Type.Array(AnyRecordId), blocks: BlockScope, assumptionExpires: Nullable(Trigger),
                          mergedCommandId: CommandId }),
  "question.delivery_planned": P({ mode: DeliveryMode, at: Nullable(Ms), boundary: Nullable(Trigger),
                                   bundleId: Nullable(Type.String({ minLength: 1, maxLength: 64 })), autonomy: Autonomy }),
  "delivery.planned": P({ bundleId: Type.String({ minLength: 1, maxLength: 64 }), questionIds: Type.Array(QuestionId, { minItems: 1 }),
                          plan: BlobRef, autonomy: Autonomy }),   // 계획 본문 모양은 11 DeliveryPlanPayload
  // 11 QuestionDeliveredExtra + 20 DeliveryPayloadForApp. 문구는 05 키로 저장하고 앱이 @helm/ui-language로 만든다.
  // 질문 본문과 비밀을 넣지 않는다. 기본 문구는 내용 숨김 (판정 J-03)
  "question.delivered": P({
    deliveryId: Type.String({ minLength: 1, maxLength: 64 }),
    batchKey: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    /** app: 연결된 앱에 보냄. push: Web Push를 보냄(26 §3.4.3, 푸시 계획이 정한 기기, 결정 48의 강도만).
     *  brief: 연결도 푸시도 없어 다음 복귀 요약에만 실림. 한 전달에 경로가 여럿이면 질문당 question.delivered를 경로마다 남긴다 */
    channel: Type.Union([Type.Literal("app"), Type.Literal("push"), Type.Literal("tui"), Type.Literal("brief")]),
    surface: Type.Array(Type.Union([Type.Literal("os"), Type.Literal("badge"), Type.Literal("banner")])),
    category: Enum(["question", "rights_gate", "review", "goal", "recovery", "observer", "system"]),
    urgency: Type.Union([Type.Literal("interrupt"), Type.Literal("notice"), Type.Literal("digest")]),   // 11 Urgency (J-52)
    copy: P({ titleKey: Type.String({ minLength: 1, maxLength: 128 }), bodyKey: Type.String({ minLength: 1, maxLength: 128 }),
              args: Type.Record(Type.String(), Type.String({ maxLength: 200 })) }),
    target: Type.String({ minLength: 1, maxLength: 512 }),     // 딥 링크 helm://question/<qs_id>
    expiresAt: Nullable(Ms),
    targetDevices: Type.Union([Type.Literal("all"), Type.Array(DeviceId)]),
  }),
  "question.seen": P({ deviceId: Nullable(DeviceId) }),
  "question.deferred": P({ until: Nullable(Trigger),
                           /** 권리 질문에 사람이 미루며 준 마감 (11 V-Q-10, J-49). 있으면 Question.deadline이 된다 */
                           deadline: Nullable(Ms) }),
  "question.delegated": P({ note: Nullable(ShortText) }),
  "question.reframe_requested": P({ note: Nullable(ShortText) }),
  "question.escalated": P({ cause: Type.Union([Type.Literal("expiry_near"), Type.Literal("human"), Type.Literal("policy")]) }),
  "question.answered": P({ value: Type.Unknown(), basisSeq: Seq, matchesAssumption: Nullable(Type.Boolean()),
                           matchesRecommendation: Nullable(Type.Boolean()) }),   // 16 지표
  "question.assumed": P({ choiceId: ChoiceId }),
  "question.withdrawn": Reason, "question.expired": Reason,
  "approval.issued": P({ approvalId: ApprovalId, fingerprint: Sha256, expiresAt: Ms, toolCallId: ToolCallId }),
  "approval.consumed": P({ approvalId: ApprovalId, toolCallId: ToolCallId }),
  "approval.expired": P({ approvalId: ApprovalId, revoked: Type.Boolean(),
                          reason: Type.Union([Type.Literal("time"), Type.Literal("revoked"), Type.Literal("restored")]) }),
  "autonomous.seen": P({ upToSeq: Seq, targets: Type.Array(AnyRecordId) }),
  "expectation.created": P({ expectation: ExpectationCore }),
  "expectation.revised": P({ dueAt: Type.Optional(Ms), statement: Type.Optional(ShortText), reason: ShortText }),
  "expectation.fulfilled": P({ observationId: ObservationId, late: Type.Boolean() }),
  "expectation.timed_out": P({ observationId: ObservationId }),
  "expectation.cancelled": Reason,
  "prediction.recorded": P({ prediction: PredictionCore }),
  "prediction.checked": P({ verdict: Type.Union([Type.Literal("held"), Type.Literal("failed"), Type.Literal("partial"), Type.Literal("indeterminate")]),
                            observations: Type.Array(ObservationId), note: Nullable(ShortText) }),
  "prediction.voided": Reason,

  // ── 루프·상황·모드·다이얼·탐침 ──
  /** authoredBy: 계획을 쓴 주체. decidedBy와 기록·이의는 그대로다 ([판정 J-188] (5), [결정 53]).
   *  modelDraftRejects: 모델 초안이 validatePlan에서 거부된 규칙 id를 시도 순서대로 담는다(최대 2). 위반마다 command.rejected가 남는다.
   *  길이 2이고 authoredBy가 code면 두 번째 위반 뒤 코드가 계획을 계산해 쓴 것이다 ([판정 J-188] (4)). */
  "loop_plan.adopted": P({ plan: LoopPlanCore, authoredBy: Enum(["code", "model", "human"]),
                           modelDraftRejects: Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 2 }) }),
  "loop.transitioned": P({ transition: LoopTransitionCore }),
  "situation.assessed": P({ assessment: SituationAssessmentCore }),
  "mode.assigned": P({ assignment: ModeAssignmentCore }),
  "dial.set": P({ layer: DialLayer, scopeId: Nullable(IdAny("cn", "wu")), key: DialKey, value: Type.Unknown(), reason: Nullable(ShortText) }),
  "dial.unset": P({ layer: DialLayer, scopeId: Nullable(IdAny("cn", "wu")), key: DialKey }),
  "probe.planned": P({ probe: ProbeCore }),
  "probe.concluded": P({ outcome: Type.Union([Type.Literal("grown"), Type.Literal("folded"), Type.Literal("inconclusive"), Type.Literal("exhausted")]),
                         observations: Type.Array(ObservationId, { minItems: 1 }), note: ShortText, autonomy: Autonomy }),
  "probe.cancelled": Reason,
  "watch.defined": P({ watch: WatchCore }),
  "watch.window_closed": P({ dueAt: Ms }),
  "watch.judged": P({ outcome: Type.Union([Type.Literal("stable"), Type.Literal("regressed"), Type.Literal("inconclusive")]),
                      observations: Type.Array(ObservationId), autonomy: Autonomy }),
  "watch.cancelled": Reason,

  // ── 탐구·자극·선호·렌즈 ──
  "inquiry.opened": P({ inquiry: InquiryCore,
                        /** 첫 발산 강도와 그 신호 (15 §3.4.2). 확정값은 inquiry.anchored */
                        divergence: P({ mode: Type.Union([Type.Literal("off"), Type.Literal("narrow"), Type.Literal("wide")]),
                                        signals: Type.Array(Type.String({ minLength: 1, maxLength: 32 })) }) }),
  "inquiry.perspective_added": P({ perspective: Perspective }),
  "inquiry.anchored": P({ anchor: BlobRef, refs: Type.Array(AnyRecordId) }),
  "inquiry.round_started": P({ n: Type.Integer({ minimum: 0 }), planHash: Nullable(Sha256) }),
  "inquiry.stage_completed": P({ stage: Type.String({ minLength: 1, maxLength: 32 }), n: Type.Integer({ minimum: 0 }) }),
  "inquiry.stop_rule_met": P({ rule: Type.String({ minLength: 1, maxLength: 64 }), inputs: Type.Record(Type.String(), Type.Unknown()) }),
  "contrast.presented": P({ pair: Type.Array(StimulusId, { minItems: 2, maxItems: 2 }), controlledFor: Type.Array(Type.String()), checkId: Nullable(CheckId) }),
  "inquiry.round_ended": P({ n: Type.Integer({ minimum: 0 }), leaderRef: Nullable(AnyRecordId),
                              leaderVersion: Nullable(Type.Integer({ minimum: 1 })), summary: Nullable(ShortText) }),
  "inquiry.cell_closed": P({ cellKey: Type.String({ minLength: 1 }), state: Type.Union([Type.Literal("filled"), Type.Literal("not_applicable")]),
                             reason: Nullable(ShortText), possibilityIds: Type.Array(PossibilityId), branchRunId: Nullable(RunId) }),
  "inquiry.stopped": P({ reason: Inquiry.properties.stop.anyOf[0].properties.reason, note: Nullable(ShortText),
                         openQuestionIds: Type.Array(OpenQuestionId),
                         handover: Nullable(BlobRef),   // 15 §3.14 InquiryHandover
                         /** 이어서 할 일 ([판정 J-157]). 14는 then === "decide_now"로 "지금 정하기"를 계산한다. 피로 멈춤의 then은 decide_now다. 초안 쪽 답으로 멈추면 사람의 결정으로 넘어간다([판정 J-235]) */
                         then: Enum(["proceed", "handoff", "decide_now"]) }),
  "lens.added": P({ lens: LensCore }),
  "lens.updated": P({ changes: Type.Partial(LensCore), userModified: Type.Boolean() }),
  "lens.retired": Reason,
  "stimulus.created": P({ stimulus: StimulusCore }),
  "stimulus.presented": P({ order: Type.Integer({ minimum: 0 }), shuffleSeed: Type.String({ minLength: 1 }) }),
  "stimulus.withdrawn": Reason,
  "preference_model.created": P({ model: PreferenceModelCore }),
  "preference.criterion_confirmed": P({
    criterion: Type.Omit(PreferenceCriterion, ["status", "confirmedSeq", "quality"]), questionId: Nullable(QuestionId),
  }),
  "preference.criterion_revised": P({ key: Type.String({ minLength: 1 }), name: Type.Optional(ShortText), weight: Type.Optional(Grade), reason: ShortText }),
  "preference.criterion_retired": P({ key: Type.String({ minLength: 1 }), reason: ShortText }),
  "preference.example_marked": P({ stimulusId: StimulusId, polarity: Type.Union([Type.Literal("liked"), Type.Literal("disliked")]) }),
  "preference.divergence_noted": P({ stated: ShortText, revealed: ShortText, evidence: Type.Array(ObservationId, { minItems: 1 }) }),
  "preference.divergence_shown": P({ index: Type.Integer({ minimum: 0 }) }),
  "preference_model.versioned": P({ modelVersion: Type.Integer({ minimum: 2 }) }),

  // ── 런타임 ──
  "thread.opened": P({ thread: Type.Omit(Thread, ["id", "kind", "status", "activeRunId"]) }),   // Meta 필드 제외 표기
  "thread.closed": Reason,
  "run.queued": P({ run: RunCore }),
  "run.started": P({ attempt: Type.Integer({ minimum: 1 }), ownerEpoch: Type.String({ minLength: 26, maxLength: 26 }) }),
  "run.context_projected": P({
    requestNo: Type.Integer({ minimum: 1 }),
    projectionId: Id("cp"),
    purpose: Enum(["resumption", "execution", "deliberation", "review", "handoff", "branch", "verification",
                         "mediation", "summary", "subcall"]), // F05 §9 purpose + 12
    sourceSeq: Type.Integer({ minimum: 0 }),          // 투영을 만든 시점의 head seq
    policyVersion: Type.String({ minLength: 1 }),
    projection: BlobRef,                              // 모델에 준 컨텍스트 문서 전문
    includedRefs: Type.Array(AnyRecordId, { maxItems: 500 }),
    staleRefs: Type.Array(AnyRecordId, { maxItems: 500 }),   // 낡음 플래그가 켜진 채 포함된 레코드 (16 H7)
    includedRefCount: Type.Integer({ minimum: 0 }),
    omitted: Type.Array(P({ category: Type.String({ minLength: 1 }), count: Type.Integer({ minimum: 1 }), reason: Type.String({ minLength: 1 }) })),
    invalidationTriggers: Type.Array(Type.String({ minLength: 1 })),
    budget: P({ maxChars: Type.Integer({ minimum: 0 }), usedChars: Type.Integer({ minimum: 0 }), approximateTokens: Type.Integer({ minimum: 0 }) }),
    requestId: Id("mr"),
    model: P({ provider: Type.String(), id: Type.String() }),
    requiredRefs: Type.Array(AnyRecordId, { maxItems: 500 }),   // 반드시 넣어야 했던 레코드 (10 A9 mustIncludeRefs)
    cacheBreak: Nullable(Type.String({ maxLength: 64 })),         // 공급자 캐시가 끊긴 이유
    bytesHash: Sha256, tokenEstimate: Type.Integer({ minimum: 0 }),
    images: Type.Array(BlobRef),
    // projection blob에는 12 투영 manifest 전문(포함·생략·순서)을 함께 둔다
  }),
  "run.message_recorded": P({
    messageId: Id("ms"),
    messageNo: Type.Integer({ minimum: 1 }),
    origin: Enum(["user_input", "model", "injection", "tool_result", "summary", "system"]), // 12
    requestId: Nullable(Id("mr")),
    injection: Nullable(P({ injectionId: Type.String({ minLength: 1, maxLength: 64 }), kind: Type.String({ maxLength: 32 }),
                            digest: Sha256 })),
    formatVersion: Type.Integer({ minimum: 1 }),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("system_section"), Type.Literal("tool_result")]),
    body: BlobRef,
    summary: Nullable(ShortText),
    model: Nullable(P({ provider: Type.String(), id: Type.String() })),
    usage: Nullable(Usage),
    stopReason: Nullable(Type.String()),
    toolCallIds: Type.Array(ToolCallId),
    utteranceObservationId: Nullable(ObservationId), // 사람 메시지면 같은 트랜잭션의 관찰
    /** 입력이 의미 미리보기를 거쳤으면 그 미리보기 ID와 두 해석 종류를 싣는다 (19 SemanticPreviewResult, 16 §3.23.8) */
    previewId: Type.Optional(Type.String({ maxLength: 64 })),
    previewAs: Type.Optional(Enum(["question", "constraint_change", "choice", "request", "criterion_change", "objection", "chat"])),   // 미리보기가 낸 해석 종류
    chosenAs: Type.Optional(Enum(["question", "constraint_change", "choice", "request", "criterion_change", "objection", "chat"])),   // 사람이 고른 종류. "그냥 메시지로"는 chat
  }),
  "run.steered": P({ text: ShortText, appliedAtStep: Type.Integer({ minimum: 0 }) }),
  "run.awaiting": P({ kind: Type.Union([Type.Literal("question"), Type.Literal("recovery")]), ref: IdAny("qs", "tc") }),
  "run.stopping": P({ cause: Type.Union([Type.Literal("cancel"), Type.Literal("wrap_up"), Type.Literal("budget"), Type.Literal("shutdown")]) }),
  "run.interrupted": P({ previousEpoch: Type.String({ minLength: 26, maxLength: 26 }), statusBefore: RunStatus,
                         code: Type.Union([Type.Literal("crash"), Type.Literal("daemon_shutdown")]) }),
  "run.ended": P({ reason: RunEndReason, code: Nullable(Type.String({ maxLength: 64 })), note: Nullable(ShortText), usage: Usage,
                   handoff: Nullable(RunHandoff) }),   // handed_off일 때 모델 선언 (08 §3.18.1, 14 §3.5.6)
  /** 한 번의 사용을 여러 계정에 함께 적는다 (12 §3.11). 월 한도(J-22)는 month:YYYY-MM 계정 */
  "budget.charged": P({ scopes: Type.Array(BudgetScope, { minItems: 1 }),
                        usage: Usage, wallMs: Type.Integer({ minimum: 0 }),
                        toolCalls: Type.Integer({ minimum: 0 }), subcalls: Type.Integer({ minimum: 0 }),
                        /** 외부 도구 사용량. 모델 usage와 섞지 않는다 (12 §3.3.7) */
                        toolUsage: Nullable(P({ webSearches: Type.Integer({ minimum: 0 }), searchCostUsd: Type.Number({ minimum: 0 }),
                                                browserMinutes: Type.Number({ minimum: 0 }) })),
                        reservedLeaseId: Nullable(Type.String({ maxLength: 64 })) }),
  "budget.exhausted": P({ scope: BudgetScope, limit: Type.String({ minLength: 1, maxLength: 32 }) }),
  /** 고쳐서 허락한 새 호출이면 원 호출의 id다. 원 호출은 같은 트랜잭션에서 toolcall.denied(edited_by_human)로 닫힌다 ([판정 J-121]) */
  "toolcall.requested": P({ toolCall: ToolCallCore, editedFrom: Nullable(ToolCallId) }),
  "toolcall.blocked": P({ rejectionClass: RejectionClassSchema, code: Type.String({ minLength: 1 }), reason: ShortText,
                          permission: Nullable(PermissionVerdict) }),
  "toolcall.approval_requested": P({ questionId: QuestionId, permission: Nullable(PermissionVerdict) }),
  "toolcall.approved": P({ questionId: QuestionId }),   // 그대로 허락. 같은 tcId로 실행 (J-40)
  /** edited_by_human이면 같은 트랜잭션에 새 호출의 toolcall.requested(editedFrom)와 approval.issued ([판정 J-121]). 승인 대기 만료는 `toolcall.not_executed`(approval_expired)로 쓴다(08 §3.22.14). 합의 취소는 `toolcall.not_executed`(cancel)로 쓰고, `denied`에는 cancel이 없다([판정 J-224]) */
  "toolcall.denied": P({ questionId: Nullable(QuestionId),
                         reason: Type.Union([Type.Literal("human"), Type.Literal("edited_by_human")]),
                         note: Nullable(ShortText), editedToolCallId: Nullable(ToolCallId), editedArgs: Nullable(BlobRef) }),
  "toolcall.started": P({ execution: ToolCallExecution, permission: Nullable(PermissionVerdict) }),
  "toolcall.not_executed": P({ reason: NotExecutedReason }),
  "toolcall.completed": P({ outcome: Type.Literal("completed"),
                            observationId: Nullable(ObservationId),          // primitive = null 제안 도구는 null (J-43)
                            isError: Type.Boolean(), exitCode: Nullable(Type.Integer()),
                            content: Nullable(BlobRef), structuredContent: Nullable(BlobRef),
                            modelContent: Nullable(BlobRef), fullOutput: Nullable(BlobRef),
                            truncation: Nullable(P({ originalBytes: Type.Integer({ minimum: 0 }), keptBytes: Type.Integer({ minimum: 0 }) })),
                            recovered: Nullable(Type.Union([Type.Literal("hash_verified"), Type.Literal("replayed")])),
                            enforcement: ToolCallExecution.properties.enforcement, durationMs: DurationMs,
                            observedChanges: Nullable(ChangeSet) }),
  "toolcall.interrupted": P({ observationId: ObservationId,
                              cause: Type.Union([Type.Literal("crash"), Type.Literal("daemon_shutdown"), Type.Literal("cancel"), Type.Literal("steering")]),   // run.interrupted.code와 같은 값 ([판정 J-160], J-122)
                              detectedChanges: Nullable(ChangeSet) }),
  "toolcall.outcome_uncertain": P({ observationId: ObservationId, cause: Type.String({ minLength: 1, maxLength: 32 }),
                                    recoveryCheck: ShortText, externalRef: Nullable(Type.String({ maxLength: 512 })),
                                    detectedChanges: Nullable(ChangeSet) }),
  "toolcall.replay_started": P({ attempt: Type.Integer({ minimum: 1 }), agreementRef: ToolCallExecution.properties.agreementRef,
                                 permission: Nullable(PermissionVerdict) }),
  "toolcall.recovered": P({ resolution: ToolCall.properties.recovery.anyOf[0].properties.resolution,
                            evidence: Type.Array(ObservationId) }),
  "rollback_point.registered": P({ rollbackPoint: RollbackPointCore }),
  "rollback_point.used": P({ forObjectionId: Nullable(ObjectionId), note: Nullable(ShortText) }),
  "rollback_point.expired": Reason,
  "directive.applied": P({ directiveSeq: Seq, directiveType: Type.String({ minLength: 1, maxLength: 32 }),
                           turns: Type.Integer({ minimum: 0 }), ms: Type.Integer({ minimum: 0 }), opsCount: Type.Integer({ minimum: 0 }) }),
  "workspace.unlinked_change_observed": P({ root: Type.String({ minLength: 1, maxLength: 4096 }),
                                            files: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 200 }),
                                            fileCount: Type.Integer({ minimum: 1 }), toolCallId: Nullable(ToolCallId) }),
  "boundary.reached": P({ boundary: WorkBoundaryKind,   // 08: round_end, workunit_end, loop_transition, concern_waiting, user_return, review_window, daily_rollover
                          concernId: Nullable(ConcernId), workUnitId: Nullable(WorkUnitId), ref: Nullable(AnyRecordId) }),

  // ── 통치·커널·시스템 ──
  // 기기·페어링·인증 (필드 의미는 18 §3.7~3.13). tokenHash·codeHash는 sensitiveFields
  "pairing.code_created": P({ codeHash: Sha256, createdBy: PairingCode.properties.createdBy, intendedName: Nullable(Title), expiresAt: Ms }),
  "pairing.code_consumed": P({ deviceId: DeviceId }),
  "pairing.code_failed": P({ reason: Type.String({ minLength: 1, maxLength: 32 }), sourceIp: Nullable(Type.String({ maxLength: 64 })),
                             count: Type.Integer({ minimum: 1 }) }),
  "pairing.code_expired": P({}), "pairing.code_cancelled": Reason,
  // 코드로 페어링했으면 코드와 만든 주체는 device.pairedFrom(08 DeviceCore)에 있다. 18 도난 대응의 연쇄 폐기 근거 ([판정 J-159])
  "device.paired": P({ device: DeviceCore, tokenId: Type.String({ pattern: "^[0-9a-f]{12}$" }), tokenHash: Sha256, expiresAt: Ms,
                       tailnetNodeId: Nullable(Type.String({ maxLength: 128 })),
                       credentialCarrier: Type.Union([Type.Literal("header"), Type.Literal("cookie")]) }),   // 26 §3.3.3, 결정 47
  "device.bound_to_node": P({ tailnetNodeId: Type.String({ minLength: 1, maxLength: 128 }), tailnetLogin: Nullable(Type.String({ maxLength: 256 })) }),
  "device.renamed": P({ name: Title }),
  "device.token_rotated": P({ tokenId: Type.String({ pattern: "^[0-9a-f]{12}$" }), newTokenHash: Sha256, prevValidUntil: Nullable(Ms) }),
  "device.expired": P({ cause: Type.Union([Type.Literal("absolute"), Type.Literal("idle"), Type.Literal("forced")]) }),
  "device.revoked": Reason,
  "device.connected": P({ connectionId: ConnectionId, listener: ListenerKind }),
  "device.push_registered": P({ registration: PushRegistration }),
  "device.push_unregistered": P({ reason: Enum(["user", "gone", "revoked", "permission_lost", "key_rotated"]) }),
  "device.disconnected": P({ connectionId: ConnectionId, cause: Type.String({ minLength: 1, maxLength: 32 }) }),
  // 값은 PresenceState. 부재는 14의 파생 함수로 계산한다
  "presence.changed": P({ state: PresenceState, previous: PresenceState,
                          screen: Nullable(Type.String({ maxLength: 64 })) }),
  "auth.denied": P({ reason: Type.String({ minLength: 1, maxLength: 32 }), listener: ListenerKind,
                     sourceIp: Nullable(Type.String({ maxLength: 64 })), count: Type.Integer({ minimum: 1 }) }),
  "auth.policy_relaxed": P({ key: Type.String({ minLength: 1, maxLength: 64 }), reason: ShortText }),
  "tools.sandbox_disabled": P({ scope: Type.String({ minLength: 1, maxLength: 64 }), reason: ShortText, until: Nullable(Ms) }),   // reason 값 browser_no_sandbox: 브라우저 내부 샌드박스를 끈 경우 (18 §3.11.11)
  "tools.sandbox_enabled": P({ scope: Type.String({ minLength: 1, maxLength: 64 }) }),
  "tools.git_config_suspicious": P({ root: Type.String({ minLength: 1, maxLength: 4096 }),
                                     reason: Enum(["exec_keys_present", "config_hash_changed", "git_dir_created"]),
                                     keys: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 50 }) }),   // 설정 키 이름만. 값은 넣지 않는다 (18 R-13)
  "permission.overridden": P({ toolCallId: Nullable(ToolCallId), rule: Type.String({ minLength: 1, maxLength: 128 }), reason: ShortText }),
  "setting.changed": P({ key: Type.String({ minLength: 1, maxLength: 128 }), value: Type.Unknown(), secret: Type.Boolean() }),
  // 관찰 에이전트 제안 (상태 기계와 필드 의미는 16 §3.15)
  "policy_proposal.submitted": P({ proposal: PolicyProposalCore }),
  "policy_proposal.evidence_updated": P({ evidence: PolicyProposalCore.properties.evidence }),
  "policy_proposal.accepted": P({ note: Nullable(ShortText), edits: Nullable(BlobRef) }),
  "policy_proposal.dismissed": P({ reason: Type.String({ minLength: 1, maxLength: 32 }), scope: Type.Union([Type.Literal("this"), Type.Literal("family_forever")]),
                                   note: Nullable(ShortText) }),
  "policy_proposal.deferred": P({ until: Ms }),
  "policy_proposal.reopened": P({}),
  "policy_proposal.withdrawn": Reason,
  "policy_proposal.expired": P({}),
  "policy_proposal.application_opened": P({ concernId: ConcernId }),
  "policy_proposal.applied": P({ appliedRefs: Type.Array(Type.String({ minLength: 1 })), settingSeq: Nullable(Seq) }),
  "policy_proposal.application_abandoned": Reason,
  "policy_proposal.effect_measured": P({ checkpoint: Type.Record(Type.String(), Type.Unknown()),
                                         verdict: Nullable(Enum(["effective", "ineffective", "inconclusive", "harmful"])) }),
  "policy_proposal.reverted": Reason,
  "procedure.adopted": P({ procedure: ProcedureCore }),
  "procedure.trust_changed": P({ trust: Type.Union([Type.Literal("trial"), Type.Literal("trusted"), Type.Literal("demoted")]), reason: ShortText,
                                 proposalId: Nullable(PolicyProposalId) }),
  "procedure.retired": Reason,
  "observer_run.started": P({ runKey: Type.String({ minLength: 1, maxLength: 64 }), inputs: Type.Record(Type.String(), Type.Unknown()) }),
  "observer_run.completed": P({ runKey: Type.String({ minLength: 1, maxLength: 64 }), proposals: Type.Integer({ minimum: 0 }), report: Nullable(BlobRef) }),
  "observer_run.failed": P({ runKey: Type.String({ minLength: 1, maxLength: 64 }), code: Type.String({ maxLength: 64 }) }),
  "brief.acknowledged": P({ upToSeq: Type.Integer({ minimum: 0 }), projectId: Nullable(ProjectId),
                            note: Nullable(ShortText),   // check-back 한 줄 (04·19)
                            compact: Type.Boolean() }),   // 휴대폰에서 줄여 본 확인 ([판정 J-137]). 줄여 본 반대 근거·이견은 다음 데스크톱 요약에 남는다
  "brief.corrected": P({ upToSeq: Type.Integer({ minimum: 0 }), item: Type.String({ minLength: 1, maxLength: 128 }), correction: ShortText }),
  "command.rejected": P({
    commandId: CommandId,
    commandType: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.Union([Type.Literal("rejected"), Type.Literal("conflict"), Type.Literal("needs_gate")]),
    rejectionClass: RejectionClassSchema,
    code: Type.String({ pattern: REJECTION_CODE_PATTERN }),
    ruleId: Nullable(Type.String({ minLength: 1, maxLength: 32 })),     // 10 규칙 id (V-DEP-1 등. 계획 초안 검사는 V-PLAN-01~07, 10 §3.8.1)
    reasons: Type.Array(ShortText),
    missing: Type.Array(Type.String({ minLength: 1, maxLength: 200 })),
    gateQuestionId: Nullable(QuestionId),                                // needs_gate면 같은 트랜잭션의 question.recorded
    contextRef: Nullable(Id("cp")),
    request: BlobRef,                     // 거부된 명령 원문 (감사용)
  }),
  "record.staled": P({ recordId: AnyRecordId, reason: StaleReason, causeRef: Type.String({ minLength: 1 }) }),
  "record.revalidated": P({ recordId: AnyRecordId, evidence: Type.Array(EvidenceRecordId), note: Nullable(ShortText) }),
  "record.superseded": P({ recordId: AnyRecordId, supersededBy: AnyRecordId }),
  "daemon.booted": P({ bootEpoch: Type.String({ minLength: 26, maxLength: 26 }), previousEpoch: Nullable(Type.String({ minLength: 26, maxLength: 26 })), releaseId: Type.String(), userVersion: Type.Integer(),
                       projectorVersion: Type.Integer(), pid: Type.Integer(), host: Type.String(), storeId: Type.String({ minLength: 26, maxLength: 26 }),
                       previousCleanShutdown: Type.Boolean(),
                       /** 읽기 전용으로 시작하면 이 이벤트를 쓰지 않는다(17 AC-10-09). 런타임 복구 결과는 이 뒤 12의 trace recovery.decided */
                       mode: Type.Union([Type.Literal("normal"), Type.Literal("safe")]) }),
  "daemon.stopped": P({ reason: Type.Union([Type.Literal("signal"), Type.Literal("admin"), Type.Literal("upgrade"), Type.Literal("restart"), Type.Literal("fatal")]),
                        uptimeMs: Type.Integer({ minimum: 0 }),
                        drainedRuns: Type.Integer({ minimum: 0 }), interruptedToolCalls: Type.Integer({ minimum: 0 }) }),   // 17 §3.4.3
  "daemon.mode_changed": P({ from: Type.String(), to: Type.String(), reasons: Type.Array(Type.String({ maxLength: 64 })) }),
  "daemon.safe_mode_entered": P({ reason: Type.Union([Type.Literal("crash_loop"), Type.Literal("restored")]), note: Nullable(ShortText),
                                  uncleanStarts: Type.Integer({ minimum: 0 }), recentReasons: Type.Array(Type.String({ maxLength: 64 })) }),
  "daemon.safe_mode_exited": P({ reason: ShortText }),
  "config.reloaded": P({ changedKeys: Type.Array(Type.String({ maxLength: 128 })) }),
  "secrets.reloaded": P({ keys: Type.Array(Type.String({ maxLength: 128 })) }),
  "clock.skew_detected": P({ wallClock: Ms, usedRecordedAt: Ms }),
  "store.restored": P({ previousStoreId: Type.String(), storeId: Type.String(), backupId: Type.String(), upToSeq: Type.Integer({ minimum: 0 }),
                        quarantinePath: Type.String(), carried: Type.Integer({ minimum: 0 }) }),   // 다시 적용한 위험 이벤트 수 (§3.14.2)
  "ledger.hmac_key_rotated": P({ fromKeyId: Type.String({ maxLength: 32 }), toKeyId: Type.String({ maxLength: 32 }) }),
  "lens_seed.loaded": P({ seedVersion: Type.String({ minLength: 1, maxLength: 64 }), seedHash: Sha256, added: Type.Integer({ minimum: 0 }),
                          updated: Type.Integer({ minimum: 0 }) }),
  "backup.failed": P({ kind: Type.String({ maxLength: 16 }), code: Type.String({ maxLength: 64 }), note: Nullable(ShortText) }),
  "backup.pruned": P({ removed: Type.Array(Type.String()) }),
  "drill.completed": P({ ok: Type.Boolean(), backupId: Type.String(), durationMs: DurationMs, report: Nullable(Type.String()) }),
  "store.migrated": P({ fromVersion: Type.Integer(), toVersion: Type.Integer(), migrations: Type.Array(Type.String()),
                        backupPath: Nullable(Type.String()) }),
  "integrity.verified": P({ mode: Type.Union([Type.Literal("tail"), Type.Literal("full")]), fromSeq: Type.Integer({ minimum: 1 }),
                            toSeq: Type.Integer({ minimum: 1 }), headHash: Type.String(), hmacChecked: Type.Integer({ minimum: 0 }),
                            durationMs: DurationMs }),
  "integrity.recovered": P({ brokenAtSeq: Type.Integer({ minimum: 1 }), action: Type.Union([Type.Literal("restored_from_backup"), Type.Literal("other")]),
                             note: ShortText }),
  "backup.created": P({ backupId: Type.String(), kind: Enum(["daily", "pre-migrate", "pre-upgrade", "manual", "pre-restore"]),
                        path: Type.String(), upToSeq: Type.Integer({ minimum: 0 }), headHash: Type.String(),
                        hmacHead: P({ seq: Type.Integer({ minimum: 0 }), keyId: Type.String({ maxLength: 32 }) }),
                        dbSha256: Sha256, bytes: Type.Integer({ minimum: 0 }), blobCount: Type.Integer({ minimum: 0 }) }),
  "blob.redacted": P({ hash: Sha256, reason: ShortText }),
  "import.completed": P({ sourcePath: Type.String(), sourceHash: Sha256, report: BlobRef }),
  "push.sent": P({ deliveryId: Type.String({ minLength: 1, maxLength: 64 }), questionIds: Type.Array(QuestionId),
                   provider: Type.Union([Type.Literal("webpush"), Type.Literal("apns")]),
                   outcome: Enum(["accepted", "gone", "rejected", "failed"]),
                   httpStatus: Nullable(Type.Integer()), attempt: Type.Integer({ minimum: 1 }) }),

  // ── 측정 (16). 필드 의미는 16 §3.6~3.9 ──
  // 화면이 보여 준 대상 레코드는 envelope refs에 둔다
  "view.opened": P({ view: Type.String({ minLength: 1, maxLength: 64 }), dwellBucket: Type.String({ maxLength: 16 }), deviceId: Nullable(DeviceId),
                      /** 화면 깊이. glance·review·audit ([판정 J-84]). 깊이가 없는 화면은 null */
                      depth: Nullable(Enum(["glance", "review", "audit"])) }),
  "surprise.reported": P({ note: Nullable(ShortText), refs: Type.Array(AnyRecordId) }),
  "resumption_check.opened": P({ checkId: Type.String({ minLength: 1, maxLength: 64 }), questions: BlobRef }),
  "resumption_check.answered": P({ checkId: Type.String({ minLength: 1, maxLength: 64 }), answers: BlobRef }),
  "resumption_check.scored": P({ checkId: Type.String({ minLength: 1, maxLength: 64 }), score: Type.Number() }),
  "self_report.recorded": P({ instrument: Type.String({ minLength: 1, maxLength: 64 }), values: Type.Record(Type.String(), Type.Unknown()) }),
  "experiment.condition_set": P({ condition: Type.String({ minLength: 1, maxLength: 64 }), until: Nullable(Ms) }),
  "observer_report.recorded": P({ form: Type.String({ minLength: 1, maxLength: 32 }), report: BlobRef }),   // form = 보고 종류 (16)
} as const;

export type EventType = keyof typeof EventPayloads;
export const EVENT_TYPES = Object.keys(EventPayloads) as EventType[];
export const EventTypeSchema = Enum(EVENT_TYPES);
export type PayloadOf<T extends EventType> = Static<(typeof EventPayloads)[T]>;

/** 카탈로그 메타 (위 표의 범주·평면·행위자·버전) */
export interface EventMeta {
  category: Static<typeof EventCategory>;
  plane: "N" | "E" | "M" | "A" | "P" | null | "subject"; // "subject" = 대상 레코드의 평면을 따름
  actors: readonly string[];      // "agent:*" 등 패턴 허용
  needsAuthority: boolean;
  typeVersion: number;            // 현재 버전
  /** 대상 레코드의 revisionSeq를 올리는가 (08 §3.4.2, 19 basisSeq 충돌 판정). 사람이 본 내용이 바뀌는 이벤트만 true */
  bumpsRevision: boolean;
  /** 재전송·투영 응답·관찰 입력에서 지울 payload 필드 (18 §3.10) */
  sensitiveFields?: readonly string[];
  /** 22 semantic 비교에 쓰는 payload 의미 필드. 없으면 payload 전체를 비교한다 */
  semanticFields?: readonly string[];   // 예: device.paired → ["tokenHash"], device.token_rotated → ["newTokenHash"], pairing.code_created → ["codeHash"]
  retired?: true;
}
export declare const EVENT_META: Readonly<Record<EventType, EventMeta>>;
```

EVENT_META 값은 카탈로그 표(범주·평면·행위자)와 아래 기본값·예외로 만든다. 메타 테스트(§6.1)가 모든 이벤트에 값이 있는지 확인한다.

| 메타 | 기본값 | 예외 |
|---|---|---|
| `needsAuthority` | true | false: `system`·`measurement` 범주 전부, `command.rejected` |
| `bumpsRevision` | `domain`·`governance` 범주에서 subject 레코드의 상태나 내용을 바꾸는 이벤트는 true. `runtime`·`kernel`·`system`·`measurement` 범주는 false | false: `question.delivery_planned`, `delivery.planned`, `question.delivered`, `question.seen`, `question.escalated`, `question.deferred`, `autonomous.seen`, `decision.confirmed`, `observation.annotated`, `claim.evidence_linked`, `claim.counter_searched`, `possibility.pinned`·`unpinned`, `check.pinned`·`unpinned`, `approval.issued`·`consumed`·`expired`, `presence.changed`, `device.connected`·`disconnected`, `entry.evaluated`, `preference.divergence_shown`, `inquiry.round_started`·`stage_completed`·`stop_rule_met`. true로 명시: `question.assumed`([판정 J-120]. 가정 확정 뒤 같은 basisSeq의 답은 충돌), `question.updated`, `question.answered`, `question.withdrawn`, `question.expired`, `record.superseded` |
| `sensitiveFields` | 없음 | `device.paired` → `tokenHash`, `device.token_rotated` → `newTokenHash`, `pairing.code_created` → `codeHash` |
| `typeVersion` | 1 | 없음(지금은 모두 1) |
| `semanticFields` | 없음(payload 전체 비교) | 새로 만든 레코드의 id·시각·blob 해시 필드가 있는 이벤트는 그 필드를 뺀 목록을 둔다(예: `run.message_recorded` → role, origin, toolCallIds 개수). 목록은 `meta.ts`에 이벤트별로 적는다 |

사람 결정 이벤트(`question.answered`, `agreement.confirmed`, `acceptance.recorded`, 사람의 `choice.committed`, `objection.filed`, `policy_proposal.accepted`·`dismissed`)의 payload에는 선택 필드 `humanOp: HumanOpMeta`(08 §3.4.5)를 둘 수 있다. 확정 이벤트(`acceptance.recorded`, `choice.committed`, `finding.confirmed`, `agreement.confirmed`)에는 선택 필드 `acknowledgedFlags: { recordId, flag: "contested" | "stale" }[]`를 둔다. 사람이 이의·낡음 표시를 보고도 확정했다는 기록이며, 10 V-INV-06은 이것이 있을 때만 플래그가 켜진 근거를 허용한다. 위 표기에서는 둘 다 생략했다.

`Type.Omit`, `anyOf[0]` 같은 참조는 08 스키마에서 하위 스키마를 꺼내는 표기다. 구현에서는 08 쪽에서 해당 하위 스키마를 이름 있는 상수로 내보내고 여기서 가져다 쓴다.

카탈로그의 정본은 §3.4 표와 `EventPayloads`다. 이벤트 수를 본문에 적지 않고 메타 테스트가 표와 맵이 같은지 확인한다. 모든 타입의 `typeVersion`은 1에서 시작한다.

### 3.5 휘발 이벤트

화면을 빨리 갱신하기 위한 흐름이다. 저장하지 않고 seq를 받지 않는다. 클라이언트는 재접속하면 휘발 이벤트를 버리고 영속 이벤트(`lastSeq` 이후)로 상태를 다시 맞춘다. 프로토콜 형식과 이름 공간은 19가 정한다. 이 문서는 무엇이 휘발인지와 공통 필드만 정한다.

| 종류 | 내용 | 영속 쪽 대응 |
|---|---|---|
| `run.text_delta` | 모델 출력 토큰 조각 | `run.message_recorded` (완성된 메시지) |
| `run.thinking_delta` | 모델 추론 조각 (보여 줄 때만) | 같은 메시지의 blob (보관 여부는 12) |
| `run.toolcall_args_delta` | 도구 인자 스트리밍 | `toolcall.requested` |
| `toolcall.output_delta` | 도구 출력 진행 (bash stdout 등) | `toolcall.completed`의 결과 blob |
| `run.step_progress` | 단계 번호, 경과 시간 | `run.*` 상태 이벤트 |
| `store.head` | 현재 head seq 알림 (구독 필터 때문에 이벤트가 오지 않을 때 따라잡기 확인용) | - |
| `device.heartbeat` | 기기 생존 신호 | `device_presence` 운영 테이블. 상태가 바뀔 때만 영속 `presence.changed` |

공통 필드:

```ts
// @helm/domain/src/events/volatile.ts
export const VolatileEvent = Obj({
  volatile: Type.Literal(true),
  type: Type.String({ pattern: "^[a-z][a-z_]*\\.[a-z][a-z_]*$" }),
  /** 이 휘발 이벤트를 내보낼 때의 마지막 영속 seq. 클라이언트는 이보다 작은 영속 이벤트를 받기 전에는 적용을 미룰 수 있다 */
  afterSeq: Type.Integer({ minimum: 0 }),
  runId: Nullable(RunId),
  toolCallId: Nullable(ToolCallId),
  data: Type.Record(Type.String(), Type.Unknown()),
});
```

도구 출력 진행의 일부는 크래시 복구에 쓰려고 운영 테이블 `volatile_scratch`에 1초에 한 번까지 덮어쓴다(마지막 8 KiB). 도구 호출이 끝나면 지운다. 재시작 때 `toolcall.interrupted`의 관찰 내용에 이 조각을 넣을 수 있다(pi-durable이 부분 출력을 100ms마다 커밋하는 것과 같은 목적 [원문 pi-api-facts-1 §7.3]). 이 테이블은 무결성 검사 대상이 아니다.

### 3.6 데이터 파일 위치와 SQLite 설정

#### 3.6.1 배치 [근거: 17 §3.2. 이 문서는 데이터 디렉터리 안쪽만 정한다]

데이터 디렉터리는 17이 정한 `${HELM_ROOT:-/srv/volumes/helm}/data/`다. 소켓은 `$XDG_RUNTIME_DIR/helm/rpc.sock`, 백업은 `${HELM_ROOT}/backups/`이며 배치와 권한은 17이 정한다.

```text
${HELM_ROOT}/data/                           0700
  helm.sqlite (+ -wal, -shm)                 0600, 정본 DB
  helmd.lock                                 단일 인스턴스 잠금 (17 §3.1.4, D09-7)
  helmd.owner.json                           진단용 소유 정보 (판정에 쓰지 않음)
  blobs/sha256/<2자>/<2자>/<64 hex>            0600, 256 KiB를 넘는 blob (내용 주소, 바뀌지 않음)
  blobs/staged/<uploadId>                    업로드 중인 파일 (19 staged upload, 24시간 뒤 정리)
  blobs/.tmp/                                blob 쓰기용 임시 파일 (같은 파일시스템이어야 rename이 원자적)
  quarantine/<UTC 시각>/                       복원으로 밀려난 이전 DB (사람이 지운다)
${HELM_ROOT}/backups/{daily,pre-migrate,pre-upgrade,manual,pre-restore}/   검증된 스냅숏 (§3.14, 17 D17-10)
${HELM_ROOT}/state/exports/                  JSONL 내보내기
```

#### 3.6.2 위치 검사 (데몬 시작 시, 실패하면 시작하지 않음)

| 검사 | 조건 | 이유 |
|---|---|---|
| 동기화 폴더 | `realpath(dataDir)`가 `realpath($HOME/projects)` 아래가 아님 | 브리프 §2.5. Syncthing이 SQLite 파일을 동기화하면 깨질 수 있다 |
| Windows·가상 파일시스템 | `/mnt/` 아래가 아님. `statfs` 종류가 ext4·xfs·btrfs 중 하나 (9p, drvfs, fuse 계열, tmpfs 거부. tmpfs는 17의 `HELM_ALLOW_TMPFS`로 개발 때만 허용) | backend-oss-research §2.2 "SQLite는 `/mnt/c`가 아니라 WSL ext4 영역에" [지식]. WAL은 공유 메모리 파일을 쓰므로 네트워크·가상 파일시스템에서 안전하지 않다 [지식] |
| 권한 | 디렉터리 0700, DB 0600, 소유자 = 프로세스 uid. 다르면 17 규칙대로 고치고 경고 | 18 |
| 여유 공간 | 남은 공간 ≥ 1 GiB. 모자라면 시작하지 않는다(17 `diskCriticalBytes`). 실행 중 1 GiB 아래로 떨어지면 17의 `read_only` 모드 | 디스크 가득 참 처리(§4) |

테스트에서는 `HELM_UNSAFE_DATA_DIR=1`로 파일시스템 검사만 끈다. 동기화 폴더 검사는 끄지 않는다.

#### 3.6.3 연결 설정

쓰기 연결(데몬, 하나):

```sql
PRAGMA journal_mode = WAL;          -- 결정 29
PRAGMA synchronous = FULL;          -- 커밋마다 WAL fsync. 정전에도 커밋된 이벤트를 잃지 않는다 (17 요구로 확정, U-02)
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;         -- 읽기 전용 연결의 체크포인트와 겹칠 때
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65536;         -- 64 MiB
PRAGMA mmap_size = 268435456;       -- 256 MiB (WSL 메모리 상한 10 GB 안에서)
PRAGMA wal_autocheckpoint = 1000;   -- 페이지 (기본값)
PRAGMA journal_size_limit = 67108864; -- 64 MiB
PRAGMA trusted_schema = OFF;
PRAGMA application_id = 1212501069; -- 0x48454C4D 'HELM'. 새 파일에서만 설정, 이후 대조
```

읽기 연결(관리 CLI, 백업 검증, 재구성 비교, 관찰 에이전트, 데몬의 읽기 워커): `new Database(path, { readonly: true, fileMustExist: true })` + `PRAGMA query_only = ON`, `busy_timeout = 5000`. WAL이라 쓰기와 동시에 읽을 수 있다 [지식]. 읽기 트랜잭션 하나는 30초를 넘지 않는다(17 F-06). 넘으면 그 워커를 끝내고 체크포인트를 다시 시도한다. 긴 읽기(내보내기, 재전송)는 5,000건 단위로 트랜잭션을 나눈다.

드라이버: `better-sqlite3`(결정 36). 동기 API라 데몬의 쓰기는 한 JS 스레드에서 순서대로 실행된다. helm-kernel-v02는 `node:sqlite`의 `DatabaseSync`로 같은 구조를 실험했다 [실험]. FTS5는 better-sqlite3 기본 빌드에 들어 있다 [지식, 구현 시 `SELECT sqlite_compileoption_used('ENABLE_FTS5')`로 확인].

종료 시: `PRAGMA wal_checkpoint(TRUNCATE)` 후 닫는다(pi-durable Node 어댑터와 같은 방식 [원문 pi-api-facts-1 §7.4]).

### 3.7 DDL

마이그레이션 0001이 만드는 전체 스키마다. 모든 테이블은 `STRICT`다. 시각은 ms 정수, id는 08 형식의 TEXT다.

```sql
-- ── 메타 ──
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
-- 키: store_id(ULID, D09-12), lineage(이전 storeId 목록), restored_pending, integrity_broken_seq, created_at, current_boot_epoch(ULID), head_seq, head_hash, last_recorded_at,
--     integrity_verified_seq, integrity_verified_at, projector_version, hmac_key_id(현재 서명 키),
--     restored_from(복원이면 backupId)

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  checksum    TEXT    NOT NULL,        -- sha256(판 번호 + "\n" + 마이그레이션 SQL 문자열)
  applied_at  INTEGER NOT NULL,
  app_version TEXT    NOT NULL
) STRICT;

CREATE TABLE boots (
  epoch       TEXT    PRIMARY KEY,                    -- ULID (D09-10)
  started_at  INTEGER NOT NULL,
  pid         INTEGER NOT NULL,
  app_version TEXT    NOT NULL,
  host        TEXT    NOT NULL,
  stopped_at  INTEGER,
  clean       INTEGER NOT NULL DEFAULT 0 CHECK (clean IN (0, 1))
) STRICT;

-- ── 정본: 이벤트 ──
CREATE TABLE events (
  seq            INTEGER PRIMARY KEY,               -- 1부터, 빈칸 없음 (쓰기 경로가 head+1로 부여)
  id             TEXT    NOT NULL UNIQUE,
  type           TEXT    NOT NULL,
  type_version   INTEGER NOT NULL,
  category       TEXT    NOT NULL CHECK (category IN ('domain','governance','runtime','kernel','system','measurement')),
  plane          TEXT    CHECK (plane IN ('N','E','M','A','P')),
  actor          TEXT    NOT NULL,
  subject        TEXT,
  project_id     TEXT,
  goal_id        TEXT,
  concern_id     TEXT,
  work_unit_id   TEXT,
  run_id         TEXT,
  command_id     TEXT,
  causation_id   TEXT,
  correlation_id TEXT,
  occurred_at    INTEGER NOT NULL,
  recorded_at    INTEGER NOT NULL,
  boot_epoch     TEXT    NOT NULL REFERENCES boots(epoch),
  envelope       TEXT    NOT NULL,                  -- 정규화 JSON (해시 대상, 바이트 그대로)
  prev_hash      TEXT    NOT NULL CHECK (length(prev_hash) = 64),
  hash           TEXT    NOT NULL CHECK (length(hash) = 64)
) STRICT;
CREATE INDEX events_subject ON events(subject, seq)      WHERE subject IS NOT NULL;
CREATE INDEX events_project ON events(project_id, seq)   WHERE project_id IS NOT NULL;
CREATE INDEX events_goal    ON events(goal_id, seq)      WHERE goal_id IS NOT NULL;   -- 19 readEvents goalId 필터
CREATE INDEX events_concern ON events(concern_id, seq)   WHERE concern_id IS NOT NULL;
CREATE INDEX events_run     ON events(run_id, seq)       WHERE run_id IS NOT NULL;
CREATE INDEX events_type    ON events(type, seq);
CREATE INDEX events_command ON events(command_id)        WHERE command_id IS NOT NULL;
CREATE TRIGGER events_append_only_u BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_append_only_d BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

-- 무효화 태그 (19 §3.6.3). 투영기가 같은 트랜잭션에서 계산한다. 파생값이므로 해시 체인 밖이고 재구성 때 다시 만든다
CREATE TABLE event_invalidations (
  seq  INTEGER PRIMARY KEY REFERENCES events(seq),
  tags TEXT    NOT NULL                              -- JSON 배열: 레코드 id와 집계 이름(@inbox 등)
) STRICT;

-- envelope.refs의 역색인: "이 레코드에 영향을 준 이벤트"
CREATE TABLE event_refs (
  ref TEXT    NOT NULL,
  seq INTEGER NOT NULL REFERENCES events(seq),
  PRIMARY KEY (ref, seq)
) STRICT, WITHOUT ROWID;

-- ── 명령 inbox (멱등, §3.9) ──
CREATE TABLE commands (
  scope_key    TEXT    PRIMARY KEY,                 -- <channel>|<actor>|<viaKey>|<idempotencyKey> (§3.9.1)
  command_id   TEXT    NOT NULL UNIQUE,
  type         TEXT    NOT NULL,
  fingerprint  TEXT    NOT NULL,                    -- sha256(정규화 {type, actor, via, payload}). expect·basisSeq 제외
  status       TEXT    NOT NULL CHECK (status IN ('accepted','rejected','needs_gate','conflict')),
  result       TEXT    NOT NULL,                    -- 처리 결과 JSON (SubmitResult, §3.16.1)
  first_seq    INTEGER,                             -- 이 명령이 만든 이벤트 범위 (거부면 command.rejected 하나)
  last_seq     INTEGER,
  received_at  INTEGER NOT NULL,
  boot_epoch   TEXT    NOT NULL,
  request_blob TEXT                                 -- 명령 원문 blob 해시. 보존 기간 뒤 NULL (§3.15)
) STRICT;
CREATE INDEX commands_received ON commands(received_at);

-- ── blob (§3.12) ──
CREATE TABLE blobs (
  hash        TEXT    PRIMARY KEY CHECK (hash GLOB 'sha256:*' AND length(hash) = 71),
  bytes       INTEGER NOT NULL,                     -- 원래 크기
  media_type  TEXT    NOT NULL,
  encoding    TEXT    NOT NULL CHECK (encoding IN ('identity','gzip')),
  storage     TEXT    NOT NULL CHECK (storage IN ('inline','file','staged','pruned','redacted')),
  blob_id     TEXT    UNIQUE,                       -- bl_<ULID> (08 BlobRef.blobId, 19·20이 쓰는 id)
  data        BLOB,                                 -- storage = inline일 때만
  created_seq INTEGER NOT NULL,                     -- 처음 참조한 이벤트 seq (쓰는 중이면 head+1)
  pruned_at   INTEGER
) STRICT;
CREATE INDEX blobs_storage ON blobs(storage, created_seq);

-- ── 무결성 체크포인트 (§3.10) ──
CREATE TABLE integrity_checkpoints (
  seq        INTEGER PRIMARY KEY REFERENCES events(seq),
  hash       TEXT    NOT NULL,
  hmac       TEXT    NOT NULL,                      -- 키는 필수 (§3.10.3)
  key_id     TEXT    NOT NULL,                      -- 검증 때 HELM_LEDGER_HMAC_KEY_<keyId>를 찾는다
  created_at INTEGER NOT NULL
) STRICT;

-- ── 투영 (재구성 가능, §3.11) ──
CREATE TABLE p_checkpoint (
  projector  TEXT    PRIMARY KEY,                   -- 'core' 하나 (모든 p_* 테이블을 함께 관리)
  version    INTEGER NOT NULL,
  last_seq   INTEGER NOT NULL,
  rebuilt_at INTEGER
) STRICT;

CREATE TABLE p_records (
  id            TEXT    PRIMARY KEY,
  kind          TEXT    NOT NULL,                   -- 08 §3.20.1
  plane         TEXT    NOT NULL,
  project_id    TEXT,
  goal_id       TEXT,
  concern_id    TEXT,
  work_unit_id  TEXT,
  run_id        TEXT,
  status        TEXT,
  quality_level TEXT,
  contested     INTEGER NOT NULL DEFAULT 0,         -- 열린 이의·미해소 반대 근거 수
  stale         INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  superseded_by TEXT,
  autonomous    INTEGER CHECK (autonomous IN (0, 1)), -- Autonomy 있는 레코드만
  decided_by    TEXT,
  title         TEXT,                               -- 화면 한 줄 (레코드 종류별 대표 필드)
  created_seq   INTEGER NOT NULL,
  revision_seq  INTEGER NOT NULL,                   -- 사람에게 의미 있는 변경의 마지막 seq (D09-4, EVENT_META.bumpsRevision)
  last_seq      INTEGER NOT NULL,                   -- 어떤 이벤트든 마지막으로 바꾼 seq
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  data          TEXT    NOT NULL                    -- 08 레코드 전체 JSON
) STRICT;
CREATE INDEX p_records_kind_status ON p_records(kind, status);
CREATE INDEX p_records_concern     ON p_records(concern_id, kind);
CREATE INDEX p_records_project     ON p_records(project_id, kind);
CREATE INDEX p_records_wu          ON p_records(work_unit_id, kind) WHERE work_unit_id IS NOT NULL;
CREATE INDEX p_records_run         ON p_records(run_id, kind)       WHERE run_id IS NOT NULL;
CREATE INDEX p_records_autonomous  ON p_records(created_seq)        WHERE autonomous = 1;
CREATE INDEX p_records_flags       ON p_records(project_id)         WHERE contested > 0 OR stale = 1;

CREATE TABLE p_links (
  src  TEXT    NOT NULL,
  dst  TEXT    NOT NULL,
  rel  TEXT    NOT NULL,                            -- 08 §3.4.8 LinkRel
  seq  INTEGER NOT NULL,
  by   TEXT    NOT NULL,
  note TEXT,
  PRIMARY KEY (src, dst, rel)
) STRICT, WITHOUT ROWID;
CREATE INDEX p_links_dst ON p_links(dst, rel);

CREATE TABLE p_goal_versions (
  goal_id      TEXT    NOT NULL,
  goal_version INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  data         TEXT    NOT NULL,                    -- 08 GoalVersion
  PRIMARY KEY (goal_id, goal_version)
) STRICT;

CREATE TABLE p_agreement_revisions (
  agreement_id TEXT    NOT NULL,
  revision     INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  data         TEXT    NOT NULL,                    -- 08 AgreementRevision
  PRIMARY KEY (agreement_id, revision)
) STRICT;

-- 표시 번호 (12 §3.5.8, 03 IA-07). 인스턴스 전체에서 레코드 종류별 생성 순서. 레코드 생성 이벤트와 같은 트랜잭션에서 max(no)+1로 채운다
CREATE TABLE p_display_no (
  kind      TEXT    NOT NULL,
  record_id TEXT    PRIMARY KEY,
  no        INTEGER NOT NULL,
  UNIQUE (kind, no)
) STRICT;

-- 타이머와 트리거 감시 (스케줄러·커널이 읽음, §3.11.3)
CREATE TABLE p_timers (
  id          TEXT    PRIMARY KEY,                  -- '<kind>:<targetId>'
  kind        TEXT    NOT NULL,                     -- 12·10과 같은 이름 (§3.11.3):
                                                    -- question_delivery | question_escalation | question_expiry |
                                                    -- rights_deadline | approval_expiry | expectation_deadline |
                                                    -- prediction_check | agreement_expiry | authority_expiry |
                                                    -- watch_window | hold_revisit | obligation_revisit |
                                                    -- review_trigger | proposal_reopen | device_expiry | rollback_point_expiry
  target_id   TEXT    NOT NULL,
  due_at      INTEGER,                              -- Trigger.kind = 'at'일 때
  watch_id    TEXT,                                 -- record_state·record_changed 트리거의 감시 대상
  trigger     TEXT    NOT NULL,                     -- 08 Trigger JSON
  created_seq INTEGER NOT NULL
) STRICT;
CREATE INDEX p_timers_due   ON p_timers(due_at)   WHERE due_at IS NOT NULL;
CREATE INDEX p_timers_watch ON p_timers(watch_id) WHERE watch_id IS NOT NULL;

-- 주의 항목 (복귀 요약·홈의 재료, §3.11.4)
CREATE TABLE p_attention (
  id         TEXT    PRIMARY KEY,                   -- '<kind>:<targetId>'
  kind       TEXT    NOT NULL,
  target_id  TEXT    NOT NULL,
  project_id TEXT,
  concern_id TEXT,
  severity   INTEGER NOT NULL,                      -- 1 낮음 ~ 4 권리 게이트
  since_seq  INTEGER NOT NULL,
  data       TEXT
) STRICT;
CREATE INDEX p_attention_project ON p_attention(project_id, severity DESC, since_seq);

-- 예산 사용량 (budget.charged 누적, 12·14)
CREATE TABLE p_budget (
  scope_id      TEXT    PRIMARY KEY,                -- rn_ | wu_ | iq_ | ag_ | act:<..> | day:<YYYY-MM-DD> | observer
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros   INTEGER NOT NULL DEFAULT 0,         -- USD × 1e6
  wall_ms       INTEGER NOT NULL DEFAULT 0,
  requests      INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  subcalls      INTEGER NOT NULL DEFAULT 0,
  last_seq      INTEGER NOT NULL
) STRICT;

-- 커널 상태 스냅숏 (10이 메모리에 두는 KernelState의 캐시. 정본 아님, 지워도 이벤트로 다시 만든다)
CREATE TABLE kernel_snapshots (
  seq            INTEGER PRIMARY KEY,               -- 이 seq까지 반영한 상태
  rules_version  TEXT    NOT NULL,
  state_hash     TEXT    NOT NULL,                  -- 직렬화 상태의 sha256
  data           BLOB    NOT NULL,                  -- gzip JSON
  created_at     INTEGER NOT NULL
) STRICT;

-- ── 지표 투영 (16 §3.22·§3.24, 소유 16). 커밋 뒤 소비자 `metrics`가 채운다. core 재구성 때 함께 비우고 다시 만든다 ──
CREATE TABLE metric_fact (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, sub TEXT NOT NULL, at INTEGER NOT NULL,
  goal_id TEXT, concern_id TEXT, work_unit_id TEXT,
  value REAL NOT NULL, dims TEXT NOT NULL,                        -- JSON
  source_event_seq INTEGER NOT NULL, stream TEXT NOT NULL, extractor_version INTEGER NOT NULL
) STRICT;
CREATE INDEX metric_fact_kind_at ON metric_fact(kind, sub, at);
CREATE INDEX metric_fact_concern ON metric_fact(concern_id, at);
CREATE TABLE metric_snapshot (
  metric_id TEXT NOT NULL, window_kind TEXT NOT NULL, window_end INTEGER NOT NULL,
  value REAL, numerator REAL, denominator REAL, n INTEGER NOT NULL,
  breakdown TEXT, def_version INTEGER NOT NULL, computed_at INTEGER NOT NULL,
  PRIMARY KEY (metric_id, window_kind, window_end)
) STRICT;
CREATE TABLE return_episode (
  id TEXT PRIMARY KEY, return_at INTEGER NOT NULL, away_ms INTEGER NOT NULL,
  first_valid_action_at INTEGER, brief_used INTEGER NOT NULL, brief_corrections INTEGER NOT NULL DEFAULT 0,
  audit_views INTEGER NOT NULL, audit_ms INTEGER NOT NULL, check_id TEXT
) STRICT;
CREATE TABLE observer_proposal (                    -- 서명·패밀리 조회 색인. 본체는 p_records의 policy_proposal
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, changes TEXT NOT NULL, signature TEXT NOT NULL, family TEXT NOT NULL,
  status TEXT NOT NULL, submitted_at INTEGER NOT NULL, decided_at INTEGER, decision TEXT,
  applied_at INTEGER, effect_verdict TEXT, record TEXT NOT NULL
) STRICT;
CREATE INDEX observer_proposal_sig ON observer_proposal(signature);
CREATE INDEX observer_proposal_family ON observer_proposal(family);
CREATE TABLE observer_signal (                      -- 관찰 보고의 최신 값 (correction_signal 등)
  kind TEXT NOT NULL, scope_key TEXT NOT NULL, local_date TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (kind, scope_key)
) STRICT;
-- 메트릭 소비자 재구성: metric_* 다섯 테이블을 비우고 consumer_cursors.metrics = 0에서 다시 읽는다 (16 §3.22.1)

-- 기기 토큰 조회 (18 §3.9). 인증 때 tokenHash로 찾는다. prev는 회전 유예 동안만
CREATE TABLE p_device_tokens (
  token_hash  TEXT    PRIMARY KEY,
  device_id   TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('current','prev')),
  valid_until INTEGER
) STRICT;
CREATE INDEX p_device_tokens_device ON p_device_tokens(device_id);

CREATE TABLE p_dials (
  layer    TEXT    NOT NULL,                        -- user | concern | instruction
  scope_id TEXT    NOT NULL DEFAULT '',             -- user 층은 ''
  key      TEXT    NOT NULL,
  value    TEXT    NOT NULL,
  seq      INTEGER NOT NULL,
  PRIMARY KEY (layer, scope_id, key)
) STRICT;

CREATE VIRTUAL TABLE p_search USING fts5(
  id UNINDEXED, kind UNINDEXED, project_id UNINDEXED, title, body,
  tokenize = 'trigram'                              -- 한국어 부분 일치. SQLite 3.34 이상 [지식]
);

-- ── 운영 상태 (이벤트로 재구성하지 않음) ──
CREATE TABLE consumer_cursors (                     -- 내부 소비자(알림기, 관찰 에이전트, 스케줄러)의 처리 위치
  consumer   TEXT    PRIMARY KEY,                   -- 이벤트 소비자 이름(metrics, orchestrator, directives). trace 소비자는 metrics_trace처럼 쓴다 (16 §3.22.1)
  last_seq   INTEGER NOT NULL,                      -- 이벤트 소비자는 seq, trace 소비자는 trace.id를 적는다 (readTrace의 afterId와 같은 값)
  updated_at INTEGER NOT NULL
) STRICT;
-- 외부 세션 로그 읽기 위치는 정본 DB에 두지 않는다. 관찰 프로세스는 정본에 쓸 수 없으므로 16의 observer.db에 둔다 (판정 J-77)
CREATE TABLE device_presence (                      -- 마지막 인증 시각 같은 잦은 값. 판정에는 presence.changed 투영을 쓴다
  device_id      TEXT    PRIMARY KEY,
  last_seen_at   INTEGER NOT NULL,
  last_auth_at   INTEGER NOT NULL,                  -- 마지막 인증 시각. 페어링 때 현재 시각으로 시작한다. 유휴 만료의 기준 (18 §3.6.1, [판정 J-159])
  last_transport TEXT
) STRICT;
-- 푸시 송신에 필요한 원문 ([판정 J-71], 26 §3.4.6). 도메인 이벤트와 Device 레코드에는 해시와 앞 8자만 둔다.
-- 이벤트로 재구성하지 않으며, 기기 폐기·등록 해제 때 지운다. 백업에 포함된다(파일 0600)
CREATE TABLE push_tokens (
  device_id    TEXT    PRIMARY KEY,                 -- dv_…
  provider     TEXT    NOT NULL,                    -- webpush | apns (1차는 webpush, apns는 26 경로 B 예약)
  token        TEXT    NOT NULL,                    -- webpush: 구독 JSON {"endpoint":…,"keys":{"p256dh":…,"auth":…}} 문자열,
                                                    -- apns: 기기 토큰. 이벤트·재전송·투영·관찰 입력·진단 묶음·로그에 넣지 않는다
  token_hash   TEXT    NOT NULL,                    -- PushRegistration.tokenHash와 같은 값
  vapid_key_id TEXT,                                -- 구독에 쓴 VAPID 공개 키 sha256 앞 12자. 키 교체 때 정리에 쓴다
  updated_at   INTEGER NOT NULL,
  last_ok_at   INTEGER,
  fail_count   INTEGER NOT NULL DEFAULT 0,          -- 26 failing 판정, 17 점검
  last_error   TEXT                                 -- HTTP 상태와 짧은 사유만. 엔드포인트 URL은 넣지 않는다
) STRICT;

-- 런타임 내부 타이머 (12 RuntimeTimer, tm_). 도메인 상태가 아니다. 재시작 때 12가 다시 건다
CREATE TABLE runtime_timers (
  id         TEXT    PRIMARY KEY,                    -- tm_<ULID>
  purpose    TEXT    NOT NULL,                       -- 목록 정본은 12 §3.10.6: mediator_timeout | daily_digest | mediator_cycle |
                                                     -- observer_cycle | metrics_snapshot | boundary_clock | budget_window_reset |
                                                     -- run_recovery_resume | run_wall_watchdog | model_probe | maintenance_<작업>
                                                     -- 26: push_followup | push_dnd_digest | push_hour_bundle
                                                     -- 추가: result_review_digest (결과 확인 묶음 알림, [판정 J-189], [결정 56]),
                                                     --       device_idle_check (하루 한 번 유휴 만료 점검, [판정 J-161])
  due_at     INTEGER NOT NULL,
  ref        TEXT,
  owner_epoch TEXT   NOT NULL,
  data       TEXT
) STRICT;
CREATE INDEX runtime_timers_due ON runtime_timers(due_at);

-- ── 실행 기록 trace (D09-11). 해시 체인 밖, State 밖, epoch 펜싱 대상 ──
CREATE TABLE trace (
  id          INTEGER PRIMARY KEY,                   -- 단조 증가 (seq와 별개)
  after_seq   INTEGER NOT NULL,                      -- 같은 트랜잭션에서 쓴 마지막 이벤트 seq (없으면 head)
  kind        TEXT    NOT NULL,                      -- 아래 TraceKind 표
  run_id      TEXT,
  thread_id   TEXT,
  concern_id  TEXT,
  ref         TEXT,
  at          INTEGER NOT NULL,
  boot_epoch  TEXT    NOT NULL,
  data        TEXT    NOT NULL,                      -- JSON. 큰 본문은 blob 해시
  expires_at  INTEGER                                -- 보존 기한 (§3.15.3)
) STRICT;
CREATE INDEX trace_run  ON trace(run_id, id)  WHERE run_id IS NOT NULL;
CREATE INDEX trace_kind ON trace(kind, id);
-- TraceKind (D09-11). 12: model.requested, model.attempted, model.responded, model.request_abandoned, model.switched,
--   context.injected, context.compacted, run.stage, input.queued, input.delivered, input.dropped, settle.unresolved,
--   recovery.decided, repl.workspace_written, steering.deferred.
-- 14: work.requested, work.admitted, work.deferred, attention.state_changed, attention.budget_spent,
--   orchestration.guard_tripped, promotion.signaled.  15: inquiry.step_started, inquiry.step_completed, inquiry.step_failed.
--   13: process.spawned, process.exited, tool.net_request(프록시가 연결을 허락·거부한 판정. 이름은 18 제안을 따른다, [결정 55]).
--   기타: memo (런타임·오케스트레이터의 짧은 진단 메모).
-- 탐구 단계 이름은 inquiry.step_started·step_completed·step_failed 셋으로 정한다(15의 inquiry.step{state}는 이 셋으로 쓴다).
-- 목록에 없는 kind는 쓰지 않는다(쓰기 경로가 검사, TraceKind 열거). 새 kind는 이 목록에 더한다
CREATE TABLE volatile_scratch (                     -- 진행 중 도구 출력 꼬리 (§3.5)
  tool_call_id TEXT    PRIMARY KEY,
  run_id       TEXT    NOT NULL,
  data         BLOB    NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;
```

뷰(투영 테이블 위의 읽기 전용 조회, 재구성 대상 아님):

```sql
-- 질문함: 사람에게 갈 질문 (v0.3 09 §4.3)
CREATE VIEW v_question_inbox AS
SELECT id, project_id, concern_id, json_extract(data, '$.gate') AS gate,
       json_extract(data, '$.delivery.mode') AS delivery, json_extract(data, '$.blocks') AS blocks,
       status, created_seq, revision_seq, data
FROM p_records WHERE kind = 'question' AND status IN ('pending', 'delivered');

-- 에이전트가 정한 것 (08 A08-4)
CREATE VIEW v_autonomous_feed AS
SELECT id, kind, project_id, concern_id, decided_by, contested, stale, created_seq, title, data
FROM p_records WHERE autonomous = 1;

-- 열린 반영 항목 (미룬 것 포함, 복귀 요약 맨 위)
CREATE VIEW v_open_obligations AS
SELECT id, project_id, concern_id, status, created_seq, data
FROM p_records WHERE kind = 'obligation' AND status IN ('open', 'deferred');
```

근거 체인(v0.3 09 §4.7)은 재귀 질의로 얻는다:

```sql
WITH RECURSIVE chain(id, depth) AS (
  SELECT :rootId, 0
  UNION
  SELECT l.src, c.depth + 1 FROM p_links l JOIN chain c ON l.dst = c.id
  WHERE l.rel IN ('supports','challenges','qualifies','invalidates','justifies','derived_from') AND c.depth < 6
)
SELECT r.* , c.depth FROM chain c JOIN p_records r ON r.id = c.id ORDER BY c.depth;
```

Concern 표시 상태(08 `ConcernDisplayStatus`)는 `@helm/store/src/views/concern-display.ts`의 함수로 계산한다. 하위 레코드 여러 종류를 보아야 해서 SQL 뷰 하나로 두면 읽기 어렵다. 규칙: 저장 상태가 merged·closed·completed·held면 그대로, `lastReopen`이 마지막 루프 활동보다 뒤면 reopened, submitted 결과가 있으면 awaiting_review, accepted 결과에 open 반영 항목이 있으면 reviewed, 진행 가능한 WorkUnit이 없고 열린 막힘 질문·기대·타이머가 있으면 waiting, 그 밖은 active·open.

### 3.8 쓰기 경로

#### 3.8.1 단일 쓰기 보장 (D09-7)

| 겹 | 방법 | 막는 것 |
|---|---|---|
| 1 | systemd 사용자 단위 하나(`helmd.service`, 17). 데몬은 쓰기 연결을 하나만 연다 | 같은 기계에서 데몬을 두 번 띄움 |
| 2 | 시작 시 `data/helmd.lock`(잠금 전용 SQLite 파일)에 `BEGIN EXCLUSIVE`를 프로세스 수명 동안 잡는다(17 §3.1.4). 못 잡으면 종료 코드 3 | systemd 밖에서 수동 실행, 오프라인 CLI와의 충돌 |
| 3 | 부팅 epoch fencing: 모든 쓰기 트랜잭션은 `BEGIN IMMEDIATE` 직후 `meta.current_boot_epoch`가 자기 epoch와 같은지 확인. 다르면 롤백하고 프로세스를 끝낸다(`path.fenced`) | 1·2가 실패해 두 프로세스가 같은 DB를 쓰는 경우. 늦게 깨어난 옛 프로세스 |

관리 CLI는 읽기 전용 연결만 연다. 쓰기가 필요한 관리 작업(기기 페어링, 복원 전 확인 등)은 `rpc.sock`으로 데몬에 명령을 보낸다. 데몬이 꺼져 있을 때만 하는 작업(복원, 오프라인 마이그레이션)은 2번 잠금을 CLI가 잡고 실행한다. 관찰 에이전트의 읽기 전용 연결은 잠금을 잡지 않는다(17 규칙 5).

#### 3.8.2 부팅 순서 (저장소 쪽)

17 §3.4의 데몬 시작 순서 안에서 저장소가 하는 단계다. 무결성 검사를 마이그레이션보다 먼저 한다(17). 손상된 DB를 새 스키마로 옮기면 손상 위치를 찾기 어려워진다.

```text
openStore(dataDir):
  1. 위치 검사 (§3.6.2)
  2. 인스턴스 잠금 (§3.8.1 겹 2)
  3. HMAC 키 확인: SecretStore에서 HELM_LEDGER_HMAC_KEY(현재 keyId)를 받지 못하면 시작하지 않는다 (§3.10.3)
  4. DB 열기, application_id 확인 (0이면 새 파일 → 초기화하고 store_id 생성, HELM이 아니면 거부)
  5. user_version 확인: 앱보다 높으면 다운그레이드로 보고 거부 (§3.13.1)
  6. 무결성 검사 tail 모드 (§3.10.4). 시작점은 min(마지막 full 통과 이후, meta.integrity_broken_seq). 실패하면 17의 `read_only` 모드로 시작(§3.10.5, [판정 J-67])
  7. 마이그레이션 (§3.13): 필요하면 pre-migrate 백업 후 적용
  8. 이벤트 버전 확인: events에 이 앱이 모르는 type 또는 type_version이 있으면 시작하지 않는다
     (더 새 앱이 쓴 DB를 옛 앱이 열었음. store.unknown_event_type)
  9. 투영 버전 확인. p_checkpoint.version ≠ PROJECTOR_VERSION 또는 last_seq ≠ head_seq면 재구성 (§3.11.2).
     재구성이 실패하면 17의 `read_only`(사유 recovery_failed)로 시작한다
 10. BEGIN IMMEDIATE
       epoch = ULID(); UPDATE meta current_boot_epoch; INSERT boots
       이전 boot의 clean 값 확인
       append daemon.booted (+ 마이그레이션이 있었으면 store.migrated)
       meta.restored_pending이 있으면(복원 뒤 첫 부팅) daemon.safe_mode_entered{reason: restored} (§3.14.2)
     COMMIT
 11. 런타임 복구 (12 §3.7.3). 투영 재구성 뒤에 한다. 안전 모드(restored)에서는 정리만 하고 재개는 하지 않는다
     - runsToInterrupt    = kind='run' AND status IN ('queued','running','stopping') AND ownerEpoch ≠ epoch
                            (awaiting_human·awaiting_recovery는 그대로 둔다. 답이 오면 새 run이 이어받는다. [판정 J-38·J-39])
     - toolCallsStarted   = kind='toolcall' AND status IN ('started','replaying')     -- run과 무관한 전역 조회가 정본.
                            승인된 호출을 새 run이 실행하다 죽은 경우도 여기 걸린다. 실행한 run은 execution 투영의 executedByRunId
     - toolCallsRequested = kind='toolcall' AND status='requested'
                            유효한 승인(approval.status = issued, 만료 전)이 있으면 그대로 두고, 없으면 not_executed(restart)
     12가 internal:recovery 출처로 run.interrupted, toolcall.interrupted/outcome_uncertain/not_executed, 해시가 맞으면
     toolcall.completed(recovered hash_verified)를 낸다. 같은 배치의 REPLAY 대상도 `report_unknown`으로
     함께 닫는다. 외부 효과가 있으면 `toolcall.outcome_uncertain`, 없으면 `toolcall.interrupted`다([판정 J-122]). 결과 불명 외부 호출이 있는 run은 run.awaiting(recovery)로 옮기고 run.ended는 내지 않는다.
     replay_started는 실행 재개 때 커널 재검사를 통과한 뒤에 낸다([판정 J-41]).
     멱등 키는 12 형식 하나: recover:<runId>:<attempt>(run 단위), recover:<tcId>:<epoch>(호출 단위).
     run 하나의 복구가 예외를 내면 그 run만 run.ended(failed, code recovery_error)와 복구 항목으로 남기고 다음 run으로 간다.
     복구 단계 전체가 결정적으로 실패하면 17의 `read_only`(사유 recovery_failed)로 바꾸고 리스너는 연다(사람이 앱으로 본다)
 12. 타이머 따라잡기: 12 §3.10.4 규칙을 따른다. 커널 상태만 바꾸는 타이머는 기한 순으로 한꺼번에 처리하고(occurredAt = due_at),
     에이전트 실행을 시작하는 타이머만 간격을 둔다. 데몬 정지 중 지난 가정 만료는 [판정 J-142]대로 미룬다
 13. 쓰기 받기 시작
```

#### 3.8.3 늦은 쓰기 차단

- 실행(`rn`)은 시작·재개 때의 epoch를 `ownerEpoch`로 가진다(08 §3.18.1). 실행이 내는 모든 명령은 `runId`를 함께 보낸다. 커널은 `run.ownerEpoch ≠ 현재 epoch`이거나 실행이 `running`·`stopping`이 아니면 `path.stale_epoch`로 거부한다(08 R-43).
- 예외: 부팅 복구(`internal:recovery`)는 이전 epoch의 실행을 정리하는 쓰기이므로 이 검사를 받지 않는다. 대신 출처가 `internal:recovery`이고 멱등 키가 `recover:` 형식이어야 한다(§3.9.3). 호출 단위 키의 epoch는 이번 부팅의 epoch와 같아야 한다. 이 예외로 이전 epoch 실행에 내는 것은 `run.awaiting`(recovery)과 `question.recorded`(결과 불명 질문)를 포함한다([판정 J-122]).
- 도구 하위 프로세스가 데몬보다 오래 살아 결과를 늦게 보내는 경우, 이전 epoch의 실행 id를 가지고 있으므로 거부된다. 그 도구 호출은 부팅 복구에서 이미 정리되어 있다.
- trace 쓰기도 같은 펜싱을 받는다(D09-11).
- 외부 런타임 어댑터(이후 단계, 결정 34)도 같은 규칙을 쓴다. 어댑터 연결마다 실행을 만들고 epoch를 받는다.

#### 3.8.4 쓰기 트랜잭션 단계

쓰기는 모두 `transaction(fn)` 안에서 일어난다(§3.16.2, [판정 J-148]). 명령 하나면 `commit`, 미리 정해진 명령 여러 개면 `commitBatch`를 쓰며 둘 다 `transaction` 위의 편의 함수다. 앞 제출의 결과를 보고 뒤 제출을 정해야 하면(13 제안 도구 경로) `fn` 안에서 `tx.commitOne`을 차례로 부른다. 명령마다 `commands` 행이 따로 생기고 결과도 따로다. 커널이 이벤트 초안을 만들고, 저장소가 seq·해시·투영을 붙인다.

```text
transaction(fn):                                      // §3.16. commit·commitBatch는 이 위의 편의 함수
  아래 1~2단계를 연 뒤 fn(tx)을 부르고, tx.commitOne(input)마다 3단계를 한다. fn이 끝나면 4~8단계

commitBatch(inputs, traces):
  0. (트랜잭션 밖) 명령 envelope 스키마 검사, scopeKey·fingerprint 계산, 큰 텍스트·인자는 putBlob (§3.12)
     - 명령 envelope 자체가 깨졌으면 저장 없이 프로토콜 오류 (멱등 키를 믿을 수 없음)
  1. BEGIN IMMEDIATE
  2. fence: meta.current_boot_epoch == myEpoch 아니면 ROLLBACK, throw Fenced
  3. for input in inputs:
     a. 멱등: SELECT commands WHERE scope_key
          있으면: fingerprint 같음 → 저장된 result에 replayed: true를 붙여 결과 목록에 넣고 다음 input
                 fingerprint 다름 → key_reused 결과 { status: "key_reused", original } (이벤트·commands 행 없음, 06 §3.4.2)
     b. decision = input.decide(view, ctx)             // 10의 순수 함수. view는 이 트랜잭션의 읽기
          버전 검사(input.expect, basisSeq)도 decide 안에서 한다 (10 V-VER-01, §3.9.4)
          decision.status = error면 ROLLBACK 전체, 결과 error (저장하지 않음, D09-3)
     c. drafts = decision.events
          status가 rejected·conflict·needs_gate면 drafts에 command.rejected 초안이 들어 있다 (커널이 만든다)
     d. for draft in drafts:
          seq = head + 1; id = ids.next('ev'); recordedAt = max(clock.now(), meta.last_recorded_at)
          envelope = {...draft, v:1, seq, id, recordedAt, bootEpoch: myEpoch, typeVersion: 현재, redactions: []}
          EventPayloads[type]로 payload 검사 (실패 = 커널 버그 → throw)
          canonical = canonicalJson(envelope); 크기 ≤ 256 KiB 확인
          hash = sha256(prevHash + "\n" + canonical)
          INSERT events; INSERT event_refs (subject + refs)
          projectors.apply(db, envelope)               // §3.11. 오류면 throw → 전체 롤백 (D09-5)
          prevHash = hash; head = seq
     e. INSERT commands(scope_key, command_id, type, fingerprint, status, result(+eventSeqs), first_seq, last_seq, ...)
  4. INSERT trace 행들 (after_seq = head)
  5. UPDATE meta head_seq, head_hash, last_recorded_at
  6. head가 1000의 배수를 지났으면 integrity_checkpoints 행 추가 (§3.10.3)
  7. COMMIT
  8. (트랜잭션 밖, 같은 턴에서 동기로) onCommitted(StoredEvent[]) 호출: 프로토콜 서버, 스케줄러, 알림기
```

- 내부 쓰기(런타임의 도구 결과, 스케줄러의 기한 처리, 부팅 복구)도 같은 경로를 쓴다. 멱등 키는 결정적으로 만든다(§3.9.3).
- 커밋 후 알림(8단계)은 커밋한 그 JS 턴 안에서 동기로 부른다(19·20). 다른 쓰기가 끼어들지 않으므로 구독자는 seq 순서대로 받는다. 구독자 예외는 잡아서 운영 로그에 남기고 쓰기 결과에 영향을 주지 않는다. 놓친 구독자는 `readEvents(afterSeq)`로 따라잡는다. 그래서 outbox 테이블이 없다(D09-5). 내부 소비자는 `consumer_cursors`에 처리한 seq를 남기고 재시작 때 거기서부터 읽는다(at-least-once, 소비자는 seq로 중복을 거른다).
- 트랜잭션 하나의 이벤트 수에 상한을 두지 않는다. 다만 낡음 전파(08 §3.21.3)처럼 많아질 수 있는 경우를 성능 시험에 넣는다(§6).
- 고장 주입 지점(테스트용, helm-kernel-v02의 `faultInjector` [원문]): `after_fence`, `after_decide`, `after_event_insert:<n>`, `after_projection:<n>`, `before_command_insert`, `before_trace_insert`, `before_commit`. 어느 지점에서 예외를 던져도 커밋 전이면 events·commands·p_*·trace 변화가 남지 않아야 한다.

### 3.9 멱등 처리와 동시성

#### 3.9.1 명령 envelope (저장소가 보는 부분)

명령의 전체 형식과 이름은 10이 정한다. 저장소는 다음 필드만 쓴다.

```ts
// @helm/store/src/command-key.ts
export interface CommandKeyFields {
  commandId: string;         // cm_<ULID>
  type: string;              // 명령 이름 (10)
  channel: "H" | "M" | "X" | "R" | "S" | "A";   // 10 §3.3 채널
  actor: ActorRef;
  via: Via;
  idempotencyKey: string;    // 1~128자. 클라이언트가 정함. 보통 commandId와 같은 ULID
  payload: unknown;
  expect?: { id: string; version: number }[];  // version = 08 revisionSeq (D09-4)
  basisSeq?: number;         // 사람 명령: 화면이 본 seq (19)
}
/**
 * via에서 만든 출처 키. 연결·경로·시도마다 바뀌는 값(connectionId, listener, toolCallId, attempt, pid)은 넣지 않는다.
 *   device → "device:<dv>",  local_cli → "local_cli:<uid>",  run → "run:<rn>",
 *   process → "process:<name>",  system → "system"
 */
export declare function viaKey(v: Via): string;
/** ActorRef는 08 문법의 문자열이므로 그대로 쓴다. 객체로 만든 행위자는 08 문법 문자열로 바꾼 뒤 넘긴다 */
export const scopeKey = (c: CommandKeyFields) => `${c.channel}|${c.actor}|${viaKey(c.via)}|${c.idempotencyKey}`;
/**
 * 지문 입력은 {type, actor, viaKey(via), payload에서 제출자 생성 id를 뺀 것}이다.
 * 제출자 생성 id: 명령이 새로 만드는 레코드의 id 필드(예: loopTransitionId, findingId). 명령마다 그 필드 이름은 10의 명령 메타
 * `generatedIdFields`가 정한다. R·S·X 채널 제출자는 이 id를 멱등 키에서 결정적으로 만든다(derivedIdFactory(key), 10 §3.3)
 */
export const fingerprint = (c: CommandKeyFields, generatedIdFields: readonly string[]) =>
  sha256Hex(canonicalJson({ type: c.type, actor: c.actor, via: viaKey(c.via), payload: omitTopLevel(c.payload, generatedIdFields) }));
```

`commandId`, `expect`, `basisSeq`, 연결 id·리스너·실행 시도 번호, 제출자 생성 id는 지문에 넣지 않는다. 재접속 뒤 다른 연결·다른 경로(tailnet ↔ loopback)로 같은 키·같은 params를 다시 보내거나, 화면을 새로 고쳐 basisSeq가 바뀌거나, 재개한 run이 같은 제출을 다시 보내도 같은 명령이다(19 §3.9.2, 01 NFR-D-4). 오케스트레이터의 재처리 결정성(같은 계기 이벤트면 같은 payload)을 위해 decide의 `ctx.now`는 계기 이벤트의 `recordedAt`으로 고정한다(10 §3.3). 22 적합성 시험: 다른 연결·다른 경로·다른 attempt에서 같은 키 재전송이 `replayed: true`를 받는다.

#### 3.9.2 결과 저장 규칙 (D09-3)

| 처리 결과 | `commands`에 저장 | 이벤트 | 같은 키로 재시도하면 |
|---|---|---|---|
| accepted | 예 | 커널이 만든 이벤트들 | 저장된 결과 + `replayed: true` |
| needs_gate (사람 확인이 필요해 질문을 만듦) | 예 | `command.rejected`(status needs_gate, `gateQuestionId`) + `question.recorded` 등 | 같음 |
| rejected (내용·자격·경로) | 예 | `command.rejected` 하나 | 같음 (다시 거부를 계산하지 않는다) |
| conflict (버전 불일치, 상태 충돌, 이미 해결됨, 대체됨) | 예 | `command.rejected`(status conflict) 하나 | 같음. 새 버전으로 다시 하려면 새 키 |
| key_reused (같은 키·다른 지문) | 아니오 | 없음 | `{ status: "key_reused", original }`. 클라이언트 버그로 보고 운영 로그에 남긴다 |
| error (커널 내부 오류) | 아니오 | 없음 (롤백) | 다시 처리 (고친 뒤 같은 키로 통과할 수 있게) |
| 일시 실패 (fenced, SQLITE_BUSY 시간 초과, 디스크 가득 참, 종료 중, 투영기 예외) | 아니오 | 없음 (롤백) | 처음부터 다시 처리 |
| 명령 envelope 파손 | 아니오 | 없음 | 프로토콜 오류 |

규칙의 이유: 같은 키에 같은 결과가 나와야 재시도가 안전하다. 거부를 저장하지 않으면 그 사이 상태가 바뀌어 같은 키의 재시도가 통과할 수 있고, 클라이언트는 어느 시도가 반영됐는지 알 수 없다. 사람은 "다시 시도"를 누를 때 새 키를 쓴다(19·20). 10 1판은 conflict를 이벤트 없이 결과만 저장한다고 적었으나 거부된 시도도 기록에 남아야 하므로(A14) 이벤트를 남긴다(§5.2).

#### 3.9.3 내부 쓰기의 멱등 키

| 쓰는 쪽 | 채널·출처 | idempotencyKey | 효과 |
|---|---|---|---|
| 도구 결과 기록 | R·`run:<rn>` | `tc:<tcId>:result` | 도구 호출당 결과 관찰 하나 (08 R-06) |
| 도구 시작 기록 | R·`run:<rn>` | `tc:<tcId>:start` | 실행 의도 한 번 |
| 모델 메시지 기록 | R·`run:<rn>` | `ms:<messageId>` (12와 같은 접두사) | 메시지 중복 없음 |
| 대기 run 이어받기 | S·`internal:dispatcher` | `handoff:<awaitingRunId>` | 같은 대기 run에서 handoff run이 둘 생기지 않음. 대기 run이 awaiting_*가 아니면 지시를 무시한다 |
| 오케스트레이터 전환 | R·`run:<rn>` 또는 S·`internal:orchestrator` | `${triggerEventId}:${ruleId}` (게이트 뒤 재제출은 `:after:<qsId>`) | 한 계기 한 번 (14 G1) |
| 스케줄러 기한 처리 | S·`internal:scheduler` | `timer:<timerId>:<dueAt>` | 재시작 뒤 같은 기한을 두 번 처리하지 않음. 도메인 타이머(`p_timers`)와 런타임 타이머(`runtime_timers`, `result_review_digest`·`device_idle_check` 포함)가 같은 형식을 쓴다 |
| 부팅 복구 | S·`internal:recovery` | `recover:<runId>:<attempt>`(run 단위), `recover:<tcId>:<epoch>`(호출 단위) | run은 attempt마다, 호출은 부팅 epoch마다 한 번 (§3.8.2) |
| 외부 관찰 | A·`run:<rn>` 또는 `internal:<adapter>` | `ext:<channel>:<actor>:<externalId>` | 같은 외부 응답 한 번. 내용이 다르면 커널이 `conflict.external_observation_changed` |
| 낡음 감지(watcher) | S·`internal:watcher` | `mat:<path>:<newHash>` | 같은 변경 한 번 |

#### 3.9.4 낙관적 동시성 (D09-4)

- 레코드마다 `revisionSeq` = 사람에게 의미 있는 변경(카탈로그 `bumpsRevision = true`)을 마지막으로 만든 이벤트의 seq(`p_records.revision_seq`). 어떤 이벤트든 마지막으로 바꾼 seq는 `last_seq`에 따로 둔다. 근거 링크 추가, 주석, 낡음 표시는 revisionSeq를 올리지 않는다. 그래서 사람이 질문에 답하는 사이 에이전트가 근거를 붙여도 답이 충돌로 막히지 않는다.
- 사람 명령은 화면이 본 시점 `basisSeq`를 싣는다(19). 커널은 대상 레코드의 `revisionSeq > basisSeq`면 충돌로 본다. 레코드를 직접 지정해야 하면 `expect: [{id, version}]`(version = revisionSeq)을 쓴다. 두 방식 모두 비교는 커널의 decide 안에서 한다(10 V-VER-01). 그래야 `conflict.version_mismatch`, `conflict.already_resolved`, `conflict.superseded`를 구분해 돌려줄 수 있다. 커널은 현재 레코드를 `result.rebase`에 넣는다(L14 "Gate는 cursor에 묶어야", helm-kernel-v02 `runtime.stale_gate` [실험]).
- 에이전트의 제안 명령은 기본적으로 `expect`를 넣지 않는다. 커널의 상태 검사(08 상태 기계)가 대부분의 경합을 막는다. 같은 레코드를 두 실행이 동시에 바꾸려 할 때는 실행이 마지막으로 읽은 버전을 넣는다(12).
- 전역 커서 `expectedCursor`(helm-kernel-v02)는 쓰지 않는다. 다만 `commit` 결과에 `headSeq`를 돌려주어 클라이언트가 자기 화면이 어디까지 반영됐는지 알 수 있게 한다.

### 3.10 해시 체인과 무결성 검사

#### 3.10.1 무엇을 보장하는가

| 보장 | 방법 |
|---|---|
| 우발 손상(디스크·파일 복사 오류)을 찾는다 | 체인 재계산 |
| 커널을 거치지 않은 편집(SQL 직접 수정, 행 삭제·삽입)을 찾는다 | 체인 + 트리거(UPDATE·DELETE 금지) + seq 연속성 |
| 체인 전체를 다시 계산한 위조를 찾는다 | HMAC 체크포인트 (키를 가진 데몬만 만들 수 있음) |
| 기록 내용이 참임 | 보장하지 않는다 (불변조건 1, F10 C3). 체인은 "이 기록이 이 순서로 쓰였다"만 보장한다 |

체인 무결성과 의미 품질은 별개 검사다(helm-canon-2 L17).

#### 3.10.2 체인

§3.2.2의 식. 첫 이벤트의 `prevHash`는 0 64개. 해시 대상 문자열은 DB `envelope` 열의 바이트 그대로이며, 검사 때 `canonicalJson(JSON.parse(envelope)) === envelope`인지도 확인한다(정규화가 깨진 저장을 찾음).

#### 3.10.3 HMAC 체크포인트 (D09-6)

```text
key     = HELM_LEDGER_HMAC_KEY (32바이트 이상 무작위, base64. SOPS 제품 비밀, 17의 SecretStore로 데몬에만 전달)
key_id  = sha256(key)의 앞 8 hex (meta.hmac_key_id에 현재 키 기록)
hmac(n) = HMAC-SHA256(key, "helm-checkpoint:" + n + ":" + hash(n))  (hex)
```

- 체크포인트를 쓰는 때: head가 1,000의 배수를 지날 때(같은 트랜잭션, 체크포인트 seq = 그 트랜잭션의 마지막 seq), 정상 종료 직전, 백업 시작 직전. 같은 head에 체크포인트가 이미 있으면 새로 쓰지 않는다(`seq`가 기본 키). `key_id` = sha256(키 바이트)의 앞 8 hex.
- 키는 필수다(18). 키가 없으면 데몬이 시작하지 않는다(§3.8.2 3단계). 체인만으로는 체인 전체를 다시 계산한 위조를 찾지 못하기 때문이다.
- 도구 실행 환경에는 이 키를 넘기지 않는다. 도구 하위 프로세스의 환경 변수에서 `HELM_*` 비밀을 지우는 규칙은 13·18이 정한다.
- 키 교체(18 §3.10.5): 체크포인트마다 `key_id`를 적고, 검증은 체크포인트의 `key_id`에 맞는 키(`HELM_LEDGER_HMAC_KEY_<keyId>`, 이전 키들)로 한다. 교체 때 새 키로 head 체크포인트를 쓰고 `ledger.hmac_key_rotated`를 남긴다. 이전 키가 없어진 구간의 체크포인트는 "검증할 키 없음"으로 보고하고 실패로 보지 않는다(체인 검사는 계속 한다).

#### 3.10.4 검사 알고리즘

```text
verify(db, mode):                          // mode: 'tail' | 'full'
  head = meta.head_seq
  from = mode == 'full' ? 1 : max(1, min(head - 10_000 + 1, meta.integrity_verified_seq + 1))
  prev = from == 1 ? "0"*64 : SELECT hash FROM events WHERE seq = from - 1
  expect = from
  for row in SELECT * FROM events WHERE seq BETWEEN from AND head ORDER BY seq:
    if row.seq != expect:                         fail("gap", expect)
    if row.prev_hash != prev:                     fail("chain_broken", row.seq)
    if sha256(prev + "\n" + row.envelope) != row.hash: fail("hash_mismatch", row.seq)
    env = JSON.parse(row.envelope)
    if canonicalJson(env) != row.envelope:        fail("not_canonical", row.seq)
    if env.seq != row.seq or env.id != row.id or env.type != row.type
       or 비정규화 열(actor, subject, scope 열, command_id, causation_id, boot_epoch, recorded_at) 불일치:
                                                  fail("column_mismatch", row.seq)
    prev = row.hash; expect += 1
  if expect - 1 != head or prev != meta.head_hash: fail("head_mismatch")
  for cp in integrity_checkpoints WHERE seq BETWEEN from AND head:
    if cp.hash != hash(cp.seq):                   fail("checkpoint_hash", cp.seq)
    k = keys[cp.key_id]                           // 현재 키와 이전 키들
    if k is undefined:                            report("checkpoint_key_unavailable", cp.seq)
    elif cp.hmac != HMAC(k, ...):                 fail("checkpoint_hmac", cp.seq)
  mode == 'full' 이면 meta.integrity_verified_seq = head, integrity_verified_at = now
  return { ok: true, from, to: head, hmacChecked }
```

| 때 | 모드 | 실패하면 |
|---|---|---|
| 부팅 | tail (마지막 1만 건 또는 마지막 전체 검사 이후) | 17 `read_only` 모드 |
| 매주 (17의 타이머, `just` 레시피) | full | 실패 지점을 `meta.integrity_broken_seq`에 남기고(다음 부팅 tail 검사가 거기서부터 본다) 백업 회전을 멈춘다. 사람에게 "읽기 전용으로 바꾸기 / 계속 쓰기"를 묻는다(17 integrity_suspect). 계속 쓰는 근거: 손상은 과거 구간이고 새 이벤트의 체인은 head에서 이어지므로 새 기록은 검사할 수 있다. 판단은 사람이 한다 |
| 백업 직후 백업 사본 | full | 그 백업을 실패로 표시 |
| 관리 명령 `helm ops verify [--full]` | 선택 | 보고서 |

검사가 끝나면 `integrity.verified` 이벤트를 남긴다(정상일 때만. 실패는 쓰기가 막힐 수 있으므로 운영 로그와 복구 기록 `integrity.recovered`로 남긴다).

#### 3.10.5 읽기 전용 복구 (17 `read_only` 모드)

- 무결성 검사 실패, 마이그레이션 체크섬 불일치에서 들어간다. 이것은 17의 `read_only` 모드다(판정 J-67). 쓰기가 막힌 상태이므로 이벤트를 남기지 않고 운영 로그와 상태 조회(17)로 알린다. 디스크 부족도 같은 `read_only` 모드다. 17의 안전 모드(`daemon.safe_mode_*`)는 크래시 루프 전용이며 이 절과 무관하다.
- 데몬은 투영 테이블로 읽기 요청에 답하고 모든 쓰기를 `path.store_read_only`로 거부한다. 진행 중이던 실행은 시작하지 않는다.
- 손상된 꼬리를 자동으로 무시하거나 잘라 내지 않는다(helm-canon-2 §1.21). 복구는 사람이 관리 명령으로 한다: 백업에서 복원(§3.14.2), 또는 손상 지점 이후 이벤트를 JSONL로 내보내 확인한 뒤 복원. 조치는 `integrity.recovered`로 남긴다.

### 3.11 투영

#### 3.11.1 투영기

```ts
// @helm/store/src/projectors/types.ts
export interface Projector {
  name: "core";
  version: number;                                   // PROJECTOR_VERSION. 투영 규칙이 바뀌면 올림
  apply(db: WriteTx, ev: StoredEvent): void;         // 순수: 시계·난수·네트워크 없음. 결과는 ev와 기존 행에만 의존
}
```

`core` 투영기 하나가 모든 `p_*` 테이블을 갱신한다. 이벤트 타입별 처리 함수를 표로 둔다(`projectors/core/<event-type>.ts`). 처리 순서:

1. `upcast(ev)`: payload를 현재 `typeVersion`으로 올린다(§3.13.3).
2. 레코드 생성 이벤트: 08의 `*Core`로 레코드를 만들고 메타(`createdSeq`, `revisionSeq = lastSeq = seq` 등), 초기 상태, 초기 품질(08 §3.21.2)을 채워 `p_records`에 INSERT. 링크 생성 규칙(08 §3.20.3)대로 `p_links`. 표시 번호는 `p_display_no`에 종류별 `max(no)+1`로 넣는다(12 §3.5.8).
3. 전이 이벤트: 대상 레코드를 읽어 08 상태 기계 데이터(`machines/*.ts`)로 다음 상태를 정하고, `last_seq = seq`, 카탈로그 `bumpsRevision`이면 `revision_seq = seq`, `updated_at = recordedAt`. 표에 없는 전이를 만나면 투영기 예외(커널이 이미 막았어야 하므로 버그). 반응 관찰(`observation.recorded`의 reaction)과 `inquiry.round_ended`는 subject 밖의 질문(`qs`)을 닫는 파생 이벤트를 커널이 같은 트랜잭션에 낸다. `triad` 질문은 `question.answered`로, 반응 없이 닫힌 `stimulus_round` 질문은 `question.withdrawn`(round_closed)으로 닫힌다. 투영기는 그 파생 이벤트를 따로 적용한다(08 §3.22.7).
4. 파생 테이블: `p_goal_versions`, `p_agreement_revisions`, `p_timers`(트리거를 가진 레코드가 생기거나 바뀔 때 다시 계산), `p_attention`(§3.11.4), `p_dials`, `p_budget`, `p_search`(title·statement·summary 텍스트).
5. 무효화 태그: 이벤트 하나를 반영할 때 바뀔 수 있는 레코드 id와 집계 이름을 모아 `event_invalidations`에 쓴다. 계산 위치는 이 투영기(커밋 트랜잭션 안) 하나이고, 집계 이름은 12의 순수 함수 `aggregateTags(event, touchedRecords)`가 정한다(집계 태그 표는 12 한 곳, 19 §3.6.3은 참조). 19는 보낼 때 이 테이블을 읽어 `invalidates`를 싣는다. 19의 정확성 규칙(뷰가 바뀌면 태그가 겹친다)을 투영기 테스트에 넣는다.
6. 16의 지표 투영 테이블(`metric_fact`, `metric_snapshot`, `return_episode`, `observer_proposal`, `observer_signal`, DDL은 16 §3.24.1)은 같은 DB에 두되 이 투영기가 아니라 커밋 뒤 소비자(`consumer_cursors`의 `metrics`)가 채운다. 쓰기 트랜잭션을 늦추지 않기 위해서다. 재구성(§3.11.2) 때 함께 다시 만든다. 외부 세션 로그에서 만든 관찰 캐시는 16의 `observer.db`에 둔다.
7. 오케스트레이터(14)는 `consumer_cursors`의 `orchestrator` 행으로 처리 위치를 남긴다. ConcernView는 저장하지 않고 투영에서 다시 만든다.

`p_records.title`은 종류별 대표 필드다: Goal `content.statement`, Concern `title`, WorkUnit `title`, Observation `summary`, 추측·판단 `statement`, Choice `decision`, Question `text`, Agreement `content.purpose`, 그 밖은 08 레코드의 첫 텍스트 필드. 200자로 자른다.

#### 3.11.2 재구성 알고리즘

```text
rebuild():                                   // 부팅 9단계, 또는 관리 명령. 쓰기를 받기 전에만
  1. BEGIN IMMEDIATE (쓰기 잠금; 데몬이 아직 쓰기를 받지 않는 시점)
  2. 각 p_* 테이블에 대해 CREATE TABLE p_x__new (같은 DDL)
  3. for batch in SELECT * FROM events ORDER BY seq LIMIT 5000 OFFSET k:
        for ev in batch: projector.apply(newTablesTx, upcast(parse(ev.envelope)))
     (full 무결성 검사를 함께 하도록 옵션. 기본은 부팅 tail 검사로 충분)
  4. DROP TABLE p_x; ALTER TABLE p_x__new RENAME TO p_x; 인덱스 재생성
  5. p_checkpoint = { version: PROJECTOR_VERSION, last_seq: head, rebuilt_at: now }
  6. COMMIT
```

- 재구성 중에는 쓰기를 받지 않는다. 예상 시간은 §3.15.
- 결정성 검사: 시험 환경에서 새 DB에 같은 이벤트를 재구성한 결과와 운영 DB의 `p_*` 행을 정렬해 해시로 비교한다(`helm ops verify --projections`). 다르면 투영기 버그다(F07 §5 "projection 간 데이터 불일치는 projection bug").
- 투영 테이블 하나만 망가졌을 때도 전체를 다시 만든다. 부분 재구성은 두지 않는다(단순함 우선).

#### 3.11.3 타이머와 트리거

- `p_timers`는 기한·트리거를 가진 레코드에서 계산한 파생 테이블이다(08 §3.4.4 `Trigger`). 타이머를 따로 이벤트로 기록하지 않는다. 기한이 레코드 필드에 있으므로 재구성할 수 있다.
- 스케줄러(12)는 `due_at ≤ now`인 행을 처리해 명령을 낸다(멱등 키 §3.9.3). 커널은 커밋마다 바뀐 레코드 id로 `watch_id` 색인을 조회해 `record_state`·`record_changed`·`before_loop`·`before_primitive` 트리거를 평가한다.
- 데몬이 꺼져 있던 동안 지난 기한은 부팅 12단계에서 한꺼번에 처리한다. 이때 이벤트의 `occurredAt`은 원래 기한이다.

kind 이름은 12·10과 같다. 10 1판 이름의 대응: agreement_valid_until → `agreement_expiry`, grant_expires → `authority_expiry`, expectation_due → `expectation_deadline`, assumption_expiry → `question_expiry`. 10의 `mediator_timeout`, `daily_digest`는 레코드 필드가 아니라 런타임 일정이므로 `runtime_timers`(12)에 둔다. `result_review_digest`([판정 J-189])와 `device_idle_check`([판정 J-161])도 같다.

| kind | 원천 레코드 필드 | 처리 명령의 결과 이벤트 |
|---|---|---|
| `question_delivery` | Question.plannedDelivery | 전달기가 `question.delivered` |
| `question_escalation` | Question.assumptionExpires − 다이얼 `question.expiry_margin` | `question.escalated` |
| `question_expiry` | Question.assumptionExpires (비막힘 정보 질문) | `question.assumed` |
| `rights_deadline` | Question.deadline (권리 질문, 사람이 마감을 정한 경우만, J-49) | `question.expired` |
| `approval_expiry` | Question.approval.expiresAt | `approval.expired` |
| `expectation_deadline` | Expectation.dueAt | `expectation.timed_out` + `observation.recorded`(no_response) |
| `prediction_check` | Prediction.check.trigger | 확인 요청(루프 전환 제안, 14) |
| `agreement_expiry` | Agreement.content.scope.validUntil | `agreement.expired` |
| `authority_expiry` | Grant.expiresAt | `grant.expired` |
| `watch_window` | Watch.window | `watch.window_closed` |
| `hold_revisit` | StructureChange(hold).revisit | `concern.reopened` |
| `obligation_revisit` | Obligation.deferral.revisitTrigger | `obligation.reopened` |
| `review_trigger` | Choice·Finding·PreferenceModel 기준·Assumption의 reviewTrigger. 질문에서 생긴 전제(origin question)는 계산에서 뺀다(그 만료는 `question_expiry`가 다룬다) | `record.staled(review_trigger_fired)`. 사람이 정한 선택이면 10이 재결정 질문을 같은 트랜잭션에 만든다([판정 J-138]) |
| `proposal_reopen` | PolicyProposal.decision.deferUntil | `policy_proposal.reopened` |
| `rollback_point_expiry` | RollbackPoint.forAssumptions가 모두 확정·폐기된 시각, 또는 `agreementId` 합의 종결 시각 + 이의 가능 기간(기본 7일, 08 §3.18.3) | `rollback_point.expired` |
| `device_expiry` | Device.expiresAt (절대 만료만). 유휴 만료는 `runtime_timers`의 `device_idle_check`가 하루 한 번 점검한다([판정 J-161]) | `device.expired`(cause absolute) |

#### 3.11.4 주의 항목 (`p_attention`)

복귀 요약과 홈 화면의 재료다. 투영기가 이벤트마다 갱신한다. 복귀 요약의 구성과 문구는 12·04가 정한다.

| kind | 생기는 때 | 없어지는 때 | severity |
|---|---|---|---|
| `question.rights` | 권리 게이트 질문 pending·delivered | answered·withdrawn·expired | 4 |
| `question.info` | 정보 게이트 질문 pending·delivered | 위와 같음 | 2 (막힘이면 3) |
| `assumption.in_use` | 비막힘 질문의 전제 active | 질문 끝 | 1 |
| `result.awaiting_review` | 결과 submitted | 결과 확인 | 3 |
| `obligation.open`, `obligation.deferred` | 반영 항목 open·deferred | resolved·transferred·waived | 2 / 1 (미룬 것은 복귀 요약 맨 위, 08 §3.12 규칙 5) |
| `objection.open` | 이의 open | 해소 | 3 |
| `record.stale_baseline` | 기준선 레코드(accepted Choice·Finding·active Agreement·Goal)가 stale | revalidated·superseded | 2 |
| `record.unqualified_baseline` | Choice가 qualified 미만 (C6 `ㅇ` 사례) | 품질 상승 또는 대체 | 2 |
| `workunit.scope_exceeded`, `workunit.paused` | 해당 상태 | 벗어남 | 3 / 2 |
| `expectation.timed_out` | 기한 초과 | fulfilled·cancelled | 2 |
| `prediction.due` | 확인 트리거 충족, 아직 checked 아님 | checked·voided | 1 |
| `toolcall.outcome_uncertain` | 결과 불확실 도구 호출 (run awaiting_recovery) | recovered | 3 |
| `blind_spot.no_goal` / `blind_spot.no_active_choice` | 프로젝트에 active Goal 없음 / Concern에 활성 선택 없이 change WorkUnit 진행 | 해당 레코드 생김 | 2 |
| `integrity.checkpoint_key_unavailable` | 검증할 이전 HMAC 키가 없는 구간 | 키를 다시 넣거나 사람이 확인 | 1 |
| `budget.exhausted` | 예산 소진 판정 | 예산 늘리기 답 또는 실행 종료 | 3 |

"blind spot 없음"은 이 표의 항목이 없을 때만 표시한다. 필드가 채워졌는지는 기준으로 쓰지 않는다(helm-canon-2 §1.10).

#### 3.11.5 조회 API (프로토콜·런타임이 쓰는 것)

```ts
// @helm/store/src/query.ts
export interface EventQuery {
  afterSeq: number;                  // 이 seq 초과부터
  limit: number;                     // 최대 5000
  types?: EventType[];
  categories?: EventCategoryName[];
  typePrefixes?: string[];           // 예: ["question.", "run."] (19)
  projectId?: ProjectId;
  goalId?: GoalId;
  concernId?: ConcernId;
  runId?: RunId;
  ref?: string;                      // event_refs로 특정 레코드 관련 이벤트만
  beforeSeq?: number;                // 역방향 페이지 (19 history). afterSeq와 함께 쓰지 않는다
  untilSeq?: number;                 // 이 seq까지만 (19 재전송의 상한)
  scanLimit?: number;                // 필터와 무관하게 이번 호출에서 훑을 최대 행 수 (기본 50,000)
  excludeTypePrefixes?: string[];    // 예: ["run.message_recorded"] 같은 큰 이벤트 제외
  concernIds?: ConcernId[];          // 여러 Concern
  includeDescendants?: boolean;      // concernIds의 하위 Concern까지 (p_records의 parentConcernId로)
  goalIds?: GoalId[];
  redact?: boolean;                  // 기본 true: sensitiveFields를 지운 사본 (§3.2 규칙 10)
}
/** scannedUntilSeq: 이번 호출이 실제로 훑은 마지막 seq. 필터에 맞는 이벤트가 없어도 다음 호출은 여기서 이어간다 */
export interface EventPage { events: DeliveredEvent[]; headSeq: number; nextAfterSeq: number; scannedUntilSeq: number; }
readEvents(q: EventQuery): EventPage;
```

- 재전송(결정 31): 클라이언트가 `lastSeq`를 보내면 `readEvents({ afterSeq: lastSeq, ... })`를 페이지로 돌려준다. 필터를 쓰면 seq에 빈칸이 생기므로 응답에 `headSeq`와 `nextAfterSeq`를 함께 둔다. 클라이언트는 `nextAfterSeq`를 다음 `lastSeq`로 쓴다. 프로토콜의 메시지 형식과 필터 이름은 19가 정한다.
- 이벤트를 프로토콜로 보낼 때 시각은 ISO 문자열로 바꾼다(19). seq·id·type·payload는 그대로 보낸다. 해시 필드는 보내지 않아도 된다(19 결정).
- 레코드 조회: `getRecord(id)`, `queryRecords({ kind, projectId, concernId, status, flags, limit, afterRevision })`, `links(id, { rel, direction })`, `search(text, { projectId, kinds })`, `attention({ projectId })`, `eventsSince(seq, filter)`(복귀 요약용, 12).
- 모든 조회는 읽기 트랜잭션 하나 안에서 실행해 같은 시점을 본다. 응답에 그 시점의 `headSeq`를 붙인다(F07 §5 "각 projection은 생성에 사용한 Event cursor를 가진다").

### 3.12 blob 저장

| 항목 | 규칙 |
|---|---|
| 주소 | `sha256:<원래 바이트의 hex>`. 압축 여부와 무관하게 원래 내용의 해시 |
| 인라인 | 압축 뒤 256 KiB 이하면 `blobs.data`에 |
| 파일 | 넘으면 `blobs/sha256/ab/cd/<hex>` 파일. `blobs/.tmp/`에 쓰고 fsync 후 rename, 그 다음 DB 행 커밋. 커밋된 행은 항상 존재하는 파일을 가리킨다 |
| 압축 | 텍스트 계열(`text/*`, `application/json`)이고 4 KiB를 넘으면 gzip, `encoding = 'gzip'` |
| 같은 내용 | 이미 행이 있으면 다시 쓰지 않는다 (내용 주소) |
| 읽기 | 압축을 풀고 해시를 다시 계산해 다르면 오류 (`blob.corrupt`, 주의 항목) |
| 고아 파일 | 행 커밋 전에 실패해 남은 파일과 어떤 이벤트도 가리키지 않는 행은 GC가 지운다: 파일은 행이 없고 1시간 넘은 것, 행은 참조 없이 35일 지난 것(17. 최근 백업이 그 blob을 아직 가리킬 수 있으므로 백업 보존 기간보다 길게) |
| 업로드 (staged) | 19의 업로드는 `blobs/staged/<uploadId>`에 쓰고 `storage = 'staged'` 행을 만든다. 명령이 그 blob을 참조하면 내용 주소 경로로 옮기고 `file`·`inline`으로 바꾼다. 24시간 안에 참조되지 않으면 지운다 |
| id | 행마다 `blob_id`(`bl_<ULID>`)를 준다. 이벤트 안에서는 해시로 가리키고, 프로토콜·앱은 id나 해시 어느 쪽으로도 받는다(08 §3.4.7) |
| 가지치기 (pruned) | 보존 정책(§3.15)에 따라 내용만 지우고 행(해시·크기·종류)은 남긴다. 이벤트의 `BlobRef`는 그대로 유효하며 내용 요청에는 "보존 기간이 지나 삭제됨"을 돌려준다 |
| 가림 (redacted) | 비밀이 들어간 blob을 사람이 지운다. 내용 삭제 + `blob.redacted` 이벤트. 이벤트의 `preview` 문자열은 체인 때문에 바꿀 수 없으므로 preview에는 비밀 가림 처리를 거친 텍스트만 넣는다(12·13) |
| 비밀 대응 ([판정 J-147]) | 1차 대응은 입력 단계 마스킹이다. 마스킹 지점은 도구 결과·모델 응답뿐 아니라 사람 명령 payload(질문 답, 지시 문장)를 포함한다(18 §3.10.3). `disclose_data` 권리 승인으로 읽은 내용은 preview를 비운다. 체인 안 인라인 필드에 들어간 비밀은 지울 수 없으므로 가림 절차(17 `helm ops redact-blob`: 내용 삭제, `secure_delete`·VACUUM, 체크포인트, 백업 스냅숏 재생성, restic rewrite 요청, 19 무효화 이벤트)로 남은 사본을 줄인다. 민감 필드를 체인 밖에 두는 안은 24 ADR 후보다 |
| 남는 위험 | 가린 blob의 sha256은 이벤트와 HTTP ETag에 남는다. 짧은 비밀(PIN, 짧은 토큰)은 대입으로 맞출 수 있다. 1차는 이 위험을 받아들이고 18 위험 목록에 적는다 |
| 전송 | 큰 blob은 프로토콜의 HTTP 경로로 해시를 지정해 받는다(결정 31, 19) |

해시 체인은 envelope 안의 `BlobRef.hash`만 덮는다. blob 내용의 무결성은 내용 주소가 보장한다.

### 3.13 마이그레이션

#### 3.13.1 DB 스키마 (user_version)

```ts
// @helm/store/src/migrations/index.ts
export interface Migration {
  version: number;           // 1, 2, 3, ... 빈칸 없음
  name: string;              // "0001_init"
  up(db: Database.Database): void;    // 트랜잭션 안에서 실행됨. down은 두지 않는다 (import Database from "better-sqlite3")
  sql: string;               // 체크섬 대상: 판 번호 + 이 SQL 문자열. 빌드마다 바뀌는 함수 소스는 쓰지 않는다
}
export declare const MIGRATIONS: readonly Migration[];
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;
```

```text
migrate(db, { backupDir }):
  uv = PRAGMA user_version
  if uv > LATEST: 거부 "DB 스키마 v{uv}가 이 Helm(최대 v{LATEST})보다 새롭다. Helm을 올리거나 백업을 복원하라" (다운그레이드 거부)
  for m in applied(schema_migrations): if checksum(m) != 저장된 checksum: 거부 (적용된 마이그레이션이 바뀜) → 17 `read_only` 모드
  if uv == LATEST: return
  backup(kind = "pre-migrate")                                      // §3.14.1과 같은 방법
  for m in MIGRATIONS where m.version > uv (오름차순):
    BEGIN IMMEDIATE
      m.up(db)
      INSERT schema_migrations(version, name, checksum, applied_at, app_version)
      PRAGMA user_version = m.version          // 같은 트랜잭션에 포함된다 [지식]
    COMMIT
  부팅 10단계에서 store.migrated 이벤트를 남긴다
```

- 버전은 선형이다. 가지치기·병합 없는 정수 하나.
- 다운그레이드는 지원하지 않는다. 이전 버전 Helm으로 돌아가려면 마이그레이션 전 백업을 복원한다.
- 종료 코드: 다운그레이드 거부와 체크섬 불일치는 데몬이 고칠 수 없는 환경 문제로 보고 정해진 종료 코드로 끝난다. 코드 값은 17이 정한다.
- 마이그레이션은 무결성 검사(부팅 6단계)를 통과한 뒤에만 한다(17).
- `events` 테이블의 열을 바꾸는 마이그레이션은 행을 다시 쓰지 않는다(트리거가 막는다). 새 열은 `ALTER TABLE ADD COLUMN`으로 더하고 기본값을 둔다. 해시 대상은 `envelope` 열뿐이므로 체인은 영향받지 않는다. helm-kernel-v02의 마이그레이션 2(해시 열 추가 후 채우기)는 초기 설계가 해시를 갖고 시작하므로 필요 없다.

#### 3.13.2 투영 스키마

투영 테이블의 모양이나 규칙이 바뀌면 `PROJECTOR_VERSION`을 올린다. DB 마이그레이션이 필요 없고, 부팅 때 재구성한다(§3.11.2). 투영 스키마와 이벤트 스키마는 따로 버전을 가진다(helm-canon-2 §1.18).

#### 3.13.3 이벤트 payload 버전 (업캐스터)

```ts
// @helm/domain/src/events/upcast.ts
/** type별로 v(n) → v(n+1) 변환 함수 배열. 순수 함수 */
export declare const UPCASTERS: Partial<Record<EventType, ((payload: unknown) => unknown)[]>>;
export declare function upcast(ev: StoredEvent): StoredEvent; // typeVersion을 현재까지 올린 사본. 저장된 행은 바꾸지 않는다
```

규칙(helm-canon-2 §1.18 schema evolution 여섯 규칙을 따른다):

1. envelope 버전(`v`)과 payload 버전(`typeVersion`)을 따로 둔다.
2. 저장된 이벤트를 제자리에서 고쳐 쓰지 않는다.
3. 형식 변환은 업캐스터, 데이터 정정은 새 이벤트(`record.revalidated`, 수정 이벤트)로 한다. 둘을 섞지 않는다.
4. 투영 스키마는 이벤트 스키마와 독립 버전을 가진다.
5. 외부 어댑터는 지원하는 계약 범위를 handshake로 알린다(19·13).
6. 알 수 없는 이벤트 타입이나 이 앱보다 높은 `typeVersion`이 있으면 데몬이 시작하지 않는다(부팅 8단계, 17). 건너뛰고 투영하면 상태가 틀린 채로 쓰기를 받게 된다. 다운그레이드를 거부하므로 정상 운영에서는 생기지 않는다. 관리 명령의 읽기·내보내기는 이 검사 없이 할 수 있다.

#### 3.13.4 이전 JSONL 가져오기 (선택 기능, MVP 밖) [제안]

이전 Helm 저장소의 `.helm/events.jsonl`(experimental.v0)을 가져오는 경우 helm-kernel-v02 `migration.mjs`의 규칙을 따른다 [원문]:

- 원본 경로·줄 번호·전체 해시를 provenance로 보존한다.
- experimental 이벤트를 안정 의미로 자동 추정하지 않는다. `normative.decision.committed`만 `choice.committed`(행위자 `migration`, `autonomy`는 사람 결정으로 표시하되 품질 `captured`)로 가져오고 나머지는 보고서의 `ignored`에 둔다.
- `projection.next_action.proposed`는 가져오지 않는다.
- 낮은 품질 결정(`ㅇ`, `ㅁㄴㅇ`)도 지우지 않고 `captured`로 가져온다. 주의 항목에 보인다.
- 가져오기 보고서(손실·모호 목록)는 blob으로 두고 `import.completed`로 남긴다.

### 3.14 백업·복구·내보내기

#### 3.14.1 백업 [일정·보존 개수·restic 연결은 17 D17-10]

```text
backup(kind):                                   // kind: daily | pre-migrate | pre-upgrade | manual | pre-restore
                                                // 데몬 안에서 실행 (17의 helm-backup.timer가 관리 명령으로 요청)
  1. head 체크포인트 (HMAC, 현재 keyId) 커밋
  2. dest = backups/<kind>/.tmp/<backupId>/helm.sqlite   // backupId = <UTC YYYYMMDDTHHMMSSZ>-seq<N>
  3. await db.backup(dest)                      // better-sqlite3 온라인 백업 API: 쓰기를 멈추지 않고 일관된 사본 [지식, 17 A17-4]
  4. 사본을 읽기 전용으로 열어:
       PRAGMA integrity_check == 'ok'
       verify(full)  (§3.10.4)
       upToSeq = 사본의 head_seq, headHash = 사본의 head_hash
  5. manifest.json 작성:
       { backupId, kind, createdAt, storeId, upToSeq, headHash, hmacHead: { seq, keyId, hmac }, userVersion,
         projectorVersion, releaseId, dbSha256, dbBytes, blobCount,
         verify: { integrityCheck: "ok", chain: "full" | "tail", projectionDigest, verifiedAt },   // 17
         producer: { component: "helmd" | "helm-cli", releaseId, host, pid } }                     // 17
  6. .tmp/<backupId>를 backups/<kind>/<backupId>로 rename (원자적)
  7. backup.created 이벤트 (manifest 요약). 실패하면 backup.failed
  8. 회전 (17이 정한 개수). 지운 것은 backup.pruned
```

- blob은 백업에 복사하지 않는다. `data/blobs/`는 내용 주소이고 쓰기 후 바뀌지 않으므로 restic이 직접 가져간다(17). 그래서 백업이 가리키는 blob이 GC로 지워지지 않도록 참조 없는 blob 행의 GC 유예를 백업 보존보다 긴 35일로 둔다(§3.12).
- `VACUUM INTO`도 일관된 사본을 만들지만 쓰기를 더 오래 막는다 [지식]. 기본은 온라인 백업 API다.
- 실행 중인 WAL DB 파일을 직접 복사하면 일관성이 없으므로 restic 대상은 `backups/`이고 `data/helm.sqlite*`는 넣지 않는다(17 D17-10) [지식].

#### 3.14.2 복원

```text
restore(backupId, carry):                       // 데몬이 꺼져 있어야 함 (CLI가 helmd.lock을 잡음)
  1. 백업 검증: manifest의 dbSha256, PRAGMA integrity_check, verify(full), headHash, hmacHead 일치
  2. 현재 상태를 pre-restore 백업으로 남길 수 있으면 남긴다 (읽을 수 없으면 건너뜀)
  3. 위험 이벤트 넘겨받기(restore-carry): 현재 DB를 읽을 수 있으면 백업 upToSeq 뒤의 다음 이벤트를
     state/restore-carry.json(0600)에 적는다: device.revoked, device.expired, device.push_unregistered, pairing.code_cancelled, grant.revoked, agreement.released,
     agreement.narrowed, dial.set(값을 낮춘 것), blob.redacted, ledger.hmac_key_rotated
  4. 현재 data/helm.sqlite와 그 -wal, -shm을 data/quarantine/<UTC 시각>/로 옮김 (지우지 않음)
  5. 백업 DB를 data/helm.sqlite로 복사. 없는 blob은 restic에서 되살리도록 목록을 보고서에 적는다
  6. 새 storeId 생성, meta.store_id·restored_from 갱신, meta.restored_pending = backupId
     (같은 계보 표시: restored_from의 이전 storeId를 meta.lineage에 덧붙인다)
  7. 데몬 시작 → 부팅 10단계: 새 epoch(ULID), daemon.booted, daemon.safe_mode_entered{restored},
     store.restored{carried}. 그 직후, 리스너를 열기 전에:
       a. restore-carry의 각 이벤트를 internal:recovery 출처 명령으로 다시 적용한다(레코드가 이미 그 상태면 건너뜀)
       b. 미소진 send 승인(approval.status = issued)을 모두 approval.expired{restored}로 닫는다.
          그 호출은 다시 묻는다(백업 뒤 실제로 나갔을 수 있으므로)
       c. 처리가 끝나면 restore-carry.json을 지우고 meta.restored_pending을 비운다
  8. 안전 모드(restored)에서는 run 자동 재개, 에이전트 실행을 시작하는 타이머, 관찰 에이전트, 14의 새 실행을 멈춘다.
     사람이 상태를 확인하고 `helm ops safe-mode off`(17, 10 `runtime.exit_safe_mode`)로 안전 모드를 끝낸다. 해제는 `daemon.safe_mode_exited`를 남긴다([판정 J-153], [판정 J-165])
```

- 복원 표지 이벤트는 `store.restored`다([판정 J-152]). 17의 복원 CLI는 데몬이 꺼진 채 일하므로 `meta.restored_pending`만 남기고, 데몬이 복원 뒤 첫 부팅에서 이 이벤트를 쓴다. 그 부팅은 안전 모드(reason restored)로 시작한다(12). 04는 `store.restored`를 읽어 "복원 지점 이후 기록 없음"(백업 시각·upToSeq)을 보인다. 백업 이후의 이벤트는 사라지며, 위험 이벤트만 3단계로 다시 적용한다(22 FI '복원 → 재개 없음'의 기대값).
- storeId를 바꾸는 이유: 복원으로 같은 seq가 다른 이벤트를 가리키게 된다. 클라이언트는 storeId가 바뀐 것을 보고 캐시를 버리고 처음부터 다시 받는다(19).
- 무결성 기준점 비교(18 `verify --anchors`)는 같은 storeId와 `meta.lineage`의 매니페스트로 한정한다. 이전 계보의 매니페스트는 archived로 표시한다.
- epoch는 ULID라 복원 전에 쓰인 epoch와 겹치지 않는다(D09-10). 그래서 복원 전 epoch로 시작한 외부 연결의 늦은 쓰기가 통과하지 않는다.
- 남는 사본: `blob.redacted`로 지운 내용과 폐기한 기기 정보는 이전 백업·restic 스냅숏(최장 6개월)에 남는다. 지우는 절차는 18 §3.16과 17 `helm ops redact-blob`이 정한다.
- 복원은 `integrity.recovered`(손상 복구일 때)와 함께 기록한다.

#### 3.14.3 내보내기

- `helm export --jsonl [--from seq] [--to seq]`: `state/exports/`에 한 줄에 한 이벤트. 정규화 envelope + `prevHash` + `hash`. 내보낸 파일만으로 체인을 다시 검사할 수 있다(F07 §3 SHOULD "사람이 읽을 수 있는 export"). blob 내용은 포함하지 않고 `--with-blobs`면 옆 디렉터리에 해시 이름으로 복사한다.
- 내보내기 형식으로 다른 Helm DB에 가져오는 import는 두지 않는다. 복원은 백업으로 한다.
- 내보내기는 읽기 연결로 하므로 데몬이 실행 중이어도 된다.

### 3.15 성능 예상치와 보존 정책

#### 3.15.1 부하 예상 [가정]

활발한 하루(실행 30회, 실행당 도구 호출 40회, 메시지 왕복 20회) 기준:

| 이벤트 | 하루 건수 | envelope 평균 | blob |
|---|---|---|---|
| 도구 호출 (requested, started, completed) + 결과 관찰 | 1,200 × 4 = 4,800 | 0.7 KiB | 출력 평균 6 KiB → 7 MiB |
| 메시지 기록 + 사람 발화 관찰 | 1,300 | 0.8 KiB | 평균 4 KiB → 5 MiB |
| 컨텍스트 투영 메타 | 600 | 1.5 KiB | 평균 20 KiB → 12 MiB |
| 도메인 이벤트 (제안, 질문, 합의, 결과 등) | 500 | 1.5 KiB | 적음 |
| 합계 | 약 7,200 | 약 6 MiB (색인 포함 약 15 MiB) | 약 24 MiB (압축 전) |

1년(활동일 250일): 이벤트 약 180만 건, DB 약 4 GiB, blob 압축 뒤 약 2~3 GiB. 서버 디스크 용량은 17이 확인한다.

#### 3.15.2 목표 수치 [가정: WSL2 ext4, Ryzen 5 PRO 6650H, synchronous = FULL. 22의 성능 시험으로 확인]

| 항목 | 목표 |
|---|---|
| 명령 하나 커밋 (이벤트 1~5개, 투영 포함) | p50 ≤ 3 ms, p99 ≤ 25 ms |
| 지속 처리량 (런타임 이벤트 몰림) | ≥ 500 이벤트/s |
| 재전송 조회 1만 건 | ≤ 200 ms |
| 부팅 tail 검사 (1만 건) | ≤ 1 s |
| full 검사 180만 건 | ≤ 90 s |
| 재구성 180만 건 | ≤ 120 s (약 1.5만 이벤트/s) |
| 낡음 전파 1,000개 레코드 한 트랜잭션 | ≤ 300 ms |

목표를 못 맞추면 먼저 볼 것: 투영기의 JSON 파싱(레코드 `data` 전체 재직렬화), `p_search` 갱신 빈도, `synchronous`(U-02).

#### 3.15.3 보존 정책 [제안]

| 대상 | 보존 | 근거 |
|---|---|---|
| 이벤트 | 영구. 지우지 않는다 | 체인, 기록과 이력 보존(F01 §6 "삭제는 의미적 폐기") |
| 명령 inbox 행 | 365일 (멱등 창). 지난 행은 `scope_key`, `fingerprint`, `status`, `first_seq`·`last_seq`만 남기고 `result`를 줄인다. 줄인 행에 같은 키가 오면 `{ status, replayed: true, resultPruned: true }`를 돌려준다(19는 이 보관 규칙을 따른다) | 재시도는 보통 분·시간 단위 |
| 명령 원문 blob (`request_blob`) | 30일 | 거부 감사는 `command.rejected`의 `request`가 남는다 |
| 컨텍스트 투영 blob (`run.context_projected.projection`) | 90일 뒤 가지치기 | A11 사후 확인은 최근 작업에 필요. 메타(sourceSeq, includedRefs, omitted)는 영구 |
| trace 행 | 180일 (모델 요청 본문 blob은 90일) | 실행 기록은 최근 문제 분석에만 쓴다. State에 들어가지 않는다 (D09-11) |
| `runtime_timers` | 처리하면 삭제 | 운영 상태 |
| `kernel_snapshots` | 최근 3개 | 캐시 |
| 업로드 staged blob | 24시간 | 19 |
| 참조 없는 blob 행 | 35일 | 백업 보존보다 길게 (§3.12) |
| 도구 출력 blob 중 64 KiB 초과 | 180일 뒤 가지치기. 단 판단·결과 확인·이의의 근거 체인에 들어간 관찰의 blob은 제외 | 근거는 남아야 한다 |
| 메시지 본문 blob | 영구 (압축) | 대화 기록은 원천 근거 |
| 자극 blob | 영구 | 선호 모델 근거 |
| `volatile_scratch` | 도구 호출이 끝나면 즉시, 부팅 복구 뒤 전부 | 임시 |
| `device_presence`, `consumer_cursors` | 갱신만 | 운영 상태 |
| 백업 | 17 §3.7이 정한 개수 | 17 |
| quarantine | 사람이 지울 때까지 | 복구 선택의 자료 |

- 가지치기는 데몬 안 정기 작업(하루 한 번, 17의 시각)이 한다. 근거 체인 제외 판정: 가지치기 후보 blob을 참조하는 관찰 id가 `p_links`에서 `supports`·`challenges`·`invalidates`의 `src`이거나 Acceptance·Attestation의 관찰 목록에 있으면 남긴다.
- DB가 20 GiB를 넘으면 주의 항목으로 알린다 [제안].
- presence·boundary 이벤트는 양이 많을 수 있다(11). 같은 상태가 이어지면 `presence.changed`를 남기지 않고, `boundary.reached`는 질문 전달 판정에 쓰이는 경계만 남긴다. 그래도 지우지 않는다. 압축 내보내기(§3.14.3)로 오래된 구간을 따로 보관할 수 있다.

### 3.16 `@helm/store` 공개 인터페이스

#### 3.16.1 커널과 저장소 경계 타입 (`@helm/domain`에 한 벌만 둔다)

06·09·10이 같은 타입을 가리키도록 경계 타입은 `@helm/domain/src/kernel-contract.ts`(06 §3.4.1)에 한 벌만 둔다. 커널 결정의 입력은 10의 `KernelState`(불변 맵)이고, 저장소는 메서드형 읽기 객체를 커널에 주지 않는다(06 §3.4.1). 저장소가 아는 것은 아래 셋이다.

```ts
// @helm/domain/src/kernel-contract.ts  (I/O 없음, 10 §3.1이 KernelState·Decision을 함께 정의)
export interface EventDraft {
  type: EventType;
  actor: ActorRef;                   // 08 문법 문자열
  via: Via;
  authority: string[];               // "<kind>:<ref>" (§3.2)
  subject: string | null;
  refs: string[];
  scope: EventScope;
  commandId: string | null;
  causationId: string | null;
  correlationId: string | null;
  provenance: { rulesVersion: string | null; contextRef: string | null; adapterId: string | null } | null;
  occurredAt?: number;               // 없으면 recordedAt
  payload: unknown;                  // EventPayloads[type]로 검사
  // category·plane·typeVersion은 EVENT_META에서 저장소가 채운다. scope 열(project_id 등)은 scope에서 채운다
}

/** 커널 판정(10 Decision)에서 저장소가 쓰는 부분 */
export interface Decision {
  status: "accepted" | "rejected" | "needs_gate" | "conflict" | "error";   // error는 저장하지 않고 롤백 (§3.9.2)
  events: EventDraft[];
  result: Record<string, unknown>;
}
/** 저장되고 재생되는 결과 (06 §3.4.2 SubmitResult). key_reused는 저장하지 않는다 */
export type SubmitResult =
  | { status: Decision["status"]; result: Record<string, unknown>; eventSeqs: number[]; headSeq: number; replayed: boolean }
  | { status: "key_reused"; headSeq: number; original: string /* 처음 저장된 commandId */ };

/** 10 KernelContext. 엔진이 만든다. 모든 값이 이벤트 로그와 주입된 시계·id에서 오므로 같은 입력이면 같은 결정 */
export interface KernelContext {
  /** max(벽시계, meta.last_recorded_at). 오케스트레이터 재처리에서는 계기 이벤트의 recordedAt으로 고정한다 */
  now: number;
  cursor: number;                    // 같은 트랜잭션에서 지금까지의 head seq
  newId: (prefix: string) => string; // 사람 채널은 주입 IdFactory, R·S·X 채널은 멱등 키에서 결정적으로 (§3.9.1)
  rules: { version: string };        // provenance.rulesVersion
  presence: PresenceView;            // presence.changed 투영 (재현 가능). 부재 판정은 14 함수가 ctx.now로 한다
}
export interface PresenceView { devices: { deviceId: string; clientKind: string; state: Static<typeof PresenceState>; sinceSeq: number; sinceAt: number }[] }
```

#### 3.16.2 저장소 API

```ts
// @helm/store/src/index.ts
import Database from "better-sqlite3";

export interface StoreOptions {
  dataDir: string;
  releaseId: string;
  clock: Clock;
  ids: IdFactory;
  hmacKeys: { current: { keyId: string; key: Uint8Array }; previous: { keyId: string; key: Uint8Array }[] };  // 필수 (§3.10.3)
  mode: "writer" | "reader";
  /** 테스트 전용 (22). 운영 빌드에서는 무시한다 */
  testing?: {
    bootEpoch?: string;                                      // 고정 epoch (골든 시험)
    storeId?: string;                                        // 고정 storeId
    allowTmpfs?: boolean;                                    // §3.6.2 파일시스템 검사만 끔
    faultInjector?: (point: string, ctx: unknown) => void;   // §3.8.4의 고장 주입 지점
    exitAt?: (point: string) => boolean;                     // 장애 주입 종료 지점 (프로세스 종료를 흉내)
  };
}

export interface CommitInput {
  command: CommandKeyFields;
  generatedIdFields: readonly string[];           // 10 명령 메타 (§3.9.1)
  /** 엔진이 KernelState(같은 트랜잭션의 덧씌운 사본)와 ctx를 묶어 넘긴다. 저장소는 멱등 조회 뒤에만 부른다 */
  decide: (tx: { headSeq: number }) => Decision;
  /** 판정 결과에 따라 같은 트랜잭션에 남길 trace ([판정 J-42]). decide 뒤, 커밋 전에 부른다 */
  traces?: (decision: Decision) => TraceDraft[];
}
export interface TraceDraft { kind: TraceKind; runId?: string; threadId?: string; concernId?: string; ref?: string;
                              data: unknown; expiresAt?: number }
/** 저장소 반환값: SubmitResult + 커밋된 이벤트(엔진이 KernelState 사본에 apply한다) */
export type CommitResult = SubmitResult & { events: StoredEvent[] };   // replayed·key_reused면 events는 빈 배열

/**
 * 대화형 쓰기 트랜잭션 ([판정 J-148]). better-sqlite3 transaction 위의 동기 함수다.
 * fn 안에서 tx.commitOne을 여러 번 부를 수 있고, 뒤 제출은 앞 제출의 결과(같은 트랜잭션의 투영과
 * 덧씌운 KernelState 사본)를 본다. fn이 던지면 전체 롤백, KernelState 사본도 버린다.
 * fn 안에서 await, 네트워크, 파일 쓰기를 하지 않는다(blob 파일은 putBlob으로 미리 준비).
 */
export interface WriteTx {
  commitOne(input: CommitInput): CommitResult;
  appendTrace(traces: TraceDraft[]): void;
  upsertRuntimeTimer(row: RuntimeTimerRow): void;          // runtime_timers (12)
  deleteRuntimeTimer(id: string): void;
  setScratch(toolCallId: string, runId: string, tail: Uint8Array): void;   // volatile_scratch
  headSeq: number;                                          // 지금까지의 제출을 반영한 head
}

export interface HelmStore {
  readonly bootEpoch: string;
  readonly storeId: string;
  readonly headSeq: number;
  transaction<T>(fn: (tx: WriteTx) => T): T;
  /** 편의 함수: transaction(tx => tx.commitOne(input)) */
  commit(input: CommitInput): CommitResult;
  /** 편의 함수: 한 트랜잭션에 여러 명령. 명령마다 commands 행과 결과가 따로 (§3.8.4) */
  commitBatch(inputs: CommitInput[], traces?: TraceDraft[]): CommitResult[];
  /** 이벤트 없이 trace만 (같은 펜싱) */
  appendTrace(traces: TraceDraft[]): void;
  /** 커밋한 그 턴 안에서 동기로 호출 (§3.8.4 8단계) */
  onCommitted(listener: (events: StoredEvent[]) => void): () => void;
  /** 10의 KernelState 캐시 (§3.16.4) */
  saveKernelSnapshot(seq: number, rulesVersion: string, state: Uint8Array): void;
  loadKernelSnapshot(): { seq: number; rulesVersion: string; state: Uint8Array } | null;

  readEvents(q: EventQuery): EventPage;
  readTrace(q: { afterId: number; kinds?: TraceKind[]; runId?: string; limit: number }): { rows: TraceRow[]; nextAfterId: number };
  getRecord<T = unknown>(id: string): T | null;
  queryRecords(q: RecordQuery): unknown[];
  links(id: string, opts?: { rel?: string; direction?: "in" | "out" }): Link[];
  attention(q: { projectId?: string }): AttentionItem[];
  search(text: string, q: { projectId?: string; kinds?: string[]; limit?: number }): SearchHit[];
  timersDue(now: number, limit: number): TimerRow[];

  putBlob(bytes: Uint8Array, mediaType: string): BlobRef;   // 트랜잭션 밖에서도 호출 가능 (파일 먼저, 행은 다음 commit 안에서)
  stageUpload(uploadId: string, mediaType: string): { write(chunk: Uint8Array): void; finish(): BlobRef; abort(): void }; // 19
  getBlob(hash: string): { bytes: Uint8Array; mediaType: string } | { gone: "pruned" | "redacted" } | null;

  verify(mode: "tail" | "full"): VerifyReport;
  rebuildProjections(): RebuildReport;
  backup(kind: "daily" | "pre-migrate" | "pre-upgrade" | "manual" | "pre-restore"): Promise<BackupManifest>;
  exportJsonl(path: string, range?: { from?: number; to?: number }): void;
  setConsumerCursor(consumer: string, seq: number): void;   // trace 소비자는 seq 자리에 trace id를 적는다(커서 이름은 metrics_trace처럼 쓴다, §3.7 consumer_cursors)
  getConsumerCursor(consumer: string): number;
  close(): void;
}

/** 17 운영 도구가 쓰는 함수 (17 §3.4·§3.9). 데몬과 오프라인 CLI가 함께 쓴다 */
export interface StoreAdmin {
  readonly schemaVersion: number;                       // user_version
  readonly codeSchemaRange: { min: number; max: number }; // 이 코드가 열 수 있는 범위 (max = LATEST)
  quickCheck(): { ok: boolean; detail: string };        // PRAGMA quick_check
  verifyChain(opts: { lastN: number } | "all"): VerifyReport;   // = verify("tail" | "full")
  projectionDigest(): string;                           // p_* 행을 정렬해 만든 sha256 (재구성 비교, 훈련)
  backupTo(path: string, opts?: { onProgress?: (done: number, total: number) => void }): Promise<BackupManifest>;
  recordRevision(id: string): { revision: number; revisionSeq: number } | null;   // 19
}

/** 읽기 전용 열기. 데몬이 꺼져 있어도 쓸 수 있다(events tail, 내보내기, 검사). HMAC 키가 있으면 체크포인트도 검사 */
export interface ReadonlyStore {
  readonly headSeq: number;
  readonly storeId: string;
  readEvents(q: EventQuery): EventPage;
  readTrace: HelmStore["readTrace"];
  getRecord: HelmStore["getRecord"];
  queryRecords: HelmStore["queryRecords"];
  links: HelmStore["links"];
  search: HelmStore["search"];
  attention: HelmStore["attention"];
  getBlob: HelmStore["getBlob"];
  recordRevision: StoreAdmin["recordRevision"];
  verify(mode: "tail" | "full", hmacKeys?: StoreOptions["hmacKeys"]): VerifyReport;
  exportJsonl: HelmStore["exportJsonl"];
  close(): void;
}

export declare function openStore(opts: StoreOptions): HelmStore & StoreAdmin;   // §3.8.2 순서 실행. 데몬 전용
export declare function openReader(dataDir: string): ReadonlyStore;              // query_only 읽기 연결. 데몬이 도는 중에도 (16)
/**
 * 데몬이 멈춘 상태의 CLI 전용 (06 §3.4.5). helmd.lock을 잡는다. read는 query_only, maintain은 마이그레이션·복원·재구성만 하고
 * commit을 노출하지 않는다. HMAC 키가 없으면 체인 해시만 검증하고 HMAC 검증을 건너뛰었다고 보고한다
 */
export declare function openOffline(dataDir: string, opts: { mode: "read" | "maintain"; hmacKeys?: StoreOptions["hmacKeys"] }):
  ReadonlyStore & { migrate?(): { from: number; to: number }; rebuildProjections?(): RebuildReport };
export declare function restore(dataDir: string, backupId: string, carry: RestoreCarry | null): RestoreReport; // 데몬 정지 상태 전용 (§3.14.2)

// @helm/store/testing (22): SQLite 오류 주입. 다음 n번의 쓰기에서 지정 오류를 낸다
export declare function injectSqliteError(store: HelmStore, code: "SQLITE_FULL" | "SQLITE_IOERR" | "SQLITE_CORRUPT" | "SQLITE_BUSY", times: number): void;
```

보조 타입:

```ts
export interface RecordQuery { kind?: string; projectId?: string; goalId?: string; concernId?: string; workUnitId?: string;
  runId?: string; status?: string[]; flags?: ("contested" | "stale" | "autonomous")[]; afterRevision?: number; limit: number }
export interface AttentionItem { id: string; kind: string; targetId: string; projectId: string | null; concernId: string | null;
  severity: 1 | 2 | 3 | 4; sinceSeq: number; data: unknown }
export interface SearchHit { id: string; kind: string; projectId: string | null; title: string; snippet: string }
export interface TimerRow { id: string; kind: string; targetId: string; dueAt: number | null; trigger: unknown }
export interface RuntimeTimerRow { id: string; purpose: string; dueAt: number; ref: string | null; ownerEpoch: string; data: unknown }
export interface TraceRow { id: number; afterSeq: number; kind: TraceKind; runId: string | null; threadId: string | null;
  concernId: string | null; ref: string | null; at: number; bootEpoch: string; data: unknown }
export interface VerifyReport { ok: boolean; mode: "tail" | "full"; from: number; to: number; headHash: string;
  hmacChecked: number; keyUnavailable: number[]; failure: { code: string; seq: number | null } | null; durationMs: number }
export interface RebuildReport { events: number; durationMs: number; projectorVersion: number; digest: string }
export type BackupManifest = Static<typeof BackupManifestSchema>;   // §3.14.1 manifest
export interface RestoreCarry { events: StoredEvent[]; sourceStoreId: string }   // §3.14.2
export interface RestoreReport { backupId: string; upToSeq: number; storeId: string; quarantinePath: string;
  carried: number; missingBlobs: string[] }
```

하위 경로(06 §3.3): `@helm/store/read` = `openReader`, `readEvents`, `readTrace`, `getRecord`, `queryRecords`, `links`, `search`, `attention`, `timersDue`, `getBlob`, `recordRevision`. `@helm/store/write` = `transaction`, `commit`, `commitBatch`, `appendTrace`, `onCommitted`, `putBlob`, `stageUpload`, 소비자 커서, 커널 스냅숏. `@helm/store/admin` = `openStore`, `openOffline`, `StoreAdmin`, `verify`, `rebuildProjections`, `backup`, `restore`, `exportJsonl`, 인스턴스 잠금(17 `acquireInstanceLock`, [판정 J-101]). 쓰기 연결은 `engine`(데몬)만 연다(06). 19의 `readRange`·`readPage`는 `readEvents`의 `afterSeq`·`beforeSeq` 페이지다. runtime은 store를 import하지 않고 06의 `RuntimeStorePort`(엔진이 위 함수로 구현해 주입)를 쓴다([판정 J-127]). 오프라인 CLI의 HMAC 키는 17 §3.8의 SecretStore 로딩을 같은 방식으로 쓴다.

#### 3.16.3 같은 트랜잭션의 커널 상태

10의 메모리 `KernelState`는 엔진이 가진다. `transaction(fn)` 안에서 엔진은 제출마다 `commitOne`이 돌려준 이벤트를 `apply`로 덧씌운 사본(오버레이)을 만들어 다음 제출의 `decide`에 넘긴다. 트랜잭션이 커밋되면 오버레이를 바탕 상태로 합치고, 롤백되면 버린다. 그래서 13의 제안 도구 경로(intend → 제안 → complete)처럼 한 트랜잭션 안의 뒤 제출이 앞 제출의 결과를 본다([판정 J-148]).

#### 3.16.4 엔진 시작과 커널 상태 적재

```text
loadKernelState(store, rules):
  snap = store.loadKernelSnapshot()
  if snap and snap.rulesVersion == rules.version and sha256(snap.state) == state_hash:
      state = deserialize(snap.state); from = snap.seq + 1
  else:
      state = State0; from = 1
  for page in store.readEvents({ afterSeq: from - 1, limit: 5000 }) 반복:
      for ev in page: state = apply(state, upcast(ev))        // 10 §3.1.4의 순수 apply
  return state

스냅숏 주기: 1만 이벤트마다, 그리고 정상 종료 직전. 형식은 gzip(canonicalJson(state)), state_hash = sha256(직렬화 바이트).
메모리 목표(10, 1 GB): KernelState에는 판정에 필요한 열린 레코드와 색인만 두고, 닫힌 레코드 본문은 view.record()가 p_records에서 읽는다.
지시 재계산 커서: consumer_cursors.directives. 엔진은 시작할 때 이 커서 이후 이벤트로 10의 react 지시를 다시 계산해 처리한다
  (지시마다 멱등 키가 있어 중복 처리해도 결과가 같다). 처리한 seq를 지시 단위로 커서에 적는다.
```

`putBlob`의 행 삽입 시점: 파일(또는 인라인 바이트)을 준비해 두었다가 그 blob을 참조하는 이벤트가 커밋되는 트랜잭션 안에서 `INSERT OR IGNORE INTO blobs`를 한다. 참조하는 이벤트 없이 끝난 blob 파일은 고아 GC가 지운다.

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 | 관련 |
|---|---|---|---|
| F-01 | 디스크 가득 참 (`SQLITE_FULL`) | 트랜잭션 롤백, 명령 저장 안 함(일시 실패). 여유 1 GiB 미만이면 17의 `read_only` 모드(`daemon.mode_changed`), 주의 항목·운영 경보. 외부 효과 도구의 완료 커밋이 실패하면 런타임이 결과를 `state/pending-results/<tcId>.json`(fsync)에 두고, `disk_critical`이 풀릴 때 먼저 커밋한다. 같은 epoch에 남은 run은 부팅 복구와 같은 규칙으로 정리한다(12·17 소유, 22 FI-16) | §3.9.2, 17 |
| F-02 | 커밋 도중 전원 차단·WSL 강제 종료 | WAL + `synchronous = FULL`이므로 커밋됐거나 안 됐거나 둘 중 하나 [지식]. 재시작 뒤 `started`인 도구 호출은 결과 기록이 없으므로 부팅 복구에서 interrupted 또는 safe 재실행 | §3.8.2, 결정 30 |
| F-03 | 커밋 직후, 구독자 알림 전에 종료 | 구독자(프로토콜, 스케줄러, 알림기)는 커서 이후를 `readEvents`로 읽어 따라잡는다 | §3.8.4 |
| F-04 | blob 파일을 쓴 뒤 DB 커밋 전에 실패 | 파일만 남음. 고아 GC가 1시간 뒤 지움 | §3.12 |
| F-05 | 투영기 예외 (버그) | 명령 전체 롤백, 저장 안 함([판정 J-129]). 같은 투영기 예외가 반복되면(17 기준: 5분 안 3회 또는 같은 투영기 연속 2회) 17이 `read_only`(사유 `projection_fault`)로 바꾸고, 사람이 수정 배포 뒤 `helm ops rebuild-projections`로 투영을 다시 만든다. 이벤트를 쓰고 투영만 건너뛰는 방식은 택하지 않는다(D09-5: 커널의 판단 입력이 틀어진다) | §3.11, 17 |
| F-06 | 부팅 무결성 검사 실패 | 17 `read_only` 모드(이벤트 없음, J-67). 자동 잘라 내기 없음 | §3.10.5 |
| F-07 | 데몬 두 개 | 두 번째는 `helmd.lock`에서 종료(코드 3). 잠금을 지나도 epoch fencing으로 옛 프로세스의 쓰기가 실패하고 그 프로세스는 끝난다 | §3.8.1 |
| F-08 | DB가 바이너리보다 새 스키마 | 시작 거부 (다운그레이드 금지) | §3.13.1 |
| F-09 | 적용된 마이그레이션 소스가 바뀜 (체크섬 불일치) | 17 `read_only` 모드 | §3.13.1 |
| F-10 | 시계가 뒤로 감 | `recordedAt`은 직전 값을 넘지 않게 고정하고 `clock.skew_detected`를 남긴다(§3.2 규칙 9). 순서는 seq로만 판단. ID 팩토리는 `max(마지막 시각, now)`로 단조 유지. 타이머는 늦게 발동할 수 있다. 시계 앞으로 점프는 타이머가 일찍 발동할 수 있다(운영 로그에 경고) | 08 §3.2 |
| F-11 | 오래 걸리는 읽기 트랜잭션이 WAL 체크포인트를 막음 | 내보내기와 재전송 조회는 5,000건 단위로 읽기 트랜잭션을 나눈다. 백업은 온라인 백업 API가 단계별로 복사한다 [지식]. `journal_size_limit`로 WAL 파일 크기를 줄인다 | §3.6.3 |
| F-12 | 같은 멱등 키에 다른 내용 | `key_reused` 반환, 저장 안 함 | §3.9.2 |
| F-13 | 네트워크 단절 후 클라이언트 재시도 | 같은 키 → 저장된 결과 재생 | §3.9.2 |
| F-14 | 커널이 만든 payload가 스키마와 안 맞음, envelope가 256 KiB 초과 | 커널 버그. 일시 실패로 롤백, 초안을 운영 로그에 남김 | §3.8.4 |
| F-15 | 이전 epoch 실행의 늦은 쓰기 | `path.stale_epoch` 거부. 거부는 `command.rejected`로 저장 | §3.8.3 |
| F-16 | HMAC 키 없음·교체 | 키 없음: 시작 거부. 이전 키가 없는 구간: 체인 검사만 하고 주의 항목 `integrity.checkpoint_key_unavailable`. 교체 절차는 §3.10.3 | §3.10.3 |
| F-17 | blob 파일이 밖에서 지워짐 | 읽을 때 `null`, 주의 항목 `blob.missing`. 주간 full 검사에 파일 존재 확인을 넣는다 | §3.12 |
| F-18 | 백업에 필요한 blob이 없음 | 복원 단계 1에서 실패, 현재 DB를 옮기지 않음 | §3.14.2 |
| F-19 | 읽기 연결의 체크포인트와 쓰기가 겹쳐 `SQLITE_BUSY` | `busy_timeout = 5000`. 넘으면 일시 실패 | §3.6.3 |
| F-20 | 데이터 디렉터리가 `~/projects` 아래 | 시작 거부 | §3.6.2 |
| F-21 | 로그에 모르는 이벤트 타입·버전 (수동 다운그레이드 등) | 시작 거부. 읽기·내보내기 관리 명령은 가능 | §3.13.3 |
| F-22 | 낡음 전파로 한 트랜잭션에 수천 이벤트 | 허용. 2초를 넘으면 운영 로그 경고. 성능 시험에 포함 | §3.15.2 |
| F-23 | FTS5·trigram을 쓸 수 없는 SQLite | 마이그레이션 0001에서 실패, 시작 거부 (better-sqlite3 버전 고정으로 예방) | §3.7 |
| F-24 | 관리 CLI가 마이그레이션 중인 DB를 염 | CLI는 `user_version`이 자기 기대값과 다르면 "데몬이 업그레이드 중"을 알리고 끝남 | §3.13.1 |
| F-25 | 복원한 DB의 seq가 클라이언트 캐시보다 작음 | 새 `storeId`로 클라이언트가 알아채고 처음부터 다시 받는다. epoch는 ULID라 겹치지 않는다 | §3.14.2 |
| F-26 | 짧은 한국어 검색어(1~2글자)가 trigram에 안 걸림 | 3글자 미만이면 `LIKE '%q%'`로 `p_records.title`을 찾는다 | §3.7, U-11 |
| F-27 | 커널 내부 오류 (`error`) | 롤백, 저장 안 함. 같은 키 재시도는 다시 처리. 사람에게는 `kernel_error` 질문(11)이 런타임에서 따로 만들어진다 | §3.9.2 |
| F-28 | `commitBatch` 중 한 명령이 rejected | 그 명령은 `command.rejected`로 저장되고 나머지는 계속. 한 명령이 error나 투영기 예외면 배치 전체 롤백 | §3.8.4 |
| F-29 | 커널 스냅숏이 규칙 버전과 맞지 않음 | 버리고 이벤트에서 다시 접는다 | §3.16 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공하는 것 |
|---|---|
| 08 | 레코드 생성·전이 이벤트 이름(§3.4), 투영기 구현 기준 |
| 10 | `transaction`·`commitOne`·`commit`·`commitBatch`와 `@helm/domain`의 `EventDraft`·`Decision`·`SubmitResult`·`KernelContext`, 결과 저장 규칙(거부·충돌·게이트 저장, 재생, error 비저장), `command.rejected` payload(ruleId, gateQuestionId, contextRef), envelope `provenance`, 쓰기 경로의 fence, `kernel_snapshots` |
| 11 | 질문·승인·전달 계획 이벤트(`question.updated`, `delivery.planned`, `question.seen`, `approval.*`, `decision.confirmed`, `boundary.reached`, 영속 `presence.changed`)와 `p_timers`의 질문 관련 kind |
| 12 | 런타임 이벤트(`run.*`, `toolcall.*`, `thread.*`, `budget.*`, `rollback_point.*`), trace 테이블과 `appendTrace`, `runtime_timers`, `commitBatch`, 부팅 복구 조회(§3.8.2), `timersDue`, `volatile_scratch`, 내부 쓰기 멱등 키(§3.9.3), `eventsSince`(복귀 요약 재료), `p_attention`, `p_budget` |
| 13 | `toolcall.*` 이벤트와 write-ahead 규칙, `agreement.violation_detected` |
| 14 | `loop.transitioned`, `loop_plan.adopted`, `situation.assessed`, `mode.assigned`, `watch.*`, `entry.evaluated`, `agreement.activated_by_rule`, `agreement.discarded`, `dial.set`, `p_dials`, 오케스트레이터 멱등 키 |
| 15 | 탐구·자극·선호·렌즈 이벤트(`inquiry.anchored`·`round_ended`·`stage_completed`·`stop_rule_met`, `contrast.presented`, `lens.updated`, `lens_seed.loaded`, `possibility.dismissed`·`merged`·`pinned`, `observation.retracted`) |
| 16 | 읽기 전용 연결로 이벤트 로그 전체 읽기, `measurement` 범주 이벤트, `policy_proposal.*`(16 상태 기계 이름), `procedure.*`, `observer_run.*`, `setting.changed`. 커서는 16의 `observer.db`에 둔다 |
| 17 | 데이터 디렉터리 안쪽 배치와 검사, 저장소 부팅 단계, 백업·복원·검증·내보내기 함수, `storeId`, system 이벤트(`daemon.*`, `backup.*`, `drill.completed`, `config.reloaded`, `secrets.reloaded`, `store.restored`), 보존 정책, 성능 목표 |
| 18 | HMAC 키 이름·다중 키 검증, 파일 권한, 기기·페어링·인증 이벤트, `sensitiveFields`와 `redactions` |
| 19 | 전역 무간격 seq, `storeId`, `readEvents` 페이지(필터·`typePrefixes`·`goalId`·`beforeSeq`·`headSeq`·`nextAfterSeq`), 휘발 이벤트 공통 필드, blob 해시·id 주소, 업로드 staged blob, `basisSeq` 충돌 판정, `brief.*`, `autonomous.seen`, `question.delivered` payload |
| 20 | 클라이언트 캐시가 seq·`storeId`·레코드 `revisionSeq`로 정합을 판단할 수 있다는 보장, `onCommitted` 동기 호출 |
| 22 | 고장 주입 지점, 결정성 재구성 비교, 성능 목표 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01·02·11 | 1판 이벤트 이름을 이 카탈로그 이름으로 바꾼다. 대응은 08 §10.3 |
| 06 | `@helm/store`는 `@helm/domain`만 의존하고 `@helm/kernel`을 import하지 않는다(커널은 `decide` 함수로 주입). `better-sqlite3` 버전 고정. 데몬 프로세스 하나만 `mode: "writer"`로 연다. 06의 outbox·`expectedSeq` 표현을 이 문서의 커서 방식·`basisSeq`로 맞춘다 |
| 10 | (1) `decide`는 순수 함수이며 `KernelState`·`KernelContext`만 읽는다. 같은 트랜잭션의 뒤 제출은 엔진이 덧씌운 `KernelState` 사본을 받는다(§3.16.3, [판정 J-148]). 명령마다 `generatedIdFields` 메타를 둔다(§3.9.1). (2) 거부·충돌·게이트도 `command.rejected` 초안을 만든다. conflict도 이벤트를 남긴다(§3.9.2). (3) 버전 검사(V-VER-01)는 decide 안에서 한다. 저장소는 하지 않는다. (4) 멱등 범위는 `channel|actor|viaKey|key`(§3.9.1). (5) 구조화 `authorityBasis`는 `<kind>:<ref>` 문자열로 저장한다(kind에 `question` 추가). (6) `command.rejected`의 plane은 대상 평면 또는 null이며 `system`이 아니다. (7) V-INV-08의 subject·authority 필수 규칙에서 §3.2 규칙 3·4의 예외를 둔다. (8) 거부 코드 목록에 `path.fenced`, `path.store_read_only`, `invalid.event_too_large`, `conflict.external_observation_changed`를 넣는다. (9) TimerPurpose 이름을 §3.11.3 kind로 바꾸고 `mediator_timeout`·`daily_digest`는 12의 `runtime_timers`로 둔다. (10) `kernel`·`scheduler` 행위자 이벤트에 `causationId` 필수 |
| 11 | (1) 질문 전달 결정을 `question.delivery_planned`(질문별)와 `delivery.planned`(묶음)로 기록한다. (2) presence는 영속 `presence.changed`(상태가 바뀔 때만)로 받아들였다. (3) `notify` outbox 대신 `onCommitted` 구독을 쓴다. (4) 이의 대상은 레코드 id다(08 U-20) |
| 12 | (0) 본문의 1판 이름 `run.completed`·`failed`·`cancelled`·`recovered`, `toolcall.intended`·`dropped`·`resolved`, `submission.*`를 09 이름으로 바꾼다(판정 J-25~J-30). `model.*`, `context.*`, `input.*`, `message.committed`, `recovery.decided`, `settle.unresolved`, `steering.deferred`는 trace 종류로 둔다. (1) 부팅 복구가 §3.8.2의 11단계 조회 결과로 명령을 내고 내부 멱등 키(§3.9.3)를 쓴다. (2) 모델 요청마다 `run.context_projected`(`projectionId` = `cp_`)를 남긴다. (3) 모델 메시지를 `run.message_recorded`로 남기고 재시작 때 이것으로 대화를 복원한다. (4) 커널 이벤트 이름은 `toolcall.started`, `toolcall.outcome_uncertain`, `toolcall.not_executed`다. (5) 모델 요청·응답·압축·입력 큐·stage는 trace로 쓴다. (6) 비밀을 가린 뒤 blob에 넣는다 |
| 13 | (0) `scope.violation_detected`는 `agreement.violation_detected`(+ `scope_violation` 질문), `question.raised`는 `question.recorded`, `submission.rejected`는 `command.rejected`다. 어댑터 쪽 이름(`tool.*`, `turn.*`, `session.started`, `usage.reported`)은 어댑터 내부 이름이며 이벤트가 아니다. 도구 환경에서 `HELM_LEDGER_HMAC_KEY*`와 데이터 디렉터리(`/srv/volumes/helm`) 접근을 막는다. 도구의 기본 작업 범위에서 이 경로를 제외한다 (bash로 기록을 고치는 문제, 대화 L2343). 10의 Scope는 08 §3.11.1을 그대로 쓴다 |
| 14 | §3.18의 받는 이벤트 이름을 09 이름으로 바꾼다(`loop_plan.recorded`→`loop_plan.adopted`, `agreement.ended`→`fulfilled`·`released`·`expired`, `obligation.closed`→`resolved`·`waived`·`transferred`, `*.contested`→`objection.filed`, `workunit.ended`→`workunit.concluded`·`cancelled`, `budget.used`→`budget.charged`, `scope.exceeded`→`workunit.scope_exceeded`, `tool.blocked`→`toolcall.blocked`, `observer.proposal_recorded`→`policy_proposal.submitted`). 규칙 결정은 행위자 `kernel`, 모델 선언 반영은 `runtime` + `declaredBy`로 보낸다. 기록이 필요한 단계 진행은 trace(`inquiry.step_*`, `work.requested` 등)다 |
| 16 | 관찰 에이전트는 읽기 전용 연결만 쓰고, 제안은 감독기 IPC로 보낸다(판정 §2, 06 §3.7). 측정 투영은 `observer.db`에 비동기로 만든다 |
| 17 | (1) 무결성 검사 → 마이그레이션 → 투영 재구성 → 복구 순서를 데몬 시작 순서에 넣는다. (2) 주간 full 검사, 하루 한 번 가지치기·GC 타이머. (3) just 레시피 이름(관리 명령은 `helm ops verify`, `helm export`, 단위는 `helmd.service`, J-68). (4) SecretStore가 이전 HMAC 키(`HELM_LEDGER_HMAC_KEY_<keyId>`)도 넘긴다 |
| 18 | HMAC 키 생성·보관·교체 절차(SOPS), 데이터 디렉터리 권한 감사 |
| 19 | (0) 이벤트 이름 `contest.filed`는 `objection.filed`, presence 값은 `PresenceState`. (1) 프로토콜 이벤트의 seq는 이 문서의 seq를 그대로 쓴다(결정 31). (2) 필터 구독에서 `headSeq`·`nextAfterSeq` 사용. (3) 휘발 이벤트를 seq 없이 보낸다. (4) 클라이언트로 보내는 이벤트는 `redact: true` 사본이다. (5) 거부 갈래 이름 `qualification`을 `authority`로 |
| 21 | 거부 갈래 이름 `eligibility`를 `authority`로 |
| 22 | §6의 저장소 시험(고장 주입, 결정성, 성능)을 테스트 계층에 넣는다 |
| 17 | J-122 정상 종료 코드 `daemon_shutdown`, J-129 `projection_fault`, 마이그레이션 체크섬 불일치는 `read_only`(integrity_suspect) 분기, 주간 full 실패의 사람 확인, 복원 CLI의 restore-carry와 `meta.restored_pending`, `helm ops safe-mode off`·`helm ops rebuild-projections`·`helm ops redact-blob`, `daemon.stopped`·`safe_mode_entered` payload의 출처 |
| 12 | 부팅 복구의 전역 started·replaying 정리와 `executedByRunId`, 복구 멱등 키, run 단위 예외 가둠, 결과 불명 run을 awaiting_recovery로(run.ended 없음), RuntimeTimer purpose 목록, `aggregateTags`, stage·모델 요청 trace, 메시지 멱등 키 `ms:`, handoff 키 |
| 18 | 마스킹 지점에 사람 명령 payload, 가린 blob 해시의 남는 위험, 복원 뒤 위험 이벤트 재적용과 남는 사본, 기준점 비교는 같은 storeId 계보만 |
| 19 | `EventQuery` 새 필드(`untilSeq`, `scanLimit`, `excludeTypePrefixes`, `concernIds`, `includeDescendants`, `goalIds`)와 `scannedUntilSeq`, 줄인 명령 행의 재생 결과, `key_reused` 결과, `DeliveredEvent.invalidates` |
| 22 | `testing` 옵션과 `injectSqliteError`, `semanticFields`, 골든 파일 경로, 지문 재전송 시험(다른 연결·경로·attempt) |
| 24 | 평면 접두사 금지(D09-9)와 DB 경로(`/srv/volumes/helm/data/helm.sqlite`)를 ADR 문구에 맞춘다 |

## 6. 구현 단위와 완료 기준

### 6.1 `@helm/domain/src/events/` (I/O 없음)

| 파일 | 내용 | 완료 기준 |
|---|---|---|
| `envelope.ts` | `EventEnvelope`, `StoredEvent`, `EventCategory`, `AuthorityBasis` | 스키마 컴파일. 권한 근거 패턴 테스트(정상 11종, 잘못된 접두사 거부) |
| `payloads.ts` | `EventPayloads`, `EventType`, `EVENT_TYPES` | 모든 이름이 §3.3 정규식과 맞고 금지 접두사가 없음. 08 상태 기계(`machines/*.ts`)와 08 §3.20.1이 쓰는 모든 이벤트가 있음 |
| `meta.ts` | `EVENT_META` | 모든 `EventType`에 메타가 있음. §3.4 표의 이름 집합과 `EventPayloads`의 키 집합이 같음. `actors`가 08 행위자 패턴에 맞음. `needsAuthority = false`는 system·measurement 범주와 `command.rejected`뿐. `sensitiveFields`가 payload 스키마에 있는 필드 |
| `canonical-json.ts` | `canonicalJson` | RFC 8785 부록의 시험 벡터 통과 [지식: 구현 시 원문 확인]. 키 순서·숫자 표현·유니코드 이스케이프. `NaN` 거부 |
| `upcast.ts` | `UPCASTERS`, `upcast` | 버전 1만 있는 지금은 항등. 가짜 v2 업캐스터로 체인이 바뀌지 않음을 확인 |
| `volatile.ts` | `VolatileEvent` | 스키마 컴파일 |

### 6.2 `@helm/store`

| 파일 | 내용 | 완료 기준 (테스트) |
|---|---|---|
| `src/paths.ts` | 데이터 디렉터리 배치, 위치 검사 | 임시 HOME 아래 `projects/` 경로 거부. `/mnt/` 경로 거부. 디렉터리 0700·파일 0600 생성 |
| `src/lock.ts` | `helmd.lock` 잠금 (17 구현을 가져다 씀) | 같은 디렉터리로 두 번째 열기 실패(코드 3). 잠금 프로세스를 kill -9 하면 다음 열기 성공 |
| `src/open.ts` | PRAGMA, application_id, 부팅 순서 | 다른 application_id 파일 거부. PRAGMA 값 확인(`journal_mode = wal`, `synchronous = 2`) |
| `src/migrations/0001_init.ts`, `index.ts` | §3.7 DDL, 마이그레이션 실행기 | 빈 파일 → LATEST. `user_version = LATEST + 1`인 DB 거부. 적용된 마이그레이션 체크섬을 바꾸면 거부. 마이그레이션 전 백업 파일 생성. `events`에 UPDATE·DELETE 시도 시 트리거 오류 |
| `src/boot.ts` | epoch, `daemon.booted` | 부팅마다 새 ULID epoch. 같은 파일을 연 두 인스턴스에서 나중 인스턴스 부팅 뒤 이전 인스턴스의 `commit`이 `Fenced`로 실패 |
| `src/commit.ts` | §3.8.4 | (1) accepted·rejected·conflict 결과가 같은 키 재시도에서 그대로 재생되고 이벤트가 늘지 않음. (2) 키 재사용 + 다른 내용 → conflict, `commands` 행 없음. (3) 모든 고장 주입 지점에서 예외 시 `events`·`commands`·`p_*` 행 수 불변, 이후 같은 명령 성공. (4) 롤백이 섞여도 seq에 빈칸 없음. (5) decide가 낸 conflict가 저장되고 재생됨, error는 저장되지 않음. (6) 256 KiB 넘는 envelope 거부. (7) `commitBatch`에서 명령마다 `commands` 행. (8) `onCommitted`가 커밋한 턴 안에서 seq 순서로 불림. (9) trace 행이 롤백과 함께 사라짐 |
| `src/hash.ts`, `src/integrity.ts` | 체인, HMAC, `verify` | (1) 테스트에서 트리거를 지우고 envelope 한 글자를 바꾸면 `hash_mismatch`. (2) 행 삭제 → `gap`. (3) 키 없이 체인 전체를 다시 계산해 위조 → `checkpoint_hmac`. (3-1) 이전 키로 쓴 체크포인트를 이전 키로 검증, 이전 키가 없으면 `checkpoint_key_unavailable` 보고. (4) 정규화가 아닌 envelope → `not_canonical`. (5) 비정규화 열 불일치 → `column_mismatch` |
| `src/projectors/core/*.ts` | 투영기 | (1) 모든 `EventType`에 처리 함수(망라성 테스트). (2) 유즈케이스 시나리오 이벤트 열(22 `tests/scenarios/golden/*.golden.jsonl`)에 대해 증분 투영과 재구성 결과의 행 해시가 같음. (3) 모르는 타입·버전이 있는 DB는 시작 거부. (4) 08 상태 기계에 없는 전이는 예외 |
| `src/rebuild.ts` | §3.11.2 | 재구성 뒤 `p_checkpoint`가 head. 재구성 도중 예외면 이전 테이블 유지 |
| `src/query.ts` | 조회 API | 필터 재전송에서 `nextAfterSeq`를 따라가면 빠짐 없이 끝까지 받음. 응답의 `headSeq`가 같은 읽기 트랜잭션 시점 |
| `src/blobs.ts` | §3.12 | 256 KiB 경계 인라인/파일. gzip 왕복. 해시 불일치 감지. 고아 GC. 가지치기 뒤 행 유지·내용 없음. 가림 이벤트 |
| `src/backup.ts`, `src/restore.ts`, `src/export.ts` | §3.14 | (1) 쓰기를 계속하는 중에 백업한 사본이 full 검사 통과. (2) 복원 뒤 `storeId`가 바뀌고 `store.restored`가 남음. (3) 내보낸 JSONL만으로 체인 검사 통과. (4) 35일 GC 유예 안의 blob은 백업 복원 뒤에도 있음 |
| `src/retention.ts` | §3.15.3 | 근거 체인에 든 관찰의 blob은 가지치기에서 빠짐 |
| `bench/*.ts` | §3.15.2 측정 | 결과를 기록. p99 100 ms를 넘으면 실패(초기 기준) |

공통: `tsc --strict` 통과, `just verify`의 store 단계가 위 테스트를 실행(레시피 이름 06·23), 테스트는 임시 디렉터리의 실제 SQLite 파일로 한다(메모리 DB는 WAL 동작이 달라 쓰지 않는다 [지식]).

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| U-01 | 프로젝트마다 DB를 나눌지 | (a) DB 하나 (b) 프로젝트별 | (a) D09-1 |
| U-02 | `synchronous` | (a) FULL (b) NORMAL | (a)로 확정(17). 성능 시험에서 p99가 목표를 넘어도 사람 결정 이벤트를 잃지 않는 쪽을 택한다 |
| U-03 | HMAC 키가 없을 때 | (a) 경고하고 계속 (b) 시작 거부 | (b). 18의 요구. 설치 레시피(17)가 키를 만든다 |
| U-04 | 모델의 사고(thinking) 내용을 저장할지 | (a) 메시지 blob에 함께 (b) 저장 안 함 | (a). 공급자가 암호화한 사고는 받은 그대로. 12 확정 |
| U-05 | 컨텍스트 투영 blob 보존 기간 | 30 / 90 / 영구 | 90일 |
| U-06 | 도구 출력 임시 버퍼(`volatile_scratch`) | (a) 둠 (b) 없앰(중단 결과에 부분 출력 없음) | (a) |
| U-07 | restic 대상 | (a) `backups/`와 `data/blobs/` (b) DB 파일 직접 | (a). 17 D17-10 |
| U-08 | 다운그레이드 거부 종료 코드 | - | 17이 정한다 |
| U-09 | `refs` 상한 256 | (a) 256 (b) 더 크게 | (a). 많은 레코드에 영향을 주는 처리는 레코드마다 이벤트를 나눈다(낡음 전파가 그렇다) |
| U-10 | 검색 토크나이저 | (a) trigram + 짧은 질의 LIKE (b) unicode61 | (a) F-26 |
| U-11 | 관찰 에이전트 프로세스 | (a) 데몬 안 실행 (b) 별도 프로세스 + 읽기 전용 연결 | 저장소는 둘 다 지원. 16 확정 |
| U-12 | blob 인라인 기준 | 64 / 256 KiB / 1 MiB | 256 KiB |
| U-13 | `toolcall.requested`와 `toolcall.started`를 합칠지 | (a) 둘 다 기록 (b) 승인이 필요 없으면 started 하나 | (a). 차단 기록과 의도 기록을 나눠 두면 부팅 복구에서 실행 여부를 바로 알 수 있다. 이벤트 수가 문제가 되면 (b) |
| U-14 | 명령 inbox의 `result` 축소 시점 | 365일 | 365일 |
| U-15 | trace 보존 기간 | 90 / 180 / 365일 | 180일 |
| U-16 | `presence.changed`를 영속으로 둘지 | (a) 상태가 바뀔 때만 영속 (11) (b) 휘발 | (a). 질문 전달 결정을 이벤트만으로 재현하려면 필요하다 |
| U-17 | 커널 버전 검사 위치 | (a) 커널 decide (10) (b) 저장소 | (a). 충돌 종류를 구분해 돌려줄 수 있다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 13·14·22·24, 기본값 29·30·31·36, 판정 44·45, §2.5(저장 위치, 비밀, 백업, just), §3.1·§3.2·§3.3
- 원전 정리: `sources/helm-canon.md` §11.2·§11.3(Event, 불변 5), §11.9(ContextProjection 메타), §11.13·§11.14, §13.3(Ledger MUST/SHOULD), §13.5(Projection 불변), §13.12, §16.2 C3·C4, §16.8, §21 "09"
- `sources/helm-canon-2.md` §1.5(helmd single writer), §1.7(정본 계약 네 종류), §1.8(identity, ordering, idempotency, 낙관적 동시성), §1.13(projection 불변), §1.18(storage, transaction boundary, schema evolution, JSONL migration), §1.19, §1.21(실패와 복구), §1.22(stream 분리), §1.27(이벤트 타입 전부), §9.1·§9.4·§9.6·§9.7·§9.14, §10 L13·L17, §11 "09"
- `sources/helm-canon-3.md` §5.1.6·§5.2.6(후보 이벤트 어휘), §8 "09"
- 대화 발췌: `sources/conversation-extracts-3.md` X3-4-04~06·X3-4-14(해시 체인, 파일 락, bash 우회), X3-8-09(정본은 이벤트 로그); `conversation-extracts-4.md` 13-9·14-12·16-6·16-8; `conversation-extracts-1.md` E1-008(중립 이벤트 어휘)
- 실행 후보 코드 [원문]: `experiments/helm-kernel-v02/src/sqlite-kernel.mjs`(PRAGMA, DDL, 체크섬 체인, BEGIN IMMEDIATE, 거부 결과 저장, 고장 주입, outbox), `src/migration.mjs`(가져오기 계획), `contracts/event.schema.json`, `contracts/write-result.schema.json`
- 감사·조사: `docs/v0.3/audit/backend-oss-research.md` §1.2(OpenCode write-ahead claim, Happy 전역 이벤트 커서), §2.2(선도착 답, WSL 파일 위치), §2.3; `mastra-review.md` §5·§9(절대 시각 타이머, 승인-인자 지문, 대기 목록); `audit-report.md` §3.5·§3.8·§4
- v0.3: `docs/v0.3/08-runtime-architecture.md` §3.1·§10, `12-implementation-architecture.md` §4·§5, `14-alternative-structure.md` §3
- pi [원문, pi-api-facts-1 §7.3·§7.4 경유]: `~/projects/_ref/pi-src/packages/durable/docs/spec.md:1917-1933`(effect sandwich), `:4887-4965`(SQLite 백엔드), `packages/durable/src/storage/sqlite/node.ts`(WAL, synchronous NORMAL, wal_checkpoint TRUNCATE), `packages/durable/src/harness/tool.ts:182-195`(interrupted 문구)
- [지식]: RFC 8785 JCS, SQLite WAL·synchronous·online backup·user_version 트랜잭션 동작, FTS5 trigram(3.34+), better-sqlite3 `backup()` API. 구현 단계에서 원문 확인 필요

## 9. ADR 후보

### A09-1. 모든 프로젝트를 DB 하나, 전역 seq 하나로 기록한다

- 상태: 제안
- 맥락: 데몬 하나가 여러 프로젝트를 다룬다. 프로토콜은 seq 재전송을 쓴다(결정 31).
- 결정: DB 파일 하나, `events.seq` 하나. 프로젝트는 `project_id` 열과 필터로 나눈다.
- 근거: 클라이언트 커서가 하나다. 프로젝트를 가로지르는 홈 화면과 관찰 에이전트가 한 질의로 읽는다.
- 기각한 대안: 프로젝트별 DB(v0.3 12 "워크스페이스마다 Harness + SQLite 파일 하나") — 커서·백업·마이그레이션이 프로젝트 수만큼 늘고 프로젝트 사이 관계를 표현할 수 없다.
- 결과: 프로젝트 하나를 지우거나 따로 내보내려면 필터 내보내기를 쓴다. 이벤트는 지우지 않는다.

### A09-2. 거부를 포함한 모든 명령 결과를 저장하고 같은 키로는 재생한다

- 상태: 제안
- 맥락: helm-kernel-v02 SQLite판은 거부를 저장했고 in-memory판은 저장하지 않았다(helm-canon-2 §9.6). 브리프 작업 지시가 하나로 정하라고 요구했다.
- 결정: accepted·needs_gate·rejected·conflict를 모두 `commands`에 저장하고 `command.rejected` 이벤트를 남긴다. 일시 실패만 저장하지 않는다.
- 근거: 같은 키에 같은 결과(결정적 재시도). 거부된 시도도 기록(A14). 저장소의 일시 실패와 커널 판정을 구분할 수 있다.
- 기각한 대안: 거부는 저장하지 않음 — 같은 키 재시도가 상태 변화에 따라 다른 결과를 낸다.
- 결과: 사용자가 같은 동작을 다시 하려면 앱이 새 키를 만든다. 이벤트 수가 거부만큼 늘어난다.

### A09-3. 낙관적 동시성은 레코드별 버전으로 한다

- 상태: 제안
- 맥락: helm-kernel-v02는 모든 명령에 전역 `expectedCursor`를 요구했다.
- 결정: `p_records.revision_seq` = 사람에게 의미 있는 변경(`bumpsRevision`)의 마지막 seq. 사람 명령은 `basisSeq`(또는 `expect`)를 싣고, 비교는 커널 decide 안에서 한다.
- 근거: 데몬에는 런타임 이벤트가 계속 쌓여 전역 커서가 무관한 변경에도 충돌한다. 근거 링크·주석처럼 사람이 본 내용을 바꾸지 않는 변경까지 버전을 올리면 사람의 답이 이유 없이 막힌다. 커널이 비교해야 충돌 종류(버전 불일치, 이미 해결됨, 대체됨)를 구분할 수 있다(10).
- 기각한 대안: 전역 커서(무관한 충돌), 버전 검사 없음(옛 화면으로 확정하는 일이 생김), 모든 변경에 버전 올림(1판), 저장소가 decide 전에 비교(1판, 충돌 종류를 못 나눔).
- 결과: 앱은 화면이 본 seq를 `basisSeq`로 보낸다(19·20). 지문에는 basisSeq를 넣지 않는다.

### A09-4. 투영을 쓰기 트랜잭션 안에서 갱신하고 outbox를 두지 않는다

- 상태: 제안
- 맥락: 커널의 판단 입력이 필요하다. helm-kernel-v02는 매 명령 전체 재생으로 느려졌다. v0.2 커널 후보는 projection 실패가 ledger commit을 되돌리지 않게 하라고 했다.
- 결정: 이벤트 추가와 `p_*` 갱신을 한 트랜잭션에. 투영기 오류는 전체 롤백. 내부 소비자는 `consumer_cursors`로 이벤트 로그를 직접 읽는다.
- 근거: 투영이 커널의 상태이므로 이벤트보다 늦으면 판단이 틀린다. 이벤트 로그 자체가 순서 있는 큐라 outbox가 중복이다.
- 기각한 대안: 비동기 투영 + outbox(커널 판단이 낡은 상태에 기댐), 투영 실패 시 이벤트만 커밋(커널 상태 불일치).
- 결과: 투영기 버그가 쓰기를 막을 수 있다. 시험(증분 = 재구성)과 상태 확인 경보로 대응한다.

### A09-5. SHA-256 해시 체인 + HMAC 체크포인트

- 상태: 제안
- 맥락: 모델이 bash로 기록을 고칠 수 있다(대화 L2343). 체인만으로는 전체를 다시 계산한 위조를 못 찾는다(L17).
- 결정: 정규화 JSON의 SHA-256 체인, 1,000건마다 SOPS 키로 HMAC 체크포인트.
- 근거: 키를 도구 환경에 주지 않으면 위조 비용이 크게 오른다. 키는 필수이며(18) 체크포인트마다 keyId를 적어 키를 바꿔도 이전 구간을 검증한다.
- 기각한 대안: 체인만(위조 감지 못 함), 이벤트마다 서명(비용, 키가 없으면 검사 불가).
- 결과: 키 관리(18)가 필요하다. 1차 방어는 도구 실행 범위에서 데이터 디렉터리를 빼는 것이다(13).

### A09-6. 단일 쓰기를 잠금 파일과 부팅 epoch fencing으로 지킨다

- 상태: 제안
- 맥락: 결정 30(늦은 쓰기 차단), helm-kernel-v02 §1.5 single writer. Node에 flock이 없다.
- 결정: systemd 단위 하나 + `data/helmd.lock`의 `BEGIN EXCLUSIVE`(17) + 쓰기마다 epoch 대조 + 실행별 `ownerEpoch`. epoch는 ULID.
- 근거: 추가 네이티브 의존성이 없다. SQLite 잠금은 프로세스가 어떻게 죽든 풀린다. 마지막 방어가 DB 안에 있다. ULID epoch는 복원해도 되돌아가지 않는다.
- 기각한 대안: 소켓 bind 잠금(1판. 소켓이 tmpfs의 `$XDG_RUNTIME_DIR`로 옮겨져 데이터 디렉터리와 수명이 다르다), `locking_mode = EXCLUSIVE`(관리 CLI의 읽기도 막힘 [지식]), pid 파일(재사용된 pid 오판), 정수 epoch(복원 때 되돌아감).
- 결과: 부팅 복구 쓰기는 `internal:recovery` 출처로 펜싱 예외를 둔다.

### A09-7. 대화 기록과 도구 입출력을 이벤트 로그와 blob에 둔다

- 상태: 제안
- 맥락: 결정 29(모든 상태는 로그에서 재구성, pi 세션 파일은 기준 원본이 아님). v0.3 14 §3.2 (b) 권고(세션은 메모리, 기록은 Helm 저장소).
- 결정: `run.message_recorded`, `toolcall.*`, `run.context_projected`를 런타임 이벤트로, 본문은 blob으로.
- 근거: 커널 기록과 대화 기록이 한 트랜잭션에 들어가 어긋나지 않는다. 컨텍스트 투영 메타로 "그때 모델이 무엇을 보았나"(A11)를 확인할 수 있다.
- 기각한 대안: pi 세션 JSONL을 함께 유지(이중 기록), 대화는 저장하지 않음(재시작 복원 불가).
- 결과: 저장량이 늘어 보존 정책(§3.15.3)이 필요하다.

### A09-8. 데이터 디렉터리는 `/srv/volumes/helm/data`이고 동기화·Windows 파일시스템을 거부한다

- 상태: 제안 (배치는 17)
- 맥락: 브리프 §2.5.
- 결정: `${HELM_ROOT:-/srv/volumes/helm}/data`, `~/projects`·`/mnt/*`·9p·drvfs·tmpfs 거부.
- 근거: SQLite WAL은 동기화 폴더와 네트워크 파일시스템에서 안전하지 않다 [지식].
- 기각한 대안: `~/.local/share/helm`(홈랩 관례와 다름, 백업 대상 관리가 따로 필요), 프로젝트 폴더 안 `.helm/`(Syncthing).
- 결과: 설치 레시피가 디렉터리를 만들고 소유권을 맞춰야 한다(17).

### A09-9. 이벤트 이름에 평면 접두사를 쓰지 않는다

- 상태: 제안
- 맥락: v0.2 실행 후보는 `normative.choice.committed`처럼 평면 접두사를 썼다. 브리프 공통 계약은 `<대상>.<과거형 동사>`.
- 결정: 평면은 envelope의 `plane`과 카탈로그 메타로.
- 근거: 한 대상의 이벤트가 여러 평면에 걸칠 수 있다(질문 N/E). 이름이 짧아진다.
- 기각한 대안: v0.2 이름 유지.
- 결과: v0.2 이름은 부록 A의 대응표로 추적한다.

## 10. 다른 문서와의 정렬 기록

1판을 쓴 뒤 06, 10~21, 24를 읽고 맞춘 결과다.

### 10.1 받아들인 것

| 출처 | 내용 | 반영 위치 |
|---|---|---|
| 17 | 데이터 디렉터리 `/srv/volumes/helm/data`, `helmd.lock` 잠금, `rpc.sock` 위치, 백업 종류·이름·manifest, `storeId`, 35일 blob GC 유예, 1 GiB 시작 거부, 무결성 → 마이그레이션 순서, 모르는 이벤트 버전 시작 거부, `recordedAt` 단조, SecretStore, system 이벤트 9종 | §3.6, §3.8, §3.12~3.14, D09-7, D09-12 |
| 12·17·19 | 부팅 epoch를 ULID 문자열로 | D09-10 |
| 18 | HMAC 필수와 다중 키 검증, `ledger.hmac_key_rotated`, 페어링·기기·인증 이벤트, `sensitiveFields`와 envelope `redactions` | §3.2, §3.4.13, §3.10.3 |
| 16 | PolicyProposal 상태 기계 이벤트 이름, Procedure 이벤트, `measurement` 범주, `observer_run.*`, `setting.changed`, 측정 투영은 16이 비동기로 | §3.4.13~14, §3.11.1 |
| 19·20·06 | 지문에서 `expect`·`basisSeq` 제외, `basisSeq` 충돌 판정, `bumpsRevision`, envelope 256 KiB, `onCommitted` 동기 호출, `readEvents` 필터 확장, `question.delivered` payload, 질문 미룸·위임·다시 세우기, `autonomous.seen`, `dial.unset`, `observation.retracted`, `expectation.revised`, `brief.corrected`, 업로드 staged blob | §3.2, §3.4, §3.8.4, §3.9, §3.11.5, §3.12 |
| 12·13·14·15 | trace 테이블, `commitBatch`, `budget.*`와 `p_budget`, `runtime_timers`, 타이머 kind 이름, `boundary.reached`(경계 항목은 `boundary_item.*`), 커널 행위자의 규칙 결정, Run·ToolCall 이벤트 정리(`run.ended`, `toolcall.not_executed`), `thread.*`, `rollback_point.*`, 읽기 빠른 경로, 탐구·렌즈 이벤트 | §3.4, §3.7, §3.8.4, §3.11.3 |
| 10 | conflict·needs_gate도 `command.rejected`로 저장, `command.rejected` payload 확장, error 비저장, 버전 검사를 커널로, 멱등 범위 `channel|actor|via|key`, `KernelContext`, `provenance`, 커널 스냅숏, `decision.confirmed`, `agreement.narrowed`·`restored`, `watch.*`, `policy_proposal.deferred` | §3.2, §3.7, §3.9, §3.16 |
| 11 | `question.updated`, `question.seen`, `delivery.planned`, `approval.*`, 영속 `presence.changed`, `bundledAnswers` | §3.4.9, §3.4.13 |

### 10.2 받아들이지 않은 것

| 출처 | 제안 | 처리 | 이유 |
|---|---|---|---|
| 10 | conflict는 이벤트 없이 결과만 저장 | `command.rejected`(status conflict)를 남김 | 거부된 시도도 기록에 남아야 한다(A14) |
| 10 | EventDraft의 구조화 `authorityBasis[]`, `subjectRefs[]`, correlation 객체 | 문자열 authority, subject + refs, correlationId 문자열 | envelope은 09가 정하고 해시 대상이다. 구조화 값은 `<kind>:<ref>`로 옮겨 쓸 수 있다 |
| 10 | `command.rejected`의 plane `system` | 대상 평면 또는 null | 평면은 N/E/M/A/P만 둔다. system은 범주(category)다 |
| 11 | `rework.*`, `contest.*`, `working_assumption.*`, `*.review_flagged`, `policy.adjustment_suggested` | 08 §10.2의 대응 | 08 결정을 따른다 |
| 11 | presence를 모든 접속 변화마다 영속 | 상태가 바뀔 때만 영속, 생존 신호는 휘발 | 양을 줄인다(§3.15.3) |
| 12 | 커널 이벤트 `toolcall.intended`, `toolcall.outcome_unknown`, `toolcall.dropped` | `toolcall.started`, `toolcall.outcome_uncertain`, `toolcall.not_executed` | 10이 이미 started를 쓴다. 12는 이름을 09에 맡겼다 |
| 12 | `run.stage`를 이벤트로 | trace | 도메인 상태가 아니다 |

### 10.3 2a단계 통합

| 출처 | 반영 |
|---|---|
| 17 | `StoreAdmin`(`quickCheck`, `verifyChain`, `projectionDigest`, `backupTo`, `schemaVersion`, `codeSchemaRange`), 읽기 트랜잭션 30초 상한, `synchronous = FULL` 확정, 잠금은 `helmd.lock`(판정 §2) |
| 18 | `p_device_tokens`(tokenHash 조회), 감사 이벤트 전부 카탈로그에 있음 |
| 19 | `event_invalidations`(무효화 태그, 체인 밖), `DeliveredEvent`, `recordRevision`, `readRange`·`readPage` = `readEvents` 페이지, 명령 결과 보존 365일(요구 7일 이상) |
| 11·20 | `question.delivered`: 11 `QuestionDeliveredExtra`(문구 키 `copy`, `surface` 배열, `category`, `targetDevices`)를 정본으로 하고 앱이 키로 제목·본문을 만든다. `question.answered.matchesRecommendation`. `PresenceState`(active·idle·hidden·locked·offline) |
| 06 | 하위 경로 `read`·`write`·`admin`, `openReader`(`query_only`) |
| 14 | 오케스트레이터 커서는 `consumer_cursors`. `work.*`, `attention.*`, `orchestration.guard_tripped`, `promotion.signaled`는 trace |
| 16 | `directive.applied`, `workspace.unlinked_change_observed` 추가. `plan.deviated`는 [판정 J-163]에 따라 이벤트가 아니다. 지표 투영 테이블은 같은 DB, 커밋 뒤 소비자가 채움 |
| 01·16 | 사람 결정 payload의 `humanOp` 선택 필드 |
| 12 | 도구 호출 종결 기록 하나(first-writer-wins)를 멱등 키와 커널 상태 검사로 지킨다 |
| 12·13 | Run `budget`·`modelRole`·`step`·`guarantees`·`capabilityManifestHash`, ToolCall `requestId`·`messageId`·`index`·`sandbox`·`externalEffect`, NotExecutedReason 확장, `toolcall.completed`(관찰 Nullable J-43, `recovered`, `modelContent`, `fullOutput`, `truncation`, ChangeSet), outcome_uncertain·interrupted의 `detectedChanges`, `replay_started` payload, `run.context_projected`·`run.message_recorded` 필드, `budget.charged` scopes, `p_budget` 열, `daemon.booted.previousEpoch`, TraceKind 표, `runtime_timers.purpose` 목록, commit `traces` 콜백(J-42). `run.resumed` 제거와 부팅 때 awaiting_* 유지(J-38·J-39), replay는 재개 때 재검사 뒤(J-41) |
| 10·11 | `boundary.reached` 7개 경계, `question.delivered.urgency` interrupt·notice·digest(J-52), `acknowledgedFlags`, `agreement.restored.restoredTo`, 권리 마감은 사람이 정한 경우만(J-49) |
| 15 | `inquiry.opened.divergence`, `inquiry.stopped.handover` |
| 10 | J-94 `setting.changed`(governance, 이미 있음), J-95 `check.pinned`·`unpinned`, `question.deferred.deadline` |
| 16 | 지표 DDL을 §3.7로 옮김(`brief_corrections` 포함), `source_cursors` 제거(J-77), 제안 경로는 감독기 IPC, `observer_report.recorded.form`, `view.opened` 대상은 refs, `resumption_check.opened` 행위자 runtime |
| 17·26 | J-67(무결성 실패는 `read_only`, 안전 모드는 크래시 루프 전용), J-68(`helmd.service`, `helm ops verify`, `helm export`), J-71(`push_tokens` 운영 테이블), 백업 manifest `verify`·`producer` |
| 조정자 | J-25(conflict도 `command.rejected`), J-26(11 이름을 08 대응으로), J-27(authority 문자열 저장), J-28(presence `locked`는 모바일만), J-29(`indeterminate`), J-30(`objection.filed`) 채택을 반영했다 |

## 부록 A. 이전 어휘와의 대응

### A.1 helm-kernel-v02 실행 후보 이벤트 13개

| v0.2 | 이 카탈로그 |
|---|---|
| `migration.legacy_choice.captured` | `choice.committed` (행위자 migration, 품질 captured), §3.13.4 |
| `governance.authority.granted` | `grant.issued` (effect class 제외) |
| `epistemic.observation.captured` | `observation.recorded` |
| `normative.choice.opened` | `question.recorded` (kind choice) + `possibility.proposed`. 선택은 결정 때만 생긴다 |
| `normative.choice.qualified` | 별도 이벤트 없음. 선택의 품질은 기록 시점에 계산. 보강은 새 선택으로 대체 |
| `normative.choice.committed` | `choice.committed` |
| `normative.agreement.offered` | `agreement.proposed` |
| `normative.agreement.accepted` | `agreement.confirmed` / `agreement.activated_by_grant` |
| `normative.agreement.renegotiated` | `agreement.renegotiated` |
| `epistemic.completion.submitted` | `result.submitted` |
| `normative.result.accepted` | `acceptance.recorded` |
| `normative.integration.started` | `integration.opened` |
| `normative.integration.completed` | `integration.completed` |

### A.2 커널 v0.2 후보 명령 어휘 41개 (helm-canon-2 §1.9)

| v0.2 명령 | 이 카탈로그의 이벤트 |
|---|---|
| `goal.open`, `goal.revise`, `goal.pause`, `goal.retire`, `goal.achievement_claim`, `goal.achievement_accept` | `goal.proposed`·`activated`, `goal.revision_proposed`·`revised`, `goal.paused`, `goal.retired`, `goal.achievement_claimed`, `goal.achieved` |
| `concern.open`, `concern.reframe`, `concern.resolve`, `concern.reopen` | `concern.opened`, `concern.reframed`, `concern.completed`, `concern.reopened` |
| `observation.capture`, `observation.qualify` | `observation.recorded` (품질은 기록 시 계산) |
| `interpretation.propose`, `possibility.propose`, `claim.propose` | `interpretation.proposed`, `possibility.proposed` |
| `claim.accept` | `finding.promoted` + `finding.confirmed` |
| `claim.contest` | `objection.filed`, 또는 `claim.evidence_linked`(challenges) |
| `claim.mark_stale`, `claim.supersede` | `record.staled`, `record.superseded` |
| `evidence.link`, `evidence.invalidate` | `claim.evidence_linked`, `claim.evidence_linked`(invalidates) / `record.staled` |
| `choice.open`, `choice.qualify`, `choice.commit`, `choice.reopen`, `choice.supersede` | `question.recorded`, (없음), `choice.committed`, `objection.filed` → `concern.reopened`, `choice.committed`(supersedes) + `record.superseded` |
| `agreement.offer`, `agreement.accept`, `agreement.renegotiate`, `agreement.release` | `agreement.proposed`, `agreement.confirmed`, `agreement.renegotiated`, `agreement.released` |
| `run.attach`, `run.status_observe` | `run.started`, `run.*` |
| `exception.raise` | `workunit.scope_exceeded`, `agreement.stop_condition_met`, `question.recorded` |
| `completion.submit`, `completion.correction_request` | `result.submitted`, `acceptance.recorded`(revision_requested) |
| `result.accept`, `result.reject` | `acceptance.recorded`(accepted / rejected) |
| `integration.start`, `integration.verify`, `integration.complete`, `integration.reopen` | `integration.opened`, `obligation.resolved`, `integration.completed`, `obligation.reopened` / `concern.reopened` |
| 실행 후보에서 새로 생긴 `authority.grant`, `agreement.activate`, `legacy.choice.capture` | `grant.issued`, `agreement.activated_by_grant`, §3.13.4 |
| 시나리오 후보 `goal.link`, `obligation.transfer` | `concern.opened`의 `goalId` / `structure.changed`(relocate), `obligation.transferred` |

### A.3 experimental.v0 이벤트 10개

| v0 | 대응 |
|---|---|
| `workspace.initialized` | `project.created` + `goal.activated` (C7: Goal은 버전 있는 레코드) |
| `normative.decision.committed` | `choice.committed` |
| `normative.commitment.created`, `normative.commitment.status_changed` | `agreement.proposed`·`confirmed`, `agreement.*` |
| `epistemic.belief.updated` | `interpretation.proposed` / `possibility.proposed` / `finding.promoted` (C5: 인식 구분을 나눔) |
| `projection.next_action.proposed` | 대응 없음. 금지 (C4) |
| `material.snapshot.observed`, `material.worktree_change.observed` | `observation.recorded` (material_change, watcher git_scan) |
| `experience.resumption.started`, `experience.resumption.completed` | 도메인 이벤트 아님. 복귀 측정은 16 |

sidecar 실험 6개(`*_provided`)도 같은 방식으로 대응한다.

### A.4 helm-kernel-v02 런타임 운영 이벤트 18개

| v0.2 런타임 | 대응 |
|---|---|
| `run.started` | 같은 이름 |
| `run.cancelled`, `run.failed` | `run.ended` (reason cancelled·failed) |
| `run.yielded` | `run.ended` (reason yielded) |
| `steering.applied` | `run.steered` |
| `steering.deferred`, `cancellation.deferred`, `provider.interrupted` | 운영 로그 (도메인·런타임 이벤트 아님) |
| `ui.block` | 휘발 이벤트 / `run.message_recorded` |
| `tool.started`, `tool.finished`, `tool.interrupted`, `tool.outcome_uncertain`, `tool.recovery_recorded` | `toolcall.started`, `toolcall.completed`, `toolcall.interrupted`, `toolcall.outcome_uncertain`, `toolcall.recovered` |
| `gate.opened`, `gate.closed` | `question.recorded`, `question.answered`·`withdrawn` |
| `gate.stale` | `conflict.version_mismatch` (명령 결과) |
| `gate.write_failed` | `command.rejected` |

### A.5 연구 묶음 문서의 후보 어휘 (helm-canon-3 §5.1.6, §5.2.6)

| 후보 | 대응 | 후보 | 대응 |
|---|---|---|---|
| `purpose.confirmed` | `goal.activated` | `request.created` | `workunit.proposed` + `agreement.proposed` |
| `concern.opened` | 같음 | `request.countered` | `agreement.revised` |
| `observation.captured` | `observation.recorded` | `request.withdrawn` | `agreement.declined`·`released` |
| `surprise.detected` | `observation.annotated`(surprise) | `commitment.offered`·`accepted` | `agreement.proposed`·`confirmed` |
| `frame.proposed` | `possibility.proposed`(perspective) | `commitment.renegotiated` | `agreement.renegotiated` |
| `frame.selected` | `concern.reframed` | `commitment.breached` | `agreement.violation_detected` |
| `frame.reopened` | `concern.reopened` | `authority.granted` | `grant.issued` |
| `hypothesis.proposed` | `possibility.proposed` | `authority.exceeded` | `toolcall.blocked` + `workunit.scope_exceeded` |
| `hypothesis.strengthened`·`weakened` | `claim.evidence_linked` (추세는 계산) | `exception.detected` | `workunit.scope_exceeded`, `agreement.stop_condition_met` |
| `evidence.captured`·`qualified`·`invalidated` | `observation.recorded`, (계산), `record.staled` | `exception.resolved_locally`·`escalated` | `workunit.scope_resolved`, `question.recorded` |
| `decision.opened`·`committed`·`reopened` | `question.recorded`, `choice.committed`, `objection.filed` + `concern.reopened` | `direction.changed` | `agreement.renegotiated`, `goal.revised`, `loop.transitioned` |
| `work.started`·`claimed_complete`·`accepted` | `workunit.started`, `result.submitted`, `acceptance.recorded` | `work.correction_requested` | `acceptance.recorded`(revision_requested) |
| `outcome.observed` | `observation.recorded` | `handoff.initiated`·`acknowledged` | 없음 (1인 앱, 실행 재개로 대신) |
| `context.materialized` | `run.context_projected` | `integration.started`·`validated` | `integration.opened`, `obligation.resolved`·`integration.completed` |
| | | `integration.conflict_detected` | `obligation.added`(concern_conflict) |
| | | `baseline.updated` | `choice.committed`, `goal.revised`, `integration.completed` |
| | | `near_miss.recorded` | `observation.annotated`(near_miss) |
| | | `reflection.applied` | `reflection.recorded`, `policy_proposal.applied` |

두 묶음의 후보 43개(중복 6개 제외) 모두 대응이 있거나, 대응하지 않는 이유(handoff: 1인 앱)가 있다.

## 부록 B. 예시 이벤트 흐름

### B.1 UC-07 되돌리기 비싼 선택: 합의(C)와 결과 확인(A)

02 §3.10 기본 흐름을 이벤트로 옮겼다. seq는 예시다. 같은 줄 묶음(┐)은 한 트랜잭션이다. 단계 번호는 02 표의 #이다.

| seq | 단계 | 이벤트 | 행위자 | subject | 비고 |
|---|---|---|---|---|---|
| 101 ┐ | 1 | `observation.recorded` | runtime | ob_1 | utterance("되돌리기 비싸니까 Concern으로…") |
| 102 ┘ | 1 | `concern.opened` | human | cn_A | origin human_designated, 진입 판정 없음 |
| 103 ┐ | 2 | `situation.assessed` | runtime(`declaredBy` rn_0) | sa_1 | complex, autonomous |
| 104 │ | 2 | `loop_plan.adopted` | runtime(`declaredBy` rn_0) | lp_1 | [O, C.commit, A.confirm], I 건너뜀과 이유 |
| 105 │ | 2 | `mode.assigned` | kernel | md_1 | execute |
| 106 │ | 2 | `loop.transitioned` | kernel | lt_1 | ∅ → O, ruleId OPEN |
| 107 ┘ | 2 | `concern.activated` | kernel | cn_A | |
| 110 ┐ | 3 | `toolcall.requested` | runtime | tc_1 | edit, 활성 합의 없음 |
| 111 ┘ | 3 | `toolcall.blocked` | kernel | tc_1 | `denied.agreement_required` |
| 120 ┐ | 4 | `loop.transitioned` | kernel | lt_2 | O → C.commit |
| 121 │ | 4 | `workunit.proposed` | runtime | wu_1 | change |
| 122 │ | 4 | `agreement.proposed` | runtime | ag_1 | rev 1, checkBack |
| 123 ┘ | 4 | `question.recorded` | kernel | qs_1 | agreement_confirm, 권리, 즉시 |
| 124 | 4 | `question.delivered` | runtime | qs_1 | channel app, dv_mac |
| 130 ┐ | 5 | `agreement.confirmed` | human | ag_1 | edits(c4 3KB), basisSeq 124 (결정 조작 1회) |
| 131 │ | 5 | `question.answered` | kernel | qs_1 | 전용 명령으로 닫힘 ([판정 J-124]) |
| 132 │ | 5 | `workunit.started` | kernel | wu_1 | |
| 133 │ | 5 | `run.queued` | runtime | rn_1 | |
| 134 ┘ | 5 | `run.started` | runtime | rn_1 | attempt 1, ownerEpoch 01J…A |
| 140 | 6 | `rollback_point.registered` | runtime | rb_1 | agreementId ag_1, git 커밋 참조 |
| 141 | 6 | `run.context_projected` | runtime | rn_1 | sourceSeq 140 |
| 142 | 6 | `run.message_recorded` | runtime | rn_1 | assistant, toolCallIds [tc_2] |
| 143 | 6 | `toolcall.requested` | runtime | tc_2 | edit (write) |
| 144 | 6 | `toolcall.started` | runtime | tc_2 | agreementRef ag_1@2, 실행 전 커밋 |
| 145 ┐ | 6 | `toolcall.completed` | runtime | tc_2 | |
| 146 ┘ | 6 | `observation.recorded` | runtime | ob_9 | tool_result |
| 147 ┐ | 6 | `toolcall.requested` | runtime | tc_3 | `src/api/client.ts` 편집 |
| 148 ┘ | 6 | `toolcall.blocked` | kernel | tc_3 | `policy.forbidden_resource` (내용 갈래) |
| … | 6 | (편집·테스트 계속) | | | |
| — | 7 | (trace: 진행 요청) | | | 이벤트 아님 |
| 200 ┐ | 8 | `result.submitted` | runtime | rs_1 | 기준 4개, c2는 unverified(강등), integrationCandidates 3개 |
| 201 ┘ | 8 | `question.recorded` | kernel | qs_3 | result_review, 권리, 막지 않음(다음 경계에 전달) |
| 202 | 8 | `question.delivered` | runtime | qs_3 | 검토 창 |
| 210 ┐ | 9 | `acceptance.recorded` | human | ac_1 | conditional, obligationPolicy proceed_all (결정 조작 2회째) |
| 211 │ | 9 | `question.answered` | kernel | qs_3 | |
| 212 │ | 9 | `integration.opened` | kernel | ig_1 | |
| 213 │ | 9 | `obligation.added` ×4 | kernel | io_1~4 | README, 전제 무효화, 아키텍처 그림, 조건 항목 |
| 217 │ | 9 | `obligation.deferred` | kernel | io_4 | 조건 항목, revisitTrigger = 조건 문장 ([판정 J-125]) |
| 218 ┘ | 9 | `agreement.fulfilled` | kernel | ag_1 | |
| 219 | 9a | `obligation.deferred` | human | io_3 | 아키텍처 그림 (선택 조작) |
| 220 | 10 | `obligation.resolved` | kernel | io_1 | 근거 관찰 ob_15 (docs_tests, R-21) |
| 221 ┐ | 10 | `record.staled` | kernel | fd_7 | 장바구니 동기화 Concern의 판단 |
| 222 ┘ | 10 | `obligation.transferred` | human | io_2 | to cn_B |
| 230 ┐ | 11 | `integration.completed` | kernel | ig_1 | WorkUnit integrated |
| 231 ┘ | 11 | `concern.completed` | runtime | cn_A | R-34 (02 §3.10, 14) |
| 240 | 12 | `reflection.recorded` | human | rf_1 | 선택 |

### B.2 UC-03 재시작 복구

| seq | 이벤트 | 행위자 | subject | 비고 |
|---|---|---|---|---|
| 300 | `toolcall.started` | runtime | tc_7 | bash, replay never, 외부 효과 없음, epoch 01J…A |
| — | (WSL 재시작, 데몬 종료) | | | 결과 기록 없음 |
| 301 | `daemon.booted` | runtime | - | epoch 01J…B, previousCleanShutdown false |
| 302 ┐ | `run.interrupted` | runtime (`internal:recovery`) | rn_1 | previousEpoch 01J…A, code crash |
| 303 │ | `toolcall.interrupted` | runtime | tc_7 | cause crash |
| 304 ┘ | `observation.recorded` | runtime | ob_40 | tool_interrupted ("재시작으로 끊김, 부분 실행됐을 수 있음", scratch 꼬리 포함) |
| 305 | `run.started` | runtime | rn_1 | attempt 2, ownerEpoch 01J…B (같은 runId 재개, 12) |
| 306 | `toolcall.requested` | runtime | tc_9 | (이전 epoch의 늦은 결과는 `path.stale_epoch`로 거부) |

## 부록 C. 원천 체크리스트 반영표

### C.1 `helm-canon.md` §21 "09"

| 항목 | 반영 |
|---|---|
| Event 스키마 필드(id, type, occurred_at, actor, authority_basis, concern, subject, payload, provenance{source, tool}, causation_id, correlation_id)와 Event 불변 5 | §3.2 (provenance = `via` + 관찰의 `source`), 필드 규칙 1~8. subject 예외는 규칙 3 |
| Ledger MUST 5, SHOULD 3 | append-only(트리거), 보정은 새 이벤트, 외부 수집 멱등(§3.9.3), 외부 식별자 보존(§3.2 규칙 8), schema version·migration(§3.13), human-readable export(§3.14.3) |
| `fold(apply, ...)` | §3.1 |
| C3 기록 무결성과 내용 타당성 분리, C4 `projection.*` 금지 | §3.10.1, §3.3 규칙 3 |
| 외부 도구 결과 원본 식별자·해시, 감사 Event 무결성과 Actor identity | §3.2 규칙 8, §3.10, `via` |
| projection의 Event cursor, stale·invalidated, projection 간 불일치 = bug | §3.11.5 `headSeq`, `run.context_projected.sourceSeq`, §3.11.2 결정성 검사 |
| 삭제 = 의미적 폐기, 이력 보존 | 지우는 이벤트 없음, blob 가지치기도 해시 보존 |
| deterministic export/import와 provenance | export 있음, import는 복원으로 대신(§3.14.3). 가져오기의 provenance(§3.13.4) |

### C.2 `helm-canon-2.md` §11 "09"

| 항목 | 반영 |
|---|---|
| envelope 필드 13개 | §3.2 (`workspaceId` 대신 `scope.projectId`, `effectiveAt` = `occurredAt`, `subjectRefs` = `subject` + `refs`) |
| DDL 기준선 + 추가 테이블(projection_checkpoints, projection_documents, actors_sessions, adapter_connections, evidence_refs) | `p_checkpoint`, `p_records`(문서 대신 레코드 JSON), 기기·실행은 레코드로(세션 연결은 운영 상태), 어댑터 연결은 운영 상태(13), 근거 참조는 `p_links` + `blobs` |
| 트랜잭션 6단계, `BEGIN IMMEDIATE`, 고장 주입 지점 | §3.8.4 |
| 해시 체인 공식, 손상 시 fail-closed, read-only recovery | §3.2.2, §3.10 |
| 마이그레이션(버전 테이블, 열 추가 + backfill), schema evolution 6, upcaster vs migration Event | §3.13 (해시를 처음부터 가지므로 backfill 불필요) |
| 거부 결과 저장 여부 | D09-3, A09-2 |
| 매 명령 전체 replay 비용 | 투영 테이블(D09-5) |
| JSONL import 규칙 5개, migration report, `ㅇ` fixture | §3.13.4. `ㅇ` 회귀 fixture는 22 |
| 백업: snapshot + evidence manifest + schema versions | §3.14.1 manifest |
| outbox 재개와 전달 표시 → 클라이언트 재전송 | 소비자 커서 + `readEvents(afterSeq)` (§3.8.4, §3.11.5) |

### C.3 `helm-canon-3.md` §8 "09"

| 항목 | 반영 |
|---|---|
| envelope 점검 8: actor, time, subject, 변화 종류(N/E/M), provenance, authority basis, affected entities, invalidation consequence | actor, occurredAt·recordedAt, subject, plane, via, authority, refs. 무효화 결과는 같은 트랜잭션의 `record.staled` 이벤트로 명시 |
| 투영 테이블의 생성 근거(cursor), 누락 정책, 무효화 조건 | 읽기 모델은 `p_checkpoint.last_seq`·`headSeq`. 모델 컨텍스트 투영은 `run.context_projected`(sourceSeq, omitted, invalidationTriggers) |
| 후보 이벤트 43개 누락 점검 | 부록 A.5 |

### C.4 대화 발췌·감사 항목 중 09 담당

| 항목 | 반영 |
|---|---|
| ledger 해시 체인으로 엔진을 거치지 않은 변경 감지 (X3-4-05, X3-4-14) | §3.10, A09-5 |
| 여러 프로세스 동시 쓰기 → 파일 락, 한 줄씩 추가 (X3-4-06, X3-4-15) | 데몬 단일 쓰기(§3.8.1) |
| 대화 기록과 Helm 레코드를 같은 트랜잭션에 (X4 16-6) | A09-7 |
| 사람 결정 대기를 폴링이 아닌 이벤트로 (X4 13-9, d21) | 질문 레코드 + `onCommitted` 알림 + 선도착 답은 질문 레코드에 먼저 저장(backend-oss-research §2.2). 대기 구현은 12 |
| 지속 타이머 (v0.3 08 §10) | `p_timers` (§3.11.3) |
| 중립 이벤트 어휘 (E1-008, audit §3.8) | §3.3 규칙 5, §3.4.12 |
