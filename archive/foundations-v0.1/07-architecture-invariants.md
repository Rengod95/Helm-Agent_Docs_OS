# Architecture Invariants

## 1. 아키텍처의 역할

Helm의 기술 아키텍처는 Foundations의 의미를 보존하는 수단이다. 특정 데이터베이스, UI 프레임워크, 에이전트 SDK가 제품 존재론을 결정해서는 안 된다.

아키텍처는 다음 요구를 동시에 만족해야 한다.

- 로컬 프로젝트에서 단독 사용 가능
- 여러 에이전트와 실행기를 교체 가능하게 연결
- 시간 간격과 세션 경계를 넘어 상태 복원
- 인간의 결정과 에이전트 주장을 구분
- 원본 Event와 근거까지 추적
- 역할과 Concern별로 다른 ContextProjection 생성
- 팀·조직 수준의 협업과 감사로 확장
- Markdown/YAML 기반 현재 사용자 경험과 점진적 호환

## 2. 논리 계층

```text
┌────────────────────────────────────────────┐
│ Experience Layer                           │
│ Brief · Inquiry · Decision · Integration   │
├────────────────────────────────────────────┤
│ Attention & Governance Engine              │
│ Gate · Authority · Escalation · Policy     │
├────────────────────────────────────────────┤
│ Normative Domain                           │
│ Purpose · Decision · Commitment            │
├────────────────────────────────────────────┤
│ Epistemic Domain                           │
│ Problem · Hypothesis · Claim · Evidence    │
├────────────────────────────────────────────┤
│ Material Domain                            │
│ Artifact · Run · Test · External State     │
├────────────────────────────────────────────┤
│ Event Ledger & Projection Runtime          │
│ Identity · Provenance · Time · Derivation  │
├────────────────────────────────────────────┤
│ Agent / Tool / Storage Adapters            │
│ Codex · Claude · Git · CI · Markdown       │
└────────────────────────────────────────────┘
```

계층은 배포 단위가 아니라 의미 경계다. 초기 구현은 하나의 로컬 프로세스여도 된다.

## 3. Event Ledger

### MUST

- 중요한 상태 변화는 append-only Event로 기록한다.
- Event는 Actor, 시점, 주체, 권한 근거, 출처를 가진다.
- 보정과 취소는 기존 Event 수정 대신 새로운 Event로 표현한다.
- 현재 상태와 UI는 Event에서 재구성 가능한 projection이어야 한다.
- 외부 시스템 Event의 중복 수집은 idempotent해야 한다.

### SHOULD

- 로컬 환경에서 사람이 읽을 수 있는 export를 제공한다.
- Git commit, agent run, CI job 등 외부 식별자를 보존한다.
- Event schema version과 migration 경로를 제공한다.

## 4. Domain Graphs

Normative, Epistemic, Material graph는 논리적으로 분리하되 관계를 일급으로 관리한다.

- Decision이 어느 Claim과 Evidence에 의존하는가
- WorkUnit이 어느 Purpose와 Commitment를 수행하는가
- Material change가 어느 Authority Envelope에서 발생했는가
- Evidence가 어느 실행·Artifact에서 파생되었는가
- Outcome이 어느 Assumption을 무효화하는가

단순 URL이나 문서 경로 링크만으로 관계 의미를 대체하지 않는다.

## 5. Projection Engine

Projection은 정본 상태를 특정 소비 목적에 맞게 압축한다.

### 필수 projection

- Common Operating Picture
- Return Brief
- Context Pack
- Inquiry Map
- Decision Queue
- Delegation Board
- Assurance View
- Integration Map

### 불변조건

- 각 projection은 생성에 사용한 Event cursor를 가진다.
- 중요 원본으로 drill-down할 수 있다.
- 누락 기준과 압축 정책을 설명할 수 있다.
- 관련 Normative baseline이 바뀌면 stale 또는 invalidated 상태가 된다.
- projection 간 데이터 불일치는 정본 충돌이 아니라 projection bug로 취급한다.

## 6. Attention & Governance Engine

이 계층은 알림 시스템이 아니다. 다음을 수행한다.

- Authority Envelope 검증
- Decision Gate 필요성 평가
- 유사 Gate 병합
- 주의력 예산에 따른 배치와 인터럽트
- 정책 기반 자동 승인과 인간 에스컬레이션
- 재검토 조건 감시
- 중요한 이견과 반대 증거 보존

Gate 결정 근거는 사용자가 검토할 수 있어야 한다. 초기에는 학습된 불투명 점수보다 규칙과 설명 가능한 휴리스틱을 우선한다.

## 7. Agent Runtime Adapter

Helm은 특정 에이전트 런타임을 제품 코어와 결합하지 않는다.

Adapter의 책임:

- Delegation Contract를 에이전트별 지시 형식으로 변환
- 실행 수명주기와 도구 호출 Event 수집
- Artifact change와 Evidence 연결
- 권한 밖의 요청 차단 또는 에스컬레이션
- 에이전트 결과를 ClaimingComplete로 변환
- 취소, 일시중지, 방향 수정 지원

Adapter가 수행하지 않는 책임:

- Purpose의 정당성 결정
- Evidence 없이 완료 수락
- 전역 Decision 기준선의 임의 변경
- 다른 Adapter의 상태를 정본으로 덮어쓰기

## 8. Storage Strategy

### OSS kernel

초기 오픈소스 커널은 local-first를 기본으로 한다.

- embedded database 또는 event file
- 사람이 읽을 수 있는 Markdown/YAML export
- Git과 함께 사용할 수 있으나 Git을 유일한 상태 저장소로 강제하지 않음
- 오프라인에서도 핵심 탐구·위임·결정 기능 사용 가능
- 공개 schema와 adapter protocol

