# 04. UX 화면 상세

- 작성: 2026-10-11, P2 UX
- 상태: 4c 보완판(2026-10-14). 기준 결정 범위는 브리프 결정 1~64이고 조정자 판정(`process/rulings-stage2a.md` §1~§11, J-01~J-275)을 따른다. 화면 ID와 이름은 03 §3.6·§3.12가 정본이다. 명령 의도 이름은 19 메서드 이름과 같고, 메서드 → 10 명령 대응의 정본은 10 §3.11.11 (2)다. 레코드·상태 값은 08, 이벤트는 09, 오류 코드는 19를 따른다. 21의 UI-D02(결정 의도에 `basisSeq`), UI-D03(낙관적 도메인 갱신 금지), UI-D08(선형 텍스트)에 맞췄다.
- 소유: 화면별 목적, 진입 경로, 레이아웃(영역별 내용), 표시 데이터 요구, 상태별 표시, 인터랙션, 문구 예시, 사람 조작 횟수.

## 1. 목적과 범위

### 1.1 목적

구현자가 이 문서만 보고 각 화면을 만들 수 있게 한다. 화면마다 무엇을 어디에 보이고, 어떤 데이터가 필요하며, 어떤 상태에서 무엇이 바뀌고, 사람의 조작이 어떤 명령 의도로 데몬에 가는지를 적는다.

### 1.2 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 화면 목록, 화면 이름, 객체 모델, 상태 라벨, 내비게이션 | 03 |
| 질문 받기·자극 반응·이의 걸기 흐름의 규칙, 알림, 단축키, 접근성, 문구 지침, 오류 문구 정본 | 05 (이 문서의 문구는 05 규칙을 따른 예시다) |
| 컴포넌트, 토큰, 시각화 컴포넌트 구현 | 21 |
| 뷰 생성 규칙, 우선순위 계산, 품질 상태 판정 | 12, 11, 14, 15 |
| 프로토콜 메서드 이름, 오류 코드 | 19 |
| 앱 상태 동기화, 캐시, 오프라인 저장, 라우팅 구현 | 20 |

### 1.3 표시 규칙

03 §1.3과 같다.

## 2. 전제와 결정

### 2.1 전제

| 근거 | 화면에 주는 전제 |
|---|---|
| 결정 10, 32 | 상태 중심. 앱은 데몬이 만든 뷰를 그리고, 사람의 조작을 명령 의도로 보낸다. 앱에 도메인 판정이 없다 |
| 결정 12 | 질문 화면은 게이트, 전달 방식, 임시 가정, 가정 만료점을 보인다 |
| 결정 15 | write·send 전 작업 합의, "완료" 전 결과 확인, 판단 전 근거. 화면 라벨과 버튼이 이 경계를 흐리지 않는다 |
| 결정 18 | 모델이 초안을 쓰고 사람은 반응·수정한다. 빈 양식을 먼저 내밀지 않는다. 원함 탐구에서 대안 몇 개 중 고르기를 만들지 않는다 |
| 결정 2 | 되돌릴 수 있는지는 권한 레이어가 판정한다. 화면에 표시할 때는 출처를 함께 적는다(canon-3 C1) |
| 결정 21, 22, 31, 38 | 원격 접속과 끊김이 일상이다. 모든 뷰에 기준 seq와 신선도가 있다. 재접속하면 저장된 위치 `{storeId, seq}`부터 다시 받는다(19 §3.5) |
| 브리프 §3.5 | "모델이 초안, 사람은 반응" 원칙과 v0.2 실사용 증거를 화면 설계에 반영한다(§2.3). C/A 사람 조작 2회 상한 |
| 결정 42, 47~49 | 휴대폰은 데몬이 서빙하는 웹 앱이고 화면은 03 §3.12·26이 정한다. 이 문서의 뷰 타입은 휴대폰도 같이 쓴다(26 §3.5) |

### 2.2 이 문서의 주요 선택

| ID | 선택 | 표시 | 절 |
|---|---|---|---|
| SC-01 | 복귀 요약은 머리 한 줄 요약과 아홉 절이다: Goal과 바뀐 기준 / 돌아온 뒤 달라진 점 / 왜 중요한가 / 지금 선택이 필요함 / 확인하면 좋은 것 / 진행 중인 작업 / 그대로 두면 / 에이전트가 정한 것(접힘) / 지금 읽지 않아도 됨(접힘). 있을 때만 그리는 블록 넷(미룬 반영 항목, 서버 재시작·복원·복구, 휴대폰에서 줄여 본 항목, 관찰 에이전트)과 끝의 기준 범위·누락 범주가 더해진다 | [제안], ADR 후보 A3 | §3.2 |
| SC-02 | 홈 "지금 주의가 필요한 것"은 설정 `attention.maxVisibleDecisions`(기본 3, 14 `OrchestrationSettings`. 다이얼이 아니다)만큼 카드로 펼치고 나머지는 접는다. 막는 권리 게이트를 먼저 놓고, 접힌 질문 가운데 권리 게이트는 개수와 존재를 한 줄로 항상 보인다(01 §3.7, [판정 J-132]) | [제안], ADR 후보 A5 | §3.1 |
| SC-03 | 연결이 끊겼거나 뷰가 낡았을 때 사람 결정 동작(답하기, 확정, 결과 확인, 이의)은 막는다. 쓰던 답은 초안으로 보존하고 다시 연결되면 사람이 확인한 뒤 보낸다. 대기열로 자동 전송하지 않는다. 예외: 끊기기 직전에 이미 보냈고 결과를 모르는 명령은 다시 연결된 뒤 같은 멱등 키·`basisSeq`로 다시 보내 결과만 확인한다(20 §3.9.7). 데몬이 처음 받지 못했고 그 사이 상황이 바뀌었으면 `3004`로 거부되므로 낡은 결정이 적용되지 않는다 | [제안], ADR 후보 A4 | §3.0.4, §3.0.6 |
| SC-04 | 질문 화면은 원전 Decision Gate 13필드를 고정 표현(canon §17.6 §3)의 순서로 보이되, 질문의 깊이(가볍게 확인 / 일반 / 깊은 검토)에 따라 펼치는 필드 수를 달리한다 | [제안] | §3.4 |
| SC-05 | 결과 확인 화면은 두 단계(결과 확인 → 전체 반영)로 나눈다. 반영 항목이 남으면 "완료"를 쓰지 않는다 | [제안], canon-3 §6.6.7 | §3.12 |
| SC-06 | 자극 보드에서 라운드가 확인하려는 기준은 반응을 마친 뒤에 보인다 | [제안] | §3.9 |
| SC-07 | 자율 진행 중 도구 활동은 한 줄 요약으로 접고, 항상 보일 사건 7종(canon-2 §3.11)만 펼쳐 보인다 | [제안] | §3.10 |
| SC-08 | 작업 합의 화면에 "에이전트가 이해한 것"(의도 재진술) 절을 둔다 | [제안], canon-3 G1 check-back | §3.11 |
| SC-09 | 화면 검토 기준은 01 §3.3.1 금지 경험 X-01~X-15다. 결과 확인은 한 번의 조작 안에서 반영 항목 처리 방침을 고른다(R-OP-3). 맡긴 범위 안의 작업 합의는 확정 질문 없이 활성되고 echo만 보인다(R-OP-2(a)). 복귀 요약은 결정적 절을 먼저 그린다(NFR-P-5). 근거 설명을 확신도 숫자로 대신하지 않는다(X-07) | [제안], 01 §3.3.1 | §3.2·§3.12, 전 화면 검토 |

### 2.3 "모델이 초안, 사람은 반응" 원칙의 근거와 화면 규칙 [결정 18]

v0.2 실사용 기록(canon-2 §6, L2, 감사 보고 §3.3):

- Git만으로 모은 상태는 네 영역 중 세 영역이 unknown이었다. 의미는 사람이 넣은 입력 7개에서 모두 나왔다.
- Inquiry Map을 사람이 직접 고치는 장면은 관찰되지 않았다. 네 템플릿(필드 약 197개, 4,319단어) 대신 사람은 한 문장으로 결정했다.
- 필수 필드를 채우는 양식에 사람이 `summary: ㅇ`, `rationale: ㅁㄴㅇ`을 넣었다. 빈칸을 채우는 형식을 설계자 본인도 우회했다는 기록이다.
- "이 원칙이 깨지면 다 맞아도 안 쓴다"(대화 L1615–1617 정리).

이 근거에서 모든 화면에 적용할 규칙 [제안]:

1. 사람이 무언가를 처음부터 쓰게 하는 빈 입력란을 주 경로에 두지 않는다. Goal, Concern, 작업 합의, 완료 기준, 기준 후보, 이의 사유는 모두 에이전트 초안이나 선택 가능한 항목에서 시작한다. 빈 입력란은 "직접 쓰기" 보조 경로로만 둔다.
2. 사람의 조작은 초안에 대한 반응(그대로, 고쳐서, 아님, 이유 없이 아님)으로 설계한다.
3. 짧은 자연어 수락도 선택·범위·하지 않을 것을 명시한 기록으로 펼쳐 보이되(canon-2 L8), 그 펼친 내용을 다시 양식으로 확인받지 않는다. 정정 경로만 둔다.
4. 필수 필드를 채웠다는 이유로 "근거 갖춤"처럼 보이지 않게 한다. 품질 배지는 데몬의 품질 상태에서만 온다(canon-2 L3, 03 §3.3.6).

## 3. 명세 본문

### 3.0 공통 규칙

#### 3.0.1 화면 기술 형식

각 화면 절은 다음 순서로 적는다: 목적, 진입 경로, 레이아웃, 표시 데이터, 상태, 인터랙션, 문구 예시, 사람 조작 횟수.

- **표시 데이터**: 화면이 받는 뷰 이름과 뷰 모델 타입. 뷰는 데몬이 만든다(12). 앱은 19의 `view.get({view, params, minSeq?})`으로 뷰를 받고, `events.subscribe` 알림의 `invalidates` 태그가 열린 뷰의 `dependsOn`과 겹치면 다시 받는다(19 §3.6). 이 문서는 뷰 이름을 `view:<이름>` 형식으로 적으며, 이름은 19 §3.7.4 카탈로그와 같다. 뷰 모델 타입(19의 `ViewResult.data`)은 이 문서가 소유한다.
- **명령 의도**: 사람 조작이 데몬에 보내는 의도. 이름은 19 §3.7.1 메서드 이름이고, 메서드 → 10 명령 대응은 10 §3.11.11 (2)가 정본이다. params 형식은 19 §3.7.5를 따른다.
- **사람 조작 횟수**: 01·02의 셈법을 따른다. D(결정: 명령 의도를 보내는 조작), I(입력: 자연어로 쓰는 것), 보기(읽기, 이동, 읽음 표시)를 따로 센다. 초안을 고쳐 확정해도 D는 1이다. 자극 반응은 관찰이라 D로 세지 않는다. 이 문서의 절마다 "결정 n"은 D, "입력 n"은 I, "이동"은 보기다.

#### 3.0.2 공통 타입 [제안, 최종 위치는 `@helm/protocol`(19)]

이 절의 타입은 화면과 휴대폰이 함께 쓰는 뷰 모델 타입의 원안이다. `RecordRef`는 한 곳(`@helm/protocol`)에만 두고 12·19·21·26은 그것을 import한다. 레코드 종류와 상태 값은 08 리터럴에서 파생하고 화면 쪽에서 새 값을 만들지 않는다. 화면 표시용으로 묶은 값이 필요하면 08 이름과 겹치지 않는 계산 필드 이름(`…Display`, `…Label`)을 쓴다.

```ts
import type { DomainRecord, AgentRole, QuestionStatus, QuestionKind, Scope, BlobRef } from "@helm/domain";   // 08
import type { CopyKey } from "@helm/ui-language";                                           // 05 §3.10.8

type Seq = number;          // 이벤트 로그의 단조 증가 순번 (결정 31)
type IsoTime = string;      // ISO 8601 UTC (브리프 §3.3). 화면은 로컬 시간대로 표시

/** 데몬이 보내는 사용자용 문장. 키와 인자만 보내고 문장 조립은 클라이언트가 한다(05 §3.10.8) */
interface CopyRef { key: CopyKey; args?: Record<string, string | number> }

/** 08 레코드의 `kind` 리터럴(snake_case) 그대로. 예: "workunit", "result", "obligation", "boundary_item", "toolcall" */
type RecordKind = DomainRecord["kind"];

interface RecordRef {
  id: string;               // <prefix>_<ULID> (08 §3.2)
  kind: RecordKind;
  displayNo: number;        // 03 §3.2.6 표시 번호. 투영이 매긴다(12 §3.5.8)
  title: string;            // 한 줄 요약. 모델 문장일 수 있음 → authoredBy로 구분
  revision?: number;        // 레코드 판(고쳐질 때 증가)
  revisionSeq?: Seq;        // 그 판을 만든 seq
  unseen?: boolean;         // 사람이 마지막으로 본 뒤 바뀐 레코드(21 UnseenDot). 기준은 사용자 확인 cursor와 question.seen
}

type Author =
  | { kind: "human" }
  | { kind: "agent"; role: AgentRole }          // 08: work, verifier, mediator, observer, router, branch. router·branch는 화면에서 "에이전트"
  | { kind: "policy"; policyRef?: string }
  | { kind: "external"; name: string }
  | { kind: "runtime" } | { kind: "kernel" } | { kind: "scheduler" };

type Freshness = "current" | "stale" | "rebuilding" | "failed";

// ViewMeta는 19 `ViewResult`의 봉투 필드(view, key, asOfSeq, generatedAt, freshness, staleReason, omitted, dependsOn)와 같다.
// 각 뷰 모델의 `meta`는 앱 저장소가 봉투를 data 옆에 붙여 둔 것이며, 데몬이 data 안에 다시 넣지 않는다.
interface ViewMeta {
  view: string;             // 예: "home"
  asOfSeq: Seq;             // 이 뷰를 만든 마지막 이벤트 seq (19 ViewResult.asOfSeq)
  generatedAt: IsoTime;
  freshness: Freshness;
  staleReason?: CopyRef;
  omitted?: { category: string; count: number }[];   // 누락 범주 (canon §13.5)
}

/** 화면 배지 이름. 08 품질 플래그 원본(level, contestedBy, stale, supersededBy)에서 계산한다(03 §3.3.6) */
type QualityBadgeDisplay = "insufficient" | "contested" | "stale" | "superseded";
/** 15 SupportGrade의 화면 표시 */
type SupportGradeDisplay = "untested" | "weak" | "consistent" | "confirmed" | "contested";

interface StatementView {
  ref: RecordRef;
  stage: "observation" | "interpretation" | "possibility" | "finding" | "choice";
  text: string;
  authoredBy: Author;
  badges: QualityBadgeDisplay[];  // qualityDisplay 단일값이 아님
  support?: SupportGradeDisplay;  // 판단·기준의 지지 등급(15). 근거 개수는 보이지 않는다
  staleBecause?: string;          // 낡은 이유 한 줄
  correlatedWith?: string[];      // 같은 출처 계열로 병합된 근거(15 §3.4.8 "상관됨"). canon §8.9 원칙 7
}

type Gate = "rights" | "information";
type Delivery = "immediate" | "negotiated" | "mediated" | "scheduled";
/** 03 §3.2.4의 화면 종류. 08 QuestionKind를 묶은 것 */
type QuestionScreenKind = "choice" | "info" | "criterion" | "finding" | "agreement" | "review" | "goal" | "budget" | "recovery" | "policy";

interface ExpiryPoint {
  description: string;            // "본문 2절 작성 시작 전"
  estimatedAt?: IsoTime;          // 데몬이 추정할 수 있으면
  approaching: boolean;           // 만료 여유(다이얼) 안에 들어옴
}

interface QuestionSummary {
  ref: RecordRef;
  kind: QuestionKind;             // 08
  screenKind: QuestionScreenKind;
  gate: Gate;
  concern: RecordRef;
  text: string;                   // 지금 정할 것 / 묻는 것
  whyNow?: string;
  delivery: Delivery;
  status: QuestionStatus;         // 08: pending, delivered, answered, assumed, withdrawn, expired, delegated
  blocking: boolean;
  assumption?: string;            // 정보 게이트의 임시 가정
  expires?: ExpiryPoint;
  deliveredAt?: IsoTime;
  scheduledFor?: { boundary: string } | { at: IsoTime };   // 예약·중재 전달 예정
  promotedToImmediate?: boolean;  // 만료점이 가까워 즉시로 승격됨
  bundleId?: string;              // 같은 경계에 묶여 전달된 질문
  priorityReason?: CopyRef;       // "왜 위에 있나" (05 §3.1.5 question.priority.*)
  estimatedReviewMinutes?: number;
}

interface CommandIntentBase {
  idempotencyKey: string;         // "ik_<ULID>" (19 §3.9)
  basisSeq: Seq;                  // 화면이 본 뷰의 asOfSeq (21 UI-D02, 19 §3.7.2 CommandParamsBase)
}
```

#### 3.0.3 데이터 상태 [제안]

모든 화면은 다음 데이터 상태를 가진다. 화면별 절에는 고유한 빈 상태 문구와 예외만 적는다.

| 상태 | 조건 | 표시 |
|---|---|---|
| 처음 불러오는 중 | `view.get`을 보냈고 아직 결과가 없다(`2006 view.notReady`면 조용히 다시 요청) | 영역별 자리 표시(뼈대). 회전 표시는 300ms 뒤에만 보인다. 1.5초가 넘으면 "서버에서 화면을 받는 중입니다."를 보인다 |
| 캐시로 먼저 보임 | 이전에 받은 뷰가 클라이언트 저장소(20)에 있다 | 캐시를 그리고 상단에 "마지막으로 받은 화면입니다 · 3분 전"을 보인다. 새 스냅숏이 오면 바꾼다 |
| 빈 상태 | 뷰는 왔고 항목이 없다 | 화면별 빈 상태 문구. 빈 상태는 "없음"과 "모름"을 구분한다(canon §8.9 원칙 6). 예: "열린 질문이 없습니다."와 "아직 판정하지 않았습니다." |
| 오류 | 뷰를 만들지 못했다(`freshness: "failed"`) 또는 `view.get`이 오류로 끝났다 | "이 화면을 만들지 못했습니다." + 원인 문장(05 §3.11) + [다시 불러오기]. 다른 화면은 계속 쓸 수 있다 |
| 찾을 수 없음 | 딥 링크·참조의 대상이 없다 | §3.0.5 |

#### 3.0.4 연결·데몬·신선도 상태 [제안]

연결 상태 기계 자체(재접속 간격, 위치 `{storeId, seq}`부터 `caughtUp`까지 다시 받기)는 20·19가 소유한다(19 §3.5, §3.10). 화면은 다음 사용자용 상태로 묶어 보인다. 상태 이름은 canon-2 §3.16의 Connection state(connected / degraded / reconnecting / offline)와 Projection freshness(current / stale / rebuilding / failed)를 따르고, 데몬 쪽 상태를 더했다.

| 사용자용 상태 | 조건(20·26이 판정) | 상단 막대 표시 | 배너 | 결정 동작 |
|---|---|---|---|---|
| 연결됨 | WebSocket 열림, 인증됨, 이벤트 스트림 `caughtUp` | "연결됨 · 서버" (점 + 글자) | 없음 | 가능 |
| 느림 | 연결됨, 응답 지연이 기준(20) 초과 | "연결 느림" | 없음 | 가능. 보내는 중 표시가 길어진다 |
| 다시 연결하는 중 | 끊긴 뒤 재시도 중. 프로토콜 오류(닫힘 1002·1003)는 연속 3회 전까지 이 상태다(규칙 7) | "다시 연결하는 중 · 12초 전 끊김" | `err.connection.reconnecting`: "서버와 연결이 끊겨 다시 연결하는 중입니다. 지금 보이는 화면은 14:02 기준입니다." | 막음. 초안 보존 |
| 서버 PC에 연결할 수 없음 | 끊긴 지 2분이 넘었거나 재시도 6회가 넘었고, `GET /healthz`가 네트워크 오류(이름 찾기·연결 실패)이거나 기기 네트워크가 없음(20 §3.8.9, 26 §3.5.11). 앱은 계속 다시 시도한다(19 §3.10.3) | "연결 안 됨" | `err.connection.serverPcUnreachable`: "서버 PC에 연결할 수 없습니다. 이 기기의 Tailscale이 켜져 있는지, 서버 PC가 켜져 있는지 확인하세요." + [연결 화면 열기]. 서버 PC가 꺼졌을 수 있으므로 작업이 계속되고 있다고 말하지 않는다 | 막음 |
| Helm 서버 응답 없음 | 서버 PC까지는 연결되지만 `GET /healthz`가 502·503·504(Tailscale serve는 응답, Helm 서버 없음) | "Helm 서버 응답 없음" | `err.connection.daemonUnreachable`: "서버 PC까지는 연결되지만 Helm 서버가 응답하지 않습니다. WSL이나 Helm 서버 프로그램이 꺼졌을 수 있습니다." + [연결 화면에서 점검] | 막음 |
| 인증 실패 | 토큰 거부, 폐기된 기기 | "인증 필요" | `err.auth.revoked`: "이 기기의 연결 권한이 없거나 폐기되었습니다. 다시 페어링하세요." | 막음 |
| 키체인 거부 | 20 `blocked(keychain_denied)` | "키체인 접근 필요" | `err.keychain.unavailable` | 막음 |
| SSH 실패 | 20 `blocked(ssh_*)` 네 사유 | "SSH 연결 실패" | 사유별 문구(05 §3.11 `err.ssh.*`) + 연결 화면 점검 2단계 | 막음 |
| 다른 서버 | 20 `blocked(wrong_server)`: 프로필에 고정한 서버 id와 다름 | "다른 서버" | `err.connection.wrongServer` | 막음 |
| 버전 불일치 | 프로토콜 버전이 맞지 않음. 같은 프로토콜 오류(닫힘 1002·1003)가 연속 3회 나옴(규칙 7) | "버전 맞지 않음" | `err.protocol.version` | 막음. 기기에 저장된 마지막 화면은 읽을 수 있다(20) |
| 읽기 전용 | 19 `DaemonMode = readOnly`(17 `read_only`). 사유는 `DaemonStatus.readOnlyReasons`와 `server.modeChanged.reason`: `disk_critical`, `integrity_suspect`, `operator`, `projection_fault`([판정 J-129]), `recovery_failed`([판정 J-178], 시작 복구 실패) | "읽기 전용 · (사유 한 줄)" | 사유별 `err.daemon.readOnly.<사유>`(05 §3.11). 예: 디스크 부족 "서버 디스크 공간이 부족해 새 기록을 쓸 수 없습니다. 서버 PC에서 공간을 비우면 자동으로 풀립니다." 기록 점검 "서버 기록에 손상 의심이 있어 읽기만 할 수 있습니다. 서버에서 `helm ops verify --full` 또는 백업 복원이 필요합니다." + [복구 화면] | 막음 |
| 다시 맞추는 중 | 재접속 직후 저장 위치부터 받는 중(19 `syncing`) 또는 뷰 재생성 중(`rebuilding`) | "맞추는 중" | 없음 | 막음(짧음). 끝나면 자동 해제 |
| 뷰 낡음 | 서버 `freshness`가 `stale`·`rebuilding`·`failed` | 해당 화면 머리에 "이 화면은 14:02 기준입니다 · 이유" | 화면 안 띠 | 그 화면의 결정 동작은 막음 |
| 서버 다시 시작됨 | `hello`의 `server.bootEpoch`가 바뀜 | "서버가 10:02에 다시 시작되었습니다" (1분) | 복구 항목이 있으면 복구 배너 | 다시 맞추는 중을 거친 뒤 가능 |
| 서버 종료 중 | 19 `draining`(`server.shutdown` 알림) | "서버가 곧 다시 시작됩니다" | "서버가 다시 시작하는 중입니다. 보내는 중인 답은 다시 연결된 뒤 확인하세요." | 막음 |
| 안전 모드 | 19 `DaemonMode = safeMode`(런타임 멈춤, 사람 명령은 받음). 사유는 09 `daemon.safe_mode_entered.reason`: `crash_loop` 또는 `restored`(백업 복원 뒤 첫 부팅, [판정 J-152]) | "안전 모드 · 작업 멈춤" | `crash_loop`: "서버가 짧은 시간에 여러 번 비정상 종료되어 안전 모드로 시작했습니다. 에이전트 작업과 예약 실행이 멈춰 있습니다. 질문에 답하고 기록을 볼 수는 있습니다." `restored`: "백업에서 복원한 뒤 처음 시작해 안전 모드입니다. 복원 지점 이후 기록은 없습니다. 멈춰 있던 작업은 자동으로 다시 시작하지 않습니다." 둘 다 + [안전 모드 풀고 작업 다시 시작하기](연결 화면·복구 화면, §3.19·§3.20) | 가능 |

상태 값(상단 막대 문구 키 `label.connection.<상태>`의 `<상태>`이며, 20 `UserConnKind`와 21 `ConnectionUiState`도 이 집합을 쓴다[판정 J-176], [판정 J-228]): 위 표 순서대로 `connected`, `slow`, `reconnecting`, `serverPcUnreachable`, `daemonUnreachable`, `authFailed`, `keychainDenied`, `sshFailed`, `wrongServer`, `versionMismatch`, `readOnly`, `syncing`, `viewStale`, `restarted`, `draining`, `safeMode`.

규칙:

1. 상단 막대의 연결 표시는 모든 화면에서 보인다. 색과 함께 글자로 상태를 쓴다(05 §3.9).
2. 연결이 없거나 뷰가 낡으면 화면은 마지막으로 받은 뷰를 그대로 보이되, 모든 시각과 "지금"을 뜻하는 문구를 기준 시각 문구로 바꾼다. 예: "지금 하는 일" → "14:02에 하던 일".
3. 결정 막기는 서버의 `freshness`가 `current`가 아니거나 연결 상태가 결정 불가일 때만 건다. 클라이언트가 무효화 뒤 다시 받기를 기다리는 짧은 낡음(19 `staleSince`, 약 150ms)으로는 막지 않는다. 그 사이의 경합은 서버가 `3004 command.revisionConflict`로 거부하고 §3.0.5로 처리한다(버튼이 깜박이지 않게).
4. 결정 동작이 막힌 버튼에는 이유를 붙인다: "연결되면 보낼 수 있습니다. 쓰던 답은 저장해 두었습니다."
5. 재접속 후 화면 사이 차이가 있으면 바뀐 항목에 "다시 연결된 뒤 바뀜" 표시를 1분 동안 붙인다.
6. 다시 연결되었을 때 초안이 있으면 그 화면에 "보내지 않은 답 1개가 있습니다. 바뀐 상황을 확인하고 보내세요."를 보인다. 자동으로 보내지 않는다(SC-03).
7. 20의 `protocolError`(닫힘 1002·1003)는 내부 원인이라 사용자용 상태가 아니다. 사용자에게는 "다시 연결하는 중"으로 보이고, 같은 오류가 연속 3회면 "버전 불일치"로 바꾼다([판정 J-228]).

#### 3.0.5 처리됨·찾을 수 없음·낡은 결정 [제안]

| 경우 | 표시 |
|---|---|
| 딥 링크·알림으로 연 질문이 이미 답해졌다 | "이 질문은 09:12에 답했습니다(이 기기 / 다른 기기)." + 답 내용 + "Concern 보기" |
| 가정이 확정되었다(`assumed`). 또는 쓰던 답을 보냈는데 `3008`로 거부됨([판정 J-120]) | "답이 없어 09:00에 임시 가정('도입부는 장면으로')대로 정해졌습니다. 쓰던 답은 이의 초안으로 옮겼습니다." + [이의로 보내기]. 거부 응답의 확정 값(`assumedValue`)을 보이고, 쓰던 답은 이의 걸기(`OVL-CONTEST`)의 이유 칸 초안이 된다 |
| 철회·의미 없어짐 | "이 질문은 더 필요하지 않게 되었습니다. 이유: …" |
| 대상이 없다 | "찾을 수 없습니다. 링크가 잘못되었거나 다른 서버의 기록일 수 있습니다." |
| 결정을 보냈는데 데몬이 낡은 기준으로 거부(`basisSeq` 이후 상태가 바뀜, canon-2 L14 stale gate) | "화면을 연 뒤 상황이 바뀌어 이 답을 적용하지 않았습니다. 바뀐 내용을 확인하고 다시 답하세요." + 바뀐 항목 강조 + 쓰던 답 유지 |

#### 3.0.6 명령 의도 공통 [제안]

1. 모든 결정 의도에는 `CommandIntentBase`(멱등 키, `basisSeq`)를 붙인다.
2. 보내는 동안 해당 버튼은 "보내는 중"으로 바뀌고 같은 버튼은 다시 누를 수 없다. 화면의 상태는 바꾸지 않는다(21 UI-D03).
3. 결과는 뷰 갱신으로 받는다. 받아들여졌으면 "적용됨" 확인 문장을 2초 동안 보인다(동작마다 문장은 각 화면 절).
4. 거부되면 거부 종류에 따라 문장을 보인다(05 §3.11). 거부 세 갈래(내용·자격·경로, 브리프 §3.5)는 사람에게 다음처럼 보인다.

| 거부 종류 | 사람에게 보이는 말 |
|---|---|
| 내용 | 무엇이 규칙에 맞지 않는지와 고칠 방법. 예: "완료 기준 2의 근거가 실제 실행 기록이 아니어서 결과 확인을 받을 수 없습니다." |
| 자격 | 누가 할 수 있는지. 사람 동작에서는 드물다. 예: "이 기기에는 결과 확인 권한이 없습니다(읽기 전용 기기)." |
| 경로 | 앱 오류로 보고 "앱이 잘못된 요청을 보냈습니다. 문제 보고에 기록했습니다."(개발자 보기에서 코드 표시) |

5. 10초 안에 결과가 없으면 "서버가 아직 답하지 않았습니다. 연결 상태를 확인하는 중입니다."를 보이고, 연결이 끊기면 §3.0.4로 넘어간다. 같은 멱등 키로 다시 보내는 것은 20이 처리한다.

#### 3.0.7 공통 카드 내용 [제안, 컴포넌트는 21]

**진행 작업 카드** (canon §17.6 §3 진행 작업 고정 표현, canon-3 §6.6.5)

| 줄 | 내용 | 비고 |
|---|---|---|
| 머리 | WorkUnit 번호, 이름, 상태 라벨(03 §3.3.2), 맡은 에이전트 역할, 단계 "단계 2/4" | 단계는 12(작업)·15 `InquiryProgressView`(탐구)의 `stages` |
| 지금 하는 일 | 의미 있는 현재 행동 한 문장 | "Agent is working…" 같은 문장 금지(canon §17.6 §5) |
| 이 일을 하는 이유 | 연결된 선택·Goal 한 줄과 링크 | |
| 다음 단계 | 예상 다음 행동, 다음 확인 시점, 다음 사람 접점("1절 제출 뒤 결과 확인"), 예상 끝 시각(데몬이 근거 있게 낼 수 있을 때만) | Predictability. 탐구는 시각 예상을 하지 않는다(15 §3.1.3) |
| 맡긴 범위 | 범위 요약 한 줄 + 집행 수준 표시("실제로 막음" / "권고만"). 격리 수준이 S1b면 격리 표지를 붙이고, `flag`가 `pre_read_exposed`이면 "쓰기는 막지만 홈 읽기 범위가 넓습니다"를 함께 보인다(13 §3.6.1, 21 SandboxBadge) | canon-2 L16 |
| 도움이 필요한 조건 | 멈출 조건 1~3개 | |
| 위험·가정 | 쓰고 있는 임시 가정과 알려진 위험 한 줄(15 `assumptionsInUse`, 질문의 임시 가정) | canon-3 §8-04 진행 카드 |
| 마지막 중요한 변화 | 시각 + 한 줄 | |
| 활동 요약 | "읽기 4건 · 검색 2건 · 실제 변경 없음" (§3.10) | 펼치면 감사 깊이 |
| 예산 | "하위 호출 12/30 · 40분/2시간" | 단위는 14·12 |

항상 가능한 동작: 방향 바꾸기, 기준 바꾸기, 범위 좁히기, 안전하게 멈추기, 요약 요청, 근거 열기, 작업 중단(05 §3.6). 원전의 "이관"(다른 담당에게 넘기기)은 동작으로 두지 않는다. 1인 앱에서 이관은 에이전트가 WorkUnit을 새 WorkUnit으로 대체하는 일(08 `superseded`)이고 "에이전트가 정한 것"에 기록되어 이의할 수 있다.

**질문 카드(접힘)** (canon-3 §8-04 collapsed 필드)

| 줄 | 내용 |
|---|---|
| 머리 | 화면 종류 라벨(선택 필요 / 확인하면 좋은 것 / 기준 확인 / 판단 확인 / 합의 확인 / 결과 확인 / Goal 확인 / 예산 확인 / 복구 선택 / 관찰 제안, 03 §3.2.4), 질문 번호, Concern 이름 |
| 본문 | 지금 정할 것 한 문장 |
| 왜 지금인가 | 한 줄 |
| 목적 영향 | 관련 Goal 한 줄 |
| 추천과 가장 강한 다른 선택 | 선택 요청에만. 원함 탐구에서 온 질문에는 없다 |
| 답이 없으면 | 권리 게이트: "답이 있을 때까지 이 작업은 멈춰 있습니다." / 정보 게이트: "임시 가정 '…'으로 계속합니다." |
| 만료점 | 정보 게이트에만. "본문 2절을 쓰기 전까지(약 40분 뒤)" |
| 미뤘을 때의 영향 | 한 줄 |
| 예상 검토 시간 | "약 2분" |
| 전달 | 전달 방식과 시각: "09:10 복귀 요약에서 전달" |

#### 3.0.8 시간 표시

상대 시간과 정확한 시각을 함께 쓴다(canon-3 §6.11). 기본은 상대 시간 + 마우스 올림·초점 시 정확한 시각. 목록의 시각 열은 "14:02 (12분 전)" 형식. 하루가 넘으면 "어제 23:10", 일주일이 넘으면 "10월 3일 14:02". 시간대는 기기의 로컬 시간대(브리프 §3.3).

### 3.1 `SCR-HOME` 홈

