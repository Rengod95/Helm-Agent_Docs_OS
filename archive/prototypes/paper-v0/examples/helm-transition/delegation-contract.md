# Delegation Contract — Helm founder dogfood와 read-only sidecar pilot

> Example status: `claiming-complete`. 2026-08-16 product owner의 실제 수행 요청을 반영했고, 결과 수락을 기다린다.

## Identity

- Contract ID: `contract-helm-pilot-001`
- WorkUnit ID: `wu-helm-paper-pilot`
- Concern: `helm-product-transition`
- Requester: product owner
- Performer: research/design and prototype agent
- Acceptor: product owner
- Integration owner: product owner
- Status: `claiming-complete`

## 1. Intent

- Purpose: Helm의 네 핵심 상호작용을 실제 product decision에 사용하고, 수동 정보 추출의 한계를 read-only collector로 검증한다.
- Desired outcome: 실제 run 기록, 관찰 가능한 측정값, 반증을 보존한 분석, 실험용 sidecar와 자동 검사
- Why this performer: 저장소와 Foundations 맥락을 이미 보유하고 연구·설계 문서를 작성할 수 있음
- Why now: 안정 schema와 runtime 구현 전에 가장 큰 제품 위험을 검증해야 함
- Non-goals: 프로덕션 UI, stable domain kernel/schema, 자동 Gate 분류, SaaS backend, 시장 수요 주장

## 2. Conditions of satisfaction

| Criterion | Evidence required | Verification method | Acceptance authority |
|---|---|---|---|
| C1 네 primitive가 독립적인 template으로 존재 | 4개 Markdown template | 파일 및 필수 필드 검사 | product owner |
| C2 추상 예시가 아닌 현재 Helm Concern으로 end-to-end 작성 | 4개 filled artifacts | 저장소 사실과 제안 상태 구분 검토 | product owner |
| C3 비교 가능한 실험 절차 존재 | experiment protocol | 조건·절차·지표·반증 기준 검토 | product owner |
| C4 Foundations 추적 가능 | artifact-to-foundation links | local link check | product owner |
| C5 사용자의 선택이 실행 범위로 정확히 전개 | committed Decision Gate와 변경된 Contract | 선택·비목표·결과의 추적 검사 | product owner |
| C6 입력 프로젝트 비파괴 sidecar 검증 | 자동 테스트와 실제 저장소 capture | 전후 Git 상태 비교, 생성물 검사 | product owner |

## 3. Scope

### Included

- `docs/prototypes/paper-v0/` 문서 설계
- 현재 저장소 상태를 사용한 dogfood example
- `docs/prototypes/paper-v0/runs/`의 실행 기록과 측정값
- `experiments/helm-sidecar/`의 dependency-free read-only collector
- NASA-TLX, SAGAT 계열, 동기·engagement 측정을 참고한 평가 프로토콜
- 기존 Foundations/Research 문서 링크

### Excluded

- 기존 `packages/agent-docs-init` package 및 CLI 변경
- 사용자 데이터 수집
- 외부 참여자 모집
- 데이터베이스 schema와 API 구현
- 실험용 event vocabulary의 안정 API 선언

### Dependencies

- Helm Foundations v0.1
- current repository architecture
- product owner의 실제 pilot 참여

### Protected baselines

- 현재 npm initializer 동작과 패키지 파일
- 사용자 소유 결정: 제품 구현 우선순위는 문서에서 승인된 것으로 표현하지 않음
- 기존 Architecture Fundamentals는 v0 기록으로 보존

## 4. Authority envelope

| Dimension | Grant / limit |
|---|---|
| Read scope | repository docs and code, public research sources |
| Write scope | `docs/prototypes/`, `experiments/helm-sidecar/`, thread visualization directory |
| Allowed actions | Markdown 작성, 실험용 Node.js collector 구현, read-only project capture, 로컬 자동 테스트 |
| Forbidden actions | 기존 initializer 변경, 외부 메시지, 배포, 안정 schema 선언, 사용자 결정 대행 |
| External side effects | none |
| Resource / cost limit | 기존 도구 범위, 유료 서비스 사용 없음 |
| Time boundary | founder dogfood 001과 thin sidecar의 첫 capture·검증 |
| Reversibility requirement | 모든 변경은 문서이며 Git으로 검토·되돌리기 가능 |