### SaaS layer

SaaS는 로컬 커널이 제공하기 어려운 협업·조직 기억을 담당한다.

- 복수 사용자 권한과 책임
- 팀 Common Operating Picture
- 실시간 Gate와 handoff
- 조직 정책 및 승인 규칙
- 장기 Evidence·Decision graph
- 감사, 분석, 비교 실험
- 여러 workspace를 가로지르는 학습

오픈소스를 기능 제한된 데모로 만들지 않는다. 개인 사용의 핵심 가치는 OSS에 남고, SaaS는 협업과 거버넌스에서 가치가 커져야 한다.

## 9. 현재 Docs-Agent OS와의 매핑

| v0 구조 | 유지할 가치 | 차세대 해석 |
|---|---|---|
| `state/current.yaml` | 빠른 복귀와 전역 상황 | Common Operating Picture projection |
| `state/checkpoints/` | 세션 간 handoff | Return Brief의 export |
| `references/` | 배경 자료와 제약 | Source/Evidence registry |
| `features/` | 코드·제품 영역별 작업 허브 | Concern/Artifact scope의 한 종류 |
| `features/*/current.md` | 지역 작업 상태 | WorkUnit/Concern projection |
| `decisions/` | 판단 근거 보존 | Normative graph의 human-readable view |
| agent fragments | 진입 프로토콜 | Runtime adapter bootstrap |
| scaffold/instance 분리 | 사용자 데이터 보호 | schema/template과 workspace state 분리 |

### 변경 원칙

1. 기존 파일을 즉시 정본 데이터베이스로 마이그레이션하지 않는다.
2. 새 모델을 sidecar Event와 projection으로 실험한다.
3. v0 파일을 읽는 importer와 새 상태를 Markdown으로 내보내는 exporter를 분리한다.
4. 실험에서 가치가 확인된 Entity와 Event만 안정 schema로 승격한다.
5. 사용자 소유 문서는 자동 덮어쓰지 않는다.

## 10. Context Compilation

에이전트에게 전체 문서 트리를 읽게 하지 않고 WorkUnit별 ContextProjection을 컴파일한다.

```text
Inputs:
  Purpose + Concern + DelegationContract
  + active Decisions/Constraints
  + relevant Claims/Evidence
  + Artifact neighborhood
  + current risks and open conflicts

Output:
  minimal sufficient context
  + source links
  + omitted categories
  + invalidation triggers
```

Context compiler는 토큰 최소화만 최적화하지 않는다. 의사결정에 중요한 차이와 반대 증거의 보존을 제약 조건으로 둔다.

## 11. 의미적 동시성 제어

Git merge conflict만으로 다중 에이전트 충돌을 탐지할 수 없다.

Helm은 다음의 의미적 lease 또는 변경 의도를 추적해야 한다.

- 변경하려는 Decision/Constraint
- 의존하는 Assumption
- 변경 대상 Artifact와 인터페이스
- 예상하는 Outcome
- 현재 Authority Envelope

두 작업이 다른 파일을 수정해도 같은 Decision을 상반되게 해석하면 충돌이다. 반대로 같은 파일을 수정해도 목적과 변경이 양립하며 검증 가능하면 조정할 수 있다.

## 12. 보안과 안전

### MUST

- 최소 권한을 WorkUnit 단위로 적용한다.
- 외부 부작용과 데이터 공개는 별도 Action class로 다룬다.
- Prompt 내용과 실행 권한을 분리한다.
- 민감한 원본 Evidence가 projection과 SaaS로 유출되지 않도록 정책을 적용한다.
- 감사 Event 자체의 무결성과 Actor identity를 보호한다.

### SHOULD

- 샌드박스·승인·롤백 메커니즘을 Adapter capability로 표준화한다.
- 위험한 Action은 dry-run과 영향 미리보기를 제공한다.
- 정책 위반을 에이전트 실패가 아니라 Governance Event로 기록한다.

## 13. 기술 비목표

- 처음부터 완전한 분산 이벤트 소싱 플랫폼 구축
- 모든 문서를 지식 그래프로 자동 변환
- 범용 프로젝트 관리 데이터 모델 복제
- 특정 모델 공급자의 세션 구조를 Domain model로 채택
- 의미적 판단을 모두 LLM 분류에 의존
- 모든 상태를 실시간 동기화해야만 동작하도록 설계

## 14. 아키텍처 결정 평가 질문

새 기능이나 기술을 도입하기 전에 다음을 묻는다.

1. 어느 Foundation 공리에서 필요한가?
2. Normative/Epistemic/Material 중 어떤 상태를 다루는가?
3. 정본인가 projection인가 adapter인가?
4. 어떤 Event와 불변조건이 필요한가?
5. 인간의 상황 인식과 directability를 높이는가?
6. 사용자의 주의력을 어디서 절약하고 어디에 더 쓰게 하는가?
7. 실패했을 때 원본 근거와 상태를 복구할 수 있는가?
8. 특정 모델·도구 없이도 의미가 유지되는가?

## 15. 실행 중인 vertical slice

Foundations의 첫 실행 아키텍처는 [`Helm System Architecture v0`](../architecture/helm-system-v0.md)에 기록한다.

- `packages/helm-core`: Event ledger, 의미 명령, projection, Git adapter
- `packages/helm-server`: local HTTP/SSE transport
- `packages/helm-sdk`: attached client contract
- `packages/helm-cli`: local/attached CLI와 server launcher
- `apps/helm-web`: 같은 core projection을 사용하는 GUI

이 구현은 Foundations의 완성이나 stable schema 선언이 아니다. 구현 coverage와 미구현 invariant를 architecture 문서에 함께 기록하고, resumption dogfood의 promotion gate를 통과한 Event만 안정 계약 후보로 삼는다.