**목적**: 지금 사람의 주의가 필요한 것과 모든 Goal·Concern의 상태를 한 화면에서 본다. canon §4.3 F10의 UX 4 질문에 대응한다: 어디로 가고 있는가(Goal 머리) / 무엇이 달라졌고 무엇을 믿는가(마지막 확인 이후 띠) / 내 판단이 필요한 차이는 무엇인가(지금 주의가 필요한 것) / 무엇을 어디까지 맡겼고 결과를 믿어도 되는가(진행 중).

**진입 경로**: 앱 실행(마지막 확인 이후 변화가 기준치 미만일 때), 내비게이션 1번, Mod+1, `G H`, 복귀 요약의 "홈으로".

**레이아웃**

```text
┌ RGN-MAIN ──────────────────────────────────────────────────────────────────┐
│ Goal                                                                        │
│  Goal 2 블로그 글쓰기 방향 정하기 · v4 · 기준 바뀜 1                         │
│  Goal 1 개인 하네스 정리 · v7                                                │
│                                                                             │
│ 마지막 확인(어제 23:10) 이후  선택 필요 1 · 확인하면 좋은 것 2 ·             │
│  에이전트가 정한 것 4 · 바뀐 것 9                         [복귀 요약 보기]   │
│                                                                             │
│ 지금 주의가 필요한 것                                                       │
│ ┌ 선택 필요 · 질문 15 · Concern 12 블로그 글 방향 ─────────────────────┐   │
│ │ 초안을 외부 리뷰어에게 보낼지 정해야 합니다. 오늘 18:00이 리뷰 마감입니다 │   │
│ │ 추천: 1·2절만 보내기 · 가장 강한 다른 선택: 전체 초안 보내기            │   │
│ │ 답이 있을 때까지 보내기 작업만 멈춰 있습니다          약 1분            │   │
│ │ [1·2절만 김OO에게 보내기]  [전체 초안 보내기]  그 밖에 ▾               │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│ ┌ 확인하면 좋은 것 · 질문 14 · Concern 12 ─────────────────────────────┐   │
│ │ 기준 후보 "도입부는 구체적인 장면으로 시작"을 선호 모델에 넣을까요     │   │
│ │ 답이 없으면 이 기준을 임시로 적용해 계속합니다 · 만료: 본문 2절 전       │   │
│ │ [선호 모델에 넣기]  [가정대로 진행]  [근거 보기]  그 밖에 ▾             │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│ 그 밖에 질문 2개 (선택 필요 1: 결과 확인)                   [질문함 열기]   │
│                                                                             │
│ 진행 중 (3)                                                                 │
│  WorkUnit 31 · Concern 12 · 진행 중 · 작업 에이전트                          │
│   지금: 선호 모델 기준으로 본문 1절 초안을 쓰고 있습니다                    │
│   다음: 1절 초안 제출 후 멈춤 · 맡긴 범위: 초안 문서 쓰기만, 보내기 없음     │
│  …                                                                          │
│                                                                             │
│ 다가오는 것                                                                 │
│  오늘 18:00  질문 15 마감(리뷰 일정)                                         │
│  10월 25일   예측 7 확인(첫 화면 불만 절반 이하)                             │
│                                                                             │
│ Concern  [사람 필요만 ▾]                                                     │
│  ▸ Goal 2 블로그 글쓰기 방향 정하기                                          │
│     ▾ Concern 12 블로그 글 방향 · 대기(질문 2)                               │
│  ▸ Goal 1 개인 하네스 정리                                                   │
│  ▸ Goal 없음 (1)                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| 영역 | 내용 |
|---|---|
| Goal 머리 | 활성 Goal마다 한 줄: 이름, 현재 버전, 마지막 확인 이후 바뀐 기준 수, Goal 확인 요청이 있으면 배지. 누르면 `SCR-GOAL` |
| 마지막 확인 이후 띠 | 사용자가 복귀 요약을 마지막으로 확인한 시각과 그 뒤 개수(선택 필요, 확인하면 좋은 것, 에이전트가 정한 것, 바뀐 것). "복귀 요약 보기" |
| 지금 주의가 필요한 것 | 질문 카드(접힘, §3.0.7). 데몬이 정한 순서(막는 권리 게이트 → C/A 접점 → 막힌 정보 게이트 → 나머지, 14 §3.13.5 규칙 6). 설정 `maxVisibleDecisions`(기본 3)만큼 펼치고 나머지는 "그 밖에 질문 n개"로 접는다. 접힌 것 가운데 권리 게이트는 개수와 종류를 그 줄에 항상 보인다(SC-02, [판정 J-132]). 선택 요청 카드는 추천과 가장 강한 다른 선택을 나란히 두고 "그 밖에"를 둔다(21 R2). 카드마다 "왜 위에 있나" 한 줄은 검사 패널에서 |
| 주의 예산 | 오늘 주의 비용 막대(`attentionBudget`, 14 §3.13.8): 사용·예약·남음 세 칸을 칸마다 글자 라벨과 무늬 차이로 그린다. 글자는 "오늘 질문 4 / 6 · 예약 2 · 다음 묶음: 라운드 끝"이다. 예산을 넘어도 막는 권리 게이트는 접지 않는다(14 §3.13.5 규칙 1) |
| 진행 중 | 진행 작업 카드(§3.0.7)의 압축형: 머리, 지금, 다음, 맡긴 범위. 진행 중이 없으면 이 구역을 접는다 |
| 다가오는 것 | 가정 만료점, 질문 마감, 기대 기한, 예측 확인일, 다시 볼 조건 날짜. 7일 이내, 시각 순 |
| Concern 트리 | Goal별 묶음. 각 행: Concern 이름, 상태와 기다리는 것. 상황 유형·현재 루프·모드는 행을 고르면 검사 패널에 보인다(한 줄에 다 붙이지 않는다). 기본은 사람이 필요한 경로만 펼친다(v0.3 09 §4.1). 거르기: 사람 필요만 / 진행 중 / 모두 / 닫힘 포함 |

**표시 데이터**: `view:home`

```ts
interface HomeView {
  meta: ViewMeta;
  goals: { ref: RecordRef; version: number; changedCriteriaSinceAck: number; pendingRevision?: RecordRef }[];
  sinceLastAck: {
    ackedAt: IsoTime | null;
    counts: { choiceNeeded: number; niceToCheck: number; autonomous: number; changes: number };
    briefRecommended: boolean;          // 데몬이 기준치(§3.2)로 판정
  };
  attention: QuestionSummary[];         // 데몬이 정렬. 앱은 순서를 바꾸지 않는다
  maxVisibleDecisions: number;          // 설정 attention.maxVisibleDecisions(14 OrchestrationSettings, 다이얼 아님)
  foldedRights: { count: number; kinds: QuestionScreenKind[] };   // 접힌 권리 게이트(J-132)
  lightWorkResults?: { count: number; question: RecordRef[] };     // 묶어 확인할 가벼운 작업 결과(§3.6.1)
  activeWork: ActiveWorkCard[];
  upcoming: { kind: "assumption_expiry" | "question_due" | "expectation_due" | "prediction_check" | "review_trigger";
              ref: RecordRef; concern: RecordRef; at?: IsoTime; condition?: string }[];
  concernTree: ConcernNode[];
  recoveryCount: number;
  attentionBudget: AttentionBudgetVM;   // 주의 예산 막대(아래 정의, 14 §3.13.8)
}

/** 14 §3.13.8 값을 21 `AttentionBudgetMeter`가 그린다. 단위는 14 §3.13.5의 "주의 비용"이다. 홈·질문함·다이얼 화면이 같은 타입을 쓴다 */
interface AttentionBudgetVM {
  unitLabel: CopyRef;                 // "질문"
  windowLabel: CopyRef;               // "오늘"(타임존 기준 0시~다음 0시)
  used: number;                       // 오늘 전달된 접점 비용 합
  scheduled: number;                  // 다음 경계에 예약된 질문 비용 합
  limit: number;                      // 설정 attention.dailyBudget
  nextBoundaryLabel?: CopyRef;        // "다음 묶음: 라운드 끝"(가장 가까운 예약 경계)
}
interface ConcernNode {
  ref: RecordRef; goal?: RecordRef;
  situation: "clear" | "complicated" | "complex" | "chaotic" | "disorder" | null;  // null = 아직 판정 안 함. 검사 패널용
  currentLoop: string | null;           // 03 §3.3.7 식별자. 검사 패널용
  mode: string | null;                  // 검사 패널용
  status: string;                        // 08 ConcernDisplayStatus
  waitingFor?: CopyRef;
  needsHuman: boolean;
  lastChangeAt: IsoTime;
  children: ConcernNode[];
}
interface ActiveWorkCard {
  workUnit: RecordRef; concern: RecordRef; state: string /* 08 WorkUnitStatus */; agentRole: AgentRole;
  doingNow: string; because?: RecordRef[]; next: string; nextCheckpoint?: string;
  stages?: { purpose: string; state: "done" | "current" | "planned" }[];   // "단계 2/4". 탐구는 15 InquiryProgressView.stages, 작업은 12
  nextHumanTouchpoint?: { kind: QuestionKind; when: string; question?: RecordRef };
  expectedDoneAt?: IsoTime;             // 근거 있게 낼 수 있을 때만(12). 탐구는 두지 않는다
  assumptionsInUse?: RecordRef[];       // 위험·가정 줄
  rangeSummary: string; enforcement: "enforced" | "advisory";   // 한 줄 요약("실제로 막음" / "권고만")
  guarantees: { id: "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8"; level: "enforced" | "detected" | "advisory" | "unavailable" }[];   // 성질별 보장 수준(13 §3.11.5, RunCore.guarantees). 검토 깊이에서 성질별 표로 보인다(21 EnforcementBadge)
  sandboxLevel?: "S0" | "S1b" | "S1" /* 13 격리 수준(13 §3.6.1), 감사 깊이 */;
  flag?: "pre_read_exposed";   // S1b이고 허용 목록 실험 전이면(13 §3.6.1). 쓰기는 막지만 홈 읽기 범위가 넓다
  helpConditions: string[]; lastChange: { text: string; at: IsoTime };
  activity?: { reads: number; searches: number; executions: number; materialChanges: number };
  budget?: { label: string; used: number; limit: number; unit: string }[];
}
```

**상태**

| 상태 | 표시 |
|---|---|
| 빈 상태: Goal 없음(첫 사용) | 프로젝트 폴더가 없으면 "아직 프로젝트 폴더가 없습니다. 폴더를 추가하면 에이전트가 폴더를 읽어 Goal 초안을 만듭니다." + [프로젝트 폴더 추가](`project.create { name, rootPath }`, 19). 폴더가 있고 Goal 초안이 있으면 그 초안 카드(§3.16 [이 Goal로 시작] [고쳐서 시작] [나중에]). 입력창(범위: 새 일)에 이루려는 것을 말해도 같은 초안 카드로 모인다. 빈 양식을 보이지 않는다 |
| 빈 상태: 주의 필요 없음 | "지금 답하거나 정할 것이 없습니다. 진행 중인 작업 3개는 맡긴 범위 안에서 계속됩니다." |
| 빈 상태: 진행 중 없음 | 구역을 접고 "진행 중인 작업이 없습니다." 한 줄 |
| 연결 끊김 | §3.0.4. "지금 주의가 필요한 것"의 버튼은 막고, 진행 중 구역 제목을 "14:02 기준 진행 중"으로 |
| 복구 항목 있음 | 지금 주의가 필요한 것 맨 위에 복구 선택 카드(막는 권리 게이트라 접지 않음) |
| 안전 모드·읽기 전용 | 맨 위에 배너(§3.0.4). 안전 모드면 [안전 모드 풀고 작업 다시 시작하기]로 가는 링크 |
| 가벼운 작업 결과가 여럿 | "가벼운 작업 결과 3개를 한 번에 확인할 수 있습니다 [묶어서 확인]" 카드 하나로 접는다(§3.6.1, [판정 J-132]) |

**인터랙션**

| 동작 | 조작 | 명령 의도 | 결과 |
|---|---|---|---|
| 질문 카드 주 버튼 | 클릭 또는 카드 초점 후 Enter | 종류별(§3.4) | 카드가 "적용됨"으로 바뀐 뒤 목록에서 빠진다 |
| 정보 질문 "가정대로 진행" | 클릭, 또는 Tab으로 버튼에 초점 후 Enter(05 §3.8) | `question.proceedWithAssumption` | 질문 상태 `answered`(답 = 임시 가정) |
| 카드 펼치기 | Space | 없음 | 질문 카드 펼침(§3.4의 펼침 필드) |
| 진행 작업 멈추기 등 | 카드 메뉴 | §3.10 | |
| Concern 행 열기 | Enter | 없음 | `SCR-CONCERN-OVERVIEW` |
| 트리 펼치기·접기 | →, ← | 없음 | 펼침 상태는 기기에 저장(20) |
| 복귀 요약 보기 | 띠의 버튼, `G` `B` | 없음 | `SCR-BRIEF` |

**문구 예시**: 위 와이어프레임. 띠의 개수가 모두 0이면 "마지막 확인(어제 23:10) 이후 바뀐 것이 없습니다."

**사람 조작 횟수**: 질문 하나 처리 = 결정 1(카드 주 버튼), 이동 0. 복귀 요약 열기 = 이동 1. 첫 Goal = 폴더 추가 1 + Goal 확정 1.

### 3.2 `SCR-BRIEF` 복귀 요약

**목적**: 마지막으로 확인한 지점(사용자 확인 cursor) 이후 달라진 점, 그 의미, 그대로 두면 일어날 일, 지금 할 일을 원본 로그를 읽지 않고 파악한다(canon §12.5, canon-2 §3.10, §5.2.4). 복귀 요약은 투영이다.

**진입 경로**: 앱을 열었을 때 `sinceLastAck.briefRecommended`가 참이면 자동으로 연다(기준치는 데몬 판정, 기본 후보: 마지막 확인 뒤 2시간 이상 지났고 바뀐 것이 1개 이상, 또는 선택 필요가 1개 이상 [제안]). 홈 띠, 명령 팔레트 "복귀 요약", `G` `B`, 알림의 예약 전달(복귀 요약 시각), 딥 링크 `helm://brief`.

**레이아웃**: 문서처럼 위에서 아래로 읽는 한 열. 오른쪽에 절 목차.

```text
복귀 요약 · 어제 23:10 이후 (10시간) · Goal 전체 [Goal 거르기 ▾]
지금 정할 것 1 · 확인하면 좋은 것 2 · 가정대로 정해진 질문 1 · 미룬 반영 1      [4절로]

1 Goal과 바뀐 기준
  Goal 2 블로그 글쓰기 방향 정하기: 완료 기준에 "도입부는 장면으로" 임시 적용 중(질문 14)

0 미룬 반영 항목 (1)
  WorkUnit 28 · 글 목차 문서 갱신 · 어제 미룸 · 다시 볼 때: 오늘       [반영 항목 보기]

2 돌아온 뒤 달라진 점 (Concern별, Concern마다 묶음 5개 이하)
  Concern 12 블로그 글 방향
  방향   선택 2 · 작업 합의 1 (맡긴 범위 변화 없음)
  이해   판단 1 강해짐 · 기준 후보 2 새로 생김 · 이의 0
  실제   초안 문서 3개 바뀜 (묶음 2)                       [각 줄 펼치기]

3 왜 중요한가
  짧은 글을 원한다고 했지만 장면 묘사가 있는 긴 글에 계속 좋다고 반응했습니다.
  이 차이 때문에 글 길이 기준을 다시 봐야 합니다.

4 지금 선택이 필요함 (1)
  [질문 15 카드: 초안을 외부 리뷰어에게 보내기]

5 확인하면 좋은 것 (2)
  [질문 14 카드: 임시 가정으로 진행 중] [질문 16 카드]
  답이 없어 가정대로 정해진 질문 (1)
  질문 13 · "참고 자료는 블로그 글만" · 02:10 확정                       [이의]

6 진행 중인 작업 (1)
  WorkUnit 31: 본문 1절 초안 · 다음: 제출 후 멈춤 · 멈출 조건: 외부 자료 인용 필요 시

7 그대로 두면
  09:40쯤 1절 초안이 제출되고 결과 확인을 기다립니다.
  질문 14의 만료점(본문 2절 시작)까지 답이 없으면 임시 가정이 확정됩니다.
  방향을 바꾸기 가장 싼 시점: 본문 2절 시작 전

8 에이전트가 정한 것 (4)  ▸ 루프 전환 2 · 상황 판정 1 · 일반 선택 1
9 지금 읽지 않아도 됨  ▸ 도구 활동 37건 · 형식 수정 3건

휴대폰에서 줄여 본 항목 (2)   (어제 23:40 휴대폰에서 "여기까지 봤음")
  반대 근거: 검증 에이전트 "둘째 문단은 설명이 김" · 깨진 가정: "짧은 글 선호" ▸

기준: 이벤트 4520~4812 · 생성 09:10 · 누락: 도구 입출력 원문, 모델 대화 원문    [원본 기록]

[여기까지 봤음]   이 요약에서 맞지 않는 곳이 있으면 해당 줄의 "정정"을 누르세요.
```

| 절 | 내용 | 원천 |
|---|---|---|
| 머리 한 줄 | 지금 정할 것 수, 확인하면 좋은 것 수, 가정대로 정해진 질문 수, 미룬 반영 수와 4절 링크. 4절이 뒤에 있어도 처음 화면에서 할 일이 보이게 한다(UC-06 "5분 안 파악") | V5-029 |
| 1 Goal과 바뀐 기준 | 범위 안 Goal과 마지막 확인 이후 바뀐 서술·성공 조건·지킬 것·선호 모델 기준. 임시로 적용 중인 것은 그렇다고 쓴다 | canon-3 I4 (1), C12 "Purpose pulse" |
| 0 미룬 반영 항목 | 미룬 반영 항목이 있으면 1절 위에 둔다(발췌3 X3-2-14, 02 AC-07-08). 없으면 절을 그리지 않는다 | |
| 2 돌아온 뒤 달라진 점 | Concern별로 나누고, Concern마다 방향(N) / 이해(E) / 실제(M) 세 줄을 의미 묶음으로 펼친다. 한 Concern의 묶음은 모두 합쳐 5개 이하(02 AC-06-04, canon-2 L5). M 변화는 파일 경로 대신 WorkUnit·선택 영향 기준으로 묶는다. 기대의 "응답 없음" 관찰은 이해(E) 줄에 들어간다(2단계, UC-16) | canon §12.5 Changes, canon-2 §5.2.4 §2 |
| 3 왜 중요한가 | 변화의 의미, 깨진 가정, 말한 것과 반응의 차이, 약한 신호, 이견. 모델이 쓴 평가문은 "에이전트 평가" 표시 | canon §12.5 Assessment |
| 4 지금 선택이 필요함 | 권리 게이트 질문 카드(접힘). 개수 제한 없음 | P05 고정 표현 |
| 5 확인하면 좋은 것 | 정보 게이트 질문 카드. 임시 가정으로 진행 중인 것. 아래에 "답이 없어 가정대로 정해진 질문 n"과 항목별 [이의]를 원인(부재, 데몬 정지)과 관계없이 둔다 | v0.3 09 §4.1, 11 §3.6.3 |
| 6 진행 중인 작업 | 진행 작업 카드 압축형(다음 예정, 멈출 조건) | canon-3 I4 (6) |
| 7 그대로 두면 | 개입하지 않을 때 예상되는 다음 행동, 가정 만료점, 기대 기한(기한이 지나면 "응답 없음"이 기록됨), 방향을 바꾸기 가장 싼 시점. "예측"(투영과 구분, canon-3 C5) | canon §12.5 Projection |
| 8 에이전트가 정한 것 | 종류별 개수만(접힘). 펼치면 항목 목록, 누르면 `SCR-AUTO`(이 범위로 거름) | v0.3 06 §4.3 |
| 9 지금 읽지 않아도 됨 | 접힘. 진행 보고, 도구 활동, 형식 수정 | P05 고정 표현 |
| 관찰 에이전트(접힘, 2단계) | 새 관찰 제안 수, 효과 판정(해로움 판정은 5절 "확인하면 좋은 것"으로 올림), Helm 밖 변경 수, 읽지 못한 외부 세션(16 요구) | 16 §5.2 |
| 서버 재시작·복원·복구(있을 때) | 서버가 꺼져 있던 구간(`restart.downSince`~`restartedAt`, 정상 종료 여부), 복원 표지(백업 id, 복원 지점 seq, "복원 지점 이후 기록 없음", 안전 모드로 시작함, [판정 J-152]), 중단된 run, 결과를 모르는 도구 호출, 자동 재개 결과(12). 1절 위에 둔다. 재부팅만 하고 복구 항목이 없어도 재시작 줄은 보인다 | 12, 17, 09 `store.restored`·`daemon.safe_mode_entered`, canon-3 §6.11 |
| 휴대폰에서 줄여 본 항목(있을 때) | 휴대폰에서 `compact: true`로 "여기까지 봤음"을 누른 범위 가운데 휴대폰 요약판이 한 줄로 줄인 반대 근거·깨진 가정·이견 항목. 다음 데스크톱 복귀 요약에 남는다([판정 J-137], 03 §3.12) | 26 §3.5.5 |
| 기준과 누락 | 이벤트 seq 범위, 생성 시각, 누락 범주, 원본 기록 링크 | canon §13.5, canon-2 §5.2.4 §7 |

4절(지금 선택이 필요함)은 권리 게이트를 맨 위에 둔다(02 AC-06-06). 화면은 결정적으로 만들 수 있는 절(머리 줄, 0, 1, 4, 5, 6, 8)을 먼저 받아 1초 안에 그리고, 모델 평가가 필요한 3·7절은 뒤따라 채운다(01 NFR-P-5). 3·7절은 `pending`으로 받아 "평가를 만드는 중"을 보인다. 부분 뷰는 12 §3.5.9가 준다.

Return Brief 계약 5절(Situation, Changes, Assessment, Projection, Recommendation)과의 대응: Situation = 1·4·6, Changes = 2, Assessment = 3, Projection = 7, Recommendation = 4·5의 순서와 카드 주 버튼. CLI 경험 Brief 순서 6단계(canon-2 §3.10)의 "맡긴 범위 안에서 자동으로 이어질 것"은 6·7에 들어간다.

**표시 데이터**: `view:brief` (파라미터: `goalId?`, `concernId?`(12가 Concern 범위로 만들 때), `sinceSeq?` 기본 = 사용자 확인 cursor)

```ts
interface BriefView {
  meta: ViewMeta;
  coveredFrom: { seq: Seq; at: IsoTime };     // 사용자 확인 cursor (canon-2 §3.10 User-acknowledged cursor)
  coveredTo: { seq: Seq; at: IsoTime };
  goals: { ref: RecordRef; changes: { field: "statement" | "successCriteria" | "preserve" | "preference"; text: string; provisional: boolean; via?: RecordRef }[] }[];
  changes: {
    normative: ChangeGroup[]; epistemic: ChangeGroup[]; material: ChangeGroup[];   // 각 최대 5묶음 + 나머지 접힘
  };
  assessment: { status: "pending" } | { status: "ready"; items: { text: string; authoredBy: Author; refs: RecordRef[] }[] };   // 3절. 평가가 뒤따르면 pending(12 §3.5.9)
  headline: { choiceNeeded: number; niceToCheck: number; assumedWhileAway: number; deferredObligations: number };
  deferredObligations: { ref: RecordRef; workUnit: RecordRef; deferredAt: IsoTime; revisit: string }[];   // 0절
  choiceNeeded: QuestionSummary[];
  niceToCheck: QuestionSummary[];
  assumedWhileAway: { question: RecordRef; assumption: string; assumedAt: IsoTime; choice: RecordRef }[];   // 5절 아래, [이의] 대상은 choice
  activeWork: ActiveWorkCard[];
  prediction: { status: "pending" } | { status: "ready"; items: { text: string; at?: IsoTime; ref?: RecordRef }[] };   // 7절 예측(12 §3.5.9)
  cheapestRedirect?: { description: string; at?: IsoTime };
  autonomous: { kind: string; count: number }[];
  skippable: { category: string; count: number }[];
  restart?: { downSince: IsoTime; restartedAt: IsoTime; clean: boolean };   // 12 §3.5.9가 boots·last_recorded_at에서 계산
  restored?: { backupId: string; upToSeq: Seq; restoredAt: IsoTime; safeModeAfterRestore: boolean };   // 09 store.restored 표지(J-152)
  recovery?: { interruptedRuns: number; unknownOutcomes: number; autoResumed: number; exhausted: number };   // 12
  compactSeen?: { ackedAt: IsoTime; device: RecordRef; items: StatementView[] };   // 휴대폰에서 줄여 본 항목(J-137)
  observer?: { newProposals: number; effects: { verdict: "effective" | "ineffective" | "inconclusive" | "harmful"; proposal: string }[]; outsideChanges: number; unreadableSessions: number };   // 16, 2단계
}
interface ChangeGroup { title: string; count: number; items: RecordRef[]; why?: string }
```

**상태**

| 상태 | 표시 |
|---|---|
| 바뀐 것 없음 | "마지막 확인(어제 23:10) 이후 바뀐 것이 없습니다." + 진행 중 작업과 다가오는 것만 |
| 첫 사용(확인 cursor 없음) | 범위를 "처음부터"로 하고 1·2절 대신 Goal과 열린 Concern 목록을 보인다 |
| 범위가 아주 김(예: 2주) | 2절을 날짜별 소제목으로 나누고 각 절 상위 5묶음만 펼친다. 머리에 "기간이 길어 각 절의 상위 항목만 펼쳤습니다." |
| 서버 재시작 이후 | 1절 위에 "서버가 08:10~10:02 동안 꺼져 있다가 다시 시작되었습니다(정상 종료가 아님). 중단됨으로 정리된 작업 2개가 있습니다." + 복구 화면 링크 |
| 백업 복원 이후 | 1절 위에 "10월 11일 04:00 백업으로 복원했습니다. 복원 지점(이벤트 4520) 이후 기록은 없습니다. 서버는 안전 모드로 시작해 멈춰 있던 작업을 자동으로 다시 시작하지 않았습니다." + [복구 화면]([판정 J-152]) |
| 낡음 | 요약을 연 뒤 새 이벤트가 오면 머리에 "요약을 연 뒤 3개가 더 바뀌었습니다 [다시 만들기]". 자동으로 바꾸지 않는다(읽는 도중 내용이 움직이지 않게). 앱은 이 뷰를 무효화 뒤 자동 다시 받기 대상으로 두지 않고(19 `untrackView`), 새 변화 수만 `events` 알림에서 센다 |

**인터랙션**

| 동작 | 조작 | 명령 의도 | 결과 |
|---|---|---|---|
| 여기까지 봤음 | 버튼(초점 후 Enter) | `brief.acknowledge { upToSeq: coveredTo.seq, note?, compact? }`(휴대폰은 `compact: true`) | 사용자 확인 cursor가 바뀐다. 홈의 띠가 0으로. 이벤트 09 `brief.acknowledged` |
| 줄 정정 | 줄의 "정정" | `brief.correct { line, note }` | 요약 오류 기록. 원본 문제인지 투영 문제인지 나중에 구분하는 자료(canon-2 §3.18 Situation recovery). 16이 집계 |
| 질문 카드 | §3.1과 같음 | | |
| 묶음 펼치기 | Enter | 없음 | 묶음 안 레코드 목록 |
| 원본 기록 | 링크 | 없음 | `SCR-RECORD` (seq 범위로 거름) |

"여기까지 봤음"은 읽었다는 표시이며 이해했다는 주장과 같지 않다(canon-2 §3.10). "결과 확인"과 헷갈리지 않게 "확인"이라는 말을 쓰지 않는다(02의 문구와 같음). 누른 뒤에 선택적으로 한 줄 입력("다음에 할 일을 한 줄로 적어 둘 수 있습니다")을 보인다. 이 입력은 check-back(canon-3 G1) 용도이며 비워 둘 수 있다. 입력이 있으면 관찰로 기록되고 다음 복귀 요약 1절 위에 "지난번에 적은 다음 할 일"로 보인다.

**사람 조작 횟수**: D 0(여기까지 봤음은 보기, 01 §3.5.2). 질문 처리는 질문마다 D 1.

### 3.3 `SCR-INBOX` 질문함

**목적**: 사람 행동이 필요한 모든 요청(03 §3.2.4)을 한곳에서 보고 처리한다.

**진입 경로**: 내비게이션 2번, Mod+2, `G I`, 홈 "질문함 열기", 알림, 트레이.

**레이아웃**: 왼쪽 목록, 오른쪽 선택한 질문(`SCR-QUESTION`) 두 칸.

```text
┌ 질문함 ───────────────────────────────┬ 질문 15 ───────────────────────────────┐
│ [모두 6] [선택 필요 1]                 │ (SCR-QUESTION)                         │
│ [확인하면 좋은 것 3] [기타 2]          │                                        │
│ 거르기: Goal ▾ Concern ▾               │                                        │
│                                        │                                        │
│ 지금 정할 것                           │                                        │
│ ● 선택 필요 · 질문 15 · Concern 12      │                                        │
│   초안을 외부 리뷰어에게 보낼지 정하기   │                                        │
│   즉시 전달 · 09:10 · 오늘 18:00 마감   │                                        │
│ 확인하면 좋은 것                       │                                        │
│ ○ 확인하면 좋은 것 · 질문 14 · 임시 가정│                                        │
│   만료: 본문 2절 전 (약 40분)           │                                        │
│ 함께 답할 수 있는 묶음 (라운드 3 끝)   │                                        │
│ ○ 질문 16, 17 · Concern 9              │                                        │
│ 곧 전달될 것 (2) ▸                      │                                        │
│ 최근 답한 것 (5) ▸                      │                                        │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

| 구역 | 내용 |
|---|---|
| 거르기 칩 | 모두 / 선택 필요(권리 게이트) / 확인하면 좋은 것(정보 게이트와 기준 확인) / 기타(합의 확인, 결과 확인, Goal 확인, 판단 확인, 예산 확인, 복구 선택). 개수 표시 |
| 지금 정할 것 | 전달됨(`delivered`) 상태의 권리 게이트 질문. 데몬 순서 |
| 확인하면 좋은 것 | 전달됨 상태의 정보 게이트 질문. 임시 가정과 만료점을 행에 보인다 |
| 함께 답할 수 있는 묶음 | 같은 작업 경계에 예약되어 함께 전달된 질문(`bundleId`). 묶음 하나를 열면 질문들이 한 화면에 차례로 보인다. 같은 경계의 막지 않는 권리 게이트(결과 확인, Goal 확인)도 여기로 온다([판정 J-132]) |
| 곧 전달될 것 | 기록되었지만 아직 전달 전(`pending`)인 질문. 기본 접힘. 각 행에 "다음 라운드 끝에 전달 예정", "중재자가 전달 시점을 정함" 같은 예정 표시. 사람은 전달 전에도 열어 답할 수 있다(협상 방식과 같은 효과) |
| 최근 답한 것 | 최근 7일 `answered`·`assumed`. 각 행에 답과 그 영향 한 줄 |

**표시 데이터**: `view:inbox` (파라미터: 거르기)

```ts
interface InboxView {
  meta: ViewMeta;
  delivered: QuestionSummary[];       // 데몬 정렬
  bundles: { bundleId: string; boundary: string; questions: QuestionSummary[] }[];
  pending: QuestionSummary[];         // 전달 전
  recent: (QuestionSummary & { answerSummary: string; answeredBy: "human" | "assumption"; impact?: string })[];
  counts: { all: number; choice: number; check: number; other: number };
  attentionBudget: AttentionBudgetVM;   // 질문함 머리 막대(§3.1)
}
```

**상태**

| 상태 | 표시 |
|---|---|
| 빈 상태 | "답하거나 정할 것이 없습니다." 곧 전달될 것이 있으면 "곧 전달될 질문 2개가 있습니다(다음 라운드 끝)." |
| 질문이 많음 | 목록은 가상 스크롤. 묶음은 묶음 단위로 한 행 |
| 다른 기기에서 답함 | 행이 "다른 기기에서 답함"으로 바뀐 뒤 2초 후 최근 답한 것으로 옮긴다 |
| 주의 예산 소진 | 오늘 예산을 넘었으면 막지 않는 정보 질문을 다음 검토 창으로 미뤄 보이고, 머리 막대에 글자로 쓴다. 막는 권리 게이트는 그대로 머리에 둔다(14 §3.13.5 규칙 2) |

**인터랙션**: 행 선택 = 오른쪽에 `SCR-QUESTION`. J/K 이동, Enter로 오른쪽 초점. 묶음 행 Enter = 묶음 모드(§3.4 "묶음 답하기").

**사람 조작 횟수**: 이동 1(행 선택) + 질문별 결정 1. 묶음도 질문 수만큼 센다(01 §3.5.2).

### 3.4 `SCR-QUESTION` 질문

**목적**: 질문 하나를 읽고 답한다. 종류가 합의 확인·결과 확인·Goal 확인·판단 확인·복구 선택이면 해당 화면(`SCR-AGREE`, `SCR-REVIEW`, `SCR-GOAL`, `SCR-EVIDENCE`, `SCR-RECOVERY`)으로 넘기고, 기준 확인은 이 화면에서 처리하되 자극 보드 링크를 둔다.

**진입 경로**: 질문함 행, 홈·복귀 요약 카드 펼치기, 알림, 딥 링크 `helm://question/<id>`, Concern 개요의 열린 질문.

**레이아웃: 선택 요청(권리 게이트)** — 예시의 "외부 리뷰어에게 보내기"는 MVP 밖 send다(MVP의 send는 git push, 01 OQ-07). 화면 구성은 send 종류와 관계없이 같다. 권리 게이트 허락 카드는 실행할 인자(대상, 받는 사람, 파일)를 미리 보이고 "인자 고쳐 허락"(11 `approve_edited`)을 둔다.

