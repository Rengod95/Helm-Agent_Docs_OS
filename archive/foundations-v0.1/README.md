# Helm Foundations

> Status: working draft v0.1  
> Role: Helm의 제품·데이터·상호작용·기술 아키텍처가 따라야 하는 상위 원론

Helm은 여러 에이전트의 작업을 표시하는 대시보드가 아니다. Helm은 인간이 목적과 판단의 저자성을 유지하면서 에이전트와 함께 문제를 정의하고, 가설을 검증하고, 결정을 약속으로 만들고, 산출물을 전체 시스템에 통합하는 **지향적 공동행위 시스템(steered co-agency system)** 이다.

> 사용자·제품·UX writing을 위한 쉬운 언어 버전은 [`../foundations-friendly/README.md`](../foundations-friendly/README.md)를 따른다. 이 디렉터리는 의미와 불변조건의 원본이고, 쉬운 버전은 사용자에게 보이는 언어와 application domain의 기본 projection이다.

이 디렉터리는 제품 기능을 설명하기 전에 다음 질문에 답한다.

1. Helm에서 일과 진척은 무엇인가?
2. 인간, 에이전트, 도구는 각각 어떤 종류의 행위자인가?
3. 사실, 추론, 가설, 결정, 약속은 어떻게 구분되는가?
4. 무엇을 위임할 수 있고 언제 인간에게 되돌아와야 하는가?
5. 적극적인 사용자 개입이 방해가 아니라 품질과 즐거움의 원천이 되려면 무엇이 필요한가?
6. 이 전제들이 상태 모델, UX, 저장 구조, 에이전트 어댑터로 어떻게 이어지는가?

## 기존 아키텍처 문서와의 관계

[`docs/architecture/fundamentals.md`](../architecture/fundamentals.md)는 Markdown/YAML 스캐폴드, 라우팅, 파일 소유권을 정의하는 **Docs-Agent OS v0의 구현 원론**이다. 이 디렉터리는 그 문서를 폐기하거나 즉시 대체하지 않는다.

- Foundations는 Helm이 다루는 현실의 의미와 불변조건을 정의한다.
- Architecture Fundamentals는 그 의미를 현재 파일 구조에 직렬화한 구현을 설명한다.
- 두 문서가 충돌할 경우 현재 동작은 Architecture Fundamentals가 설명하지만, 차세대 설계 방향은 Foundations를 따른다.
- 기존 구조의 변경은 실험을 통해 Foundations의 가설이 지지된 이후 ADR로 수락한다.

즉, `docs/`, YAML, Markdown, 데이터베이스는 Helm의 존재론이 아니다. 이들은 Helm의 의미 모델을 저장하고 투영하는 교체 가능한 표현 방식이다.

## 문서 순서

1. [`00-manifesto.md`](00-manifesto.md) — 제품의 목적, 공리, 비목표
2. [`01-ontology.md`](01-ontology.md) — 존재하는 객체와 세 세계 모델
3. [`02-epistemology.md`](02-epistemology.md) — 지식, 증거, 불확실성, 수락
4. [`03-praxeology-and-governance.md`](03-praxeology-and-governance.md) — 행위, 위임, 권한, 책임
5. [`04-co-agency.md`](04-co-agency.md) — 인간–에이전트 공동행위와 경험
6. [`05-formal-state-model.md`](05-formal-state-model.md) — 상태, 사건, 전이, 형식 불변조건
7. [`06-interaction-constitution.md`](06-interaction-constitution.md) — 사용자 개입과 인터페이스의 헌법
8. [`07-architecture-invariants.md`](07-architecture-invariants.md) — 제품·기술 아키텍처의 불변조건
9. [`08-falsifiable-hypotheses.md`](08-falsifiable-hypotheses.md) — 반증 가능한 제품 가설과 실험
10. [`09-operating-theory.md`](09-operating-theory.md) — 네 운영 루프와 전체 제품·기술 아키텍처의 통합 이론

다음 버전 논의를 위한 [`10-refinement-candidate.md`](10-refinement-candidate.md)는 현재 실행 증거에서 드러난 모순과 v0.2 정제안을 모은 **비규범적 후보 문서**다. 제품 소유자의 Decision Gate 수락과 cross-runtime 검증 전에는 00–09의 정본 지위를 대체하지 않는다.

연구 근거와 타 분야 전이 분석은 [`../research/README.md`](../research/README.md)에서 관리한다.

Foundations를 실제 작업에 적용하는 첫 검증 아티팩트는 [`../prototypes/paper-v0/README.md`](../prototypes/paper-v0/README.md)에서 관리한다. 이 prototype은 원론을 안정 schema로 구현하기 전에 Return Brief, Inquiry Map, Delegation Contract, Decision Gate의 사용자 가치를 검증한다.

첫 paper/sidecar 검증 이후의 실행 가능한 vertical slice는 [`../architecture/helm-system-v0.md`](../architecture/helm-system-v0.md)에 기록한다. headless core, CLI, HTTP/SSE server, Web GUI가 같은 Event ledger와 projection을 사용하지만 contract는 아직 experimental이다.

## 규범 키워드

이 문서에서 다음 용어는 설계 강도를 나타낸다.

- **MUST**: 위반하면 Helm의 원론적 정체성이 깨지는 불변조건
- **SHOULD**: 특별한 근거가 없다면 따라야 하는 기본 원칙
- **MAY**: 환경에 따라 선택할 수 있는 구현 전략

## 핵심 문장

> Helm은 더 많은 일을 인간 대신 처리하는 시스템이 아니라, 인간의 제한된 주의력을 가장 중요한 판단에 배치하여 인간과 에이전트가 함께 더 정당하고 일관된 변화를 만드는 시스템이다.
