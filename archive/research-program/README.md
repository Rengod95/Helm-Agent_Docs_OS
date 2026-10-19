# Helm Research Program

> Status: working research map v0.1

이 디렉터리는 타 학문과 산업의 방법론을 Helm 기능으로 바로 복사하지 않고, 원래 해결한 문제와 환경 독립적인 원리를 분석한 뒤 반증 가능한 제품 가설로 번역하기 위한 연구 체계를 정의한다.

## 1. 연구 질문

1. 복수 행위자가 제한된 정보와 시간 안에서 공동 목적을 유지하는 방법은 무엇인가?
2. 상위 목적을 보존하면서 세부 실행을 안전하게 위임하는 방법은 무엇인가?
3. 판단자가 모든 세부 상태를 보지 않고도 상황 인식을 유지하는 방법은 무엇인가?
4. 경쟁하는 설명과 불완전한 증거를 비교하는 방법은 무엇인가?
5. 중요한 단계 전환과 책임 인수인계에서 오류를 줄이는 방법은 무엇인가?
6. 자동화가 인간의 능력과 주도성을 약화시키지 않게 설계하는 방법은 무엇인가?
7. 지역적 성과를 전체 시스템의 정합성과 안전으로 통합하는 방법은 무엇인가?
8. 공동 작업이 통제와 승인만이 아니라 몰입·학습·저자성의 경험이 되게 하는 조건은 무엇인가?

## 2. 연구 축

- 철학: 실용주의, 실천적 지혜, 행위, 약속, 공동 의도
- 인지과학: 분산인지, 상황 인식, 공동 인지 시스템, 자연주의적 판단
- 조직·지휘: 임무형 지휘, 사건지휘체계, 보충성, 예외 관리
- 과학·정보분석: 가설 생성, 경쟁 가설, 반증, 불확실성
- 시스템 공학: trade study, 요구사항 추적, 기준선, 통합
- 안전공학: HRO, STPA, resilience engineering, assurance case
- 의료·항공: 체크리스트, CRM, handoff, closed-loop communication
- 인간–자동화: 자동화 수준, out-of-the-loop, coactive design
- 설계·개선: Double Diamond, PDSA, reflective practice
- 동기·경험: 자율성, 유능감, 관계성, sense of agency

## 3. 방법론 전이 절차

각 방법은 다음 순서로 분석한다.

```text
Original domain and failure
  → Environmental assumptions
  → Domain-invariant mechanism
  → What must not be copied
  → Helm primitive
  → Falsifiable hypothesis
  → Prototype and metric
```

예를 들어 군의 Mission Command에서 계급 구조와 군사 용어를 복사하지 않는다. 중앙의 의도·제약과 지역의 판단 자율성을 결합하는 원리를 추출하여 `Purpose`, `AuthorityEnvelope`, `EscalationTrigger`로 번역한다.

## 4. Method Card 형식

```yaml
method:
  name: string
  domain: string
  primary_sources: []
  original_problem: string
  environment_assumptions: []
  invariant_mechanisms: []
  known_failure_modes: []
  transfer_risks: []
  helm_primitives: []
  product_hypotheses: []
  prototype: string
  metrics: []
  evidence_status: exploratory | supported | rejected | superseded
  owner: actor-id
  reviewed_at: date
```

## 5. 근거 등급

- **A**: 원전, 표준, 공식 핸드북, 재현된 연구
- **B**: 동료평가 종합, 권위 있는 2차 자료, 다수 현장 사례
- **C**: 단일 사례, 실무 에세이, 유추를 위한 자료
- **D**: 아직 출처가 충분하지 않은 제품 직관

높은 등급은 Helm 전이에 자동으로 적합하다는 뜻이 아니다. 원래 환경과 Helm 환경의 차이를 별도로 평가한다.

## 6. 전이 평가 질문

1. 이 방법은 어떤 실패를 줄이기 위해 생겼는가?
2. 그 실패가 에이전틱 작업에서도 실제로 존재하는가?
3. 성공의 원인이 절차 자체인지, 전문가 문화와 훈련인지 구분했는가?
4. 안전 중요 환경의 무거운 절차를 저위험 소프트웨어 작업에 과잉 적용하지 않는가?
5. 인간 사이의 약속을 확률적 모델 출력에 그대로 투영하며 의인화하지 않는가?
6. 정보 압축이 중요한 반대 증거와 이견을 제거하지 않는가?
7. 사용자의 주의 비용을 포함해 전체 공동 시스템 성능을 측정하는가?
8. 어떤 관찰이 이 전이가 잘못되었음을 보여줄 것인가?

## 7. 현재 산출물

- [`method-transfer-map.md`](method-transfer-map.md) — 35개 방법론의 핵심 원리, Helm primitive, 전이 위험
- [`method-cards/README.md`](method-cards/README.md) — 20개 우선 방법론의 원래 환경·전이 규칙·실패 모드·제품 가설
- [`bundles/situation-recovery-and-deliberative-inquiry.md`](bundles/situation-recovery-and-deliberative-inquiry.md) — Situation Recovery와 Deliberative Inquiry의 통합 설계 결론
- [`bundles/delegated-action-and-integration.md`](bundles/delegated-action-and-integration.md) — Delegated Joint Action과 Acceptance & Integration의 통합 설계 결론
- [`commercial-desktop-agent-ux.md`](commercial-desktop-agent-ux.md) — Helm Foundations를 상용 desktop workflow agent의 제품 관점·정보 구조·핵심 UX로 번역한 조사
- [`../foundations/09-operating-theory.md`](../foundations/09-operating-theory.md) — 네 Bundle을 하나로 묶은 Helm 운영 이론
- [`../foundations/08-falsifiable-hypotheses.md`](../foundations/08-falsifiable-hypotheses.md) — 제품 가설과 실험
- [`../prototypes/paper-v0/experiment-protocol.md`](../prototypes/paper-v0/experiment-protocol.md) — 핵심 상호작용의 비교 실험 절차

후속 연구에서는 전이 지도의 고우선순위 항목을 개별 Method Card로 분리하고, 원전 독해·전문가 인터뷰·프로토타입 결과를 축적한다.