```text
선택 필요 · 질문 15 · Concern 12 블로그 글 방향 · 즉시 전달 09:10
──────────────────────────────────────────────────────────────
지금 정할 것   초안을 외부 리뷰어(김OO)에게 보낼지 정해야 합니다. 지금 정하지 않으면 리뷰가 다음 주로 밀립니다
왜 지금인가    리뷰 일정이 오늘 18:00에 마감됩니다. 넘기면 다음 리뷰는 다음 주입니다
관련 Goal      Goal 2 블로그 글쓰기 방향 정하기
답이 없으면    보내기 작업만 멈춰 있습니다. 다른 작업은 계속됩니다
추천           1절과 2절 초안만 보내기 (3절은 아직 근거 확인 중)
다른 선택      전체 초안 보내기 · 이번 리뷰 건너뛰기 · 요약만 보내기 (+1 ▸)
핵심 근거      ▸ 1절·2절은 선호 모델 기준 3개를 모두 맞춤(관찰 21, 24)
아직 모르는 점 ▸ 리뷰어가 다룰 수 있는 분량
되돌릴 수 있나 보낸 뒤에는 되돌릴 수 없습니다 (권한 레이어 판정)
미뤘을 때      리뷰가 다음 주로 밀립니다
다시 볼 조건   리뷰 의견이 선호 모델과 반대로 나오면 이 선택을 다시 봅니다
정하면 생기는 일 ▸ 보내기 1건, 응답 기대(기한 10월 13일 18:00) 기록
──────────────────────────────────────────────────────────────
[1·2절만 김OO에게 보내기]  [전체 초안 보내기]  [보내지 않기]
그 밖에: 범위 줄여 허락 · 기준 고치기 · 질문 다시 쓰기 · 먼저 알아보기 · 미루기 · 이의   [근거 보기]
```

**레이아웃: 정보 질문(정보 게이트)**

```text
확인하면 좋은 것 · 질문 14 · Concern 12 · 예약 전달(복귀 요약) 09:10
──────────────────────────────────────────────────────────────
묻는 것        기준 후보 "도입부는 구체적인 장면으로 시작"을 선호 모델에 넣을까요
근거           도입부 자극 3개에 대한 반응(관찰 21, 24, 27) · 반대 반응 0
답이 없으면    이 기준을 임시로 적용해 다음 자극과 초안을 만듭니다 (임시 가정)
만료점         본문 2절 작성 시작 전 · 약 40분 뒤
               이 시점을 넘기면 답이 바뀌었을 때 되돌리는 비용이 커집니다
막힘           아니요. 답이 없어도 작업은 계속됩니다
──────────────────────────────────────────────────────────────
[선호 모델에 넣기]  [가정대로 진행]  [넣지 않기]
그 밖에: 기준 고쳐서 넣기 · 자극 보드에서 더 보기 · 질문 다시 쓰기 · 미루기 · 이의
```

**필드와 깊이** [제안]: 원전 Decision Gate 13필드(canon §12.4)와 고정 표현(canon §17.6 §3)의 대응. 깊이는 데몬이 질문에 붙인다(`depth`, 11이 정함). 깊이별로 처음부터 펼친 필드(○)와 접힌 필드(▸)를 정한다.

| Gate 필드 | 화면 이름 | 가볍게 확인 | 일반 | 깊은 검토 |
|---|---|---|---|---|
| Question | 지금 정할 것 / 묻는 것 | ○ | ○ | ○ |
| Why now | 왜 지금인가 | ○ | ○ | ○ |
| Purpose | 관련 Goal | ▸ | ○ | ○ |
| Recommendation | 추천 | ○ | ○ | ○ |
| Options | 다른 선택(현상 유지 포함, 모두. 접힌 것은 "+n") | ▸ | ○ | ○ |
| Criteria | 기준 | ▸ | ▸ | ○ |
| Evidence | 핵심 근거(지지와 반대 근거를 함께) | ▸ | ○ | ○ |
| Uncertainty | 아직 모르는 점 | ▸ | ○ | ○ |
| Consequences | 결과(지역·전체 영향) | ▸ | ▸ | ○ |
| Reversibility | 되돌릴 수 있나(출처 표시: 권한 레이어) | ○ | ○ | ○ |
| (canon §12.13) 되돌리는 방법 | 되돌리는 방법(권한 레이어·도구 선언이 줄 때만) | ▸ | ▸ | ○ |
| (canon §12.13) 이해관계자와 결정 권한 | 두지 않는다. 1인 앱이라 결정 권한은 언제나 사용자다(결정 24). 남에게 영향이 가는 행동은 권리 범주 `affect_others`·`speak_for_user`로 "왜 사람이 정하나" 줄에 보인다 | - | - | - |
| Alternative | "그 밖에"의 먼저 알아보기·에이전트가 정하게 두기·미루기 | 메뉴 | 메뉴 | 메뉴 |
| Commitment | 정하면 생기는 일 | ▸ | ▸ | ○ |
| Reopen trigger | 다시 볼 조건 | ▸ | ○ | ○ |
| (v0.3) 답이 없으면, 만료점, 막힘 | 그대로 | ○ | ○ | ○ |
| (P02) 미뤘을 때의 영향 | 미뤘을 때 | ▸ | ○ | ○ |

- Criteria(기준), Consequences(결과), Commitment(정하면 생기는 일)는 08 Question의 `criteria`·`consequences`·`commitmentPreview`에서 읽는다. 값이 비어 있으면 칸을 그리지 않는다(빈 칸이나 "없음"을 보이지 않는다).
- 반대 근거는 접힌 상태에서도 개수와 가장 강한 것 한 줄을 보인다(canon §12.12 금지 3 "추천만 강조하고 반대 증거를 숨김").
- "되돌릴 수 있나"는 권한 레이어의 판정 값이 있을 때만 보이고 "(권한 레이어 판정)"을 붙인다. 값이 없으면 "판정 없음"으로 쓴다. Helm은 이 값을 계산하지 않는다(결정 2, canon-3 C1).
- 원함 탐구에서 온 질문(기준 확인 등)에는 "추천"과 "다른 선택" 필드가 없다(결정 18, v0.3 06 §3.4). 선택지를 보여 주고 고르게 하는 형태로 바꾸지 않는다.
- 선택 요청의 다른 선택은 개수를 줄이지 않는다. 대비 압축은 순서만 정한다(v0.3 04 §4.7). 처음에는 추천과 가장 강한 다른 선택을 보이고 나머지는 "+n"으로 접되 펼쳐서 고를 수 있다(canon-2 R2).
- 선택지가 구조화된 범위(`scope: Scope`, 08)를 가지면 그 범위를 커널 값 그대로 보인다(대상 경로, 허용 행동, send 대상). 사람이 이 선택지를 직접 고르면 뒤따르는 합의가 이 범위 안일 때 합의 확인 질문이 생기지 않는다(01 R-OP-2(a), [판정 J-133]). 화면은 버튼 아래에 "이 범위 안의 작업은 다시 묻지 않습니다"를 쓴다.
- 선택이 판단을 근거로 하면 "정하면 생기는 일"에 "판단 17도 확인됩니다"를 쓴다. 그 판단 확인 질문은 이 선택 요청에 묶여 같은 조작으로 닫힌다(11·14).

**범위 변경·권리 행동 카드**(`scope_change`, `send_approval`): 커널 구조 값과 모델 문장을 나눠 보인다. 머리 아래에 "현재 맡긴 범위 → 요청 범위" 표를 두고 바뀌는 항목(경로, 행동, 네트워크 대상, send 대상)만 강조한다. 값은 커널이 계산한 것이며(11 §3.2), 에이전트의 설명은 "에이전트 설명" 칸에 따로 둔다. 허락 버튼은 실행할 인자의 지문에만 유효하다(11 §3.14). 인자가 길어 잘렸으면 "전체 보기"를 열기 전에는 허락 버튼이 꺼져 있고, 제어 문자·양방향 문자·폭 없는 문자는 코드 포인트 칩으로 보인다(18 §3.11.6, 21 `ArgsView`). 허락에 붙이는 자유 문장 조건은 두지 않는다. 실행 인자를 바꾸려면 "인자 고쳐 허락"이나 "범위 줄여 허락"을 쓴다(실행에 효과가 없는 조건을 사람이 조건부 허락으로 믿지 않게). `send_approval` 카드는 같은 run이 웹 내용을 본 뒤(`taint.web`)에 만든 요청이면 머리에 "웹 내용을 본 뒤의 요청" 표시를 붙인다. 이 요청은 미리 정한 정책이 있어도 사람에게 묻는다(01 NFR-S-7, [판정 J-190] (3)). 브라우저의 비-GET 요청, 파일 업로드, 합의 밖 호스트 이동도 같은 카드로 올라오며, 호스트는 "네트워크 대상" 줄에 쓴다.

**행동 버튼** [제안, 규칙은 05 §3.1]

| 질문 종류 | 주 버튼(최대 3개) | "그 밖에" 메뉴 |
|---|---|---|
| 선택 요청(권리 게이트, 밖으로 보내기·돈 쓰기·대리 발언 같은 실행 허락) | 대상과 효과를 쓴 허락 버튼(추천안), 다른 선택 허락 버튼 하나, "(대상)을 하지 않기" | 인자 고쳐 허락(11 `approve_edited`), 범위 줄여 허락(11 `narrow_scope`), 기준 고치기, 질문 다시 쓰기, 먼저 알아보기, 미루기, 이의 |
| 선택 요청(방향 결정, 권리 게이트 [판정 J-131]) | 추천대로 정하기, 가장 강한 다른 선택으로 정하기, 고쳐서 정하기 | 기준 고치기, 질문 다시 쓰기, 먼저 알아보기(구분 확인), 에이전트가 정하게 두기(사람이 명시적으로 고를 때만), 미루기(조건까지), 이의 |
| 정보 질문 | 답(종류에 맞는 형태), 가정대로 진행, 반대 답(예: 넣지 않기) | 고쳐서 답, 질문 다시 쓰기, 미루기, 에이전트가 정하게 두기, 이의 |
| 기준 확인 | 기준이 하나면 선호 모델에 넣기, 가정대로 진행, 넣지 않기. 여러 기준이 묶인 질문이면 항목별로 넣기·고쳐서 넣기·넣지 않기를 고른 뒤 "고른 대로 보내기" 1회(D 1, [판정 J-23]) | 기준 고쳐서 넣기, 자극 보드에서 더 보기, 미루기, 이의 |
| 예산 확인(`budget_extension`) | 늘리기(데몬이 낸 추천 양, 예: "예산 15분 늘리기"), 여기까지 결과로 제출받기, 범위 줄여 계속 | 미루기, 이의. 진행 요약 형식과 선택지 값은 14 §5.3 12행(`recommendedExtra`, `alternative: narrow_scope \| stop_here`), 문구 키는 05 §3.6.4 |

`[승인]`, `[거절]`, `[확인]`, `[계속]`만 있는 버튼 줄은 만들지 않는다(canon-2 §3.7, §3.19 금지 5). "그 밖에" 메뉴의 기준 고치기·질문 다시 쓰기·먼저 알아보기·미루기는 모든 선택 요청에 항상 있다(감사 보고 §3.4 A15). 홈·작업 카드처럼 줄인 카드도 "그 밖에"를 둔다(21 §3.9 R2, 11 필수 선택지).

**묶음 답하기**: 묶음으로 열면 질문을 차례로 한 화면에 쌓아 보인다. 질문마다 행동을 고르고 맨 아래 "고른 대로 보내기"를 누른다. 앱은 질문마다 명령 하나씩을 같은 멱등 키 묶음으로 보내고, 사람 조작은 질문 수만큼 센다(01 §3.5.2 "묶어 답하기"). 고르지 않은 질문은 그대로 남는다. 묶음 전체 "모두 가정대로 진행"은 정보 게이트 질문만 있을 때만 보인다.

**답한 뒤(선택 영향 표시, canon-2 §3.7 impact echo)**

```text
적용됨 · 질문 15
이 선택으로 바뀐 것
  · 1·2절 초안을 김OO 리뷰어에게 보냈습니다 (보내기 1건)
  · 응답 기대를 기록했습니다: 10월 13일 18:00까지. 기한이 지나면 "응답 없음"이 기록됩니다
다시 볼 조건
  · 리뷰 의견이 선호 모델과 반대로 나오면 다시 봅니다
[Concern 보기]  [질문함으로]
```

영향 표시는 데몬이 결과로 돌려준 변화 목록(`impact`)을 그대로 보인다. 앱이 영향을 추측하지 않는다. 사용자의 개입 뒤 영향과 후속 약속을 보이지 않는 것은 금지 상호작용이다(canon §12.12 금지 7).

**표시 데이터**: `view:question` (파라미터: `questionId`)

```ts
interface QuestionView {
  meta: ViewMeta;
  q: QuestionSummary & {
    depth: "light" | "normal" | "deep";
    goal?: RecordRef;
    recommendation?: OptionView;          // 원함 탐구 출처면 없음
    options?: OptionView[];               // 현상 유지 포함. 대비 압축 순서
    criteria?: string[];
    evidence?: { supporting: StatementView[]; challenging: StatementView[] };
    unknowns?: string[];
    consequences?: string[];
    reversibility?: { text: string; source: "permission_layer" } | null;
    commitmentPreview?: string[];         // 정하면 생기는 일
    reviewTrigger?: string;
    delayImpact?: string;
    answerShape: AnswerShape;              // 정보 질문의 답 형태
    origin: { loop: string; inquiry?: "fact" | "want" | "possibility" | "outcome" };
    alsoAskedBy?: RecordRef[];             // 중복 질문 병합 기록 (canon §12.12 금지 8)
    currentScope?: Scope; requestedScope?: Scope;   // scope_change의 커널 구조 값(08 Scope). 화면은 칸별 차이만 강조(21 ScopeDiff)
    action?: { tool: string; args: { text: string; truncated?: { totalBytes: number; full: BlobRef } } };   // send_approval의 실행 인자. 잘렸으면 전체 보기 전 허락 버튼 끔
    agentExplanation?: string;             // 모델 설명. 커널 값과 다른 칸에 둔다
    bundledFinding?: RecordRef;            // 이 선택과 함께 확인되는 판단
    reasons: CopyRef[];                    // 08 QuestionReason → question.reason.*
  };
}
interface OptionView { id: string; text: string; gains?: string; losses?: string; actionLabel: string /* 대상·효과를 쓴 버튼 문구 */; isStatusQuo?: boolean;
                     scope?: Scope /* 08 선택지 Scope를 커널 값 그대로(J-133) */ }
type AnswerShape =
  | { kind: "yesNo"; yesLabel: string; noLabel: string }
  | { kind: "pickOne"; choices: { id: string; label: string }[] }     // 사실 질문(예: 참고 범위)에만. 원함 탐구 금지
  | { kind: "text"; placeholder: string }
  | { kind: "value"; unit?: string };
```

**명령 의도** (메서드는 19 §3.7.1, params는 19 §3.7.5, 답 값은 11 `AnswerValue`·`ResponseOptionId`. 10 명령 대응은 10 §3.11.11 (2))

| 동작 | 메서드 | params의 답(11 `AnswerValue`) |
|---|---|---|
| 허락 | `question.answer` | `{ option: "approve" }` |
| 인자 고쳐 허락 | `question.answer` | `{ option: "approve_edited", editedArgs, editedFingerprint }`. 인자 편집기가 고친 인자를 blob으로 올리고 지문을 함께 보낸다. 실행은 원 호출에서 결정적으로 만든 새 도구 호출이 승인을 소진한다([판정 J-117], [판정 J-121]) |
| 하지 않기 | `question.answer` | `{ option: "deny" }` |
| 추천대로 정하기 | `question.answer` | `{ option: "accept_recommendation" }` |
| 다른 선택으로·고쳐서 정하기 | `question.answer` | `{ option: "answer", value?, edits? }` |
| 범위 줄여 진행, 범위 줄여 허락 | `question.answer` | `{ option: "narrow_scope", instruction }`. 권리 허락 질문에서는 "범위 줄여 허락"이라 부르고, 에이전트가 줄인 인자로 새 허락 질문을 낸다(11 §3.2.3) |
| 기준 고치기 | `question.answer` | `{ option: "modify_criteria", changes }` |
| 확정·거절(후보 확인) | `question.answer` | `{ option: "confirm", edits? }` / `{ option: "reject", reason? }`. 여러 기준이 묶인 `criterion_confirm`은 `{ option: "confirm_items", items: [{ key, decision: confirm \| reject \| keep, edits?, weight? }] }`(10이 기준별로 펼친다. 고쳐서 넣기(`edits`)와 무게(`weight`)는 `decision`이 `confirm`인 항목에만 싣는다 [판정 J-258·J-262·J-263]) |
| 가정대로 진행 | `question.proceedWithAssumption` | (`accept_assumption`. 권리 게이트면 3001 `policy.answer_option_not_allowed`) |
| 질문 다시 쓰기 | `question.requestReframe` | `note` |
| 먼저 알아보기 | `question.requestInquiry` | `note?` (`experiment_first`) |
| 에이전트가 정하게 두기 | `question.delegate` | 결과는 질문 상태 `delegated`와 에이전트가 정한 것(`whyNotAsked.kind = "delegated_by_human"`). 정보 게이트와 방향 선택 권리 게이트([판정 J-131])에서 사람이 명시적으로 고를 때만 보인다. send·범위 확장·결과 확인 권리 게이트에는 두지 않는다([판정 J-201]) |
| 미루기 | `question.defer` | `until`: 11 §3.18 Trigger(다음 작업 경계 `next_work_boundary` / 돌아왔을 때 `user_return` / 시각 / 조건 문장). 권리 게이트는 "답이 있을 때까지 멈춤"이 유지됨을 알린다. 미루기 선택지마다 만료 경고 여부를 정한다. 시각으로 미루면 미룬 시각보다 만료점이 먼저 오는 막지 않는 질문(정보 게이트)에 "만료점이 먼저 와서 임시 가정 '…'으로 계속합니다"를 미루기 화면에 경고로 보인다. 다음 작업 경계·돌아왔을 때·조건으로 미루면 만료점과 비교하지 않으므로 질문의 만료점 문구를 함께 보인다(11 Q-E19) |
| 이의 | `objection.file`([판정 J-111]) | `OVL-CONTEST`(05 §3.3) |

합의 확인과 결과 확인은 `question.answer`로 보내지 않고 전용 메서드(`agreement.confirm`, `result.accept` 등)로 보낸다([판정 J-124]. 그 두 질문 종류에 `question.answer`를 보내면 3001 `policy.answer_option_not_allowed`).

**상태**

| 상태 | 표시 |
|---|---|
| 만료점이 가까움(`approaching`) | 머리에 "만료점이 가까워 지금 전달했습니다 · 약 10분 남음" |
| 즉시로 승격됨 | 전달 방식 칸 "협상 → 즉시(만료 임박)" |
| 다른 에이전트도 같은 질문 | "같은 질문이 Concern 9에서도 나와 하나로 합쳤습니다" (`alsoAskedBy`) |
| 원본이 바뀜 | §3.0.5 낡은 결정 |
| 이미 처리됨 | §3.0.5 |

**사람 조작 횟수**: D 1(주 버튼). 고쳐서 정하기 = D 1 + I 1. 질문 하나에 담긴 여러 기준은 D 1([판정 J-23], 02 UQ-11). 묶음은 "고른 대로 보내기"를 한 번 눌러도 답한 질문 수만큼 D로 센다(01 §3.5.2, 02 UC-04 대안 F).

### 3.5 `SCR-AUTO` 에이전트가 정한 것

**목적**: 에이전트가 사람에게 묻지 않고 정한 것을 종류별로 보고, 필요한 것에 이의를 건다(결정 8, 불변조건 7).

**진입 경로**: 내비게이션 3번, Mod+3, `G A`, 복귀 요약 8절, Concern 개요의 "에이전트가 정한 것 n".

**레이아웃**

```text
에이전트가 정한 것   [마지막 확인 이후 ▾]  [Concern: 모두 ▾]  [이의 걸린 것만 □]
───────────────────────────────────────────────────────────────────────────
▾ 루프 전환 (2)
  선택 41 · Concern 12 · 어제 23:30 · 작업 에이전트
    탐침 → 구조: 나누기 · 이유: '글 주제'와 '글 형식'의 선호가 따로 움직임(관찰 31)
    묻지 않은 이유: 답에 따라 결과가 크게 달라지지 않음
    다시 볼 조건: 두 하위 Concern의 기준이 같아지면    [이대로 둔다] [이의]
▸ 상황 판정 (1)
▸ 가정 확정 (0)
▸ 분해·병합 (1)
▸ 모드 라우팅 (0)
▸ 진입 판정 (1)
▸ 일반 선택 (1)
───────────────────────────────────────────────────────────────────────────
처리 중인 이의 (1)
  선택 38 · 이의 09:15 · Concern 12 다시 열림 · 처리: 다시 보는 중 · 다시 정할 질문: 질문 19 [지금 정하기]
```

| 항목 필드 | 내용 |
|---|---|
| 무엇을 정했나 | 결정 내용 한 줄 |
| 대안 | 고려한 대안 목록(접힘) |
| 이유 | 정한 이유 |
| 묻지 않은 이유 | `why_not_asked`. 반드시 보인다(v0.3 06 §4.2). "사람이 맡김"이면 그렇다고 쓴다 |
| 다시 볼 조건 | `review_trigger` |
| 영향 | 이 결정에 기대는 작업·선택 수 |
| 작성자 | 에이전트 역할(작업 에이전트, 중재자 등. router·branch는 "에이전트") 또는 정책 |

종류(v0.3 06 §4.2): 루프 계획·루프 전환(계획의 `authoredBy`가 `model`이면 "에이전트가 설계한 계획"으로 표시한다[판정 J-188, J-204]), 상황 판정, 분해·병합(구조 루프), 가정 확정, 모드 라우팅, 진입 판정(Concern으로 열기, 가벼운 작업으로 두기, 승격·강등, v0.3 01 §3.7, 09 `entry.evaluated`), 탐구 사용 승격(11 §3.9.1의 kernel 승격), 일반 선택. 진입 판정은 08 `EntryAssessment`(`ea`, `Autonomy` 보유) 레코드이고 이의 대상이다(`objection.file { target: { kind: "record", id: <ea id>, itemKey: null } }`). Concern 개요의 "Concern으로 열었습니다 [이의]"와 가벼운 작업 카드의 [Concern으로 열기]도 이 레코드를 대상으로 한다.

**표시 데이터**: `view:autonomous` (파라미터: `since`(확인 cursor | 전체), `concernId?`, `contestedOnly`)

```ts
interface AutonomousView {
  meta: ViewMeta;
  groups: { kind: "loop" | "situation" | "structure" | "assumption" | "routing" | "entry" | "choice";
            items: AutonomousItem[] }[];
  openContests: { objection: RecordRef; target: RecordRef; filedAt: IsoTime; status: "open" | "upheld" | "withdrawn" | "dismissed" | "noted"; statusDisplay: CopyRef; concern: RecordRef; redecision?: RecordRef }[];
}
interface AutonomousItem {
  ref: RecordRef;                       // 진입 판정은 08 EntryAssessment(ea)
  concern?: RecordRef; decidedAt: IsoTime; decidedBy: Author;
  decision: string; alternatives: string[]; reason: string; whyNotAsked: CopyRef;   // 08 WhyNotAsked.kind별 문구
  reviewTrigger?: string; dependents: number; seen: boolean; contested: boolean; confirmed: boolean; fromQuestion?: RecordRef;
}
```

**인터랙션**

| 동작 | 조작 | 명령 의도 | 결과 |
|---|---|---|---|
| 목록 열기 | 화면을 열거나 복귀 요약 8절을 펼침 | `autonomous.markSeen { upToSeq: meta.asOfSeq }`(앱이 열람 때 한 번 보냄, 사람 조작 아님) | 이벤트 09 `autonomous.seen`. 레일의 점이 사라진다. 승인과 다르다. 이의를 걸 권리는 그대로 남는다 |
| 이대로 둔다 | 항목 버튼 | `decision.confirm { targets: [ref] }`(19 params에 `targets` 요구) | 항목에 "이대로 둠 · 09:20". 선택 조작이며 정상 경로 수에 넣지 않는다 |
| 이의 | 버튼, `!` | `OVL-CONTEST` → `objection.file` | 항목이 "이의 걸림"으로, 처리 중인 이의에 추가. 재결정 질문이 생기면 "다시 정할 질문: 질문 n [지금 정하기]" |
| 근거·계기 보기 | Enter | 없음 | 검사 패널, `SCR-EVIDENCE` 또는 `SCR-LOOPS` |

항목별 [봤음] 버튼은 두지 않는다. 열람 기록과 이의 기록이 v0.3 06 §4.4의 다이얼 조정 자료가 된다(이의 없이 열람 = 묻지 않은 것이 괜찮았을 가능성). 집계는 16·11이 정한다. 레일 배지는 숫자 대신 점이다(03 §3.5.2). 화면에서 확인을 재촉하지 않는다(승인 노동이 되지 않게).

**상태**: 빈 상태 "마지막 확인 이후 에이전트가 혼자 정한 것이 없습니다." 이의가 처리되지 않은 채 오래 남으면(14가 기준) 질문함에 "이의 처리 확인" 질문이 생긴다. 화면에서 사라진 이의 수는 0이어야 한다(Contestability 지표).

**사람 조작 횟수**: 이의 = D 1, 이유를 쓰면 I 1을 더한다([판정 J-20], 02 UC-05). 열람은 보기. 이대로 둔다 = D 1(선택 조작).

### 3.6 `SCR-CONCERNS` Concern

**목적**: 모든 Concern을 Goal별 트리로 보고 고른다. 홈 트리의 넓은 판. 가벼운 작업을 담는 보관 Concern(14 `light_work`)은 목록에 보이지 않고 "가벼운 작업"으로 진행 중 서랍에만 보인다(14 §3.14).

**진입 경로**: 내비게이션 4번, Mod+4, `G C`.

**레이아웃**: 표 형태의 트리.

| 열 | 내용 |
|---|---|
| 이름 | 표시 번호 + 서술 한 줄, 하위 Concern은 들여쓰기 |
| 상황 유형 | 라벨(03 §3.3.7). 판정 전이면 "판정 전" |
| 현재 루프 | 라벨 |
| 모드 | 이름 |
| 상태 | 라벨 + 기다리는 것 |
| 사람 필요 | 열린 질문 수(권리 게이트 강조) |
| 마지막 변화 | 시각 |

거르기: 사람 필요만 / 진행 중 / 대기 / 보류 / 닫힘 포함. 묶기: Goal(기본) / 상황 유형 / 현재 루프.

**표시 데이터**: `view:concernTree` (파라미터: 거르기 `filter`, 묶기 `groupBy`)

```ts
interface ConcernTreeView {
  meta: ViewMeta;
  groups: { key: string; label: string; goal?: RecordRef; nodes: ConcernNode[] }[];   // groupBy: goal(기본) | situation | loop
  rows: Record<string, { openQuestions: number; rightsGates: number; lastChangeAt: IsoTime }>;   // ConcernNode.ref.id → 표의 열
}
```

**인터랙션**

| 동작 | 조작 | 명령 의도 |
|---|---|---|
| 열기 | Enter | 없음 (`SCR-CONCERN-OVERVIEW`) |
| 새 일 | 입력창(범위 "새 일") 또는 `N` | `composer.preview` → `composer.submit { scope: "new", text, previewId }` → 진입 판정(01 §3.6.2, 10·14)에 따라 Concern으로 열리거나 가벼운 작업으로 진행된다(§3.6.1) |
| 보류·닫기 | 행 메뉴 | `concern.hold`, `concern.close` (닫기 조건은 §3.7) |

**상태**: 빈 상태 "아직 Concern이 없습니다. 다루고 싶은 상황(문제, 결정할 것, 취향을 정하고 싶은 것)을 입력창에 말하면 Concern 초안을 만듭니다."

#### 3.6.1 새 일과 가벼운 작업 (입력창 범위 "새 일") [제안, 진입 규칙은 01 §3.6·10·14]

UC-01·02·15의 출발점이다. 입력창 범위 칩을 "새 일"로 두고 말하면(전역 `/`, 홈 빈 상태, Concern 목록 `N`) 다음 순서로 진행한다(01 R-OP-2(b), [판정 J-90]).

1. **입력 중 미리보기**: 입력이 멈추면(300ms) 앱이 `composer.preview { scope: "new", text }`를 보낸다. 결과(19 `SemanticPreviewResult`)는 진입 예비 판정(Concern으로 열기 / 가벼운 작업)과, 가벼운 작업이면 합의 echo(대상, 할 일, 하지 않을 일)를 함께 담는다.
2. **보내기 버튼에 echo**: 가벼운 작업으로 예비 판정되면 보내기 버튼 문구가 echo를 담는다. 예: [README 오타 고치기 · 이 파일만 쓰기 · 보내기 없음]. Concern으로 열 것이면 [Concern으로 열기]다. 버튼 아래에 "보내면 이 범위로 맡깁니다"를 쓴다.
3. **보내기**: `composer.submit { scope: "new", text, previewId }`. 이 지시를 보내는 것이 합의 확정을 겸한다(지시는 I 1, D 0).
4. **확정 질문으로 돌리는 경우**: 미리보기 없이 보냈거나(빠르게 Enter), 보낸 뒤의 진입 판정·echo 범위가 미리보기와 다르거나, 범위를 모델이 만들었으면 데몬이 합의 확인 질문을 낸다(01 R-OP-2(b)). 화면은 "보낸 뒤 범위가 미리보기와 달라 확인이 필요합니다"를 보인다.

| 진입 결과(데몬 판정) | 화면 |
|---|---|
| E1 시작 시 진입: Concern으로 엶 | 새 Concern 개요로 이동. 머리에 "Concern으로 열었습니다 · 이유: 목표가 흐림, 취향에 달림(진입 조건 2개) [이의]". 판정은 에이전트가 정한 것으로 기록된다. 확인을 묻지 않는다 |
| 가벼운 작업으로 진행 | 홈 "진행 중"과 진행 중 서랍에 "가벼운 작업" 카드. 카드 머리에 "가벼운 작업으로 진행 · 이유: 대상이 한 파일, 기준이 분명함 [Concern으로 열기]"를 둔다. [Concern으로 열기]는 진입 판정에 대한 이의(E3 직접 지정과 같은 효과)로 기록된다. 카드 본문은 지금 하는 일과 맡긴 범위 한 줄. Concern을 만들지 않는다 |
| 가벼운 작업 끝 | 결과 확인 간단판을 카드 안에 보인다: 결과와 근거 한 줄, 바뀐 것 보기, [결과 확인] [수정 요청] + 그 밖에(Concern으로 열기, 이의). 결과 확인은 사람만 하는 막지 않는 권리 게이트라 다음 작업 경계나 검토 창에 묶여 전달되고, 홈에서는 "가벼운 작업 결과 n개 [묶어서 확인]"으로 접힌다([판정 J-89], [판정 J-132]). 묶어서 확인 화면은 결과마다 한 줄씩 쌓고 [결과 확인]·[수정 요청]을 고른 뒤 "고른 대로 보내기"를 누른다 |
| E2 작업 중 승격 제안 | 가벼운 작업 진행 중 승격 신호(v0.3 01 §3.7)가 보이면 정보 게이트 질문 "Concern으로 열지 확인하면 좋습니다. 이유: 같은 확인이 세 번 실패했습니다" [Concern으로 열기] [가벼운 작업으로 계속] + 그 밖에(질문 다시 쓰기, 미루기, 이의) |
| E3 직접 지정 | 입력창에서 "Concern으로 열기"를 고르거나 TUI `/open`. 판정 없이 Concern을 연다 |
| 강등 | Concern이 단순하다고 확인되면 에이전트가 가벼운 작업으로 내리고 에이전트가 정한 것에 기록한다(이의 가능) |

**사람 조작 횟수**: 새 일 = I 1(합의 확정 겸함), D 0. 가벼운 작업 결과 확인 = 결과마다 D 1(묶어서 보내도 결과 수만큼, 01 §3.5.2). 진입 판정은 에이전트가 정한 것으로 기록되어 이의를 걸 수 있다.

### 3.7 `SCR-CONCERN-OVERVIEW` Concern 개요

**목적**: Concern 하나의 현재 상태, 다음 예정, 사용 중인 가정, 하위 Concern을 본다(v0.3 09 §4.2). Concern 화면의 첫 탭이다.

**진입 경로**: 홈·Concern 목록의 행, 질문·작업 화면의 Concern 링크, 딥 링크 `helm://concern/<id>`.

**레이아웃**

```text
RGN-STATUSLINE  Goal 2 블로그 글쓰기 · Concern 12 블로그 글 방향 · 모드 취향 탐색 [이의] ·
                지금: 본문 1절 초안 · 맡긴 범위: 초안 문서만, 보내기 없음 · 다음 멈춤: 1절 제출
[개요] [탐구] [작업] [이력] [대화]
───────────────────────────────────────────────────────────────────────────
Concern 12 블로그 글 방향                                     상태: 대기(질문 2)
Goal 2 블로그 글쓰기 방향 정하기 ▸

상황 유형   해 봐야 아는 일 · 판정: 어제 22:10 · 에이전트가 판정 · 근거 ▸          [이의]
루프 계획   상황 파악 ✓ → 원함 탐구 ✓ → 탐침 ✓ → [구조: 나누기] → 원함 탐구 → 약속 실행 → 확인·반영
            계획: 에이전트가 정함 · 에이전트가 설계한 계획 · 바뀐 횟수 2            [이의] [루프 이력]

지금 하는 일   WorkUnit 31 본문 1절 초안 (진행 중)
다음 예정      1절 초안 제출 → 결과 확인 대기
멈출 조건      외부 자료 인용이 필요할 때 · 보내기가 필요할 때

사용 중인 가정 (1)
  질문 14 "도입부는 장면으로" 임시 적용 · 만료: 본문 2절 전 (약 40분)     [답하기]

열린 질문 (2)    질문 14, 질문 15                                         [질문함]

판단과 아직 모르는 점
  판단   길이보다 장면 묘사가 반응을 좌우한다 (지지: 일관됨 · 반대 근거 검토: 찾아봄, 없음) ▸
  모름   리뷰어가 다룰 수 있는 분량 ▸
  (사실 탐구 중이면) 가능성 1순위  캐시 설정이 원인 · 가장 강한 반대 근거: 모바일에서 재현 안 됨 ▸

최근 선택
  내가 정함      선택 39 블로그 주제를 "개인 하네스 회고"로                 어제 21:40
  에이전트가 정함 선택 41 하위 Concern 둘로 나누기 (묻지 않은 이유 ▸) 근거 부족  어제 23:30 [이의]
                  선택 37 · 낡음(판단 15가 바뀜) · 마지막으로 다시 열림 10월 9일

하위 Concern
  Concern 12.1 글 주제 · 진행 중
  Concern 12.2 글 형식 · 대기
  경계 항목: 글 길이 기준은 두 하위 Concern에 함께 걸림 ▸

다가오는 것
  오늘 18:00 질문 15 마감 · 10월 13일 리뷰 응답 기대 기한
```

