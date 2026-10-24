# Co-agency: 인간과 에이전트가 함께 일한다는 것

## 1. 분석 단위

Helm은 인간과 에이전트 중 어느 한쪽을 독립적으로 최적화하지 않는다. 분석 단위는 다음으로 구성된 **Joint Cognitive System**이다.

```text
Human actors
+ Agent actors
+ Tools and interfaces
+ Shared representations
+ Organizational rules
+ Material environment
```

분산인지 연구는 작업 성과를 개인의 정보 처리 능력만으로 설명할 수 없으며, 사람과 인공물 사이에서 표현이 어떻게 이동하고 변환되는지를 봐야 한다고 제안한다. [Hutchins, How a Cockpit Remembers Its Speeds](https://doi.org/10.1207/s15516709cog1903_1)

그러므로 “에이전트 정확도”가 높아져도 인간이 상태를 이해하지 못하거나 방향을 바꿀 수 없다면 공동 시스템은 개선되지 않은 것이다.

## 2. 공동행위의 조건

공동 목적만으로 공동행위가 성립하지 않는다. 공유 행위에 관한 철학은 참여자들이 서로의 의도와 행동에 반응하고, 각자의 하위 계획을 맞물리게 하며, 그 사실을 공동으로 인식해야 한다고 본다. [Stanford Encyclopedia of Philosophy: Collective Intentionality](https://plato.stanford.edu/entries/collective-intentionality/)

Helm의 공동행위는 다음을 요구한다.

- Shared Purpose: 공동 목적과 성공 기준
- Meshing Plans: 충돌하지 않도록 맞물린 하위 계획
- Mutual Responsiveness: 상황 변화에 서로 반응할 수 있음
- Common Ground: 현재 사실·의도·역할에 대한 충분한 공통 기반
- Repair Capability: 오해와 실패를 탐지하고 복구할 수 있음
- Explicit Commitments: 누가 무엇을 맡았는지 추적 가능함

## 3. 상호의존성이 자율성을 형성한다

Coactive Design은 사람과 기계의 독립성을 최대화하기보다 공동 작업에서의 상호의존성을 먼저 분석해야 한다고 주장한다. 핵심 설계 기준은 다음 세 가지다. [TU Delft: Coactive Design](https://repository.tudelft.nl/record/uuid%3A35cfe91a-bd59-427d-89a9-e2019f9b0c28)

### Observability

각 참여자가 자신의 다음 행동에 필요한 상대의 상태·의도·변화를 볼 수 있는가?

### Predictability

상대의 다음 행동과 그 조건을 충분히 예상할 수 있는가?

### Directability

상황이 바뀌었을 때 상대의 방향, 우선순위, 권한을 낮은 비용으로 수정할 수 있는가?

Helm은 여기에 다음을 추가한다.

### Contestability

상대의 문제 프레임, 주장, 권고, 결정에 이의를 제기하고 근거를 검토하거나 다시 열 수 있는가?

설명 가능성은 과거 행동의 이유를 보여준다. Contestability는 그 이유와 전제를 바꿀 실질적 권한을 제공한다.

## 4. 인간 경험: labor, work, action

Hannah Arendt의 구분을 제품 설계 언어로 차용한다. [Stanford Encyclopedia of Philosophy: Hannah Arendt](https://plato.stanford.edu/entries/arendt/)

- **Labor**: 반복되고 소비되는 활동. 에이전트 자동화가 우선된다.
- **Work**: 지속되는 산출물을 만드는 활동. 인간과 에이전트가 공동으로 형성한다.
- **Action**: 다른 주체들과 방향·관계·약속을 만드는 활동. 인간 참여가 중심이 된다.

Helm은 인간에게 단순 반복을 남겨 “일하는 느낌”을 만들지 않는다. 인간이 문제를 다시 보고, 기준을 세우고, 대안을 비교하고, 중요한 형상을 직접 바꾸는 경험을 제공한다.

## 5. 좋은 참여 경험

즐거운 상호작용은 알림의 수나 게임화로 만들지 않는다. Self-Determination Theory가 강조하는 자율성, 유능감, 관계성의 관점에서 다음 경험을 설계한다. [Self-Determination Theory](https://selfdeterminationtheory.org/about-the-theory/)

### Autonomy

- 사용자가 문제 프레임과 기준을 바꿀 수 있다.
- 시스템 권고를 거부하거나 추가 실험을 요청할 수 있다.
- 개입의 타이밍과 깊이를 조절할 수 있다.

### Competence

- 복잡한 상황이 이해 가능한 구조로 나타난다.
- 사용자의 판단이 결과를 어떻게 바꿨는지 피드백된다.
- 회고를 통해 사용자의 도메인 지식과 위임 규칙이 축적된다.

### Relatedness

- 에이전트는 무명 프로세스가 아니라 역할·능력·약속이 있는 협력자로 표현된다.
- 인간과 에이전트가 공통 목적과 상황도를 공유한다.
- 이견과 실패를 비난이 아니라 조정 대상으로 다룬다.

## 6. 참여의 리듬

Helm의 기본 리듬은 지속적인 방해가 아니라 **집중된 공동 작업과 자율 구간의 교대**다.

```text
Briefing
  → Framing/Delegation
  → Autonomous interval
  → Scheduled or exception checkpoint
  → Evidence review and decision
  → Autonomous interval
  → Integration review
  → Debrief and learning
```

사용자는 모든 구현 단계를 감시하지 않는다. 다음과 같은 고레버리지 지점에 참여한다.

- 문제와 목적이 합의되지 않았을 때
- 서로 다른 가설이 결과 방향을 크게 바꿀 때
- 평가 기준이 기술적으로 환원되지 않을 때
- 큰 비용이나 비가역적 효과가 예상될 때
- 에이전트 간 이견이 중요한 정보를 포함할 때
- 결과를 전체 시스템에 받아들일지 판단할 때

## 7. 자동화 역설 방지

Bainbridge의 자동화 역설은 자동화가 정상 작업을 제거하면서 인간에게 가장 어렵고 비정상적인 예외만 남길 수 있음을 지적한다. [Ironies of Automation](https://www.sciencedirect.com/science/article/pii/0005109883900468)

Endsley와 Kiris의 연구는 자동화 속에서 수동적 감시자로 밀려난 사용자가 상황 인식과 실패 시 복구 능력을 잃을 수 있음을 보여준다. [The Out-of-the-Loop Performance Problem](https://doi.org/10.1518/001872095779064555)

Helm은 이를 방지하기 위해 다음을 MUST로 둔다.

1. 자율 작업 중에도 사용자가 현재 의도와 예상 경로를 볼 수 있어야 한다.
2. 복귀 시 상태 나열뿐 아니라 의미와 향후 예측을 제공해야 한다.
3. 중요한 방향 선택에 사용자를 참여시켜 능동적 상황 모델을 유지해야 한다.
4. 실패 시 처음부터 로그를 재구성하지 않고 결정·증거·약속의 경로를 따라 복구할 수 있어야 한다.
5. 자동화는 쉬운 시점에서만 편하고 어려운 시점에 추가 인지 부담을 만드는 clumsy automation이 되어서는 안 된다.

## 8. 공동행위 안티패턴

### Silent autonomy

무엇을 왜 하고 있는지 드러내지 않은 채 실행한다.

### Approval theater

사용자에게 실질적 선택이 없는 승인 버튼을 반복 제공한다.

### Summary collapse

충돌과 불확실성을 하나의 매끄러운 진행 요약으로 제거한다.

### Agent anthropomorphism

에이전트의 운영적 상태를 인간의 책임·감정·도덕성처럼 표현한다.

### Human as exception handler

평상시 이해 기회를 제거하고 가장 어려운 실패 순간에만 인간을 호출한다.

### Independence maximization

상호의존성 지원 없이 에이전트가 인간 도움 없이 할 수 있는 범위만 늘린다.

### Context flooding

중요한 차이를 선별하지 않고 모든 로그와 문서를 보여준다.

## 9. Co-agency 불변조건

1. 모든 공동 작업은 공유 Purpose와 역할을 가져야 한다.
2. 각 Actor는 자신의 다음 행동에 필요한 상대의 상태를 관측할 수 있어야 한다.
3. 자율 실행은 예상 경로와 예외 조건을 노출해야 한다.
4. 방향 수정 비용은 작업 진행과 함께 비선형적으로 증가하지 않아야 한다.
5. 사용자는 에이전트의 프레임과 주장을 반박할 수 있어야 한다.
6. 인간 참여는 사소한 승인보다 목적·프레임·대안·수락에 집중해야 한다.
7. 시스템 성능은 인간과 에이전트를 포함한 공동 시스템 수준에서 평가해야 한다.