## 5. Epistemic obligations

- 확인해야 할 Assumption: 네 primitive가 Helm의 핵심 가치를 충분히 대표함
- 비교해야 할 대안: code-first, scaffold-first, sidecar-first
- 보존해야 할 Counterevidence: 실제 사용자 검증 없음, facilitator bias, 문서 작성 부담
- 모른다고 보고해야 할 범위: 시장 수요, 장기 사용, 지불 의사, 자동 분류 정확도
- 완료 시 제출할 Evidence: run log, 전후 Git 상태, sidecar output, automated tests, coverage comparison

## 6. Coordination obligations

- Dependent WorkUnits: 향후 sidecar prototype, agent adapter, user research
- Shared Artifacts / Decisions: Foundations ontology와 state model
- Expected observable progress: 각 artifact 작성 후 파일 목록과 검증 결과
- Next checkpoint: product owner가 Decision Gate와 example을 실제로 검토할 때
- Handoff recipient and format: product owner에게 Return Brief + open Gate

## 7. Escalation triggers

- 제품 방향을 사실상 확정하는 문구가 필요한 경우
- 사용자 선호나 결정이 없는 상태에서 승인으로 기록해야 하는 경우
- prototype을 위해 runtime/code 변경이 필요해진 경우
- 외부 참여자 또는 데이터 접근이 필요한 경우
- 연구 도구의 라이선스·상업 사용 조건이 불명확한 경우

## 8. Negotiation log

| Event | Actor | Proposed change | Reason | Resolution |
|---|---|---|---|---|
| Contract drafted | research/design agent | paper-first 검증 범위 | Foundations를 저비용으로 시험 | superseded by accepted run |
| Recommended sequence accepted | product owner | A paper validation 후 B read-only sidecar 수행 | 실제 수행·검증과 결과 분석 요청 | accepted 2026-08-16 |
| Scope translated | prototype agent | stable kernel 대신 별도 experiment 구현 | 사용자 선택의 순서와 낮은 피벗 비용 보존 | active |

## 9. Completion claim

- Claimed outcome: 실제 Gate 반영, founder-dogfood-001 수행, 비파괴 sidecar 구현, 두 capture 조건 비교, 가설별 결과 분석 완료
- Criteria satisfied: C1–C6 performer verification 완료
- Criteria not satisfied: product owner의 결과 수락, 지연 복귀, 주관 workload·agency 측정
- Evidence: [`founder-dogfood-001`](../../runs/founder-dogfood-001/), [`experiments/helm-sidecar`](../../../../../experiments/helm-sidecar/README.md), Node test 5/5 pass, worktree digest 전후 동일
- Known limitations: 단일 프로젝트·단일 founder, facilitator가 저자·구현자·분석자, 비교 baseline과 24시간 resumption 없음
- Unexpected consequences: generated Brief가 56개 material Event를 그대로 나열해 collector가 오히려 information flooding을 재현함
- Remaining uncertainty: Return Brief 복귀 효과, 사용자 workload·agency, semantic capture correction rate, 외부 사용자 가치
- Invalidation triggers: 사용자가 다른 검증 순서 또는 제품 프레임을 선택

## 10. Acceptance and integration

- Acceptance: `accepted for execution`
- Accepted by: product owner
- Rationale: Decision Gate의 권고 순서대로 실제 수행과 검증을 진행하도록 명시적으로 요청함
- Remaining obligations: product owner outcome acceptance 또는 correction, 다음 Gate 선택
- Integration target: Helm product roadmap and domain schema decision
- Integration status: analysis delivered; roadmap integration pending owner acceptance
- Reopen trigger: 첫 pilot 결과가 핵심 가설과 충돌