| 구역 | 내용 | OPD+C |
|---|---|---|
| 상태 줄 | Goal, Concern, 모드, 지금 하는 일, 맡긴 범위, 다음 멈춤(canon-2 §3.5) | P |
| 머리 | 서술, Goal 링크, Concern 상태 | O |
| 상황 유형 | 라벨, 판정 시각, 판정 주체, 근거, 이의 버튼 | O, C |
| 루프 계획 | 계획 칩 줄. 지난 루프 ✓, 현재 루프 강조, 남은 계획. 건너뛴 루프는 칩 줄 아래에 이유와 함께 보인다(`skipped`, 14 `LoopPlanRecord`). 누가 정했는지(`decidedBy`)와 누가 설계했는지(`authoredBy`)를 함께 보인다. 모델이 설계했으면 "에이전트가 설계한 계획"을 표시하고 근거(`outOfPattern`, 14 `Flag.evidence`)를 펼친다. 사람이 고쳤으면 "직접 고친 계획"을 표시한다. 코드가 계산한 계획에는 표시를 붙이지 않는다([판정 J-204]). 모델 초안이 검사에 두 번 걸려 코드가 계획을 썼으면(`modelDraftRejects` 두 개, 09 `loop_plan.adopted`) 그 사실과 마지막 거부 규칙을 보인다. 이의 버튼은 어느 경우에나 같다([결정 53], [판정 J-188]) | O, P, C |
| 지금 하는 일 / 다음 예정 / 멈출 조건 | 현재 WorkUnit 요약(진행 작업 카드에서) | P |
| 사용 중인 가정 | 임시 가정과 만료점(v0.3 09 §4.2) | P |
| 열린 질문 | 이 Concern의 질문 | D |
| 판단과 아직 모르는 점 | 판단과 지지 등급(15 `SupportGrade`), "반대 근거 검토: 찾아봄/찾아보지 않음", 아직 모르는 점, 이의 걸린 판단. 근거 개수는 보이지 않는다. 사실 탐구 중이라 판단이 아직 없으면 가능성 1순위와 가장 강한 반대 근거 한 줄을 보인다 | O, C |
| 최근 선택 | 사람이 정한 것과 에이전트가 정한 것을 구분하고, 품질 배지(근거 부족, 이의 걸림, 낡음)와 마지막으로 다시 열린 때를 보인다 | O, C |
| 하위 Concern, 경계 항목 | 구조 루프 결과(v0.3 03 §4.3 규칙 4) | O |
| 다가오는 것 | 이 Concern의 만료점, 기한, 예측 확인일 | P |

**표시 데이터**: `view:concern` (파라미터: `concernId`)

```ts
interface ConcernView {
  meta: ViewMeta;
  ref: RecordRef; goal?: RecordRef; status: string /* 08 ConcernDisplayStatus */; waitingFor?: CopyRef;
  statusLine: { mode: string | null; modeAssignment?: RecordRef /* 이의 대상 md */; doingNow?: string; rangeSummary?: string; nextStop?: string };
  situation: { type: ConcernNode["situation"]; assessedAt?: IsoTime; assessedBy?: Author; evidence: RecordRef[]; contested: boolean } | null;
  loopPlan: { ref: RecordRef /* lp, 이의 대상 */; steps: { loop: string; state: "done" | "current" | "planned" }[];
              skipped: { loop: string; reason: string }[];   // 건너뛴 루프와 이유(14 LoopPlanRecord.skipped)
              decidedBy: Author; authoredBy: "code" | "model" | "human";   // 누가 설계했나([판정 J-188] (5)). decidedBy는 그대로
              outOfPattern?: { evidence: string[] };   // authoredBy가 model일 때 PlanFlags.outOfPattern의 근거(근거 필수, [판정 J-188] (2))
              modelDraftRejects?: string[];   // 09 loop_plan.adopted. 모델 초안이 거부된 규칙 id를 시도 순서대로 최대 2개 담는다. 화면은 마지막 항목을 쓴다
              changes: number } | null;
  current?: ActiveWorkCard;
  assumptions: { question: RecordRef; assumption: string; expires?: ExpiryPoint }[];
  openQuestions: QuestionSummary[];
  findings: StatementView[]; unknowns: { text: string; ref?: RecordRef }[];
  leadingPossibility?: { statement: StatementView; strongestCounter?: StatementView };   // 판단이 없을 때(사실 탐구 중)
  recentChoices: { ref: RecordRef; text: string; decidedBy: Author; autonomous: boolean; whyNotAsked?: CopyRef; at: IsoTime; badges: QualityBadgeDisplay[]; lastReopenedAt?: IsoTime }[];
  children: ConcernNode[]; boundaryItems: { text: string; spans: RecordRef[] }[];
  upcoming: HomeView["upcoming"];
  canClose: { allowed: boolean; reason?: CopyRef };    // 하위 재조합 확인 전이면 false (의존 규칙 4 [제안])
}
```

**인터랙션**

| 동작 | 조작 | 명령 의도 |
|---|---|---|
| 상황 판정·루프 계획·모드 이의 | 각 줄의 [이의] | `objection.file { target: { kind: "record", id: <sa·lp·md id>, itemKey: null }, desiredEffect }` (08 `ObjectionTarget`) |
| 루프 직접 지정 | 루프 계획 칩 메뉴 "이 루프로 옮기기" | `loop.requestTransition { to, reason? }` (사용자 직접 지시는 전환 계기, v0.3 03 §6) |
| 나누기·합치기 요청 | 메뉴 | `structure.request { op: "split" \| "merge", note }` |
| 보류 | 메뉴 | `concern.hold { until? }` |
| 보류 풀기 | 보류 상태의 머리 버튼 "다시 열기" | `concern.resume` |
| 닫기 | 메뉴 | `concern.close`. `canClose.allowed`가 거짓이면 "하위 Concern 2개가 아직 다시 합쳐지지 않았습니다. 그래도 닫으면 남은 하위 Concern도 닫힙니다."를 보이고 사람이 명시적으로 닫을 때만 보낸다(v0.3 03 §5 예외) |
| 서술·Goal 연결 고치기 | 제자리 편집 | `concern.revise { field, value }` (10 `concern.update`, Directability) |

**상태**: 상황 판정 전이면 "아직 상황 유형을 판정하지 않았습니다." 루프 계획 없음이면 "루프 계획이 아직 없습니다. 상황 파악부터 시작합니다." 닫힘이면 머리에 "닫힘 · 10월 3일 · 다시 열기".

**사람 조작 횟수**: 이의 D 1(이유를 쓰면 I 1 추가). 루프 지정 2(메뉴 + 고르기).

### 3.8 `SCR-INQUIRY` 탐구

**목적**: Concern의 사실·원함·가능성·결과 탐구의 현재 상태를 보고, 탐구에 반응하거나 방향을 바꾼다(v0.3 09 §4.5, 04).

**진입 경로**: Concern 탭 "탐구", 질문·판단에서 "탐구 보기", Concern 안에서 `[`·`]`로 탭 이동.

**레이아웃**: 위에 탐구 종류 칩 [사실] [원함] [가능성] [결과]. 이 Concern에서 쓴 종류만 활성. 아래에 종류별 본문. 공통 머리 줄: 라운드, 멈출 조건 진행, 예산 사용, 근거 범위 다이얼 값.

```text
[사실 ●] [원함 ●] [가능성 ○] [결과 ○]
사실 탐구 · 라운드 3 · 멈출 조건: 1순위가 두 라운드 유지(지금 1라운드) · 예산 하위 호출 12/30
```

**앵커링 결과** (15 발산 서브시스템, 탐구를 시작할 때): 요청에서 확실한 것 / 모호한 것 / 가정으로 나눈 초안을 탐구 화면 머리에 보이고, 줄마다 "고쳐 말하기"를 둔다(15 요구). 고친 것은 반응처럼 관찰로 기록된다.

**사람 조작(15 §3.11.2)**: 항목 고정·접기·기각, 자극·레퍼런스 추가, 렌즈 지정·추가, 특정 칸 채우기 요청, 탐구 일시 정지·재개. 하위 호출이 실패해 결과가 줄었으면 머리에 `degraded` 배지("일부 하위 호출이 실패해 결과가 줄었습니다")를 보인다. 예산이 거의 다 되었을 때는 15 §3.13.3의 문장(`notice.inquiry.budgetNear`, 05 §3.11)을 머리 줄에 보인다(질문은 만들지 않는다, 14).

**종류별 본문** [제안]

| 종류 | 본문 구역 | 원천 |
|---|---|---|
| 사실 | (1) 관점: 관점마다 예측과 반박 조건 (2) 원인 후보 표: 후보 / 지지 근거 / 반대 근거 / 다음 확인 (3) 다음 구분 확인: 무엇을 구분하는지, 비용, 순서 이유(코드 계산). 순서는 에이전트가 정한 것이라 줄마다 [이것 먼저]와 [이의]를 둔다 (4) 반대 근거 탐색 기록: 1순위 후보에 대해 "찾아봄: 없음" 또는 "찾는 중" (5) 판단으로 올라간 것 | v0.3 04 §2, canon §17.8 가능성 비교 표, canon-2 §5.2.1 |
| 원함 | (1) 라운드 목록과 각 라운드 반응 수 (2) 선호 모델 요약: 기준과 무게, 좋았던 예, 싫었던 예 (3) 기준 후보(추측)와 각 후보의 근거 반응·반대 반응 (4) 말한 것과 실제 반응의 차이(`stated_vs_revealed`) (5) "자극 보드 열기" | v0.3 04 §3, 09 §4.5 |
| 가능성 | (1) 발산 표: 관점 × 바꾸는 대상, 칸마다 ● 채워짐 / ○ 빈 칸 / · 해당 없음(이유). Method Transfer 렌즈로 만든 관점 행 표시 (2) 가능성 목록: 대비 압축 순서, 근거 있음·근거 없음 구분 (3) 렌즈 사용 기록 | v0.3 04 §4 |
| 결과 | (1) 예측 목록: 문장, 근거, 실패 경로와 대응·감시 신호, 확인 날짜와 방법, 결과 (2) 사전 부검 결과 (3) 시나리오 셋(잘 풀림 / 나쁘게 풀림 / 예상 밖), "시나리오는 확정 예측이 아닙니다" 표시 | v0.3 04 §5 |

규칙:

- 대비 압축(v0.3 04 §4.7, 09 §4.5): 결과를 바꾸는 차이가 있는 항목을 앞에 보이고 나머지는 접는다. 개수를 줄이지 않는다. 반대 근거와 이견은 접지 않는다.
- 근거 개수로 강도를 표시하지 않는다(canon §8.3 P04 §3). 후보 표의 근거 칸은 근거 한 줄씩과 각 근거의 직접성·독립성 표시를 보인다.
- confidence 숫자를 보이지 않는다(21 UI-D05). 선호 모델 기준의 무게는 문구 키 `label.weight.high|medium|low`("높음"·"중간"·"낮음", 05 §3.10.8) 하나로만 보인다. 15·21도 이 키를 쓴다.
- 모델이 쓴 칸 내용(가능성, 기준 후보, 예측 문장)은 작성자 표시를 붙인다.
- 같은 모델·같은 컨텍스트에서 나온 가능성은 "같은 출처 계열" 표시(G7).

**사람이 할 수 있는 것** (Inquiry Interaction 7, canon §12.6)

| 원전 행위 | 화면 동작 | 명령 의도 |
|---|---|---|
| 문제 프레임 분기·합치기 | 관점 메뉴: "관점 더 보기", "이 둘은 같은 관점" | `inquiry.requestFrame { op: "add" \| "merge", note }` |
| 새 가설 제안 | 후보 표 끝 "후보 추가"(자연어) | `inquiry.proposeCandidate { text }` (사람 작성 추측으로 기록) |
| 근거 관계 이의 | 근거 줄의 이의 | `objection.file { target: { kind: "link", from, to, rel } }` (08 `ObjectionTarget`) |
| 숨은 전제 승격 | 문장 메뉴 "이건 확인 안 된 전제" | `inquiry.markAssumption { refOrText }` |
| 구분력 높은 다음 실험 선택 | 다음 구분 확인 목록에서 "이것 먼저" | `inquiry.pinCheck { checkId }` (순서 계산은 코드, 사람 고정은 기록) |
| 불확실성이 남아도 행동 결정 | 머리의 "지금 정하기" | `inquiry.requestDecision` → 선택 요청 질문 생성 |
| 탐구 중단 비용과 기대 정보 가치 비교 | 머리의 예산·멈출 조건 표시와 "여기서 멈추고 넘기기" | `inquiry.stop { then: "hand_off" }` (열린 질문을 그대로 넘긴다, v0.3 04 §1) |
| (가능성) 가능성에 반응 | 가능성 행의 반응 칩. 대비 반응(잃어도 괜찮음 / 잃으면 안 됨 / 모르겠음)은 가능성 탐구에만 있다(05 §3.2.7, 2단계) | `reaction.record` (05 §3.2) |

**표시 데이터**: `view:inquiry` (파라미터: `concernId`, `kind`)

```ts
interface PreferenceModelView {
  ref: RecordRef;
  criteria: { name: string; weight: "high" | "medium" | "low"; evidence: RecordRef[]; counter: RecordRef[]; confirmed: boolean; reviewTrigger?: string }[];
  liked: RecordRef[]; disliked: RecordRef[];
  statedVsRevealed: { stated: string; revealed: string; evidence: RecordRef[] }[];
}
interface InquiryView {
  meta: ViewMeta;
  kinds: { kind: "fact" | "want" | "possibility" | "outcome"; active: boolean; round: number; stopProgress: string; budget: HomeView["activeWork"][number]["budget"] }[];
  fact?: {
    frames: { id: string; text: string; predicts: string; refutedBy: string; authoredBy: Author }[];
    candidates: { ref: RecordRef; text: string; supporting: StatementView[]; challenging: StatementView[]; nextCheck?: string; rank: number }[];
    nextChecks: { id: string; text: string; distinguishes: RecordRef[]; cost: string; orderReason: string; pinnedByHuman: boolean }[];
    counterSearch: { candidate: RecordRef; state: "not_searched" | "searching" | "searched_none" | "found"; refs: RecordRef[] }[];
    promoted: StatementView[];
  };
  want?: {
    rounds: { no: number; stimuli: number; reactions: number; closedAt?: IsoTime }[];
    preferenceModel?: PreferenceModelView;
    criterionCandidates: { id: string; text: string; evidence: RecordRef[]; counter: RecordRef[]; question?: RecordRef }[];
    statedVsRevealed: { stated: string; revealed: string; evidence: RecordRef[] }[];
  };
  possibility?: {
    matrix: { rows: { id: string; label: string; viaLens?: string }[]; cols: { id: string; label: string }[];
              cells: { row: string; col: string; state: "open" | "na" | "queued" | "running" | "filled" | "failed"; naReason?: string; possibilities?: RecordRef[] }[] };   // 15 §3.4.5. 행에는 direction(up/down/side/invert/lens)
    diversity?: "single_family" | "mixed";       // single_family면 "같은 모델 계열로 발산함" 띠(15 §3.4.6)
    possibilities: { ref: RecordRef; text: string; hasEvidence: boolean; evidence: StatementView[]; gainsText?: string; lossesText?: string; group: "front" | "folded"; foldedReason?: "no_evidence" | "previously_rejected" | "order" | "frame_changed"; independence?: "independent" | "correlated" }[];
    noDivergence?: boolean;                      // 결과를 바꾸는 차이가 없음(15 §3.4.9)
  };
  outcome?: {
    predictions: { ref: RecordRef; statement: string; basis: RecordRef[];
                   failurePaths: { path: string; impact: "high" | "medium" | "low"; mitigation?: string; watchSignal?: string; fromPremortem: boolean }[];
                   checkAt?: { at: IsoTime } | { condition: string; latestAt: IsoTime }; checkMethod?: string;
                   verdict?: "held" | "partial" | "failed" | "indeterminate" }[];   // 15 §3.10.3
    premortem: string[];
    scenarios: { kind: "good" | "bad" | "unexpected"; text: string }[];
  };
}
```

**상태**: 탐구가 없는 종류를 누르면 "이 Concern에서는 아직 원함 탐구를 쓰지 않았습니다. [원함 탐구 시작 요청]"(`loop.requestTransition { to: "I.want" }`). 예산 소진이면 머리에 "예산을 다 써서 멈췄습니다. 남은 질문 2개를 그대로 넘겼습니다." 탐구 진행 중이면 갱신은 라운드 경계 단위로 보이고 중간 결과는 "진행 중" 표시를 붙인다.

**사람 조작 횟수**: 반응은 관찰(세지 않음). 이의·요청은 D 1(이유를 쓰면 I 1 추가). 탐구 자체는 사람 조작 없이 진행된다.

### 3.9 `SCR-STIM` 자극 보드

**목적**: 원함 탐구의 자극에 요소 단위로 반응하고, 이유를 대지 못하는 반응도 남긴다(결정 1·18, v0.3 04 §3, 09 §4.6). 흐름 규칙은 05 §3.2가 정본이다.

**진입 경로**: 탐구(원함)의 "자극 보드 열기", 질문함의 기준 확인 질문 "자극 보드에서 더 보기", 알림(라운드 준비됨, 예약 전달), 딥 링크 `helm://stimuli/<iqId>/<roundNo>`(03 §3.5.4).

**레이아웃**: 자극 보드는 넓게 쓰도록 검사 패널을 닫고 연다.

```text
Concern 12 블로그 글 방향 · 원함 탐구 · 라운드 3 · 자극 8개                    [라운드 마치기]
반응한 자극 3/8 · 이번 라운드에서 확인하려는 기준은 반응을 마친 뒤 보입니다
──────────────────────────────────────────────────────────────────────────────
┌ D ──────────────────────────┐ ┌ A ──────────────────────────┐ ┌ G ─────────────┐
│ 도입부 초안                  │ │ 레퍼런스 · 출처 ↗            │ │ (이미지)        │
│ "새벽 세 시, 빌드 로그가     │ │  식당 주방의 주문표 레일     │ │                │
│  멈췄다. [a1]                │ │  요약: … [b1]                │ │                │
│  나는 그 순간 … [a2]"        │ │                              │ │                │
│ 반응: ++ (아주 좋음)         │ │ 반응: 없음                   │ │ 반응: 이유 없이 아님│
│ [a1] 좋음 · "구체적이라서"   │ │                              │ │                │
└──────────────────────────────┘ └──────────────────────────────┘ └────────────────┘
 …
반응 막대(선택한 자극 D):  [--] [-] [0] [+] [++]   [이유는 모르겠지만 아님]  [고쳐 말하기]
                          [부분 고르기 (E)]   [가깝다 표시]   이유(선택): ____________
──────────────────────────────────────────────────────────────────────────────
오른쪽 패널(접을 수 있음): 내 반응 목록 · 기준 후보(라운드 마친 뒤) · 말한 것과 반응의 차이
```

| 구역 | 내용 |
|---|---|
| 머리 | Concern, 라운드 번호, 자극 수, 반응한 자극 수, "라운드 마치기" |
| 자극 격자 | 자극 카드. 라벨은 라운드마다 섞은 글자(A, B, …). 순서는 데몬이 섞어 보낸 순서(첫 자극 끌림 방지, v0.3 04 §3.2). 카드에는 출처 종류(초안 / 레퍼런스 / 사례 / 비유)와 출처 링크만 보인다. "다른 분야" 라벨과 극단 자극 표시는 반응 전에 보이지 않고 라운드를 마친 뒤 오른쪽 패널에 보인다(반응이 출처에 끌리지 않게, 02 AC-01-03, 15 §3.6.3) |
| 요소 표시 | 부분 고르기 모드에서 문장·문단·목록 항목에 `[a1]` 같은 표시가 보인다. 이미지는 영역을 끌어 고른다 |
| 머리의 진행 | "단계 2/4 · 라운드 3/4"(15 `InquiryProgressView`), 닫힌 뒤 도착한 반응이 있으면 "라운드 2가 닫힌 뒤 들어온 반응 1개는 다음 라운드 입력으로 씁니다"([판정 J-99]) |
| 반응 막대 | 선택한 자극(또는 요소)에 대한 강도 5단계, 이유 없이 아님, 고쳐 말하기, 부분 고르기, 가깝다 표시, 이유 입력(선택) |
| 세 개 비교 | 데몬이 세 개 비교 질문을 보내면 격자 위에 띠로 나타난다: "D, A, G 가운데 비슷한 둘을 고르세요. 나머지 하나는 무엇 때문에 다른가요?" (05 §3.2.4) |
| 오른쪽 패널 | 내 반응 목록(고치기·철회), 라운드를 마친 뒤: 확인하려던 기준, "다른 분야" 표시, 기준 후보(SC-06), 말한 것과 반응의 차이 |

**표시 데이터**: `view:stimulusRound` (파라미터: `inquiryId`, `roundNo`. 같은 Concern에 원함 탐구가 다시 열려도 키가 겹치지 않는다. 첫 자극 라운드는 1). 큰 자극(이미지, 긴 문서)은 HTTP로 받는다(결정 31). `form`은 08 `Stimulus.form`에서 읽고, `origin`·`otherField`는 08 Stimulus의 출처 필드에서 12가 투영한다.

```ts
interface StimulusRoundView {
  meta: ViewMeta;
  concern: RecordRef; inquiry: RecordRef; roundNo: number; closed: boolean;
  progress?: { stage: string; stagesDone: number; stagesTotal: number; round: number; maxRounds: number };   // 15 InquiryProgressView
  lateReactions?: number;              // 닫힌 뒤 들어와 다음 라운드 입력으로 쓰이는 반응 수(J-99)
  stimuli: {
    ref: RecordRef;                    // kind "stimulus"
    label: string;                     // 라운드 안 섞은 글자
    form: "text" | "structure" | "image" | "reference" | "analogy";   // 15 §3.6.3
    origin: string;                    // 15 origin(초안, 레퍼런스, 사례 등)
    sourceUrl?: string;                // 출처 링크(반응 전에도 보임)
    // otherField(다른 분야), facets, controlledFor, extreme, direction은 반응 전에는 싣지 않는다(SC-06, 05 §3.2.1). 라운드를 마친 뒤 revealAfterClose로
    content: { type: "text"; markdown: string; elements: { id: string /* 15 요소 id: p1, p1.s1, 노드 id */; displayLabel: string /* a1 */; range: [number, number]; text: string /* 요소의 평문 조각(15, 21 E9): 선택 범위 고정과 TUI 표시용 */ }[] }
           | { type: "structure"; outline: { id: string; displayLabel: string; text: string; depth: number }[] }   // 구조 자극은 개요 목록(15)
           | { type: "image"; url: string; width: number; height: number; alt: string }
           | { type: "link"; url: string; summary: string; elements: { id: string; range: [number, number] }[] };
    myReactions: ReactionView[];
  }[];
  triad?: { id: string; stimuli: [RecordRef, RecordRef, RecordRef]; prompt: string };
  revealAfterClose?: { testing: string[]; criterionCandidates: { id: string; text: string }[]; otherField: { stimulus: string; field: string }[] };   // 라운드 마친 뒤만
  statedVsRevealed: { stated: string; revealed: string }[];
}
interface ReactionView {
  ref: RecordRef;                      // 관찰(반응 종류)
  target: { stimulus: string; element?: string; textRange?: [number, number]; region?: [number, number, number, number] };
  kind: "intensity" | "no_reason" | "rephrase" | "near" | "triad" | "comment" | "contrast" | "comparison";   // 08 ReactionPayload에서 계산. contrast는 가능성 탐구 전용, comparison은 2단계(15 §3.6.4)
  intensity?: -2 | -1 | 0 | 1 | 2;     // near만 있는 반응은 intensity 없음(08 near: true)
  reason?: string;
  rephrase?: string;
  at: IsoTime; withdrawn: boolean;
}
```

**인터랙션** (단축키는 05 §3.8)

| 동작 | 조작 | 명령 의도 |
|---|---|---|
| 강도 반응 | 자극·요소 선택 후 `1`~`5` 또는 막대 버튼 | `reaction.record { intensity }` |
| 이유 없이 아님 | `N` 또는 버튼 | `reaction.record { intensity: -1, reason: null }` |
| 고쳐 말하기 | `R` → 입력 → Mod+Enter | `reaction.record { rephrase }` |
| 부분 고르기 | `E` → 화살표로 요소 이동 → `1`~`5`/`N` | 같은 의도, `target.element` 포함 |
| 이미지 영역 | 끌기 | `target.region` |
| 가깝다 표시 | `M` | `reaction.record { near: true }` |
| 이유 덧붙이기 | 반응 뒤 이유 칸 | 같은 반응에 `reason` 추가(`reaction.amend`) |
| 세 개 비교 답 | 비슷한 둘 고르기 + 다른 하나의 이유(또는 "말로 못 하겠음") | `reaction.record { triad: { similar, different, why, cannotSay } }` |
| 반응 철회 | 반응 목록에서 | `reaction.withdraw` (지우지 않고 철회 기록) |
| 라운드 마치기 | 버튼 | `stimulusRound.close { inquiryId, roundNo }` (10 `inquiry.round.close`, 계기 `human`. 조건은 05 §3.2.5, 정본 규칙은 15 `roundClosable`). 사람 버튼 말고도 모든 자극에 정보성 반응이 들어오거나 대기 시한이 지나면 15가 닫는다(15 §3.6.4 닫는 계기 셋) |

**상태**

| 상태 | 표시 |
|---|---|
| 다음 라운드 준비 중 | "에이전트가 다음 자극을 만드는 중입니다. 준비되면 알립니다(전달 방식: 예약)." 화면을 떠나도 된다 |
| 자극을 못 받음(HTTP 실패) | 카드에 "자극을 불러오지 못했습니다 [다시 불러오기]". 다른 카드는 반응 가능 |
| 연결 끊김 | 반응 입력은 받되 "보내지 않음" 표시로 기기에 보관하고, 다시 연결되면 사람이 "보내기"를 누른다. 반응은 관찰이므로 §3.0.4의 결정 동작 막기와 다르게, 쓰기는 허용하고 보내기만 사람이 다시 확인한다 [제안] |
| 라운드 마침 | 카드는 읽기 전용. 머리에 닫힌 계기("직접 마침" / "모든 자극에 반응함" / "대기 시한 지남"). 오른쪽 패널에 이번 라운드가 확인하려던 기준과 기준 후보가 보인다. 닫힌 뒤에도 반응은 넣을 수 있고 다음 라운드 입력으로 쓰인다([판정 J-99]) |
| 멈출 조건 충족 | 머리에 "선호 모델의 기준이 두 라운드 동안 바뀌지 않아 원함 탐구를 멈춥니다. 기준 확인 질문 2개가 질문함에 있습니다." [한 라운드 더] [이의]. 멈춤은 에이전트가 정한 것이며 [한 라운드 더]는 그 전환 기록에 대한 이의(`desiredEffect: reopen`)로 보낸다 |

**사람 조작 횟수**: 자극 하나에 반응 1(키 하나). 이유 붙이기는 선택. 라운드 마치기 1.

### 3.10 `SCR-WORK` 작업

**목적**: Concern 안의 진행 작업, 작업 합의, 탐침, 기대를 보고 진행 중인 작업의 방향을 바꾼다(canon §17.3 단계 6, canon-3 §6.6.5).

**진입 경로**: Concern 탭 "작업", 홈 진행 중 카드, 진행 중 서랍.

**레이아웃**: 위에서 아래로 진행 중 → 결과 확인 대기 → 합의 확인 필요 → 탐침 → 기대 → 끝난 작업(접힘).

```text
진행 중
┌ WorkUnit 31 · 본문 1절 초안 · 진행 중 · 작업 에이전트 · 단계 2/4 ─────────────┐
│ 지금 하는 일       선호 모델 기준 3개로 1절 초안을 쓰고 있습니다              │
│ 이 일을 하는 이유  선택 39(주제), 선호 모델 기준 ▸                           │
│ 다음 단계          1절 초안 제출 → 멈춤 · 다음 사람 접점: 결과 확인           │
│ 예상 경로          초안 작성 → 기준별 자기 점검 → 결과 제출                   │
│ 맡긴 범위          초안 문서 쓰기 · 보내기 없음 · 실제로 막음                  │
│ 도움이 필요한 조건 외부 자료 인용 필요 · 2절 범위 침범                         │
│ 위험·가정          임시 가정 "도입부는 장면으로"(질문 14) 사용 중              │
│ 마지막 중요한 변화 09:31 1절 개요 확정                                        │
│ 활동               읽기 4건 · 검색 2건 · 문서 변경 1건          [활동 펼치기] │
│ 예산               하위 호출 3/20 · 25분/1시간                                │
│ [방향 바꾸기] [기준 바꾸기] [범위 좁히기] [안전하게 멈추기] [요약 받기]        │
│ [근거 보기] [작업 중단]                                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**도구 활동 표시** [제안, canon-2 §3.11]

- 기본은 한 줄 요약: 읽기 n건 · 검색 n건 · 실행 n건 · 실제 변경 n건. 변경이 없으면 "실제 변경 없음".
- 항상 펼쳐 보이는 사건(7종): 실제 변경의 시작과 끝, 밖으로 나가는 효과, 권한 거부, 판단을 바꾼 테스트·관찰, 추천을 바꾼 반대 근거, 지켜야 할 조건과의 충돌, 비용·시간·위험 기준 초과.
- "활동 펼치기"는 감사 깊이 목록(시각, 도구, 입력 범위, 출력 참조, 종료·오류, 소속 WorkUnit: canon-2 §3.11 source trace 필드)을 보인다. 도구 출력은 제어 문자를 지운 뒤 보인다(canon-2 §4.5).
- 자동화 역설 방지 MUST 5(canon §10.7) 중 1번(현재 의도와 예상 경로)은 "지금 하는 일"과 "예상 경로"로 지킨다.

**탐침 카드**(2단계): 확인하려는 가설, 키울 조건, 접을 조건, 예산, 결과(관찰), 상태(08 `planned`·`running`·`grown`·`folded`·`inconclusive`·`exhausted`·`cancelled`). 조건이 충족되었다는 판정(`probe.judge`)은 에이전트가 정한 것이고 [이의]를 둔다. 여러 탐침 가운데 무엇을 키울지는 사람이 정하는 선택 요청이다(추천, 가장 강한 다른 선택, 현상 유지). 고른 범위로 만든 합의는 그 선택 범위 안이면 echo로 활성된다(01 R-OP-2(a), 02 UC-14).

**기대 카드**(2단계): 대상(외부 행위자), 요청 내용, 보낸 시각, 기한, 기한이 지나면 기록될 관찰. "기한 바꾸기"(`expectation.revise`)와 [응답 받음 기록](Helm이 볼 수 없는 경로로 응답이 왔을 때. 사람 발화 관찰로 남기고 기대를 닫는다, 02 UC-16). "응답 없음" 관찰은 복귀 요약 2절(이해 줄)과 7절(기한)에 보인다.

**집행 수준 표시**: 맡긴 범위가 런타임에서 실제로 막히는지("실제로 막음") 권고만인지("권고만 · 이 실행 방식에서는 도구 실행 전에 막을 수 없습니다")를 보인다(canon-2 §3.13 capability missing, L16). 1차 구현(자체 런타임)은 "실제로 막음"이 기본이고, 외부 어댑터(결정 34)에서 권고만이 생길 수 있다.

**인터랙션** (규칙은 05 §3.6)

| 동작 | 명령 의도 | 결과 표시 |
|---|---|---|
| 방향 바꾸기 | `work.steer { note }` | "지금 하던 도구 실행이 끝나면 반영합니다." 반영되면 "반영됨 · 바뀐 것: …" |
| 기준 바꾸기 | 입력창(범위: WorkUnit) → 의미 미리보기 카드(05 §3.5.3) → [그렇게 기록] → 활성 합의면 `agreement.renegotiate { agreementId, content, reason }`(사람 채널, 19) | 범위를 넓히지 않는 기준 변경은 그대로 반영된다. 맡긴 범위가 넓어지면 합의 확인 질문이 생긴다(02 AC-12-02). 이전 합의 내용은 "낡음" 표시, 새 합의 요약 |
| 범위 좁히기 | `agreement.narrow { agreementId, scope, reason }` | 좁히기는 확인 질문 없이 반영(권한을 줄이므로). 넓히면 커널이 거부한다 |
| 안전하게 멈추기 | `work.pause` | "지금 하던 도구 실행이 끝나는 지점에서 멈춥니다." |
| 맡긴 범위 안에서 다시 시작 | `work.resume` | "마지막 확인 지점부터 이어 갑니다." |
| 요약 받기 | `view.get("brief", { workUnitId })`(명령 아님, 19 §3.7.1) | 진행 작업 범위의 짧은 요약이 카드 아래에 붙는다 |
| 작업 중단 | `work.stop` → 확인 창 [WorkUnit 31 중단하기] | "중단했습니다. 이미 일어난 변경: 문서 1개 수정. 되돌리려면 …" |
| 즉시 끊기 | 중단 확인 창 안의 "즉시 끊기" | `work.abort`. "즉시 끊으면 작업이 복구 필요 상태가 될 수 있습니다." |

**표시 데이터**: `view:work` (파라미터: `concernId`)

```ts
interface WorkView {
  meta: ViewMeta;
  active: ActiveWorkCard[];
  awaitingReview: { workUnit: RecordRef; submission: RecordRef; summary: string; question: RecordRef }[];
  awaitingAgreement: { workUnit: RecordRef; agreement: RecordRef; question: RecordRef; widened: string[] }[];
  probes: { ref: RecordRef; hypothesis: string; growIf: string; foldIf: string; budget?: string;
            state: "planned" | "running" | "grown" | "folded" | "inconclusive" | "exhausted" | "cancelled"; results: RecordRef[] }[];   // 08 Probe.status
  expectations: { ref: RecordRef; to: string; what: string; sentAt: IsoTime; due: IsoTime;
                  state: "open" | "fulfilled" | "timed_out" | "late_fulfilled" | "cancelled" }[];   // 08 Expectation.status
  finished: { workUnit: RecordRef; label: string; at: IsoTime }[];
  activityLog?: { at: IsoTime; tool: string; inputScope: string; outputRef?: string; exit?: string; workUnit: RecordRef; alwaysShow?: string }[];   // 펼쳤을 때만 요청
}
```

**사람 조작 횟수**: 멈추기 1. 작업 중단 2(버튼 + 확인). 방향 바꾸기 I 1. 기준 바꾸기 I 1 + 기록 D 1.

### 3.11 `SCR-AGREE` 작업 합의 (C)

**목적**: 에이전트가 만든 작업 합의 초안을 읽고 확정하거나 고친다. write·send 전에 C가 필요하다(결정 15). 사람 조작 상한은 변경 WorkUnit 하나의 정상 경로에서 확정 1회다(01 §3.5.2, 14 §3.13.7). 확정 질문을 만들지 않는 경우는 01 R-OP-2의 두 경우뿐이다: 사람이 확정한 구조화된 범위(직접 고른 선택지의 `scope`, 맡겨 둔 권한) 안임을 커널이 증명할 때, 명확한 직접 지시를 echo 미리보기를 보고 보냈을 때(03 §3.2.4). "넓어진 것"은 사람이 확정한 이전 합의 범위나 직접 고른 선택 범위와 비교한다.

**진입 경로**: 질문함의 "합의 확인" 질문, 작업 탭의 "합의 확인 필요", 딥 링크 `helm://agreement/<id>`. 확정된 합의는 작업 탭에서 읽기 전용으로 연다.

