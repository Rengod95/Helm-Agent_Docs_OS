# Method Card: Requisite Variety

- Domain: cybernetics, control theory, organizational regulation
- Evidence status: foundational theory; Helm operationalization exploratory
- Primary Helm bundle: Situation Recovery
- Candidate primitives: `AttentionEngine`, `Projection`, `ExceptionGate`, `AutonomyPolicy`

## 1. Original problem

조절 대상 시스템이 만들어낼 수 있는 상태의 다양성이 조절자가 구분하고 대응할 수 있는 다양성보다 크면 안정적인 통제가 어렵다. W. Ross Ashby의 cybernetics는 조절자가 관련 다양성을 흡수할 충분한 대응 범위를 가져야 한다는 관점을 제시한다.

복수 에이전트 시스템에서는 실행 속도, 병렬 WorkUnit, 가설, 오류, 변경 경로가 늘어나며 인간 사용자가 직접 구분해야 할 상태가 폭발한다.

## 2. Environmental assumptions

- 환경과 시스템은 여러 가능한 상태를 생성한다.
- 조절자는 모든 상태에 개별적으로 반응할 수 없다.
- 어떤 차이는 결과에 중요하고 어떤 차이는 무시할 수 있다.
- 규제는 다양성의 감쇠, 증폭, 분산을 조합한다.
- 잘못된 압축은 중요한 상태 차이를 제거한다.

## 3. Domain-invariant mechanisms

### Attenuation

중복, 정상 범위, 저위험 변화처럼 인간 판단이 필요 없는 다양성을 압축한다.

### Amplification

충돌, 비가역성, 새 실패 모드, 반대 증거처럼 작은 신호라도 중요한 차이를 확대한다.

### Distribution

모든 대응을 중앙 인간에게 모으지 않고 정책과 지역 Actor에 권한을 배분한다.

### Model enrichment

조절자가 더 나은 범주, 표현, 시뮬레이션을 통해 복잡한 상태를 다룰 수 있게 한다.

## 4. Helm problem explained

사용자의 인지 능력이 에이전트 실행 능력보다 낮다는 페인포인트는 개인 결함이 아니다. 시스템이 생성하는 상태 다양성과 감독 인터페이스가 제공하는 규제 다양성 사이의 구조적 불일치다.

단순 요약은 다양성을 감쇠하지만 다음을 함께 제거할 수 있다.

- 에이전트 간 중요한 이견
- 아직 작은 실패 전조
- 서로 다른 Assumption
- 비가역적 파급 효과

따라서 Helm은 압축기보다 **variety transformer**여야 한다.

## 5. Transfer to Helm

| Cybernetic operation | Helm mechanism |
|---|---|
| Attenuate | deduplicate events, batch routine updates, policy auto-approval |
| Amplify | conflict, dissent, weak signal, irreversible consequence Gates |
| Distribute | Authority Envelope, local decision, specialist routing |
| Enrich | Inquiry Map, simulation, alternative comparison |
| Feedback | Outcome, validation, Reflection, policy update |

## 6. Transfer rules

1. 축약률이 아니라 결정 관련 차이의 보존률을 측정한다.
2. normal/exception 기준은 Purpose와 위험에 따라 달라져야 한다.
3. 중요한 다양성을 사용자에게 보여주는 것과 에이전트 전문 역할에 재분배하는 것을 구분한다.
4. 자동화 정책의 false negative를 false positive와 함께 측정한다.
5. Workstream span과 Gate queue를 인간 attention capacity에 맞게 조절한다.
6. 사용자 개입이 시스템의 미래 대응 범위를 실제로 확장하는지 확인한다.

## 7. What must not be copied

- 인간 판단을 채널 용량 숫자로 환원하기
- 모든 차이를 노이즈 또는 정보량으로 동일 취급하기
- 압축이 많을수록 좋은 시스템이라고 보기
- cybernetic control을 인간에 대한 행동 통제로 확장하기

## 8. Failure modes

- **Over-attenuation**: 반대 증거와 소수 의견이 사라짐
- **Under-attenuation**: 사용자가 모든 Event를 직접 관리
- **False amplification**: 중요하지 않은 anomaly가 반복 Gate를 생성
- **Central bottleneck**: 자율성이 있어도 모든 결정이 인간에게 상향
- **Policy blindness**: 오래된 정상 범위가 새로운 실패를 숨김

## 9. Falsifiable Helm hypotheses

### RV-H1

결정 관련 차이를 보존하는 Brief는 단순 길이 기반 요약보다 missed consequential change를 줄일 것이다.

### RV-H2

위험 적응적 자동 승인과 예외 상향은 고정 승인 정책보다 같은 attention budget에서 더 높은 결과 품질을 만들 것이다.

### RV-H3

WorkUnit을 Purpose/Assumption conflict에 따라 그룹화하면 run 단위 감독보다 사용자 통제 범위가 증가할 것이다.

## 10. Prototype

- 동일 Event set에서 세 projection을 만든다: 원본 전체, 빈도 기반 요약, consequence-aware Brief.
- 사용자에게 중요한 Decision과 weak signal을 식별하게 한다.
- 낮은 위험 Event를 자동 처리하고 어떤 exception만 상향할지 정책을 비교한다.

## 11. Metrics

- compression ratio
- consequential-change recall
- false amplification / escalation
- missed exception
- active Gate count
- human attention minutes
- outcome quality under fixed attention budget

## 12. Sources

- [Ashby, An Introduction to Cybernetics](https://ashby.info/Ashby-Introduction-to-Cybernetics.pdf)

## 13. Open questions

- decision-relevant variety를 누가 정의하며 학습된 정책의 편향을 어떻게 감시할 것인가?
- 사용자의 attention capacity를 침해적인 측정 없이 어떻게 추정할 것인가?
- 새로운 종류의 실패를 기존 exception taxonomy가 억압하지 않게 하려면 무엇이 필요한가?

