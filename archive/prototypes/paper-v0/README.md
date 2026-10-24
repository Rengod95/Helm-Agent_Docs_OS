# Helm Paper Prototype v0

> Status: test artifact, not a product specification  
> Goal: Foundations의 핵심 상호작용이 실제 사용자의 상황 인식·판단·결과 품질을 개선하는지 코드 구현 전에 검증

## 1. 검증 범위

Paper Prototype v0는 다음 네 primitive만 검증한다.

1. **Return Brief** — 시간 간격 이후 상황과 판단권 복원
2. **Inquiry Map** — 문제 프레임, 경쟁 가설, 증거, 다음 실험 관리
3. **Delegation Contract** — 목적·권한·완료 기준을 포함한 작업 이관
4. **Decision Gate** — 중요한 선택에 대한 근거 있는 사용자 개입

이 단계에서는 다음을 검증하지 않는다.

- 완전한 Event Store 구현
- 실제 에이전트 권한 차단
- 다중 사용자 실시간 동기화
- 자동 Context compiler 정확도
- SaaS 권한·결제·조직 관리
- 최종 시각 디자인

## 2. 왜 paper prototype인가

Foundations가 틀렸다면 안정 schema와 런타임을 먼저 구현할수록 피벗 비용이 커진다. Paper prototype은 사람이 뒤에서 상태를 구조화하는 Wizard-of-Oz 방식으로 다음 질문을 검증한다.

- 사용자는 이 구조를 실제로 이해하는가?
- 어떤 필드는 판단에 사용되고 어떤 필드는 장식인가?
- Gate가 결과를 바꾸는가, 승인 마찰만 만드는가?
- Return Brief가 원본 로그 재독을 대체할 수 있는가?
- 경쟁 가설이 조기 수렴을 줄이는가?
- Contract가 방향 이탈을 줄이면서도 작성 부담을 감당할 수 있는가?

## 3. 아티팩트

### Templates

- [`templates/return-brief.md`](templates/return-brief.md)
- [`templates/inquiry-map.md`](templates/inquiry-map.md)
- [`templates/delegation-contract.md`](templates/delegation-contract.md)
- [`templates/decision-gate.md`](templates/decision-gate.md)

### Helm dogfood example

현재 Docs-Agent OS에서 차세대 Helm으로 전환하는 실제 Concern을 예시로 사용한다.

- [`examples/helm-transition/return-brief.md`](examples/helm-transition/return-brief.md)
- [`examples/helm-transition/inquiry-map.md`](examples/helm-transition/inquiry-map.md)
- [`examples/helm-transition/delegation-contract.md`](examples/helm-transition/delegation-contract.md)
- [`examples/helm-transition/decision-gate.md`](examples/helm-transition/decision-gate.md)

### Evaluation

- [`experiment-protocol.md`](experiment-protocol.md)
- [`runs/founder-dogfood-001/`](runs/founder-dogfood-001/) — 첫 실제 Gate와 sidecar 검증 결과

## 4. 운영 순서

```text
1. Facilitator가 실제 프로젝트 Event와 자료를 관찰한다.
2. Return Brief와 Inquiry Map을 수동으로 작성한다.
3. 사용자가 문제 프레임과 기준을 수정한다.
4. 합의된 내용을 Delegation Contract로 변환한다.
5. 에이전트 작업을 기존 도구에서 실행한다.
6. 중요한 이견·권한 초과·비가역 선택에만 Decision Gate를 생성한다.
7. 에이전트의 완료 주장을 증거와 함께 수락 또는 반려한다.
8. 행동·시간·오류·주관 경험을 기록한다.
```

Facilitator는 에이전트 결과를 좋게 보이게 편집하지 않는다. 원본 Evidence와 Counterevidence를 보존하고, 실험 조건마다 같은 수준의 도움을 제공한다.

## 5. 최소 상호작용 문법

네 아티팩트는 공통 행위를 사용한다.

| 행위 | 의미 |
|---|---|
| Inspect | 근거와 원본 Event를 확인 |
| Reframe | 문제 정의나 Purpose 연결을 수정 |
| Challenge | Claim, Evidence 관계, Recommendation에 이의 제기 |
| Compare | 대안과 가설의 차이를 같은 기준으로 검토 |
| Delegate | 조건과 권한을 포함한 Commitment 생성 |
| Decide | Normative baseline을 변경 |
| Defer | 더 좋은 시점 또는 Evidence까지 결정 연기 |
| Experiment | 결정 전에 불확실성을 줄이는 WorkUnit 생성 |
| Accept | 조건부 또는 최종 수락 |
| Reopen | 무효화 조건 때문에 과거 결정 재검토 |

## 6. 프로토타입 성공의 최소 조건

다음이 동시에 관찰되어야 다음 구현 단계로 진행한다.

- Return Brief가 원본 로그 없이도 핵심 상황을 복원시킨다.
- 사용자가 Inquiry Map에서 적어도 하나의 프레임·가설·증거 관계를 의미 있게 수정한다.
- Decision Gate가 승인 클릭이 아니라 기준·선택·후속 Commitment 중 하나를 바꾼다.
- Delegation Contract가 실제 방향 이탈 또는 완료 기준 혼동을 예방한다.
- 사용자의 총 부담이 증가하더라도 결과 품질과 주도성의 증가가 그 비용을 정당화한다.

## 7. Foundations 추적

| Prototype | 주요 Foundation |
|---|---|
| Return Brief | `A9`, `A11`, `A12`; ContextProjection; Situation Awareness |
| Inquiry Map | `A3`, `A4`, `A5`, `A14`; Epistemology |
| Delegation Contract | `A1`, `A6`, `A7`, `A8`; Praxeology & Governance |
| Decision Gate | `A6`, `A8`, `A13`, `A15`; Interaction Constitution |