**레이아웃**

```text
합의 확인 · 작업 합의 9 · WorkUnit 31 본문 1절 초안 · Concern 12
이전 합의보다 넓어진 것: "외부 자료 웹 검색" 추가                       [이전 합의와 비교]
확정되지 않은 기준 1개: 기준 2는 원함 탐구에서 확정되지 않은 추측입니다   [기준 확인 열기]
──────────────────────────────────────────────────────────────────────────
이 일을 하는 이유   선호 모델 기준으로 글 1절을 써서 방향이 맞는지 확인한다
결과(완료 기준)     1. 1절이 선호 모델 기준 3개를 모두 맞춘다
                   2. 분량 800~1200자
                   3. 인용한 외부 자료는 출처를 적는다                      [고치기]
맡긴 범위          할 수 있는 것: 초안 문서 쓰기, 웹 검색(읽기)
                   하지 않을 것: 보내기, 2절 이후 쓰기, 기존 글 수정
                   집행: 실제로 막음
제출할 근거        기준별 자기 점검, 검색한 자료 목록
멈출 조건          외부 자료를 인용해야 할 때 · 2절 범위를 건드려야 할 때
다음 확인 시점     1절 초안 제출 때
맡는 쪽            작업 에이전트
에이전트가 이해한 것  "1절은 새벽 빌드 장면으로 시작하고, 길이보다 장면의 구체성을
                   우선합니다. 2절의 주제는 건드리지 않습니다."             [이해가 다름]
──────────────────────────────────────────────────────────────────────────
[이 범위로 맡기기]  [웹 검색 빼고 맡기기]  [맡기지 않기]  그 밖에: 미루기 · 이의
맡긴 범위 펼치기 ▸ (대상 · 가능한 행동 · 금지된 행동 · 되돌리기 · 영향 범위 · 확인 방법 · 아직 모르는 점 · 유효 기간)
```

| 구역 | 내용 | 원천 |
|---|---|---|
| 넓어진 것 | 사람이 확정한 이전 합의 범위나 직접 고른 선택 범위 대비 넓어진 항목. 이 화면이 열린 이유 | canon §9.5 "이미 한 번 맡겼다로 권한이 이어지지 않음", 01 R-OP-2 |
| 확정되지 않은 기준 | 완료 기준 가운데 원함 탐구에서 확정되지 않고 임시로 넣은 기준 수와 "추측" 표시(15 §3.6.9) | 15 |
| 네트워크·보호 경로 경고 | 합의가 네트워크 접근을 허용하거나 보호 경로(데몬 데이터·설정·비밀 파일 근처)를 건드리면 "이 합의는 네트워크에 접근합니다", "보호 경로에 가까운 파일을 씁니다: …"를 맡긴 범위 위에 보인다(18). 경고는 합의 뷰의 `warnings`(13 §3.5.3 경고 키)를 문구 키로 그린다 | 18 §5.2 |
| 모델 제공자 | 이번 작업이 쓰는 모델 제공자 목록(작업·검증 에이전트별, 18 §3.11.6, [판정 J-150]) | 18 |
| 지침 파일 | 작업 공간 지침 파일(`AGENTS.md` 등)이 바뀌었다는 질문은 2단계다[결정 62]. MVP 합의 확인에는 이 질문을 두지 않고, 확인 전에는 이전 확인본을 쓴다(18 §3.12 9번) | 18 |
| 합의 여섯 항목 | 목적, 완료 기준, 범위, 금지 행동, 제출할 근거, 멈출 조건(브리프 §6) + 다음 확인 시점, 맡는 쪽 | canon §12.7 Delegation Interaction 8, canon-2 §3.12 echo |
| 에이전트가 이해한 것 | 에이전트가 합의를 자기 말로 다시 쓴 것(check-back, SC-08). "이해가 다름"을 누르면 다른 부분을 고르고 한 줄 정정 | canon-3 G1, Mission Command 규칙 2 |
| 맡긴 범위 펼치기 | P04 §1 여덟 항목. "되돌리기"는 권한 레이어 판정 출처를 붙인다 | canon §9.5 |
| 집행 수준 | 실제로 막음 / 권고만 | canon-2 L16 |

**인터랙션**

| 동작 | 조작 | 명령 의도 | 결과 |
|---|---|---|---|
| 이 범위로 맡기기 | 주 버튼(초점 후 Enter) | `agreement.confirm { agreementId }` | "맡겼습니다. 다음 확인: 1절 초안 제출 때." 질문 `answered` |
| 넓어진 부분 빼고 맡기기 | 둘째 버튼(넓어진 항목이 있을 때만) | `agreement.confirm { exclude: [항목] }` | 좁은 합의로 확정(범위를 줄여 진행, v0.3 06 §2.2) |
| 고쳐서 맡기기 | 항목 옆 "고치기" → 제자리 편집 → [이 범위로 맡기기] | `agreement.confirm { agreementId, edits }`(edits는 10 `Partial<AgreementContent>` 구조) | 고친 내용으로 바로 확정. D 1 + I 1 |
| 다시 써 달라고 하기 | 입력창(범위: 이 합의) 자연어("범위를 더 좁게") | `composer.submit`(에이전트에게 초안을 다시 쓰라는 말. 확정이 아니다). 구조로 고쳐 두고 확정은 나중에 하려면 `agreement.revise { content, reason }` | 에이전트가 초안을 다시 만들면 화면이 갱신되고 확정 버튼은 그대로 1회 |
| 맡기지 않기 | 셋째 버튼 | `agreement.decline { note? }` | "합의 취소됨". WorkUnit은 제안(`proposed`) 상태로 남고, 다음 루프는 데몬이 정해 보인다(14) |
| 이해가 다름 | 링크 → 다른 부분 고르기(목적 / 끝 상태 / 첫 단계 / 멈출 때 / 자동으로 이어지는 것) + 한 줄 | `agreement.correctUnderstanding { agreementId, part, note }` | 에이전트가 이해 문장을 다시 쓰고 확정 전에 다시 보인다 |

"확인할까요?" 같은 반복 확인을 만들지 않는다. 사람이 고친 뒤에도 확정은 한 번이다. 자연어 고침은 구조 값으로 바뀌기 전이라 바로 확정하지 않고 다시 쓴 초안을 본 뒤 확정한다(에이전트가 쓴 범위를 사람이 보지 않고 확정하지 않게). 사람이 자연어로 짧게 수락한 경우("응 그렇게 해")도 위 항목으로 펼친 기록이 남고 이 화면에서 볼 수 있다(canon-2 L8).

**표시 데이터**: `view:agreement` (파라미터: `agreementId`)

```ts
interface AgreementView {
  meta: ViewMeta;
  ref: RecordRef; workUnit: RecordRef; concern: RecordRef; revision: number; state: string;
  question?: RecordRef;                          // 확인 질문이 있을 때
  widenedFromPrevious: { item: string; previous?: string }[];
  purpose: string; criteria: { id: string; text: string }[];
  range: { can: string[]; cannot: string[]; targets: string[]; validUntil?: string };
  evidenceToSubmit: string[]; stopConditions: string[];
  nextCheckpoint?: string; performer: Author;
  restatement?: { text: string; authoredBy: Author };   // 에이전트가 이해한 것
  rangeDetail: { label: string; value: string; source?: "permission_layer" }[];   // P04 §1 여덟 항목
  enforcement: "enforced" | "advisory";
  previousRevision?: RecordRef;
  unconfirmedCriteria?: { criterionId: string; text: string }[];   // 15 §3.6.9 확정되지 않은 기준
  warnings: CopyRef[];                           // 13 §3.5.3 경고 키. 문구 키로 그린다
  providers: { role: AgentRole; name: string }[];   // 작업·검증 에이전트별 모델 제공자(18 §3.11.6, [판정 J-150])
}
```

**사람 조작 횟수**: 결정 1(확정). 고친 경우 입력 1 + 확정 1. 01 R-OP-2의 두 경우는 0.

### 3.12 `SCR-REVIEW` 결과 확인 (A)

**목적**: 결과 제출을 완료 기준별 근거로 보고 받아들일지 정하고(결과 확인 단계), 받아들인 뒤 다른 작업·문서·결정과 맞추는 반영 항목을 처리한다(전체 반영 단계). 결과 확인은 사람만 한다(결정 15, v0.3 03 §3.4). 사람 조작 상한은 D 1이며, 결과 확인 조작 하나에 반영 항목 처리 방침과 반영 범위 합의까지 함께 정한다(01 R-OP-3, [판정 J-126]). 반영 항목마다 따로 묻지 않는다.

**진입 경로**: 질문함의 "결과 확인" 질문(막지 않는 권리 게이트. 기록은 즉시, 전달은 다음 작업 경계나 검토 창, [판정 J-132]), 작업 탭, 딥 링크 `helm://review/<rsId>`. 휴대폰은 `SCR-M-QUESTION`에서 처리하되 `mobileReviewable`이 거짓이면 미루기만 둔다([판정 J-139], 03 §3.12).

**레이아웃: 결과 확인 단계**

```text
결과 확인 · 결과 제출 12 · WorkUnit 31 본문 1절 초안 · Concern 12
기준 3개 중 2개 확인됨 · 1개 확인 못함 · 독립 검증: 검증 에이전트(다른 모델) 거침
──────────────────────────────────────────────────────────────────────────
기준                                판정        근거
1 선호 모델 기준 3개를 맞춘다        충족 ✓      자기 점검(관찰 52) · 검증 에이전트 증언(관찰 55)
2 분량 800~1200자                  충족 ✓      글자 수 측정 1,034자(관찰 53)
3 인용 자료 출처                    확인 못함 ? 근거가 에이전트 설명뿐이라 "확인 못함"으로 낮췄습니다
──────────────────────────────────────────────────────────────────────────
확인된 것        1절이 장면 묘사로 시작하고 기준 1·2를 맞춤
확인하지 못한 것  인용 자료 출처(기준 3)
남은 제한        리뷰어 의견을 아직 받지 않음
남은 전제        "독자는 개발자다"(전제 8) · 확인 안 됨
반대 근거        검증 에이전트: "둘째 문단은 설명이 길어 기준 '장면 우선'과 맞지 않을 수 있음" ▸
전체 영향        2절 도입과 겹치는 문장 1개 ▸
결과가 무효가 되는 조건  리뷰 의견이 선호 모델과 반대면
──────────────────────────────────────────────────────────────────────────
반영 범위(이 결과를 반영할 때 맡길 쓰기)  글 목차 문서 docs/outline.md 갱신 · 보내기 없음   [고치기]
반영 항목 처리: (●) 에이전트가 모두 진행(기본)  ( ) 남는 제한은 미루고 나머지 진행   반영 항목 3개 미리 보기 ▸
[조건 붙여 확인]  [결과 확인]  [수정 요청]  그 밖에: 거절(해결 안 됨) · 기준이 틀림 · 근거 보기 · 이의
```

확인하지 못한 기준이 있으면 위처럼 주 버튼(첫째, 초점 기본)이 [조건 붙여 확인]이 되고 조건 초안은 "기준 3(인용 자료 출처)은 리뷰 뒤 다시 확인"으로 채워진다. 모든 기준이 확인되었으면 주 버튼은 [결과 확인]이다.

결과 확인 알림은 화면 아래 한 줄로 보인다. 알리지 않음이면 "결과 확인 알림: 알리지 않음 · 설정 바꾸기 ▸", 하루 한 번 묶음이면 "결과 확인 알림: 하루 한 번 묶음 · 19:00"처럼 쓴다. 값과 묶음 시각은 `view:settings`의 `notifications`에서 받고, 바꾸기는 `SCR-SETTINGS`(§3.21)로 연다(11 §3.5.7, [결정 56], [판정 J-189]).

| 구역 | 내용 | 원천 |
|---|---|---|
| 머리 줄 | 기준 수와 판정 요약, 독립 검증 여부(다이얼, v0.3 07 §3)와 검증 에이전트의 독립성(생성 에이전트와 같은 모델인지) | canon-3 §8 08 "생성자와 확인자의 독립성" |
| 기준 표 | 기준별 판정: 충족 ✓ / 미충족 ✗ / 확인 못함 ?(08 `met`·`unmet`·`unverified`). 근거는 실제 관찰 링크. 근거가 모델 문장뿐인 기준은 거부하지 않고 "확인 못함"으로 낮춘 이유를 쓴다 | 발췌3 X3-2-11, 감사 §3.6 "거부와 강등의 구분" |
| 고정 표현 | 확인된 것 / 확인하지 못한 것 / 남은 제한 / 남은 전제 / 반대 근거 / 전체 영향 / 결과가 무효가 되는 조건 | canon §17.6 §3, §18.5, 인식적 완료 조건(canon §8.10) |
| 결과 확인 트리 | 완료 기준 → 확인된 기준과 근거 / 확인하지 못한 범위 / 남은 전제와 모르는 점 / 반대 근거와 알려진 제한 / 결과가 무효가 되는 조건(`invalidIf`) | canon §17.5 P04 §4 |
| 반영 범위 | 결과 제출 때 에이전트가 낸 반영 범위 초안(`integrationAgreementDraft.content`, 08 `AgreementContent`)을 구조 값으로 보인다. 범위(`scope`), 금지 자원(`forbiddenResources`), 금지 행동(`forbidden`), 범위 밖(`nonGoals`), 멈출 조건(`stopConditions`)을 각각 한 줄로 쓴다. 접지 않는다. 결과 확인·조건 붙여 확인이면 같은 트랜잭션에서 이 합의가 확정된다(`integrationAgreementId`, [판정 J-126]). [고치기]는 합의 초안을 고치는 `agreement.revise`이고, 고친 뒤 결과 확인 버튼 하나로 함께 확정된다 | 14 §3.6.8, 10 `result.accept` |
| 주의 항목 | 변경 목록에 `.gitattributes`·`.gitmodules`·`.git*` 파일이나 새 `.git` 디렉터리가 있으면 "git 설정 파일이 바뀌었습니다: (파일). 다음 git 실행에 영향을 줄 수 있습니다"를 접지 않고 보인다(18 §3.11.10). 승인됐지만 실행하지 않은 행동(소진되지 않은 승인)이 있으면 행동마다 한 줄로 "승인됐지만 실행하지 않은 행동: (대상) · (이유)"를 보인다. 이유는 08 `NotExecutedReason`(예: `approval_expired`)을 사람이 읽는 말로 바꿔 보인다(14 §3.12.3, F32). 결과 확인과 함께 그 승인은 만료된다 | 18, 14 |
| 반영 처리 방침 | 두 값(모두 진행 / 남는 제한은 미룸). 조건 붙여 확인의 조건은 같은 트랜잭션에서 미룬 반영 항목(다시 볼 조건 = 조건 문장)이 된다([판정 J-125]) | 01 R-OP-3 |

선호 모델 없음: 원함 탐구를 건너뛴 취향형 작업이면 머리 줄에 "선호 모델 없음 · 원함 탐구를 하지 않아 취향 기준으로 확인할 근거가 없습니다 [원함 탐구 열기]"를 보인다(01 FX-14).

예시의 독립 검증과 하위 Concern(12.2)은 각각 2단계·3단계 기능이다. MVP에서는 그 요소를 그리지 않는다(03 §3.6 단계).

취향형 작업(원함 탐구에서 온 결과): 선호 모델 기준 행에만 사람 판정 칸이 있고 "맞음 / 아님 / 모르겠음"을 고른다. 비워 둔 칸은 "모르겠음"으로 기록된다(08 `criteriaReview.verdict = not_confirmed`). 사람의 판정은 관찰로 기록된다. "모르겠음"이 하나라도 있으면 주 버튼은 [조건 붙여 확인]이고, "아님"이 하나라도 있으면 "원함 탐구로 돌아가기"(기준이 틀림, `reopenTo: "I.want"`)가 주 버튼에 더해진다(v0.3 03 §3.4). 고르기 형태의 대안 비교로 확인을 대신하지 않는다.

**레이아웃: 전체 반영 단계** (결과 확인 뒤 같은 화면 아래에 펼쳐짐)

```text
결과 확인됨 · 반영 3개 남음
──────────────────────────────────────────────────────────────────────────
Goal·이전 선택과 맞는가           맞음 (선택 39, Goal 2 v4)                    처리됨
다른 작업의 전제를 깨뜨렸는가      Concern 12.2(글 형식)의 "짧은 글" 전제와 충돌 ▸ [다른 Concern으로 넘기기] [미루기]
검증되거나 깨진 가정              "도입부는 장면으로"(질문 14 임시 가정) 검증됨 · "독자는 개발자다" 확인 안 됨
문서·규칙·테스트·외부 상태 갱신   글 목차 문서 갱신 필요                       진행 중(WorkUnit 33)
지역 개선이 전체를 낮추지 않는가  해당 없음 (이유: 1절만 바뀜)
실패 시 되돌리기·복구             이전 초안 버전 유지됨                         처리됨
남는 알려진 제한                  리뷰 의견 미반영                              [미루기]
──────────────────────────────────────────────────────────────────────────
반영 항목을 모두 처리하거나 넘기면 이 작업은 "완료"가 됩니다.
```

- 일곱 줄은 Integration Review 6(canon §12.8, "어떤 가정이 검증되거나 깨졌는가" 포함)과 전체 반영 체크 5(canon §17.5 P04 §5)를 합친 것이다. 데몬이 줄마다 항목을 만들고, 항목이 없으면 "해당 없음(이유)"을 보인다. 줄을 숨기지 않는다.
- 반영 항목 처리 자체(문서 갱신 등)는 결과 확인 때 고른 방침과 확정한 반영 범위대로 반영 WorkUnit이 진행한다. 사람은 따로 조작하지 않아도 된다. 바꾸고 싶을 때만 항목별로 미루기, 다른 Concern으로 넘기기, 처리함 확인을 쓴다(선택 조작이며 정상 경로 수에 들지 않는다, 01 §3.5.2).
- 미룬 항목은 다음 복귀 요약 0절에 보인다(발췌3 X3-2-14).

**인터랙션** (메서드는 19 `result.accept` 하나이고 `decision`에 10 명령 값을 싣는다. [판정 J-123], 19 §3.7.5 `ResultAcceptParams`)

| 동작 | 조작 | 명령 의도 | 결과 |
|---|---|---|---|
| 결과 확인 | 버튼(초점 후 Enter) | `result.accept { resultId, decision: "accept", obligationPolicy: "proceed_all" \| "defer_limits", integrationAgreementId?, criteriaReview?, bundledAnswers? }` | 10 `accept` → 08 `accepted`. 상태 "결과 확인됨 · 반영 n개 남음", 전체 반영 단계 펼침 |
| 조건 붙여 확인 | 버튼 → 조건 초안 고치기 | `result.accept { resultId, decision: "accept_with_conditions", conditions, obligationPolicy, integrationAgreementId?, criteriaReview? }` | 10 `accept_with_conditions` → 08 `conditional`. 조건마다 미룬 반영 항목이 생긴다([판정 J-125]) |
| 수정 요청 | 버튼 → 무엇을(기준 고르기 + 자연어) | `result.accept { resultId, decision: "request_changes", criteriaReview, note }` | 10 `request_changes` → 08 `revision_requested`. 합의를 유지한 채 진행 중으로(v0.3 03 §6) |
| 거절(해결 안 됨) | "그 밖에" → 거절 → 다음 루프와 이유 | `result.accept { resultId, decision: "reject", reopenTo, note? }` | 10 `reject` → 08 `rejected`. 합의를 닫는다(08 `released`). 다음 루프는 `reopenTo`: 직전 I가 있으면 앱이 그 루프를 기본값으로 채워 보내고, 없으면 거절 행 안에서 "새 합의 초안(C.commit) / 사실 탐구(I.fact)"를 함께 고른다. 고르는 것까지 조작 1회다([판정 J-04], [판정 J-24]) |
| 기준이 틀림 | "그 밖에" → 기준이 틀림 | `result.accept { resultId, decision: "criteria_wrong", reopenTo: "I.fact" \| "I.want", note? }` | 08 `criteria_wrong`. 합의를 닫고(08 `released`) I로 돌아간다(기본: 취향형이면 원함 탐구, 아니면 사실 탐구) |
| 확인 뒤 되돌리기 | 결과 확인 뒤 "이의" | `objection.file { target: { kind: "record", id: <ac id>, itemKey: null } }` | 결과 확인 전 거절과 다르다([판정 J-123]) |
| 반영 항목 처리됨 확인 | 사람이 직접 처리한 항목(예: 외부 문서 갱신)의 "처리함" | `obligation.confirmDone { obligationId, note? }` | 항목 상태 `resolved` |
| 반영 항목 미루기 | 항목 버튼 → 다시 볼 때(초안 제시)·이유 | `obligation.defer { obligationId, revisitTrigger: Trigger, reason }`(08 `Obligation.deferral`, 이유 필수) | 항목 상태 `deferred` |
| 다른 Concern으로 넘기기 | 항목 버튼 → 대상 고르기(초안 제시)·이유 | `obligation.transfer { obligationId, to: { concernId } \| { workUnitId }, reason }` | 항목 상태 `transferred` |
| 이의(기준별 판정에) | 판정 칸 메뉴 | `objection.file { target: { kind: "record", id: <rs id>, itemKey: "criterion:<cr id>" }, desiredEffect }`(08 `ObjectionTarget`, [판정 J-36]) | 그 기준이 "확인 못함"으로 바뀌고 수정 요청 초안이 생긴다 |
| 근거 보기 | 기준 행의 근거 링크, 또는 "그 밖에" → 근거 보기 | 없음(화면 이동) | `SCR-EVIDENCE`(§3.15)를 연다. 결과 확인 화면의 판정은 바뀌지 않는다 |

결과 확인 화면의 다섯 행동 이름(05 §3.4.1)과 값: 결과 확인 = 10 `accept` / 08 `accepted`, 조건 붙여 확인 = `accept_with_conditions` / `conditional`, 수정 요청 = `request_changes` / `revision_requested`, 거절(해결 안 됨) = `reject` / `rejected`, 기준이 틀림 = `criteria_wrong`([판정 J-35]). 1판의 `result.acceptWithConditions`·`result.requestRevision`·`result.reopen`은 쓰지 않는다([판정 J-123], 19 §3.7.1). 결과 확인 질문은 `question.answer`로 보내지 않는다([판정 J-124]).

**표시 데이터**: `view:review` (파라미터: `resultId` 또는 `workUnitId`)

```ts
interface ReviewView {
  meta: ViewMeta;
  result: RecordRef /* rs */; workUnit: RecordRef; concern: RecordRef; agreementRevision: number;
  question?: RecordRef;
  verification?: { by: Author; independentModel: boolean; attestations: RecordRef[] };
  notExecuted: { ref: RecordRef; target: string; reason: NotExecutedReason }[];   // 승인됐지만 실행하지 않은 행동 목록(14 §3.12.3 F32, 08 NotExecutedReason)
  criteria: { id: string; text: string; verdict: "met" | "unmet" | "unverified";   // 08 ResultSubmission 기준 판정
              evidence: StatementView[]; downgradedReason?: string;
              tastePreference?: boolean;          // 선호 모델 기준이면 사람 판정 칸을 그림
              humanJudged?: "yes" | "no" | "unsure" }[];
  tasteMode: boolean;                    // 선호 모델 기준 확인
  sections: { confirmed: string[]; unconfirmed: string[]; limitations: string[]; remainingAssumptions: StatementView[];
              challenging: StatementView[]; wholeImpact: string[] };
  invalidIf: string[];                   // 결과가 무효가 되는 조건
  integrationAgreementDraft?: { agreementId: string; content: AgreementContent };   // 반영 범위 초안(J-126, 08). 구조 값으로 접지 않는다. 확인 때 integrationAgreementId로 보낸다
  primaryAction: "accept" | "accept_with_conditions";   // 확인 못함 기준이나 "모르겠음"이 있으면 조건 붙여 확인
  defaultReopenTo?: "C.commit" | "I.fact" | "I.want";   // 직전 I. 없으면 거절 행에서 고른다(J-24)
  acceptance?: { by: Author; at: IsoTime; decision: "accepted" | "conditional" | "revision_requested" | "rejected" | "criteria_wrong"; conditions?: string[] };   // 08 AcceptanceDecision
  preferenceModelMissing?: boolean;      // 원함 탐구를 건너뛴 취향형 작업(01 FX-14)
  mobileReviewable?: boolean; mobileReason?: CopyRef;   // 휴대폰에서 확인할 수 있는지(26 §3.5.4, J-139). 결과 제출 시점에 런타임이 정해 ResultSubmissionCore.mobileReviewable에 실은 값을 그대로 보인다. 재작업으로 새 제출이 생기면 그 제출에서 다시 정한다([판정 J-225])
  obligations: { checkpoint: "goal_fit" | "breaks_assumptions" | "assumptions_checked" | "artifacts_updated" | "local_vs_whole" | "rollback" | "known_limits";
                 items: { ref: RecordRef; text: string; state: "open" | "resolved" | "deferred" | "transferred" | "waived"; workUnit?: RecordRef; deferredUntil?: string; transferredTo?: RecordRef }[];   // 08 ObligationStatus
                 naReason?: string }[];
  completeAllowed: boolean;               // 모든 항목 처리·넘김 → "완료"
}
```

**상태**

| 상태 | 표시 |
|---|---|
| 기준 일부가 아직 검증 중(검증 에이전트 진행 중) | "검증 에이전트가 기준 1을 확인하는 중입니다." 결과 확인 버튼은 쓸 수 있되 옆에 "검증을 기다리지 않고 확인" 문구 |
| 합의가 바뀐 뒤 제출(옛 revision 기준) | "이 결과는 바뀌기 전 합의(판 2) 기준으로 제출되었습니다. 바뀐 기준 1개는 확인되지 않았습니다." (canon-2 F5) |
| 모든 반영 처리됨 | 머리 "완료" + 처리 내역 |
| 반영 미룸만 남음 | "결과 확인됨 · 반영 미룸 1개" ("완료"를 쓰지 않음, 03 IA-08) |
| 산출물을 아직 열지 않음(휴대폰) | 결과 확인 버튼 비활성, "산출물을 먼저 열어 보세요"(`notice.mobile.openOutputFirst`) |

**사람 조작 횟수**: D 1(결과 확인과 반영 처리 방침·반영 범위를 함께). 조건 붙이기 = D 1 + I 1. 반영 단계의 항목별 조작은 선택이다.

### 3.13 `SCR-LOOPS` 루프 이력

**목적**: 이 Concern이 어떤 루프를 거쳤고 언제 왜 전환했는지, 상황 판정과 모드가 어떻게 바뀌었는지 시간순으로 본다(v0.3 09 §4.2 루프 이력).

**진입 경로**: Concern 탭 "이력", 개요의 루프 계획 "루프 이력", 에이전트가 정한 것의 루프 전환 항목.

**레이아웃**: 세로 시간선. 루프 구간(시작–끝, 걸린 시간, 그 구간의 주요 산출물 수)과 구간 사이 전환 표시. 계획 기록은 시간선에 "계획 v2 · 에이전트가 설계한 계획 · 건너뜀: 탐침(이유)" 줄로 끼운다.

```text
어제 21:00  상황 파악                          (12분) 상황 판정: 해 봐야 아는 일 ▸
            ↓ 전환: 원함 탐구로 · 계획대로
어제 21:12  원함 탐구 라운드 1~2               (1시간) 기준 후보 3 · 질문 1
            ↓ 전환: 탐침으로 · 이유: 기준 확인용 짧은 초안 필요 · 에이전트가 정함 [이의]
어제 22:20  탐침 ×3                            (40분) 키울 조건 충족 1
            ↓ 전환: 구조 나누기 · 이유: 주제와 형식의 선호가 따로 움직임(관찰 31) [이의]
어제 23:30  구조: 나누기 → Concern 12.1, 12.2
```

거르기: 의미 있는 것만(기본: 루프 전환, 루프 계획, 상황 판정, 모드 변경, 질문, 선택, 결과 제출·확인) / 모두(감사 깊이: 모든 이벤트).

**표시 데이터**: `view:loopTimeline` (파라미터: `concernId`, `detail: "meaningful" | "all"`)

```ts
interface LoopTimelineView {
  meta: ViewMeta;
  segments: { loop: string; startedAt: IsoTime; endedAt?: IsoTime; outputs: { kind: RecordKind; count: number }[]; notable: RecordRef[] }[];
  transitions: { ref: RecordRef; from: string; to: string; at: IsoTime; reason: string; trigger?: RecordRef; decidedBy: Author; autonomous: boolean; contested: boolean; planned: boolean }[];
  situationChanges: { ref: RecordRef; from: string | null; to: string; at: IsoTime; by: Author }[];
  modeChanges: { from: string | null; to: string; at: IsoTime; by: Author }[];
  plans: { ref: RecordRef /* lp */; version: number; at: IsoTime; decidedBy: Author; authoredBy: "code" | "model" | "human";
           skipped: { loop: string; reason: string }[]; outOfPattern?: { evidence: string[] }; modelDraftRejects?: string[] }[];   // 계획 기록(09 loop_plan.adopted, authoredBy는 [판정 J-188] (5). modelDraftRejects는 시도 순서대로 최대 2개이고 화면은 마지막 항목을 쓴다)
}
```

**인터랙션**: 전환 이의(`objection.file`, 대상 `lt`), 계기 관찰 열기(검사 패널), 구간 선택 시 그 구간의 레코드를 검사 패널에.

**사람 조작 횟수**: 보기만. 이의 1~2.

### 3.14 `SCR-THREAD` 대화

**목적**: Concern에 딸린 대화를 보고 자연어로 말한다. 대화는 상태를 만들고 바꾸는 행위 채널이며 정본이 아니다(canon-3 §6.8).

**진입 경로**: Concern 탭 "대화", 입력창에서 보낸 말의 "대화에서 보기".

**레이아웃**: 시간순 메시지. 메시지 종류 라벨: 나 / 에이전트 설명(역할 표시) / 기록됨(의미 미리보기로 상태가 바뀐 경우, 레코드 링크) / 질문 카드(질문함의 같은 카드를 끼워 보임) / 활동 요약 한 줄.

규칙:

- 에이전트 메시지는 "에이전트 설명"으로 표시한다. 관찰·선택·작업 합의·결과 제출 라벨은 커널 레코드에서만 붙는다(03 §3.1.2 규칙 8).
- 대화 안에 끼워 보인 질문 카드의 버튼은 질문함과 같은 명령 의도를 보낸다. 모델 도구 경로로 사람의 결정을 보내지 않는다(발췌4 15-7, 결정 14).
- 사용자의 발화가 의미 상태를 바꿀 수 있으면 의미 미리보기(05 §3.5)를 메시지 아래에 붙인다.
- 관찰 에이전트의 제안은 이 대화에 쓰지 않는다(발췌1 E1-088). 관찰 제안함에만 들어간다.
- 모델의 사고 과정 원문은 보이지 않고 근거로 쓰지 않는다(canon-3 G15).
- 21 UI-D11에 따라 assistant-ui Thread를 쓸 수 있다. 정보 구조는 같다.

**표시 데이터**: `view:thread` (파라미터: `concernId`, 페이지 `beforeSeq?`)

```ts
interface ThreadView {
  meta: ViewMeta;
  concern: RecordRef;
  messages: (
    | { kind: "human"; at: IsoTime; text: string; observation?: RecordRef; preview?: { recorded: RecordRef[]; summary: CopyRef } }
    | { kind: "agent"; at: IsoTime; role: AgentRole; text: string; run?: RecordRef }       // "에이전트 설명"
    | { kind: "recorded"; at: IsoTime; records: RecordRef[]; summary: CopyRef }           // 의미 미리보기로 기록됨
    | { kind: "question"; at: IsoTime; question: QuestionSummary }
    | { kind: "activity"; at: IsoTime; summary: string; workUnit: RecordRef }
  )[];
  hasMoreBefore: boolean;
}
```

**인터랙션**: 입력창(범위: 이 Concern) → `composer.submit { scope, text }`. 메시지 메뉴 "이 말을 기록으로" → 의미 미리보기 요청.

**사람 조작 횟수**: 말하기 1.

### 3.15 `SCR-EVIDENCE` 근거 체인

**목적**: 판단, 선택, 결과 확인, 기준 후보의 근거를 원본(도구 실행 기록, 사람 발화, 외부 응답)까지 따라 내려간다(v0.3 09 §4.7, canon-3 §6.6.6).

**진입 경로**: 판단·선택·기준 판정의 "근거", 검사 패널에서 "넓게 보기", 딥 링크 `helm://evidence/<id>`, 명령 팔레트 "판단 찾기", 질문함의 "판단 확인" 질문(`finding_confirm`, 이때 머리에 판단 확인 구역이 열린다).

**레이아웃**

```text
판단 확인 · 질문 20 (확인하면 좋은 것)
  이 판단을 선택 39의 근거로 씁니다. 판단으로 두어도 될지 확인하면 좋습니다
  [이 판단으로 두기]  [범위 좁혀 두기]  [판단이 아님 → 이의]  그 밖에: 미루기 · 질문 다시 쓰기
──────────────────────────────────────────────────────────────────────────
판단 17 · Concern 12 · "길이보다 장면 묘사가 반응을 좌우한다"            [이의]
지지: 일관됨 · 승격: 어제 22:15 · 반대 근거 검토: 찾아봄, 없음
──────────────────────────────────────────────────────────────────────────
├─ 근거 · 관찰 21  "도입부 D(장면, 긴 글)에 아주 좋음"      사람 반응 · 어제 21:30
│     직접 확인 · 최신 · 이 판단 전체를 지지
├─ 근거 · 관찰 24  "도입부 B(설명, 짧은 글)에 이유 없이 아님" 사람 반응 · 어제 21:35
│     구분 확인: 길이와 장면을 따로 바꾼 자극 쌍 ▸
├─ 근거 · 관찰 27  …
├─ 반대 근거 검토  찾아봄 · 관찰 29 "짧은 장면 글 E에 상관없음" → 판단을 뒤집지는 않고 범위를 좁힘(한정) ▸
└─ 아직 모르는 점  리뷰어 같은 다른 독자의 반응
이 근거가 바뀌면 다시 열릴 것: 선택 39 · 작업 합의 9 · 선호 모델 기준 1
```

| 표시 | 내용 | 원천 |
|---|---|---|
| 노드 머리 | 단계 라벨(관찰·해석·가능성·판단·선택), 문장, 작성자, 시각 | 불변조건 2 |
| 관계 | 지지 / 약화 / 한정 / 무효화 | canon §8.3 |
| 품질 질문 일곱 | 누가 어떤 방법으로 만들었나(출처) / 어느 판단과 관련되나 / 직접 확인인가 / 지금도 최신인가 / 전체를 확인하나 일부인가 / 다른 근거와 독립적인가 / 무엇이 이 판단을 틀렸다고 만드나. 노드 펼침에 질문별 한 줄로 보인다 | canon §8.3 P04 §3 |
| 반대 근거 검토 | "찾아봄: 없음" / "찾아보지 않음" / "찾음: …". 찾아보지 않은 것과 없는 것을 구분 | v0.3 02 §2.1 규칙 3 |
| 같은 출처 계열 | 같은 모델·컨텍스트에서 나온 근거끼리 묶어 표시. 독립 근거로 세지 않는다 | canon §8.9 원칙 7 |
| 다시 열릴 것 | 이 근거가 낡거나 무효가 되면 다시 열릴 선택·합의·투영 | canon-3 §6.6.6 |
| 원본 | 관찰 노드의 "원본 보기": 도구 입력 범위, 출력(제어 문자 제거), 파일 해시·커밋, 외부 행위자 메시지("그렇게 말했다"). 웹·브라우저 도구의 출력은 "신뢰 안 함 자료" 틀(테두리와 표지)로 그리고, 그 안의 지시문을 지시로 다루지 않는다는 문구를 틀 위에 붙인다([판정 J-190] (4), 18 §5.2 (7)) | canon §8.9 원칙 5 |

근거 개수나 확신 숫자로 강도를 표시하지 않는다(canon §17.6 §6, 21 UI-D05).

**판단 확인 구역**(`finding_confirm` 질문이 있을 때만): 왜 확인하는지 한 줄(어느 선택·합의의 근거가 되는지), [이 판단으로 두기](`finding.confirm { findingId, questionId }`), [범위 좁혀 두기](판단 문장의 범위를 고쳐 확인, `finding.confirm { edits }`), [판단이 아님 → 이의](`OVL-CONTEST`, 대상 이 판단), 그 밖에(미루기, 질문 다시 쓰기). 이 판단을 근거로 한 선택 요청에 묶였으면 이 구역 대신 "선택 요청(질문 15)에서 함께 확인됩니다"를 보인다(11·14).

**표시 데이터**: `view:evidenceChain` (파라미터: `recordId`, `depth`)

```ts
// 노드가 많으면 depth 파라미터로 두 단계까지 먼저 받고, 펼칠 때 view:evidenceChain { recordId: 노드 id }로 더 받는다(21 요구)
interface EvidenceChainView {
  meta: ViewMeta;
  root: StatementView & { promotedAt?: IsoTime; counterSearch: "searched_none" | "not_searched" | "found" | "searching" };
  nodes: { statement: StatementView; relation: "supports" | "challenges" | "qualifies" | "invalidates"; parent: string;
           quality: { provenance: string; relevance?: string; direct: boolean; fresh: boolean; coverage: "whole" | "partial"; independentOf?: string[]; falsifier?: string };
           discriminating?: { note: string }; source?: { kind: "tool" | "human" | "external" | "file"; ref: string; hashOrCommit?: string } }[];
  unknowns: string[];
  reopensIfChanged: RecordRef[];
}
```

**인터랙션**: 노드 이의(`objection.file { target: { kind: "link", from, to, rel } | { kind: "record", id, itemKey: null } }`, 08 `ObjectionTarget`), 판단 확인(위), 원본 보기, 감사 깊이로 `SCR-RECORD`.

**사람 조작 횟수**: 보기만. 판단 확인 D 1. 이의 D 1(이유를 쓰면 I 1 추가).

### 3.16 `SCR-GOALS`, `SCR-GOAL` Goal과 Goal 상세

**목적**: Goal 목록과 각 Goal의 현재 버전을 보고(`SCR-GOALS`), Goal 하나의 내용·버전 이력·수정 제안·선호 모델·영향받는 작업 합의를 본다(`SCR-GOAL`, v0.3 09 §4.8, 결정 11). Goal 변경은 사람이 확인한다(의존 규칙 5 [제안]).

**진입 경로**: 내비게이션 5번, Mod+5, `G G`, 홈 Goal 머리, 질문함의 "Goal 확인" 질문, 딥 링크.

**레이아웃: `SCR-GOALS`**: 프로젝트별로 Goal 행(이름, 현재 버전, 연결된 Concern 수, 열린 Concern 중 사람 필요 수, 마지막 변경, 선호 모델 기준 수, 상태 라벨 03 §3.3.3: Goal 초안·진행 중·잠시 멈춤·이뤄졌다는 주장·이뤄짐·다른 Goal로 대체됨·그만둠). 상위·하위 Goal은 들여쓰기. 자리표시 Goal은 "이름 없는 Goal"과 [Goal 초안 만들기]. 그만둔 Goal은 접되, 그 아래 아직 활성인 합의가 있으면 "그만둔 Goal 아래 합의 2개(새 쓰기는 거부됨)"를 주의 항목으로 펼친다([판정 J-130]). 목록 위에 [새 Goal](프로젝트 고르기 → 에이전트 초안 → 초안 카드).

**레이아웃: `SCR-GOAL`**

```text
Goal 2 블로그 글쓰기 방향 정하기 · v4 · 진행 중
──────────────────────────────────────────────────────────────────────────
수정 제안 (Goal 확인 · 질문 18)
  성공 조건: "독자가 끝까지 읽는다"
        →   "독자가 끝까지 읽고, 글의 장면을 한 줄로 다시 말할 수 있다"
  계기: Concern 12 원함 탐구 반응(관찰 21, 24, 27), 판단 17
  반대 근거: 관찰 29 "짧은 장면 글 E에 상관없음" (접지 않음)
  바꾸면 다시 확인할 작업 합의: 작업 합의 9 (WorkUnit 31)
  [이대로 바꾸기]  [고쳐서 바꾸기]  [바꾸지 않기]  그 밖에: 미루기 · 이의
──────────────────────────────────────────────────────────────────────────
현재 내용(v4)
  서술       개인 하네스 회고 글을 장면 중심으로 쓴다
  성공 조건  독자가 끝까지 읽는다
  지킬 것    사실과 다른 일화를 지어내지 않는다
  선호 모델  기준 3 (도입부는 장면으로, 길이보다 구체성, 설명은 짧게) ▸
  하위 Goal  없음 · 상위 Goal 없음
──────────────────────────────────────────────────────────────────────────
버전 이력
  v4  10월 10일 · 지킬 것 추가 · 계기: Concern 9 이의(선택 30) · 내가 확인
  v3  10월 8일  · 서술 변경 · 계기: Concern 7 원함 탐구 · 내가 확인       [v3 ↔ v4 비교]
  …
```

| 구역 | 내용 |
|---|---|
| 첫 Goal 초안 | Goal이 `proposed`이면 맨 위에 초안 카드: 에이전트가 프로젝트 폴더와 사용자 말에서 만든 서술·성공 조건·지킬 것, 근거(읽은 파일). [이 Goal로 시작] [고쳐서 시작](제자리 편집 뒤 확정) [나중에](자리표시 Goal로 진행, 01 FX-13) + 그 밖에(이의) |
| 수정 제안 | 대기 중인 Goal 수정 제안(이벤트 `goal.revision_proposed`). 바뀌는 항목의 이전/이후, 계기(Concern, 관찰, 반응, 판단), 반대 근거(접지 않음, 02 AC-09-03), 바꾸면 다시 확인 대상이 될 작업 합의와 컨텍스트 |
| 현재 내용 | 서술, 성공 조건, 지킬 것(보존 제약), 선호 모델 연결, 상위·하위 Goal(v0.3 02 §3.2) |
| 버전 이력 | 버전마다 바뀐 항목, 계기, 확인한 사람(또는 "확인 없음"이 있으면 이상으로 표시), 비교 링크 |
| 다시 확인할 것 | Goal이 바뀐 뒤 다시 확인 대상이 된 작업 합의·선택과 상태(확인 기다림 / 다시 확인됨 / 대체됨). 해당 합의가 다시 확정되거나 대체되면 데몬이 지운다(12) |
| 선호 모델 | 기준, 무게(높음·중간·낮음), 근거 반응, 반대 반응, 좋았던 예·싫었던 예, 말한 것과 반응의 차이. 기준마다 다시 볼 조건 |

**표시 데이터**: `view:goals`, `view:goal` (파라미터: `goalId`)

```ts
interface GoalsView {
  meta: ViewMeta;
  projects: { id: string; name: string; rootPath: string;
              goals: { ref: RecordRef; state: GoalView["state"]; placeholder: boolean; version: number; concerns: number;
                       needsHuman: number; lastChangeAt: IsoTime; criteria: number; children: string[]; agreementsUnderRetired: number }[] }[];
}
```

```ts
interface GoalView {
  meta: ViewMeta;
  ref: RecordRef; version: number;
  state: "proposed" | "active" | "paused" | "achievement_claimed" | "achieved" | "superseded" | "retired";   // 08 GoalStatus
  placeholder: boolean;                  // 08 "이름 없는 Goal"
  project: { id: string; path: string };
  statement: string; successCriteria: string[]; preserve: string[];
  draftEvidence?: RecordRef[];           // proposed일 때 초안 근거(읽은 파일 관찰)
  parent?: RecordRef; children: RecordRef[];
  preferenceModel?: PreferenceModelView;
  pendingRevision?: { question: RecordRef; changes: { field: string; before: string; after: string }[];
                      triggers: RecordRef[]; counter: StatementView[]; affectedAgreements: RecordRef[] };
  recheck: { ref: RecordRef; state: "waiting" | "rechecked" | "superseded" }[];
  agreementsUnderRetired?: RecordRef[];  // retired Goal 아래 활성 합의(J-130)
  history: { version: number; at: IsoTime; changedFields: string[]; triggers: RecordRef[]; confirmedBy: Author | null }[];   // 버전 본문은 비교를 열 때 view:goal { goalId, version }으로 따로 받는다(21 요구)
}
```

**인터랙션**

| 동작 | 명령 의도 |
|---|---|
| 이 Goal로 시작 / 고쳐서 시작 | `goal.activate { goalId, edits? }`(19) |
| 새 Goal | 프로젝트 고르기 → 입력창(범위: 새 일)에 이루려는 것 → 에이전트 초안 카드. 사람이 내용을 다 써서 바로 만들면 `goal.propose { core, activateNow: true }` |
| 이대로 바꾸기 | `goal.confirmRevision { revisionQuestionId }` |
| 고쳐서 바꾸기 | 제자리 편집 → `goal.confirmRevision { edits }` |
| 바꾸지 않기 | `goal.rejectRevision { note? }` |
| 직접 고치기(제안 없이) | 항목 제자리 편집 → `goal.revise { field, value }` (사람이 쓴 수정. 확인 질문 없이 새 버전) |
| 이뤄졌다는 주장 아님 | `goal.rejectAchieved` |
| 이뤄짐 확인 | `goal.confirmAchieved` (이뤄짐 주장이 있을 때) |
| 버전 비교 | 없음 |

**상태**: Goal이 없으면 §3.1 빈 상태와 같은 안내. 수정 제안이 없으면 그 구역을 숨긴다.

**사람 조작 횟수**: Goal 확인 결정 1. 첫 Goal 확정 1(고치면 I 1 추가).

### 3.17 `SCR-DIALS` 다이얼·모드

**목적**: 현재 범위(사용자 전체 또는 Concern)의 모드와 다이얼 값을 보고, 값이 어느 층에서 왔는지 확인하고 바꾼다(v0.3 09 §4.9, 07 §3·§6). Goal 범위 다이얼은 두지 않는다([판정 J-136]). Directability의 중심 화면이다.

**진입 경로**: 상태 줄의 모드 표시, Concern 메뉴 "다이얼", 설정 "질문 전달 기본값", 명령 팔레트 "모드 바꾸기"·"다이얼", 딥 링크 없음.

**레이아웃**

```text
다이얼 · 범위: Concern 12 블로그 글 방향 [범위 ▾]
──────────────────────────────────────────────────────────────────────────
모드  취향 탐색 · 에이전트가 정함(어제 21:00, 이유: 상황 유형 "해 봐야 아는 일")  [모드 바꾸기] [이의]
      중심 루프: 상황 파악, 원함 탐구, 가능성 탐구, 탐침
      쓰는 능력: 읽기, 초안 쓰기, 하위 실행, 묻기 · 쓰지 않는 능력: 보내기

다이얼                값                       출처 층               
기본 전달 방식        예약(라운드 경계)         모드 기본값            [값 바꾸기]
질문 조건 문턱        보통 · 보통 · 보통        시스템 기본값          [값 바꾸기]
즉시 승격 문턱        보통                      시스템 기본값
만료 여유             작업 경계 하나 전         시스템 기본값
종류별 예외           "보내기는 항상 묻기"      내 저장된 설정
관점 폭               넓게                      모드 기본값
탐구 깊이             라운드 4                  이 Concern에서 바꿈    [기본값으로 되돌리기]
근거 범위             웹까지                    모드 기본값
자율 정도             2라운드                   모드 기본값
예산                  하위 호출 30 · 2시간      시스템 기본값
자극 수               라운드당 8                내 저장된 설정
증명 부담             보통                      시스템 기본값
독립 검증             결과 확인 전 거침         내 저장된 설정
──────────────────────────────────────────────────────────────────────────
바꾼 값의 반영 시점은 다이얼마다 다릅니다(질문 다이얼은 바로, 탐구 다이얼은 다음 라운드 경계, 증명 부담·독립 검증은 다음 루프 시작).
다이얼로 바뀌지 않는 것 ▸ (불변조건 1~7: 예를 들어 질문을 적게 두어도 에이전트는 결과를 확인할 수 없습니다)
```

| 구역 | 내용 |
|---|---|
| 범위 | 사용자 전체(08 `DialLayer` `user`), 이 Concern(`concern`), 진행 작업 하나(`instruction`, 그 지시로 시작한 WorkUnit 하나. 14 §3.11.2). Goal 범위는 없다([판정 J-136]). MVP는 여섯 다이얼만 보이고 나머지는 2단계에 연다. 여섯 가운데 다섯은 01 §3.8.2의 기본 전달 방식, 질문 빈도, 예산, 자극 수, 탐구 깊이이고, 나머지 하나는 `planAuthoring`(루프 계획 방식)이다. `planAuthoring`은 [결정 53]이 사람에게 고르게 한 값이므로 MVP에서도 보인다. 설정 화면(§3.21)에서도 고를 수 있다([판정 J-192]) |
| 모드 | 현재 모드, 고른 주체(에이전트 / 사람 / 상황 유형 기본값), 이유, 중심 루프, 능력 부분집합(원시 행동과 기록 능력을 사람이 읽는 말로), 바꾸기, 라우팅 이의 |
| 다이얼 표 | 14 다이얼 정의의 다이얼과 현재 값, 값을 정한 해석 순서(14 `DialPrecedence`: 1 시스템 기본값 / 2 상황 유형별 기본값 / 3 고른 모드 / 4 사용자의 저장된 설정 / 5 현재 Concern에서 바꾼 값 / 6 지금 이 지시). 4~6은 08 `DialLayer`(`user`, `concern`, `instruction`)로 저장되고, 화면에서 사람이 바꾸는 것은 4와 5다([판정 J-136]). `planAuthoring`(값 `computed`: 코드 계산만 / `hybrid`: 혼합(기본) / `model`: 모델 설계)은 층 4·5만 가진다([판정 J-188], [결정 53]). 6(지시)은 그 WorkUnit이 끝나면 사라진다 |
| 루프별 설정 | 질문 다이얼을 루프별로 다르게 둔 값(펼침) |
| 불변조건 안내 | 다이얼로 바뀌지 않는 것(v0.3 07 §7) |

다이얼 이름과 값의 정본은 14가 정한다. 화면은 데몬이 보내는 다이얼 정의(이름, 값 목록, 설명)를 그대로 그린다. 앱 코드에 다이얼 목록을 고정해 두지 않는다(값이 바뀌어도 앱을 고치지 않게).

**표시 데이터**: `view:dials` (파라미터: `scope`)

```ts
interface DialsView {
  meta: ViewMeta;
  scope: { kind: "user" | "concern" | "instruction"; ref?: RecordRef };   // 08 DialLayer 중 사람이 화면에서 바꾸는 셋. instruction의 ref는 WorkUnit(14 §3.11.2). Goal 범위 없음(J-136)
  attentionBudget: AttentionBudgetVM;   // 주의 예산 막대(§3.1)
  mode: { id: "orient" | "investigate" | "deliberate" | "taste" | "execute" | "verify" | "restructure" | "emergency"; name: string; decidedBy: "rule" | "human"; assignment: RecordRef /* md, 이의 대상 */; precedence: 3 | 5 | 6; reason?: string; at?: IsoTime; centralLoops: string[];
          capabilities: { label: string; on: boolean }[]; contested: boolean; choices: { name: string; description: string }[] };
  dials: { key: string; label: string; description: string; value: string; valueLabel: string;
           options: { value: string; label: string }[] | { kind: "number"; min: number; max: number; unit: string };
           precedence: 1 | 2 | 3 | 4 | 5 | 6 /* 14 DialPrecedence */; precedenceLabel: CopyRef; storedLayer?: "user" | "concern" | "instruction" /* 08 DialLayer */; editableAt: ("user" | "concern")[];
           appliesAt: "immediate" | "next_round" | "next_loop";
           required?: string; belowRequired?: boolean /* 증명 부담 자동 상향(14 §3.11.7) */;
           perLoop?: Partial<Record<"O" | "I" | "C" | "A" | "S", string>> }[];
}
```

**인터랙션**: 값 바꾸기 → `dial.set { layer, scopeId, key, value }`(지시 층이면 `scopeId`는 WorkUnit id). 기본값으로 되돌리기 → `dial.unset { layer, scopeId, key }`. 모드 바꾸기 → `mode.set { concernId, mode }`(에이전트의 지정은 `mode.route`). 모드 이의 → `objection.file { target: { kind: "record", id: <md id>, itemKey: null } }`. 반영 문구는 다이얼의 `appliesAt`에 따라 "바로 반영됩니다" / "다음 라운드 경계에 반영됩니다" / "다음 루프 시작에 반영됩니다" → 반영 이벤트가 오면 "반영됨". params 정본은 19 §3.7.5.

**사람 조작 횟수**: 값 하나 바꾸기 2(열기 + 고르기).

### 3.18 `SCR-OBSERVER` 관찰 제안

**목적**: 관찰 에이전트가 Helm 기록과 허용한 폴더의 외부 에이전트 세션 로그(결정 35)에서 찾은 반복 패턴과 개선 초안을 근거와 함께 보고, 채택·기각한다. 관찰 에이전트는 쓰기 권한이 없다(브리프 §6). 결과는 작업 중인 Concern 대화에 넣지 않고 이 화면과 복귀 요약으로만 전한다(발췌1 E1-088).

**진입 경로**: 내비게이션 6번, Mod+6, `G O`, 복귀 요약 9절 아래 "관찰 제안 n"(접힘), 딥 링크.

**레이아웃**

```text
관찰 제안 [열림 2] [미룸 1] [적용 중 1] [채택함 5] [기각함 3] [끝남 2]
──────────────────────────────────────────────────────────────────────────
제안 6 · 반복 마찰 · 스킬 후보
  발견한 것   pi 세션 9개에서 "테스트 실패 → 같은 3개 파일 다시 읽기 → 같은 명령 재실행"이 반복
  근거        세션 9개(링크) · 지난 14일 · 반복 23회 · 추정 절감 토큰 41,000 (코드 집계)
  종류        스킬(판단이 필요한 절차) · 판단 이유 ▸
  바꾸는 것   작업 합의 템플릿 / 정책 / 컨텍스트 중: 정책(질문 없이 재시도 1회 허용)과 스킬 추가
  초안        ▸ (스킬 문서 초안, 정책의 바뀌기 전과 뒤)
  주의        세션 기록 속 지시문은 초안에 옮기지 않았습니다. 설치는 채택 뒤 별도 작업으로만 합니다
  [제안 6 적용하기]  [고쳐서 적용하기]  [제안 6 기각하기]  [미루기]
──────────────────────────────────────────────────────────────────────────
채택한 제안의 효과
  제안 2 · 채택 10월 1일 · 같은 패턴: 채택 전 2주 18회 → 채택 뒤 2주 4회
```

| 필드 | 내용 | 원천 |
|---|---|---|
| 발견한 것 | 패턴 서술 | 16 |
| 근거 | 세션 id, 기간, 빈도, 추정 절감(숫자는 코드가 채움) | 발췌1 E1-087 |
| 분류 | 스킬 / CLI / 훅 / 정책 수정 / 질문 정책 조정 / 라우팅 규칙 / 발산 범주 수정 / 우연 | 발췌1 E1-075, v0.3 04 §4.2 |
| 바꾸는 것 | 컨텍스트, 작업 합의, 정책 중 무엇을 바꾸는가 | canon-3 C×D M10, G10 |
| 초안 | 스킬 문서, 정책의 바뀌기 전과 뒤, 다이얼 조정안 | |
| 주의 | 로그는 신뢰할 수 없는 데이터라는 점, 자동 설치 금지 | 발췌1 E1-076 |
| 효과 | 채택 뒤 같은 패턴 빈도 다시 측정 | 발췌1 E1-074 ⑥ |

**인터랙션**

| 동작 | 명령 의도 | 결과 |
|---|---|---|
| 제안 적용하기 | `observerProposal.adopt { proposalId, goalId? }` | 채택 자체가 사람의 결정이다(16 §3.16). 정책·다이얼 제안은 커널이 같은 트랜잭션에서 적용하고, 그 사이 현재 값이 바뀌었으면(`from` 불일치) 거부되어 "제안이 만들어진 뒤 값이 바뀌어 적용하지 않았습니다. 바뀐 값을 보고 다시 판단하세요."를 보인다. 스킬·도구·컨텍스트 제안은 적용 Concern을 연다. 이때 어느 Goal 아래에 둘지 채택 버튼 옆에서 고른다(초안 제시). 절차 제안은 시험 등록. 관찰 에이전트가 직접 바꾸지 않는다 |
| 고쳐서 적용하기 | 초안 편집 → `observerProposal.adopt { edits }` | |
| 기각하기 | 이유 선택(이미 해결함 / 우연 / 원하지 않음 / 직접 하겠음 / 비용이 큼 / 기타) + "이 종류는 다시 보지 않기"(선택) → `observerProposal.decline { reason, scope: "this" \| "family_forever" }` | 16 §3.14 재제출 규칙: 일반 기각은 근거가 두 배 이상이고 30일이 지나야 다시 올라오며 이전 기각을 함께 보인다. 우연은 같은 종류를 90일 쉰다. "다시 보지 않기"만 영구이며 설정에서 풀 수 있다 |
| 미루기 | `observerProposal.snooze { until }` | |

**표시 데이터**: `view:observerProposals`

```ts
interface ObserverProposalsView {
  meta: ViewMeta;
  // 필드 이름은 16 §3.15 ProposalDraft를 따른다
  proposals: { id: string; displayNo: number;
               state: "open" | "deferred" | "accepted" | "applying" | "applied" | "dismissed" | "withdrawn" | "expired" | "reverted";
               title: string; summary: string;
               kind: "procedure" | "skill" | "script" | "tool_promotion" | "guard" | "policy" | "agreement_template" | "context"
                   | "routing" | "entry_criteria" | "divergence_category" | "lens" | "demotion";
               changes: ("context" | "agreement" | "policy" | "procedure" | "tooling")[];
               evidence: { windowStart: IsoTime; windowEnd: IsoTime; occurrences: number; sessions: number; distinctDays: number;
                           refs: { label: string; filePath?: string; line?: number; excerpt?: string /* 마스킹됨 */ }[] };
               estimate?: { savings: number; unit: "tokens_per_28d" | "human_ops_per_28d"; formula: string };   // 화면에 "추정"과 식을 함께
               draft: { format: string; body: string }; patch?: { from: string; to: string };
               risks: string[]; flags: { injectionSuspect: boolean; llmUsed: boolean; priorDismissalId?: string };
               effect?: { checkpoints: { day: 7 | 14 | 28 | 56; metric: string; before: number; after: number; unit: string }[];
                          verdict?: "effective" | "ineffective" | "inconclusive" | "harmful" } }[];
}
```

**사람 조작 횟수**: 적용 1. 기각 2(버튼 + 이유).

### 3.19 `SCR-CONNECT` 연결·기기

**목적**: 데스크톱 앱이 데몬에 붙는 방식(Tailscale serve를 거친 WSS, SSH를 거친 접속, 결정 26·38)을 정하고, 기기를 페어링·폐기하고, 데몬 상태를 본다. 연결 문제를 사람이 스스로 진단할 수 있게 한다. 연결 방식의 기술 세부(포트, 터널, 토큰 형식)는 17·18·19·20이 정하며, 이 화면은 그 결과를 표시한다.

**진입 경로**: 상단 막대 연결 표시, 연결 배너 "연결 화면 열기", 설정 "연결", 첫 실행(`SCR-ONBOARD`가 같은 구성 요소를 쓴다).

**레이아웃**

```text
연결·기기
──────────────────────────────────────────────────────────────────────────
지금 연결  ● 연결됨 · Tailscale · https://server.<tailnet>.ts.net:<포트>
          지연 42ms · 마지막 이벤트 14:02 · 프로토콜 v1 · 서버 Helm 0.1.0
          이 기기: MacBook (기기 7) · 마지막 인증 오늘 09:08
──────────────────────────────────────────────────────────────────────────
연결 방식
  ● Tailscale   주소 [server.<tailnet>.ts.net] 포트 [   ]          [시험]
  경로 1 Tailscale (권장)   [시험]
  경로 2 SSH   대상 [server 또는 user@host] 포트 [선택] 키 [선택] 호스트 키 확인 [엄격 ▾]   [시험]
                (`~/.ssh/config`를 그대로 씁니다. 전달 방식은 19·20)
  시도 순서: 경로 1 → 경로 2 (순서대로, 자동 전환 켬이 기본: 20 APP-D05) ▾  · 경로 2는 3번 연속 실패해 30분 미룸 [지금 다시 연결]
  이 프로필의 서버: server-7f3a (다른 서버면 연결하지 않음)
──────────────────────────────────────────────────────────────────────────
서버 상태
  실행 중 · 시작 10월 11일 08:02 (1시간 6분) · 진행 중 작업 3 · 다음 예약 실행 09:40
  기록 저장소 1.2GB · 마지막 백업 오늘 04:00 · 디스크 여유 120GB · 모델 제공자 연결됨
  (안전 모드일 때) 안전 모드 · 사유: 10분 안에 비정상 종료 3번(마지막 09:58) · 에이전트 작업 멈춤
                  [안전 모드 풀고 작업 다시 시작하기]
  (읽기 전용일 때) 읽기 전용 · 사유: 디스크 부족(여유 0.8GB) · 서버 PC에서 공간을 비우면 풀립니다
──────────────────────────────────────────────────────────────────────────
기기
  기기 7 MacBook        Tailscale  마지막 사용 지금                       (이 기기)
  기기 5 Windows 데스크톱 SSH       마지막 사용 어제 22:10      [기기 5 권한 없애기]
  기기 9 iPhone          Tailscale  마지막 사용 1시간 전 · 푸시 켜짐  [기기 9 권한 없애기]
  기기 3 TUI(서버)       로컬       마지막 사용 3일 전          [기기 3 권한 없애기]
  [새 기기 페어링 ▾ 데스크톱 / 휴대폰]
──────────────────────────────────────────────────────────────────────────
연결 점검  [점검 실행]
  1 서버 이름 찾기 ✓  2 서버 PC까지 연결 ✓  3 Helm 서버 응답 ✓  4 인증 ✓  5 버전 확인 ✓
──────────────────────────────────────────────────────────────────────────
보내지 못한 조작 (1)   연결이 끊긴 동안 결과를 확인하지 못하고 시간이 지난 조작
  질문 16 답 "넣기" · 어제 22:41 · [내용 보기] [다시 보내기]
```

| 구역 | 내용 |
|---|---|
| 지금 연결 | 사용자용 연결 상태(§3.0.4), 방식, 주소, 지연, 마지막 seq, 프로토콜·서버 버전, 이 기기 |
| 연결 방식 | 한 프로필에 경로 여러 개(Tailscale, SSH)를 두고 순서대로 시도하거나 하나로 고정한다(20 §3.8.7). SSH는 대상(별칭 또는 user@host), 포트·키(선택), 호스트 키 확인(기본 엄격). 연속 실패로 미룬 경로를 표시한다. 프로필에 고정한 서버 id. 두 방식에서 화면과 재전송 의미는 같다(결정 38) |
| 보내지 못한 조작 | 끊긴 동안 결과를 확인하지 못하고 기한이 지난 조작(20 §3.9.7). 먼저 `command.lookup { idempotencyKey }`(19)로 원래 결과를 묻고, 결과가 있으면 그 결과를 보이고 행을 지운다(두 번 적용되지 않게). 결과가 없으면 원인별 문장을 보인다: 기한 지남(키 보존 7일 경과), 서버가 백업에서 복원됨(다른 저장소), 이 기기가 바뀜(다시 페어링), 앱·서버 형식이 바뀜, 영구 오류. 다시 보내려면 해당 화면을 열어 바뀐 상황을 본 뒤 새 멱등 키와 현재 `basisSeq`로 보낸다 |
| 서버 주의 항목 | 서버가 사람의 판단을 기다리는 운영 항목. (1) 주간 전체 검사 실패(17 §3.4.1): "기록 검사에서 문제가 나왔습니다. 읽기 전용으로 바꾸고 점검할 수도, 계속 쓸 수도 있습니다." [읽기 전용으로 바꾸기] [계속 쓰기]. (2) 시계가 앞으로 크게 바뀌어 보류한 만료 처리(17 §3.6.8): "서버 시계가 크게 앞으로 바뀌어 가정 만료 처리를 멈춰 두었습니다. 시계가 맞으면 진행하세요." [만료 처리 진행]. (3) 새 기기 연결(18 §3.7.2): "새 기기가 연결되었습니다: iPhone(기기 9). 내가 연결한 기기가 아니면 권한을 없애세요." [기기 9 권한 없애기]. (4) 점검 경고(17 §3.11.2, 05 `warn.check.*`). 복원 뒤 권한 변경 미확인(18 §3.16 4번)은 2단계로 미룬다[결정 62] |
| 서버 상태 | 실행 여부, 시작 시각, 진행 중 작업 수, 다음 예약 실행, 기록 저장소 크기, 마지막 백업, 디스크 여유, 모델 제공자 연결 상태(12 값, 05 `warn.models.*`), 안전 모드(사유 `crash_loop`·`restored`, 최근 비정상 종료 목록)와 [안전 모드 풀고 작업 다시 시작하기], 읽기 전용 사유(`readOnlyReasons`). 데이터는 19 `daemon.status`(`DaemonStatus`, 17) |
| 기기 | 페어링된 기기 목록(이름, 경로, 마지막 사용, 토큰 만료 예정, 휴대폰이면 푸시 상태: 켜짐 / 실패 중 / 다시 등록 필요), 권한 없애기, 이름 바꾸기, 새 기기 페어링(데스크톱 / 휴대폰). 토큰 값은 보이지 않는다(18). 토큰 교체는 2차 기능이다(HTTP, 18 §3.8.3). 기기를 누르면 그 기기에서 낸 사람 결정 목록(`SCR-RECORD`를 기기로 거름, 18 감사 보기) |
| 연결 점검 | 단계별 결과와 실패한 단계의 다음 할 일 |

연결 점검 실패 문구(05 §3.11에 정본):

| 실패 단계 | 문구 |
|---|---|
| 1 이름 찾기 | "서버 이름을 찾지 못했습니다. 이 기기에서 Tailscale이 켜져 있는지 확인하세요." |
| 2 서버 경로(Tailscale) | "서버 PC까지 연결되지 않았습니다. 서버 PC가 켜져 있고 Tailscale에 연결되어 있는지 확인하세요." |
| 2 서버 경로(SSH) | "SSH 연결에 실패했습니다: (원인). 키 경로와 사용자 이름을 확인하세요." |
| 3 Helm 서버 응답 | "서버 PC까지는 연결되지만 Helm 서버가 응답하지 않습니다. WSL이나 Helm 서버 프로그램이 꺼졌을 수 있습니다." |
| 페어링 코드 | "코드가 틀렸거나 만료되었습니다. 서버에서 새 코드를 만들어 다시 입력하세요."(`err.pairing.codeRejected`. 틀림과 만료를 구분하지 않는다, [판정 J-81]) |
| 4 인증 | "이 기기의 연결 권한이 없습니다. 기기가 폐기되었거나 토큰이 만료되었습니다. 다시 페어링하세요." |
| 5 버전 | "앱(v…)과 서버(v…)의 프로토콜 버전이 맞지 않습니다. (앱을 업데이트하세요 / 서버를 업데이트하세요)" |


**페어링 흐름** [제안, 기술 세부는 18·20]

1. 이 화면에서 "새 기기 페어링" 또는 첫 실행에서 연결 방식과 주소를 정한다.
2. 페어링 코드를 만든다. 이미 페어링된 다른 기기가 있으면 그 기기의 이 화면 "새 기기 페어링"이 `device.createPairingCode`로 코드를 보인다. 처음 기기이면 앱이 서버 쪽에서 실행할 명령을 보인다(19 §3.7.7, SSH 경로는 `helm device issue`, 이름은 17·18이 확정).
3. 사람이 코드를 앱에 입력한다(입력란 하나, 기기 이름 기본값은 OS 컴퓨터 이름). 페어링 링크(`helm://pair?…`)로 열었으면 코드가 채워진 채로 열리고 사람이 [연결]을 누른다. 앱은 HTTP `POST /pair {code, device}`로 보낸다(19 §3.7.7).
   - SSH 발급: SSH 경로만 쓰는 기기는 코드 없이 `helm device issue`를 SSH로 실행해 토큰을 받는다(20 §3.8.7). 화면에는 "SSH로 발급받기" 버튼을 두고 결과만 보인다.
   - 처음 연결하는 SSH 호스트의 키를 모르면 "터미널에서 `ssh <대상>`으로 한 번 접속하고 `helm doctor`가 보이는 지문과 맞는지 확인하세요."를 보인다.
4. 앱이 코드로 기기 토큰을 받아 OS 키체인에 저장한다(브리프 §2.5, 20).
5. "연결됨 · 기기 8 MacBook"을 보이고 연결 점검을 한 번 실행한다.

**휴대폰 페어링**("새 기기 페어링 ▾ 휴대폰", 26 §3.3.4): 이 화면이 설치 주소 QR(`https://<서버>.ts.net:<포트>/m/`), 12자 코드, 만료 시각을 보이고 다음 안내를 붙인다: "1. 휴대폰에서 Tailscale을 켜고 카메라로 QR을 읽어 Safari로 엽니다. 2. 공유 → 홈 화면에 추가를 누릅니다. 3. 홈 화면의 Helm 아이콘으로 열고 이 코드를 입력합니다. 4. 알림을 켭니다." 코드는 `device.createPairingCode`로 만든다. 휴대폰은 새 기기 코드를 만들지 않는다(18 §3.18.2).

**인터랙션**: 시험(앱 내부 경로 점검, 20 `route_check` + 19 `GET /healthz`·`hello`), 경로·순서 저장(앱 설정, 20), 권한 없애기(`device.revoke { deviceId }` → 확인 창 "기기 5 Windows 데스크톱의 연결 권한을 없앱니다. 그 기기는 다시 페어링해야 연결할 수 있습니다." [기기 5 권한 없애기]), 새 기기용 코드 만들기(`device.createPairingCode`), 페어링 코드 교환(앱 내부 동작, Rust의 HTTP `POST /pair`. JSON-RPC 명령 의도가 아니다), 안전 모드 풀기(확인 시트 "멈춰 있던 에이전트 작업과 예약 실행이 다시 시작됩니다." [안전 모드 풀고 작업 다시 시작하기] → `daemon.exitSafeMode`).

**표시 데이터**: `view:devices`(`DevicesView`, 아래), 서버 상태 `daemon.status → DaemonStatus`, 현재 연결 목록 `connection.list`(19 §3.7.7). 연결 상태는 앱 내부 상태(20, 19 `HelmClient.state`). 기기 이름 바꾸기는 `device.rename`(목록 행 메뉴).

```ts
interface DevicesView {
  meta: ViewMeta;
  thisDevice: string;
  devices: { ref: RecordRef /* dv */; name: string; kind: "desktop" | "mobile" | "tui"; route: "wss" | "ssh";
             lastSeenAt: IsoTime; tokenExpiresAt?: IsoTime; revoked: boolean;
             push?: { state: "on" | "failing" | "needs_reregister" | "off"; showContent: boolean /* 기기 설정 notifications.showContent, 기본 꺼짐([판정 J-03], [판정 J-237]) */ } }[];
  pendingPairing?: { expiresAt: IsoTime; forMobile: boolean };   // 코드 값은 만든 화면에만, 뷰에는 싣지 않는다
}
```

**상태**: 연결 안 됨이어도 이 화면은 항상 열린다(앱 설정과 점검은 데몬 없이 동작). 서버 상태와 기기 목록은 "마지막으로 받은 정보 · 14:02"로 보인다.

**사람 조작 횟수**: 페어링 = 이동 1 + 코드 입력 1 + 연결 1. 권한 없애기 2. 안전 모드 풀기 2(버튼 + 확인).

### 3.20 `SCR-RECOVERY` 복구

**목적**: 데몬 재시작이나 충돌 뒤 자동 재개가 끝내 실패한 작업(결정 30)과 결과를 모르는 외부 행동을 사람이 처리하고, 안전 모드·백업 복원·읽기 전용 같은 서버 상태를 확인한다(canon-3 G11 Recovery Center). 실패한 작업을 처음부터 다시 하게 하지 않는다(canon §17.5 P04 §7).

**진입 경로**: 내비게이션의 복구 항목(복구 항목이 있거나 안전 모드일 때만), 홈 맨 위 복구 선택 카드, 복귀 요약 머리, 질문함 "복구 선택", 딥 링크 `helm://recovery`.

**레이아웃**

```text
복구 · 서버가 10:02에 다시 시작되었습니다 · 선택이 필요한 작업 2
(안전 모드일 때) 안전 모드 · 사유: 10분 안에 비정상 종료 3번 · 에이전트 작업과 예약 실행 멈춤
                 [안전 모드 풀고 작업 다시 시작하기]
(복원 뒤일 때)   10월 11일 04:00 백업으로 복원 · 복원 지점(이벤트 4520) 이후 기록 없음 ·
                 복원 뒤 첫 시작이라 안전 모드, 멈춰 있던 작업은 자동으로 다시 시작하지 않았습니다
──────────────────────────────────────────────────────────────────────────
WorkUnit 31 본문 1절 초안 · Concern 12 · 자동 재개 3번 실패
  마지막 확인 지점   09:58 1절 초안 저장 (관찰 50)
  자동 재개          10:02, 10:03, 10:03 · 모델 응답 오류로 실패 (12)
  바뀐 것            재시작 동안 초안 파일이 바깥에서 바뀜(감지됨)
  이미 일어난 외부 행동   없음
  [마지막 확인 지점부터 다시 실행]  [그대로 두기]  [확인 작업 만들기]
──────────────────────────────────────────────────────────────────────────
WorkUnit 28 리뷰 요청 보내기 · Concern 12 · 복구 선택(질문 22)
  중단된 행동        메일 보내기 1건 · 보냈는지 모름
  다시 실행해도 안전한가  안전하지 않음 (보내기는 두 번 일어날 수 있음)
  이미 일어난 외부 행동   보냈을 수 있음
  [보낸 것으로 기록]  [보내지 않은 것으로 기록]  [보냈는지 확인하는 작업 만들기]
```

| 필드 | 내용 | 원천 |
|---|---|---|
| 마지막 확인 지점 | 마지막으로 결과가 기록된 지점 | canon §17.5 P04 §7 |
| 중단된 행동 | 실행 의도는 기록됐지만 결과가 없는 도구 호출 | 결정 30, 12 |
| 다시 실행해도 안전한가 | 도구가 선언한 재실행 안전성(13). Helm이 가역성을 판정하지 않으며, 도구 선언과 권한 레이어 값을 보인다 | 결정 2 |
| 이미 일어난 외부 행동 | 외부 결과가 확실하지 않으면 "모름". 시간 초과를 실패로 단정하지 않는다 | canon-2 §3.13 Unknown external outcome, L12 |
| 행동 | 선택지 집합은 12 §3.7.4가 정한다(19 `RecoveryResolveParams`). 결과 불명 도구 호출: 적용된 것으로 기록(`confirmed_applied`) / 적용 안 된 것으로 기록(`confirmed_not_applied`) / 확인 작업 만들기(`manual_review`). 자동 재개가 실패한 WorkUnit: 마지막 확인 지점부터 다시 실행(`rerunFromCheckpoint`) / 그대로 두기(`leaveAsIs`) / 확인 작업 만들기(`createCheckTask`). "Concern에서 다시 계획"은 명령을 보내지 않고 Concern 개요로 가는 링크다 | 12, 19 |

복구 선택 질문은 [판정 J-05]와 [판정 J-44]를 따른다. 외부 효과가 있을 수 있는 결과 불명 호출(send, 네트워크 쓰기)만 `recovery` 질문(권리 게이트)을 만든다. 답이 없는 동안 그 작업은 멈춘 상태로 남고 가정 확정이 없다. 외부 효과가 없는 로컬 쓰기의 결과 불명은 질문 없이 `toolcall.interrupted`로 닫히고 모델이 상태를 읽어 확인한다(12). 이 화면에 오지 않는다. 데몬은 중단된 run을 자동으로 재개한다(12: 최대 3회, 첫 턴은 안전한 도구만, 안전한 도구는 다시 실행, 결정 30). 이 화면에는 자동 재개가 끝내 실패한 것(run `ended`, 이유 `recovery_exhausted`), 외부 효과가 있을 수 있는 결과 불명 호출(run `awaiting_recovery`), 안전 모드로 자동 재개가 멈춘 것만 온다. 자동 재개된 것은 복귀 요약의 복구 절에 개수로만 보인다.

**안전 모드**: 머리에 사유(09 `daemon.safe_mode_entered.reason`: `crash_loop` 또는 `restored`), 최근 비정상 종료 목록(`DaemonStatus`, 17), [안전 모드 풀고 작업 다시 시작하기](확인 시트 "멈춰 있던 에이전트 작업과 예약 실행이 다시 시작됩니다." → `daemon.exitSafeMode`). 질문 답하기와 기록 보기는 안전 모드에서도 된다.

**백업 복원 뒤** ([판정 J-152]): 17이 복원을 마칠 때 남긴 복원 표지(09 `store.restored`: 백업 id, 복원 지점 seq)를 읽어 "복원 지점 이후 기록 없음"을 보인다. 그 뒤 첫 부팅은 안전 모드라서 run 자동 재개·에이전트 타이머·관찰 실행이 없고(12), 소진되지 않은 승인은 만료되어 다시 묻는다(09 §3.14.2). 화면은 이 사실을 머리에 쓰고, 복원 지점 이후 사람이 했던 결정이 사라졌을 수 있으니 복귀 요약과 질문함을 다시 보라고 안내한다. 이 표시의 소유는 이 문서다.

**읽기 전용**: 데몬이 읽기 전용(19 `readOnly`, 17 `read_only`)이면 화면 맨 위에 사유별 문장(05 `err.daemon.readOnly.<사유>`)과 서버에서 할 일을 보인다. 예: `integrity_suspect`면 "서버 기록에 손상 의심이 있어 읽기만 할 수 있습니다. 서버에서 `helm ops verify --full` 또는 백업 복원이 필요합니다." 이 상태에서는 이 화면의 행동 버튼도 막힌다.

**표시 데이터**: `view:recovery`

```ts
import type { DaemonMode } from "@helm/protocol";   // 19: normal | safeMode | readOnly | draining
interface RecoveryView {
  meta: ViewMeta;
  restartedAt?: IsoTime;
  daemonMode: DaemonMode;
  safeMode?: { reason: "crash_loop" | "restored"; since: IsoTime; recentCrashes: { at: IsoTime; note?: string }[] };
  readOnlyReasons?: ("disk_critical" | "integrity_suspect" | "operator" | "projection_fault" | "recovery_failed")[];   // 17 DaemonStatus([판정 J-178])
  restored?: { backupId: string; upToSeq: Seq; restoredAt: IsoTime };   // 09 store.restored(J-152)
  items: (
    | { kind: "toolCall"; toolCall: RecordRef /* tc */; question?: RecordRef; workUnit: RecordRef; concern: RecordRef;
        interrupted: { tool: string; summary: string; intentAt: IsoTime };
        rerunSafe: "safe" | "unsafe" | "unknown"; rerunSafeSource: "tool_declaration" | "permission_layer";
        externalEffect: "maybe" | "happened" | "unknown";
        resolutions: ("confirmed_applied" | "confirmed_not_applied" | "manual_review")[] }
    | { kind: "workUnit"; workUnit: RecordRef; concern: RecordRef; lastCheckpoint?: { at: IsoTime; ref?: RecordRef };
        attempts: { at: IsoTime; error: string }[];
        actions: ("rerunFromCheckpoint" | "leaveAsIs" | "createCheckTask")[] }
  )[];
  autoResumed: { workUnit: RecordRef; tool: string; at: IsoTime }[];
}
```

**인터랙션**: 각 행동 → `recovery.resolve { target: { kind: "toolCall", toolCallId, questionId?, resolution } | { kind: "workUnit", workUnitId, action }, note? }`(19 §3.7.5. 도구 호출은 10 `toolcall.recover`, WorkUnit은 12 실행 수준 동작). "보낸 것으로 기록"은 사람이 외부에서 확인한 사실이며 커널이 사람 발화 관찰을 근거로 남긴다(08 §3.22.7). 안전 모드 풀기 → `daemon.exitSafeMode`.

**사람 조작 횟수**: 항목당 결정 1. 안전 모드 풀기 2(버튼 + 확인).

### 3.21 `SCR-SETTINGS` 설정

**목적**: 알림, 주의 예산, 표시, 키보드, 권한·연결 요약, 개발자 보기, 데이터를 정한다. 다이얼은 `SCR-DIALS`로 보낸다.

**진입 경로**: 내비게이션 7번, Mod+, (쉼표), `G S`.

**절**

| 절 | 항목 | 저장 위치 |
|---|---|---|
| 알림 | OS 알림 켜기, OS 알림 권한 상태와 "알림 시험 보내기"(OS 설정에서 꺼져 있으면 안내, 20 F-35), 알릴 것(끼어들기 / 알림 / 복귀 요약 시각 / 예약 묶음 / 협상 전달 `notifications.negotiated` 기본 끔, 관찰 제안 `notifications.observer` 기본 끔), **결과 확인 알림**(`notifications.resultReview`: 알리지 않음 / 하루 한 번 묶음 푸시 / 즉시 푸시[결정 56]. 이 설정은 휴대폰 푸시를 고르는 것이고, 데스크톱은 배지로만 알리며 `immediate`일 때만 OS 알림도 띄운다[결정 60]. 기본은 알리지 않음[판정 J-189]. 묶음 시각 `notifications.resultReviewDigestAt`, 기본 "19:00", 서버 시간대. 묶음은 확인 대기 결과가 있을 때만 보내고, 묶음과 즉시 푸시는 방해 금지(예외 값 포함)와 시간당 상한을 따르며 휴대폰 확인 범위는 J-139 그대로다), 방해 금지·조용한 시간(05 §3.7.4. 방해 금지 예외(`notifications.dndException`)는 휴대폰 푸시에만 적용하고, 방해 금지 중에는 예외 값과 관계없이 데스크톱 OS 알림을 띄우지 않는다[결정 59]), 알림에 내용 보이기(기본 끔), 소리. "휴대폰 알림은 휴대폰의 설정 화면에서 정합니다." 한 줄(26). 조용한 시간은 기본이 없고, 휴대폰 알림을 처음 켤 때 23:00~08:00을 제안값으로 보인다([제안], 14 §3.13.8) | 05 §3.7. 결과 확인 알림과 묶음 시각은 데몬 의미 설정(`settings.update`, 기록은 09 `setting.changed`, [판정 J-189]). 방해 금지(`attention.snoozeUntil`)·조용한 시간·시간당 알림 상한(`attention.interruptsPerHour`)은 데몬 설정(14 `OrchestrationSettings`, 모든 기기 합산, 기기별 상한은 두지 않는다[판정 J-171]). 소리·OS 알림 켜기·내용 보이기·방해 금지 예외(`notifications.dndException`)는 기기 설정(20 §3.9.11) |
| 주의 예산 | 홈에 펼칠 카드 수(`attention.maxVisibleDecisions`, 기본 3), 일일 예산(`attention.dailyBudget`, 주의 예산 막대의 한도), 시간당 알림 상한(`attention.interruptsPerHour`, 기본 2, 모든 기기 합산, 05 §3.7.3), 일시 방해 금지(`attention.snoozeUntil`, "지금부터 1시간", [판정 J-166]), 복귀 요약 자동 열기 기준 | 데몬 설정(14 `OrchestrationSettings`, 다이얼 아님)과 기기 설정 |
| 질문 전달 기본값 | `SCR-DIALS`(전역 범위) 링크 | 14 |
| 계획 작성 방식 | 전역 기본값을 여기서 고른다: 코드 계산만 / 혼합(기본) / 모델 설계(`planAuthoring`, 층 `user`). Concern별 값은 `SCR-DIALS`에서 바꾼다([결정 53], [판정 J-192]) | 14 |
| 표시 | 테마(시스템 / 밝게 / 어둡게), 글자 크기(`fontScale`), 밀도(보통 / 촘촘), 투명도(`transparency`: 시스템 / 전체 / 줄임), 창 효과(`windowEffect`), macOS 유리 질감(`macGlass`, macOS 26 이상), 움직임 줄이기, 시간 표시(상대+정확 / 정확만) | 기기(20 §3.9.11) |
| 창 | 창 닫기(`closeBehavior`: 숨기기 / 종료), Dock 아이콘(`macActivation`: 기본 / 메뉴 막대만, 배지 없음) | 기기(20 §3.9.11) |
| 키보드 | 단축키 목록과 바꾸기, 한 글자 단축키 켜기·끄기 | 기기(05 §3.8) |
| 권한·연결 | 연결 화면 링크, 허용 폴더(Helm이 읽고 쓸 프로젝트 폴더는 `project.create`로 추가, 관찰 에이전트가 읽을 외부 세션 로그 폴더는 `settings.update`, 결정 35, 02 UC-11 단계 8), 이 기기의 권한(읽기 전용 기기 여부), 연결된 모델 제공자와 도구 목록(데몬이 보냄, 읽기 전용, [판정 J-150]). 도구마다 단계(MVP / 이후)와 집행 수준을 보이고, 웹 페이지 읽기·웹 검색은 MVP다([결정 55]). 웹 검색 제공자 순서(`tools.webSearch.providers`, 기본 Brave → Tavily)와 월 상한(`monthlyCap`), 제공자별 키 등록 여부를 보인다. 키 값은 보이지 않는다([판정 J-190] (1)(6)). 네트워크 차단은 내부망 요청(루프백·사설·CGNAT·tailnet)만 막고 외부 인터넷 탐색은 막지 않는다는 한 줄을 붙인다([판정 J-134]), 데이터가 나가는 곳(모델 API로 보내는 것) 요약 | canon-3 §6.11 Trust Center를 1인용으로 줄인 판. 데이터는 18·17 |
| 개발자 보기 | 켜면 모든 카드에 레코드 ID, 이벤트 종류, seq, 정책 사유 코드가 보인다(03 §3.10) | 기기 |
| 데이터 | 기록 내보내기 요청(사람이 읽을 수 있는 형식, 17), 이 기기의 캐시 지우기, 오프라인 사본(`offlineCopy`, 기본 켬, 20 §3.9.5) | 데몬 / 기기 |
| 정보 | 앱 버전, 서버 버전, 프로토콜 버전, 열린 소스 고지 | |

**표시 데이터**: `view:settings`(데몬 쪽 값)와 기기 설정(20). 데몬 쪽 값만 뷰로 받는다.

```ts
interface SettingsView {
  meta: ViewMeta;
  notifications: { resultReview: "none" | "daily_digest" | "immediate"; resultReviewDigestAt: string /* "HH:MM", 서버 시간대, 기본 "19:00" */; briefAt?: string };   // 알림 경로 설정만([판정 J-195]). 시간당 상한은 attention 하나다([판정 J-171]). [판정 J-189]
  attention: { quietHours: { start: string; end: string } | null; maxVisibleDecisions: number; interruptsPerHour: number; dailyBudget: number; snoozeUntil?: IsoTime; reviewWindows: { start: string; end: string }[] };   // 14 OrchestrationSettings.attention([판정 J-166]). 조용한 시간은 [판정 J-195]
  folders: { projects: { id: string; name: string; rootPath: string }[]; observerSources: string[] };
  providers: { name: string; models: string[]; state: CopyRef }[];   // 모델 제공자(J-150), 읽기 전용
  planAuthoring: "computed" | "hybrid" | "model";   // 사용자 층의 루프 계획 작성 방식([결정 53], [판정 J-192])
  webSearch: { providers: ("brave" | "tavily")[]; monthlyCap: number; keyRegistered: { brave: boolean; tavily: boolean } };   // tools.webSearch(13), 앞에서부터 시도([판정 J-190] (1)). 키 값은 보내지 않는다
  tools: { name: string; stage: "mvp" | "later"; enforcement: "enforced" | "advisory" }[];   // 도구 단계([결정 55])
  dataEgress: CopyRef[];                                             // 데이터가 나가는 곳 요약(18)
  versions: { server: string; protocol: number };
}
```

**사람 조작 횟수**: 항목당 1~2.

### 3.22 `SCR-ONBOARD` 처음 연결

**목적**: 첫 실행에서 데몬에 연결하고, Helm이 어디까지 보고·제안·실행하며 언제 멈추는지, 사용자의 정정이 어디까지 바뀌는지를 짧게 알린다(canon-3 §6.3.2).

**진입 경로**: 연결 프로필이 없을 때 앱 실행(20 §3.9.2). 프로필은 있는데 토큰만 없으면(폐기·만료·키체인에 없음) 이 화면 대신 `SCR-CONNECT`의 다시 페어링으로 간다. 설정 "처음 연결 다시 보기".

**단계**

| 단계 | 화면 | 문구 예시 |
|---|---|---|
| 1 연결 방식 | Tailscale / SSH 고르기 + 주소 | "Helm 서버는 WSL 서버 PC에서 돌고, 이 앱은 그 서버에 붙어 화면을 보여 줍니다. 앱을 꺼도 서버의 작업은 계속됩니다." |
| 2 페어링 | 코드 입력(§3.19) | "서버에서 페어링 코드를 만든 뒤 여기에 입력하세요." |
| 3 연결 확인 | 점검 다섯 단계 | |
| 4 Helm이 하는 일 | 네 줄 안내 | 아래 |
| 5 로그인 때 시작 | 선택 | "컴퓨터에 로그인할 때 Helm을 트레이에서 시작할까요? 앱이 꺼져 있으면 이 컴퓨터에는 질문 알림이 오지 않습니다." [로그인 때 시작] [시작하지 않음] (20 §3.10.5) |
| 6 프로젝트 폴더 | 서버의 프로젝트 폴더 고르기(서버 쪽 경로 입력, 최근 폴더 제안) → `project.create { name, rootPath }` | "Helm이 읽고 쓸 프로젝트 폴더를 고르세요. 이 폴더 밖은 쓰지 않습니다." [폴더 추가] [나중에] |
| 7 첫 Goal | 폴더를 추가했으면 에이전트가 폴더를 읽어 만든 Goal 초안 카드(§3.16, [이 Goal로 시작] [고쳐서 시작] [나중에]). 초안을 만드는 동안 "폴더를 읽어 Goal 초안을 만드는 중입니다" | "이루려는 것을 한두 문장으로 더 말해 주면 초안에 반영합니다." |

4단계 안내 문구(CLI 경험 First launch 4줄, canon-2 §3.10을 데스크톱·데몬 구조로 바꿈):

```text
Helm은 맡긴 범위 안에서만 읽고, 쓰고, 실행합니다.
밖으로 보내거나 돈을 쓰는 일, 결과 확인, Goal 변경은 항상 먼저 묻습니다.
묻지 않고 정한 것은 "에이전트가 정한 것"에 모두 남고, 언제든 이의를 걸 수 있습니다.
입력창에 고친 말은 지금 Concern에만 적용됩니다. 다음에도 그렇게 하려면 다이얼이나 규칙으로 저장하세요.
```

**사람 조작 횟수**: 주소 1 + 코드 1 + 확인 1 + 안내 넘기기 1 + 폴더 추가 1 + 첫 Goal 확정 1.

### 3.23 `SCR-RECORD` 변화 기록

**목적**: 원본 이벤트를 감사 깊이로 본다. 복귀 요약·근거 체인에서 원본을 확인하거나, 화면이 이상할 때 투영 문제인지 원본 문제인지 구분한다(canon-2 §3.18).

**진입 경로**: 복귀 요약 "원본 기록", 근거 체인 "원본 보기", 개발자 보기의 레코드 메뉴, 명령 팔레트.

**레이아웃**: 표. 열: seq, 시각, 이벤트 종류, 행위자, 대상 레코드, 요약, 원인(causation) 링크. 거르기: 대상, Concern, 행위자, 종류, seq 범위. 행 펼침: payload(JSON, 비밀 값 가림), provenance.

**표시 데이터**: `view:records` (파라미터: `subject?`, `concernId?`, `actor?`, `deviceId?`, `kinds?`, `fromSeq?`, `toSeq?`, 페이지). 비밀 값은 데몬이 숨긴 뒤 보낸다(18).

```ts
interface RecordsView {
  meta: ViewMeta;
  rows: { seq: Seq; at: IsoTime; eventType: string; actor: string; device?: string; subject?: RecordRef;
          summary: string; causationSeq?: Seq; payload?: unknown /* 펼칠 때만, 가림 적용 */; provenance?: unknown }[];
  nextBeforeSeq?: Seq;
}
```

**사람 조작 횟수**: 보기만.

### 3.24 `SCR-TRAY` 메뉴 막대·트레이 메뉴

**목적**: 앱 창을 열지 않고 사람 행동이 필요한 수와 진행 중 요약을 본다(canon-3 §8-20 메뉴바·트레이). 구현은 20.

**내용** [제안]

```text
Helm · 연결됨
선택 필요 1          (누르면 질문함)
확인하면 좋은 것 2
진행 중 3
  Concern 12 블로그 글 방향 · 본문 1절 초안 쓰는 중
  Concern 9 테스트 실패 원인 · 원인 비교 중
  …
빠른 입력…           (입력창, 범위: 전체)
방해 금지 1시간 / 방해 금지 끝내기
Helm 열기
종료
```

- 표시 데이터: `view:tray`(19 §3.7.4 카탈로그). 선택 필요 수, 확인하면 좋은 것 수, 진행 중 WorkUnit 요약, 연결 상태.
- 아이콘 배지(트레이, macOS Dock, Windows 작업 표시줄)는 "선택 필요" 수만 숫자로 보인다. "선택 필요"는 이 설계 전체에서 전달된 권리 게이트 질문(선택 요청, 합의 확인, 결과 확인, Goal 확인, 복구 선택) 수를 뜻한다(03 §3.2.4). 정보 게이트 질문은 배지를 바꾸지 않는다(주의 예산). 질문함 내비게이션 배지는 두 수를 따로 보인다(21 §3.7 `PendingQuestionsIndicator`).
- Concern은 번호와 제목을 함께 보이고 제목은 30자에서 자른다.
- 방해 금지 켜기·끄기는 데몬 설정을 바꾸는 명령(`settings.update`, 19)이며 현재 방해 금지 상태를 메뉴에 보인다(05 §3.7.4).
- 연결이 없으면 숫자 옆에 "(연결 끊김 기준)"을 붙인다.
- 연결 안 됨이면 첫 줄 "Helm · 연결 안 됨"과 "연결 화면 열기".
- 트레이 메뉴는 질문 내용을 보이지 않는다(화면 공유·잠금 상황 고려). 내용은 앱에서 본다.

### 3.25 `OVL-PALETTE` 명령 팔레트

**목적**: 모든 화면, 객체, 동작을 이름으로 찾는다(canon-3 §6.5). 키보드 우선 사용의 중심.

**열기**: Mod+K. 입력에 따라 결과를 묶어 보인다: 이동(화면 이름), 객체(표시 번호와 제목: "질문 14", "Concern 12 블로그"), 동작("질문 14 답하기", "모드 바꾸기", "새 Goal", "복귀 요약 여기까지 봤음", "판단 찾기", "다이얼: 탐구 깊이", "루프 이력", "변화 기록", "평가"), 최근. 레일에 없는 화면(`SCR-LOOPS`, `SCR-RECORD`, `SCR-METRICS`)은 여기와 검사 패널 링크로 연다(03 §3.6).

**규칙**: 결정 동작은 팔레트에서 바로 보내지 않고 해당 화면을 연다(질문 내용을 읽지 않고 결정하는 경로를 만들지 않는다). 예외는 "가정대로 진행"처럼 질문 카드가 팔레트 미리보기에 보이는 경우이며, 이때도 미리보기 안 버튼으로만 보낸다.

**표시 데이터**: 검색 `search.query { text }`(19 후보) + 앱의 화면 목록.

### 3.26 `OVL-CONTEST` 이의 걸기

**목적**: 객체 하나(선택, 판단, 상황 판정, 분해·병합, 루프 전환, 모드 라우팅, 가정 확정, 기준 후보, 근거 관계, 결과 제출의 기준별 판정)에 이의를 건다. 흐름 규칙은 05 §3.3이 정본이다.

**레이아웃**

```text
이의 걸기 · 선택 41 하위 Concern 둘로 나누기 (에이전트가 정함)
──────────────────────────────────────────────────────────────
이유 (선택)   [주제와 형식은 같이 정해야 합니다              ]
              □ 이유는 모르겠지만 맞지 않습니다
어떻게 할까   ● 다시 열기 (이 결정을 다시 다룹니다)
              ○ 다음부터 이런 것은 묻기
              ○ 기록만 남기기
이의를 걸면   Concern 12가 다시 열리고, 이 결정에 기대는 작업 1개가 멈춥니다.
              다시 정할 질문이 생기면 질문함으로 가지 않고 이 자리에서 이어서 정할 수 있습니다
──────────────────────────────────────────────────────────────
[선택 41에 이의 걸기]  [닫기]
```

**명령 의도**: `objection.file { target, reason?, reasonKind?, desiredEffect: "reopen" | "ask_next_time" | "note_only", basisSeq }`(19 `ObjectionFileParams`, [판정 J-111]). `target`은 08 `ObjectionTarget`(`{ kind: "record", id, itemKey }` 또는 `{ kind: "link", from, to, rel }`, [판정 J-36]). "이유는 모르겠지만 맞지 않습니다"는 `reason` 없이 보내는 것과 같다(08에 별도 필드가 없다). `concernId`는 커널이 대상에서 정한다(10). 이유 칸 아래 선택 칩은 08 `reasonKind`(근거가 틀림 / 반대 근거를 놓침 / 가치 판단이 다름 / 범위가 틀림 / 물어봤어야 함 / 그 밖에, 05 §3.3.2)이고 `objection.file`에 함께 싣는다(19에 필드 요구).

"다음부터 이런 것은 묻기"를 고르면 영향 미리보기에 "앞으로 '루프 전환'은 묻습니다(모든 Concern)"가 보이고, 보내면 같은 트랜잭션에서 종류별 예외 다이얼(`question.kind_exceptions`, 사용자 층)에 "항상 묻기"가 기록된다. 확인을 다시 받지 않는다(11 §3.9.4).

이의 뒤 재결정 질문이 생기면(대상이 다시 열려 사람이 정해야 하면) 적용 확인 문장 아래에 "다시 정할 질문: 질문 19 [지금 정하기]"를 보이고 그 자리에서 질문 카드를 펼친다.

**사람 조작 횟수**: 이의 D 1(이유 없이 기본값으로 보냄). 이유를 쓰면 I 1을 더한다([판정 J-20], 02 UC-05, 26 §3.5.6). "다음부터 묻기"도 같은 조작 1회다.

### 3.27 `SCR-METRICS` 평가 (결정적 지표·복귀 점검은 MVP, 관찰 에이전트 절은 2단계)

**목적**: 16이 측정하는 지표(OPD+C 네 칸, C/A 2주 지표, 질문 부담, 에이전트가 정한 것, 계획 이의 비율(`authoredBy`별, [판정 J-188]), A12, 범주, 관찰 에이전트)를 사람이 본다(16 §5.2). 정의와 측정은 16이 소유하고 이 절은 화면 규칙만 정한다.

**진입 경로**: 명령 팔레트 "평가", 복귀 요약 맨 아래 "2주 평가 준비됨" 카드, 홈 경고 띠.

**레이아웃**: 묶음 패널. 값마다 기간, 분자/분모, 표본 수, 정의 버전, 추세(지난 기간 대비 글자로), 검토 신호. 표본이 부족하면 "표본 부족(4/20)". 좋음·나쁨 색과 점수·배지 같은 게임 요소를 쓰지 않는다(canon §12.11).

**함께 정하는 화면 요소** (16 요구)
- 홈 경고 띠(MVP): 연결되지 않은 변경, 사라진 이의, 정상 경로 조작 위반, 해로움 판정(2단계)이 있을 때만 홈 맨 위에 한 줄.
- 복귀 요약 맨 아래 "2주 평가 준비됨" 카드(MVP): 자기보고와 판단 입력(이대로 진행 / 상호작용 고치기 / 다시 정의하거나 멈추기). 복귀 점검 채점도 이 화면에서 한 번에 한다.
- 복귀 점검(MVP, 첫 2주 평가 기간 G1에만 켬, 02 UQ-05): 24시간 이상 비운 뒤 첫 화면에서 제안. 복귀당 1회, 주 2회까지. 건너뛸 수 있다. 기억으로 답한 뒤 복귀 요약을 보고 다시 답한다(16 OB-11, canon-2 §2.1.6). 메서드는 `resumptionCheck.answer`·`resumptionCheck.score`. 채점 라벨은 "일치 / 부분 일치 / 불일치"다(취향형 판정의 "맞음 / 아님 / 모르겠음"과 겹치지 않게).
- "예상 못 했다" 표시: 결과 확인 화면, 에이전트가 정한 것 항목, 진행 작업 카드의 메뉴. 이벤트 후보 `surprise.reported`.
- 결과 적합도 1~5: 결과 확인 화면에 두되 기본은 숨김.
- 화면 열람 이벤트 `view.opened{surface, depth, subjectRef}`는 복귀 요약, 에이전트가 정한 것, 감사 깊이, 결과 확인, 질문 상세 다섯 곳에서만 보낸다(16 §3.24.2).

**표시 데이터**: 뷰 이름 후보 `view:metrics`(19 카탈로그에 추가 요구).

## 4. 실패·예외·경계 사례

| 사례 | 처리 [제안] |
|---|---|
| 같은 질문을 두 기기에서 동시에 답함 | 먼저 도착한 답이 적용된다(커널). 늦은 기기는 §3.0.5 "이미 처리됨"과 적용된 답을 보인다. 두 답이 다르면 늦은 쪽에 "내 답(…)은 적용되지 않았습니다. 다르게 정하려면 이의를 거세요." |
| 가정이 확정된 뒤 쓰던 답을 보냄 | 데몬이 `3008`로 거부하고 확정된 값을 돌려준다([판정 J-120]). 화면은 §3.0.5처럼 쓰던 답을 이의 초안으로 옮기고 [이의로 보내기]를 보인다 |
| 질문을 읽는 동안 질문이 철회됨 | 화면 머리에 "이 질문은 방금 철회되었습니다. 이유: …"를 보이고 버튼을 막는다. 쓰던 답은 복사할 수 있게 남긴다 |
| 합의 확인 화면을 보는 동안 에이전트가 초안을 고침 | 화면 머리에 "초안이 바뀌었습니다 [바뀐 곳 보기]". 바뀐 뒤 처음 누르는 확정은 `basisSeq` 불일치로 거부될 수 있으므로, 바뀐 곳을 본 뒤에만 확정 버튼이 다시 활성화된다 |
| 결과 확인 중 새 반대 근거 도착 | 반대 근거 구역에 "새로 들어옴" 표시. 확정 버튼은 막지 않되 "확인 전에 새 반대 근거 1개가 들어왔습니다" 문구를 버튼 위에 둔다 |
| 복귀 요약 범위가 너무 커서 뷰 생성이 느림 | 처음 불러오는 중 상태에서 "기간이 길어 요약을 만드는 데 시간이 걸립니다(10일)". 12 §3.5.9의 부분 뷰(결정적 절 먼저, 3·7절 `pending`)를 받는다. 범위가 길면 2절은 Concern 단위 요약으로 먼저 온다 |
| 자극 이미지가 아주 큼 | 썸네일을 먼저 보이고 원본은 HTTP로 필요할 때 받는다(결정 31). 크기 한도는 19·20 |
| 자극이 다른 앱에서만 볼 수 있는 형식(예: 영상) | 링크와 요약을 보이고 "외부에서 보기"로 연다. 반응은 전체 단위로만 받는다 |
| 질문의 만료점이 이미 지난 상태로 처음 열림 | `assumed`면 §3.0.5. 아직 `delivered`인데 시각이 지났으면(데몬 지연) "만료점이 지났습니다. 지금 답하면 되돌리는 비용이 커질 수 있습니다." |
| 사용자가 결과 확인을 습관적으로 누름 | 확인 못한 기준이나 "모르겠음"이 있으면 주 버튼이 [조건 붙여 확인]이 되어, 그대로 누르면 확인 못한 부분이 조건(미룬 반영 항목)으로 남는다(§3.12). 휴대폰은 산출물을 연 뒤에만 확인을 받는다([판정 J-139]). 그 밖에는 화면이 막지 않는다. 확인까지 걸린 시간, 근거 펼침 여부를 관찰로 남겨 16이 결과 확인 전용 우회 지표로 본다(발췌3 X3-2-20). 재촉이나 경고를 띄우지 않는다 |
| 데몬이 판정 값(되돌릴 수 있나, 다시 실행 안전성)을 주지 않음 | "판정 없음"으로 쓰고 추측하지 않는다 |
| 낡은 화면에서 이의를 걸었음 | 이의는 대상 레코드 id로 보내므로 대상이 대체되었으면 데몬이 `3009`로 거부하고 "이 결정은 이미 다른 결정(선택 44)으로 대체되었습니다 [선택 44에 이의]"를 보인다 |
| Goal을 그만둔 뒤 그 아래 합의로 쓰기를 시도 | 커널이 `policy.goal_not_active`로 거부한다([판정 J-130]). Goal 목록과 홈에 그 합의를 주의 항목으로 보인다(§3.16) |
| 휴대폰 알림으로 연 새 질문이 캐시에 없음 | 휴대폰은 푸시 data(종류, 질문 번호, Concern 번호)로 자리 표시 카드를 그리고, 연결되면 채운다. 이름 찾기가 실패하면 "서버 PC에 연결할 수 없습니다. 휴대폰의 Tailscale 앱을 켜세요."(26 §3.5.11) |
| 연결 방식 전환(Tailscale → SSH) 중 | 상단 막대 "연결 방식을 바꾸는 중". 재접속 규칙(§3.0.4)과 같다. 두 방식의 seq 의미가 같으므로 화면을 다시 받지 않고 저장 위치 `{storeId, seq}`부터 이어 받는다(결정 38, 19 §3.5) |
| 모델 문장에 제어 문자나 표시 위조 시도 | 데몬이 정화한 뒤 보낸다(canon-2 §4.5). 앱도 텍스트로만 그리고 HTML로 해석하지 않는다(21) |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 화면별 뷰 모델 요구(타입 후보, 19 `ViewResult.data`) | 12(뷰 생성), 19(`view.get` 카탈로그), 20(클라이언트 저장소) |
| 화면별 명령 의도 목록(후보 이름) | 10(명령 카탈로그), 19(메서드), 11(질문 응답 종류) |
| 상태별 표시 규칙(§3.0.3, §3.0.4) | 20(상태 기계 → 사용자 상태 대응), 21(상태 컴포넌트) |
| 화면별 레이아웃과 구역 | 21(화면 → 컴포넌트 매핑) |
| 사람 조작 횟수 | 01·02(수용 기준), 16(우회율·부담 지표), 22(E2E 시나리오) |

### 5.2 다른 문서에 요구하는 것

메서드 → 10 명령 대응은 10 §3.11.11 (2)가 정본이고 19 §3.7.1이 그 표를 옮긴다. 이 문서는 대응표를 두지 않는다. 2a단계 요구 가운데 반영된 것(19 `tray`·`settings` 뷰, 복귀 요약 고정, `brief.acknowledge.note`, 3008·3009 세부, `DaemonStatus` 디스크, `objection.file`, `result.accept` 결정 값, `RecoveryResolveParams`, `goal.activate`·`project.create`, 20의 초안 저장·알림 숨김·트레이·단축키 판정)은 지웠다.

| 문서 | 요구 |
|---|---|
| 08 | 남은 요구 없음. 진입 판정 `EntryAssessment`(`ea`), 질문 `criteria`·`consequences`·`commitmentPreview`, `Stimulus.form`, `reasonKind`, `ResultSubmissionCore.mobileReviewable`([판정 J-225])은 08 2판에 반영되어 이 문서가 읽는다 |
| 09 | 복원 표지 `store.restored`와 `daemon.safe_mode_entered{reason: restored}`를 04 §3.2·§3.20이 읽는다([판정 J-152]). `brief.acknowledged`에 `note`·`compact`. `loop_plan.adopted`의 `authoredBy`([판정 J-188]). `setting.changed`(설정 기록, [판정 J-189]) |
| 10 | (1) `goal.activate`의 `edits`(고쳐서 시작). (2) 결과 확인과 같은 트랜잭션의 반영 범위 합의 확정([판정 J-126]) |
| 11 | (1) 권리 허락의 `approve.conditions`(자유 문장)는 실행에 효과가 없어 화면에 입력을 두지 않았다(§3.4). 없애거나 "기록용"으로 표시. (2) 막지 않는 권리 게이트 전달([판정 J-132]) |
| 12 | (1) 이 문서 각 절의 뷰 모델 생성(새로 더한 `ConcernTreeView`, `ThreadView`, `GoalsView`, `DevicesView`, `RecordsView`, `SettingsView` 포함, 26행 원천 표). (2) 복귀 요약 머리 줄, `restart`(boots·`last_recorded_at`), `restored`, `assumedWhileAway`, `compactSeen`([판정 J-137]), `deferredObligations`. (3) 결과 확인 반영 단계 일곱 줄의 항목과 "해당 없음(이유)", `primaryAction`, `defaultReopenTo`, `mobileReviewable`. (4) `ActiveWorkCard`의 `stages`·`nextHumanTouchpoint`·`expectedDoneAt`(작업은 12, 탐구는 15 `InquiryProgressView`). (5) Goal `recheck` 상태와 지우는 조건 |
| 14 | 다이얼 정의(이름, 값 목록, 설명, 편집 가능 범위, `DialPrecedence`)를 데이터로 제공([판정 J-136]). `maxVisibleDecisions`는 설정이며 막지 않는 권리 게이트는 접고 개수 표시([판정 J-132]). 다이얼 `planAuthoring`(값 `computed`·`hybrid`·`model`, 기본 `hybrid`, 층 user·concern)을 `DIAL_DEFS`에 더한다([판정 J-188]). `loopPlan`의 `skipped`와 `authoredBy`를 뷰에 싣는다. `planAuthoring`의 MVP 노출은 [판정 J-192](§3.17)대로 정한다 |
| 15 | `InquiryProgressView`, 라운드 닫는 계기 셋, `revealAfterClose.otherField`는 15 2판에 반영되었다. 남은 요구 없음 |
| 16 | 결과 확인 전용 우회 지표(확인까지 시간, 근거 펼침, 확인 못함 포함 확인 비율). 관찰 제안 데이터 형식(§3.18). 복귀 점검 G1 기간 켜기(§3.27). 계획 이의 비율을 `authoredBy`별로 잰다([판정 J-188]) |
| 17 | 안전 모드 사유·최근 비정상 종료 목록과 읽기 전용 사유(`recovery_failed` 포함, [판정 J-178])를 `DaemonStatus`에(§3.19·§3.20). 복원 표지 기록([판정 J-152]) |
| 19 | (1) `objection.file` params에 `reasonKind?`(08). (2) `view:review`에 `mobileReviewable`과 이유 키. `command.lookup`, `decision.confirm.targets`, `goal.activate`, `project.create`, `result.accept.decision`, 라운드 키 `inquiryId + roundNo`는 19 2판에 반영되었다. (3) `view:settings`에 `notifications.resultReview`·`resultReviewDigestAt`·`attention.snoozeUntil`·`attention.interruptsPerHour`를 싣고, 바꾸기는 `settings.update`로 한다([판정 J-189], [판정 J-166]). (4) 홈·질문함·다이얼 뷰에 `attentionBudget`(14 §3.13.8)을 싣는다 |
| 20 | 사용자용 연결 상태(§3.0.4)의 판정, 특히 `GET /healthz`로 "서버 PC에 연결할 수 없음"과 "Helm 서버 응답 없음"을 나누기. 결정 막기 기준(서버 `freshness`만). 딥 링크 `helm://question`을 종류에 따라 `SCR-AGREE`·`SCR-REVIEW`·`SCR-GOAL`·`SCR-EVIDENCE`·`SCR-RECOVERY`로. 기기별 시간당 상한은 두지 않는다. 시간당 상한은 `attention.interruptsPerHour` 하나다([판정 J-171], [판정 J-248]). 방해 금지는 의미 설정 `attention.snoozeUntil`로 두고 §3.9.11의 "데몬 설정" 문장을 맞춘다([판정 J-166]). `protocolError`(닫힘 1002·1003)는 사용자용 상태로 두지 않는다(§3.0.4 규칙 7). `UserConnKind`는 §3.0.4 값 열여섯을 쓰고, `viewStale`·`restarted`는 이 값으로 대응시킨다([판정 J-228]) |
| 21 | 질문 카드(접힘·펼침, 깊이별 필드, 줄인 카드의 "그 밖에"), 진행 작업 카드(단계, 위험·가정 줄), 자극 카드와 반응 막대, 근거 트리와 판단 확인 구역, 기준 판정 표, 반영 범위 구역, 다이얼 표의 컴포넌트. `sameSourceFamily`·평면 N·M 대신 이 문서 이름(`correlatedWith`, 방향·이해·실제). 주의 예산 부품의 입력은 `AttentionBudgetVM`(라벨은 `CopyRef`)이다. 연결 상태 값은 §3.0.4 열여섯을 쓴다([판정 J-176], [판정 J-228]). 성질별 보장 수준은 §3.0.7 `guarantees`를 쓴다. 문구 키 타입은 `CopyKey`다([판정 J-175]) |
| 26 | 이 문서의 뷰 타입을 휴대폰도 쓴다. 남은 요구 없음(26 §5.2 04 요구 반영) |
| 03 | `SCR-DIALS`의 MVP 최소판 목록에 `planAuthoring`을 더한다([판정 J-192], §3.17). `SCR-SETTINGS` 알림 절에 결과 확인 알림 항목을 둔다([결정 56], §3.21) |
| 05 | (1) 문구 키 타입은 `CopyKey`다([판정 J-175]). §3.10.8의 "CopyKey라는 이름은 쓰지 않는다" 문장을 지운다. (2) 결과 확인 알림 선택지와 묶음 시각의 키(`label.settings.resultReview.*`, `label.settings.resultReviewDigestAt`, [판정 J-189]). (3) 다이얼 `planAuthoring` 값의 키, 계획 작성자 키(`label.loopPlan.authoredBy.*`), 건너뛴 루프·모델 설계·코드 계획 문장([판정 J-188]). (4) 주의 예산 라벨과 §3.12 "승인됐지만 실행하지 않은 행동" 문장. (5) §3.0.4 상태 값 열여섯의 `label.connection.<상태>`([판정 J-176]) |
| 13 | 웹 페이지 읽기(`web_fetch`)와 웹 검색(`web_search`)을 MVP에 넣는다([결정 55]). O-13-05의 "1차 제외"를 고친다. 도구 목록 항목에 단계 값(`stage`)을 준다 |

## 6. 구현 단위와 완료 기준

ID는 22 추적 색인의 `04/UT-nn`과 같다(행 순서, 새 행은 끝에 붙인다).

| ID | 단위 | 위치(후보, 20이 확정) | 완료 기준(테스트로 확인할 조건) |
|---|---|---|---|
| UT-01 | 공통 상태 표시 | `apps/desktop/src/screens/common/` | 각 화면에 대해 처음 불러오는 중, 캐시 표시, 빈 상태, 오류, §3.0.4 표의 모든 사용자 상태의 스토리가 있고 스크린샷 테스트를 통과한다. 연결 끊김·뷰 낡음 상태에서 결정 버튼이 비활성이고 이유 문장이 있다 |
| UT-02 | 명령 의도 공통 | `apps/desktop/src/intents/` | 모든 결정 의도에 `basisSeq`와 멱등 키가 붙는다(단위 테스트). 보내는 동안 같은 버튼을 다시 누를 수 없다. 거부 세 갈래가 서로 다른 문장으로 보인다 |
| UT-03 | `SCR-HOME` | `screens/home/` | `maxVisibleDecisions` 값 n일 때 카드는 n개까지 펼쳐지고, 접힌 권리 게이트가 있으면 그 개수와 종류가 접힌 줄에 보인다. 선택 요청 카드에 "그 밖에"가 있다. 카드 순서는 뷰의 순서와 같다(앱 정렬 없음) |
| UT-04 | `SCR-BRIEF` | `screens/brief/` | 아홉 절(미룬 반영 항목이 있으면 0절 포함)이 정해진 순서로 렌더된다. 8·9절은 접혀 있다. 결정적 절은 1초 안에 먼저 그려진다. "여기까지 봤음"이 `brief.acknowledge`를 `coveredTo.seq`와 함께 보낸다. 요약을 연 뒤 새 이벤트가 와도 본문이 바뀌지 않고 머리 안내만 나타난다 |
| UT-05 | `SCR-QUESTION` | `screens/question/` | 원함 탐구 출처 질문에는 추천·다른 선택 영역이 렌더되지 않는다. 선택 요청의 버튼 줄에 "승인"·"거절"·"확인"·"계속"만 있는 경우가 없다(문구 테스트, 05 §6). 모든 선택 요청의 "그 밖에" 메뉴에 기준 고치기·질문 다시 쓰기·먼저 알아보기·미루기가 있다. 권리 게이트 질문에 "가정대로 진행"이 없다. 답한 뒤 `impact` 목록이 보인다 |
| UT-06 | `SCR-AUTO` | `screens/autonomous/` | 모든 항목에 "묻지 않은 이유"가 보인다(값이 비면 테스트 실패로 본다). 이의 걸린 항목이 처리 중인 이의 목록에 나타난다. 항목별 [봤음]이 없고, 화면을 열면 `autonomous.markSeen`이 한 번만 간다 |
| UT-07 | `SCR-STIM` | `screens/stimuli/` | "가깝다 표시"만 있는 상태에서 라운드 마치기를 누르면 바로 닫히지 않고 후속 질문(05 §3.2.5)이 나타난다. 숫자 키 1~5가 한글 입력 상태에서도 동작한다(05 §3.8 `KeyboardEvent.code`). 라운드를 마치기 전에는 "확인하려는 기준"이 렌더되지 않는다 |
| UT-08 | `SCR-AGREE` | `screens/agreement/` | 확정이 한 번의 조작으로 끝난다. 고친 뒤에도 확정은 한 번이다. 넓어진 항목이 있을 때만 "넓어진 부분 빼고 맡기기"가 보인다 |
| UT-09 | `SCR-REVIEW` | `screens/review/` | 반영 항목이 남아 있으면 "완료" 문자열이 화면에 없다. 근거가 모델 문장뿐인 기준이 "확인 못함"과 낮춘 이유로 보인다. 결과 확인이 한 번의 조작으로 끝난다. 확인 못한 기준이 있으면 주 버튼이 [조건 붙여 확인]이다. 반영 범위 구역이 접혀 있지 않다. 거절 행은 직전 I가 없을 때 다음 루프 선택을 같은 행에 보인다 |
| UT-10 | `SCR-EVIDENCE` | `screens/evidence/` | 근거 개수로 강도를 표시하는 요소가 없다. 반대 근거 검토 "찾아보지 않음"과 "찾아봄: 없음"이 다르게 렌더된다 |
| UT-11 | `SCR-DIALS` | `screens/dials/` | 다이얼 목록을 앱 코드에 두지 않고 뷰에서 받아 그린다(뷰에 새 다이얼을 넣으면 앱 수정 없이 보인다) |
| UT-12 | `SCR-CONNECT` | `screens/connect/` | 데몬이 꺼져 있어도 화면이 열리고 연결 점검 다섯 단계가 단계별 결과를 보인다. 기기 토큰 값이 화면·로그에 나오지 않는다 |
| UT-13 | `SCR-RECOVERY` | `screens/recovery/` | 재실행 안전성이 "unsafe"인 항목에 "다시 실행" 버튼이 없다. 외부 효과 "unknown" 항목에 확인 작업 만들기가 있다. 보이는 행동은 12 §3.7.4 선택지 집합뿐이다. 복원 표지가 있으면 "복원 지점 이후 기록 없음"과 안전 모드 문장이 머리에 있다 |
| UT-14 | 화면별 선형 텍스트 | 21 UI-D08 | 각 화면의 선형 텍스트가 골든 파일과 같다. TUI 대조에 쓴다 |
| UT-15 | 안전 모드·읽기 전용 | `screens/connect/`, `screens/recovery/` | 안전 모드에서 [안전 모드 풀고 작업 다시 시작하기]가 연결 화면과 복구 화면에 있고 확인 시트를 거쳐 `daemon.exitSafeMode`를 보낸다. 읽기 전용 사유 다섯(`recovery_failed` 포함)이 서로 다른 문장으로 보인다 |
| UT-16 | 새 일 echo 미리보기 | `screens/composer/` | 가벼운 작업 예비 판정이면 보내기 버튼 문구에 echo가 들어간다. 미리보기가 오기 전 보내면 `previewId`가 없다(데몬이 확정 질문으로 돌린다) |
| UT-17 | 뷰 타입 | `packages/protocol` | 이 문서의 뷰 타입 26개가 19 뷰 카탈로그 이름과 하나씩 대응한다(대응표 테스트). `RecordRef`는 `@helm/protocol` 한 곳에만 정의된다 |

## 7. 미결 사항

| 번호 | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| SC-Q1 | 복귀 요약 자동 열기 기준 | 시간만 / 변화 수만 / 둘 다 / 선택 필요가 있으면 항상 | 둘 다 + 선택 필요가 있으면 항상. 마지막 확인 뒤 2시간 이상 그리고 바뀐 것 1개 이상. 다이얼로 둔다 |
| SC-Q2 | 연결 끊김 중 반응(자극) 기록 | 기기에 두고 다시 연결 뒤 사람이 보내기 / 막음 | 기기에 두고 보내기만 사람이 확인(§3.9). 반응은 관찰이며 결정으로 세지 않는다. 라운드 흐름을 끊지 않기 위해서다 |
| SC-Q3 | 홈 주의 카드 개수 기본값 | 3 / 5 / 제한 없음 | 3(설정 `maxVisibleDecisions`, canon §12.10 `maximum_active_gates: 3`을 표시 개수로만 사용, canon-3 C3). 접힌 권리 게이트는 개수를 항상 보인다 |
| SC-Q4 | "봤음" 표시를 둘지 | 둔다 / 두지 않는다(열람 기록만) | (해소) 항목별 [봤음]은 두지 않고 열람 기록만 남긴다. 확인하고 싶은 항목만 [이대로 둔다] |
| SC-Q5 | 결과 확인 전 독립 검증을 기다릴지 | 기다림 강제 / 기다리지 않고 확인 가능 | 기다리지 않고 확인 가능(사람의 권리). 독립 검증 다이얼이 켜져 있으면 버튼 옆에 진행 상태를 보인다 |
| SC-Q6 | 질문 깊이(가볍게/일반/깊은)를 누가 정하나 | 데몬(11) / 화면이 필드 수로 추정 | 데몬. 화면은 추정하지 않는다 |
| SC-Q7 | 관찰 제안의 "채택"이 바로 Concern을 열지, 질문을 거칠지 | 바로 Concern / 정책 수정만 질문 | 코드·스킬 산출물은 Concern을 열고 작업 합의 확인을 거친다. 정책·다이얼 조정은 권리 게이트 질문 |

## 8. 출처

- 브리프 결정 1, 2, 8, 10~12, 14, 15, 18, 21, 22, 24, 26, 30~32, 34, 35, 37, 38, 42, 47~49, 53, 55, 56, §2.5, §3.2, §3.3, §3.5, §5.2, §6. 조정자 판정: `process/rulings-stage2a.md` J-02~J-05, J-20, J-23, J-24, J-35, J-36, J-44, J-81, J-89, J-99, J-111, J-115~J-117, J-120~J-126, J-129~J-133, J-136, J-137, J-139, J-141, J-144, J-150, J-152, J-166, J-171, J-175, J-176, J-178, J-188, J-189.
- v0.3: `09-client-opdc.md` §4·§5·§6, `06-asking-and-interruption.md` §3·§4·§5·§6, `04-inquiry-types.md` §2~§5·§7, `03-loops-and-transitions.md` §3·§5·§6·§7, `07-modes-and-capabilities.md` §3·§4·§6·§7, `02-core-concepts.md` §2·§3·§9, `01-scope-and-motivation.md` §3.7.
- 감사: `docs/v0.3/audit/audit-report.md` §2, §3.3, §3.6, §5.4.
- 원천: canon §4.3, §8.3, §8.9, §8.10, §9.5, §10.7, §12.4~§12.8, §12.12, §12.13, §17.3, §17.5, §17.6, §17.8, §18.3~§18.5; canon-2 §3.4~§3.13, §3.18, §3.19, §4.1, §4.4(R1·R2), §4.5, §5.2, §6.1, §6.3, L2·L3·L5·L8·L12·L14·L16; canon-3 §6.4~§6.11, §7.1 C1~C5·C9·C10, §7.2 G1·G11·G12·G15·G16, §7.3 I4; 발췌1 E1-074~E1-088; 발췌3 X3-2-11~X3-2-20; 발췌4 4-39, 15-7, 20-2~20-8.
- 21(P14) 1단계 초안 UI-D02, UI-D03, UI-D05, UI-D08, UI-D11, UI-D15.

### 8.1 원천 체크리스트 반영표 (04 해당 항목)

| 원천 항목 | 반영 위치 또는 반영하지 않은 이유 |
|---|---|
| canon §21-04 fixed_sections 4 | 복귀 요약 §3.2(brief), 질문 §3.4(choice_request), 진행 작업 카드 §3.0.7(active_work), 결과 확인 §3.12(result_review) |
| canon §21-04 Return Brief 5절, Gate 13필드 ↔ 고정 표현, 선택 요청 깊이 3 | §3.2 대응표, §3.4 필드·깊이 표. 깊은 검토의 "복구 방법과 명시적 수락"은 "되돌리는 방법" 행으로, "이해관계자와 결정 권한"은 1인 앱이라 넣지 않았다(결정 24, §3.4) |
| canon §21-04 맡긴 범위 8, 결과 확인 트리, 전체 반영 체크 5, Integration Review 6, Delegation Interaction 8, Inquiry Interaction 7 | §3.11 맡긴 범위 펼치기·합의 항목, §3.12 결과 확인 트리·반영 여섯 줄, §3.8 사람이 할 수 있는 것 |
| canon §21-04 상태 라벨 work 14·choice 7, 라벨 없는 상태 | 03 §3.3. Closed·Refused·Deferred 처리는 03 §3.3.2 |
| canon §21-04 인식적 UI 원칙 7, 모름을 정상 상태로 | §3.0.3 빈 상태 "없음/모름" 구분, §3.8 규칙, §3.15 |
| canon §21-04 근거 품질 질문 7, 근거 개수로 강도 금지 | §3.15 |
| canon §21-04 자동화 역설 MUST 5 | 1번: §3.0.7·§3.10 지금 하는 일·예상 경로·단계·다음 사람 접점. 2번: §3.2 3·7절. 3번: 질문함과 Goal 확인. 4번: §3.20 마지막 확인 지점. 5번(쉬운 시점과 어려운 시점의 부담 비교): 16 `a12.hard_moment_load`(§3.23.8)가 잰다. 이 문서는 복구·결과 확인 화면에서 원본 로그 없이 판단할 수 있게 한다 |
| canon-2 §11-04 Choice gate 4행동, `[승인][거절]` 금지 | §3.4 행동 버튼 |
| canon-2 §11-04 Choice impact echo | §3.4 "답한 뒤" |
| canon-2 §11-04 Work Agreement echo | §3.11, 진행 작업 카드 |
| canon-2 §11-04 Completion ✓/△, Review 5행동, "수락됨 · 전체 반영 N개 남음" | §3.12. 라벨은 "결과 확인됨 · 반영 n개 남음"(03 §3.3.2) |
| canon-2 §11-04 오류·저하 4종 | Kernel unavailable → §3.0.4 "Helm 서버 응답 없음"과 05 §3.11, capability missing → §3.10 집행 수준, projection stale → §3.0.4 "뷰 낡음", unknown external outcome → §3.20 |
| canon-2 §11-04 stale view를 current처럼 보이지 않기, source cursor | §3.0.4 규칙 2, §3.2 기준과 누락 |
| canon-2 §11-04 정보 밀도 R2 | §3.4 다른 선택 접힘 "+n", 깊이별 필드 |
| canon-2 §11-04 템플릿 필드 중 화면과 drill-down | §3.4 깊이 표, §3.2, §3.11 "맡긴 범위 펼치기", §3.8 |
| canon-3 §8-04 복귀 요약 하나로 | §3.2(SC-01) |
| canon-3 §8-04 질문 카드 collapsed·expanded | §3.0.7, §3.4 |
| canon-3 §8-04 primary action, Approve/Deny는 권리 게이트 bounded side effect에만 | §3.4 행동 버튼 표 첫 행 |
| canon-3 §8-04 진행 작업 카드와 항상 가능한 동작 | §3.0.7, §3.10. "위험·가정" 줄을 넣었다. "이관" 동작은 1인 앱에서 WorkUnit 대체(08)로 표현해 동작으로 두지 않았다 |
| canon-3 §8-04 근거 화면 | §3.15 |
| canon-3 §8-04 결과 확인 두 단계 | §3.12 |
| canon-3 §8-04 stale·contested·inferred·policy-approved 표시 | 03 §3.3.6 품질 배지와 작성자 표시, §3.0.4 |
| 브리프 §3.5 "모델이 초안, 사람은 반응"과 v0.2 증거 | §2.3 |
| 브리프 §3.5 C/A 사람 조작 2회 상한 | §3.11(1회), §3.12(1회), 03 §3.7 |
| 발췌1 Q6 관찰 결과 전달 채널, 세션에 써 넣지 않기 | §3.18, §3.14 |
| 발췌4 20-7 밤 11시 예시 | 05 §3.1.7 |
| 감사 §3.6 거부와 강등 구분 | §3.12 기준 표 |
| 브리프 결정 53(루프 계획 혼합, [판정 J-188]) | §3.7 계획 표시(`authoredBy`, 건너뛴 루프, 모델 설계 근거), §3.13 계획 기록, §3.17 다이얼 `planAuthoring` |
| 브리프 결정 55(MVP 도구와 네트워크 차단) | §3.21 도구 단계와 내부망 차단 문장 |
| 브리프 결정 56(결과 확인 알림, [판정 J-189]) | §3.21 알림 절 |
| 판정 J-166·J-171·J-175·J-176·J-178 | §3.0.2 `CopyKey`, §3.0.4 상태 값과 `recovery_failed`, §3.21 `attention.snoozeUntil`·`attention.interruptsPerHour`(기기별 상한 삭제) |
| 판정 J-192·J-225·J-228 | §3.17 MVP 다이얼 여섯 개(`planAuthoring` 포함), §3.12 `mobileReviewable`(결과 제출 시점에 런타임이 정한 값을 그대로 보임), §3.0.4 프로토콜 오류의 사용자용 상태(규칙 7)와 값 열여섯 |

## ADR 후보

### A3. 복귀 요약을 머리 한 줄과 아홉 절로 정한다

- 상태: 제안
- 맥락: 원전과 v0.3의 복귀 요약 구성이 문서마다 다르다(canon-3 I4: SA 3칸, SBAR 5칸, UX P9 4칸, UX §6.6.1 6블록, A×B·C×D 필드, v0.3 09 4항목, P05 고정 표현 5개, CLI 경험 6단계).
- 결정: 머리 한 줄(지금 정할 것 n · …, 4절 링크) / Goal과 바뀐 기준 / 돌아온 뒤 달라진 점(N·E·M) / 왜 중요한가 / 지금 선택이 필요함 / 확인하면 좋은 것 / 진행 중인 작업 / 그대로 두면 / 에이전트가 정한 것(접힘) / 지금 읽지 않아도 됨(접힘). 있을 때만 그리는 블록 넷(0 미룬 반영 항목, 서버 재시작·복원·복구, 휴대폰에서 줄여 본 항목, 관찰 에이전트)과 끝의 기준 범위·누락 범주.
- 근거: P05 고정 표현 다섯을 모두 포함하고, v0.3의 권리·정보 게이트 구분과 혼자 정한 결정을 더하며, Return Brief 계약 5절(canon §12.5)을 모두 덮는다. "투영"과 "예측"을 섞지 않는다(canon-3 C5).
- 기각한 대안: v0.3 09의 네 항목(Goal·예측이 빠짐), UX §6.6.1 6블록(혼자 정한 결정과 정보 게이트 구분이 없음).
- 결과: 12가 이 구성의 뷰를 만든다. 16의 복귀 지표(time-to-orientation 등)를 이 화면에서 잰다.

### A4. 연결이 끊기거나 화면이 낡으면 사람 결정을 막고 초안만 보존한다

- 상태: 제안
- 맥락: 원격 접속(결정 21·38)에서 끊김이 잦다. 결정 명령을 기기에 쌓아 두었다가 다시 연결될 때 보내면, 그 사이 상황이 바뀐 결정이 적용될 수 있다(stale gate, canon-2 L14).
- 결정: 연결 끊김, 다시 맞추는 중, 뷰 낡음 상태에서 답하기·확정·결과 확인·이의는 보낼 수 없다. 쓰던 내용은 기기에 초안으로 남기고, 다시 연결되면 사람이 바뀐 상황을 본 뒤 보낸다. 자극 반응은 결정이 아니므로 기기에 두었다가 사람이 보내기를 누른다.
- 근거: 결정은 본 상황에 묶여야 한다. 자동 전송은 사람이 보지 않은 상황 변화를 합의된 것으로 만드는 위험이 있다(canon §12.12 금지 4).
- 기각한 대안: 오프라인 대기열 자동 전송(낡은 결정 적용 위험), 오프라인에서 화면 전체 막기(읽기와 검토도 막혀 쓸모가 줄어듦, canon-3 §6.10.2 "offline-first read/review").
- 결과: 20이 초안 보존과 재접속 뒤 차이 표시를 구현한다. 19는 `basisSeq` 불일치를 별도 오류(3004)로 돌려준다. [판정 J-02]로 채택되었다.

### A5. 홈 주의 카드는 기본 3개를 펼치고 접힌 권리 게이트는 개수를 항상 보인다

- 상태: 제안
- 맥락: 원전은 활성 Gate 상한 3을 두었다(canon §12.10). v0.3에는 개수 상한이 없고 고정 숫자를 피하라는 원전 규칙도 있다(canon-3 C3).
- 결정: 3은 홈에 펼쳐 보이는 카드 수의 기본값(설정 `attention.maxVisibleDecisions`, 다이얼 아님)이다. 데몬 순서(막는 권리 게이트 → C/A 접점 → 막힌 정보 게이트 → 나머지)대로 펼치고 나머지는 "그 밖에 n개"로 접는다. 접힌 것 가운데 권리 게이트는 개수와 종류를 그 줄에 항상 보인다. 막지 않는 권리 게이트(결과 확인, Goal 확인)는 기록은 즉시, 전달은 다음 작업 경계나 검토 창이다([판정 J-132], 01 §3.7).
- 근거: 사람의 권리가 걸린 질문을 표시 상한으로 숨기면 작업이 멈춘 이유를 놓친다. 막지 않는 권리 게이트를 모두 펼치면 가벼운 작업 결과 확인이 쌓여 주의 예산을 다 쓴다(V5-006).
- 기각한 대안: 모든 질문 펼치기(주의 예산 무시), 권리 게이트를 개수와 관계없이 모두 펼치기(가벼운 작업 결과 확인이 홈을 채움).
- 결과: 14가 설정을 등록한다. 16이 "Concern당 전달된 질문 수"로 기본값을 조정한다.
