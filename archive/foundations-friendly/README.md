# 쉬운 Helm Foundations

> Status: product-language foundation v0.1  
> Role: Helm의 사용자 경험, 제품 도메인, UX writing, onboarding이 따라야 하는 기본 언어  
> Source: [`../foundations/README.md`](../foundations/README.md)의 원칙을 의미 손실 없이 쉬운 말로 투영

## 이 문서가 필요한 이유

기존 Helm Foundations는 제품의 책임 구조와 불변조건을 정확히 설명한다. 하지만 `Normative`, `Epistemic`, `Commitment`, `Authority Envelope` 같은 표현을 사용자가 매일 읽고 조작하기에는 어렵다.

이 디렉터리는 같은 원칙을 다음 기준으로 다시 쓴다.

- 처음 보는 사람도 한 번에 이해할 수 있는가?
- 화면의 제목과 버튼으로 바로 사용할 수 있는가?
- 사용자가 자신의 목표·판단·권한을 스스로 바꿀 수 있게 하는가?
- 기술 용어를 몰라도 서로 다른 상태를 혼동하지 않게 하는가?
- 제품·디자인·개발·지원팀이 같은 단어를 사용할 수 있는가?

## 두 Foundations의 역할

| 구분 | 어려운 원론 Foundations | 쉬운 Product Foundations |
|---|---|---|
| 주 독자 | 연구자, 시스템 설계자, core 개발자 | 사용자, product, design, application 개발자, support |
| 책임 | 의미·책임·상태 전이의 정확성 | 제품 언어·화면 구조·상호작용의 이해 가능성 |
| 대표 표현 | Purpose, Concern, Claim, Commitment | 목표, 초점, 판단, 약속 |
| 사용 위치 | 내부 불변조건, 연구, formal model | UI label, public API, onboarding, 도움말, 알림 |

충돌할 때 다음 규칙을 따른다.

1. **의미와 안전 규칙**은 원론 Foundations가 우선한다.
2. **사용자에게 보이는 이름과 설명**은 쉬운 Product Foundations가 우선한다.
3. 쉬운 표현으로 중요한 구분을 보존할 수 없으면 새 표현을 찾는다. 어려운 용어를 그대로 노출하는 것은 마지막 수단이다.
4. 내부 저장 schema는 즉시 이름을 바꾸지 않아도 되지만, 새 public domain과 UI는 [`06-technical-crosswalk.md`](06-technical-crosswalk.md)의 제품 용어를 기준으로 한다.

## 읽는 순서

1. [`00-helm-in-plain-language.md`](00-helm-in-plain-language.md) — Helm이 무엇이고 왜 필요한가
2. [`01-shared-language.md`](01-shared-language.md) — 제품과 UI에서 사용할 공통 용어
3. [`02-how-work-flows.md`](02-how-work-flows.md) — 목표에서 전체 반영까지의 사용자 흐름
4. [`03-working-with-agents.md`](03-working-with-agents.md) — 인간과 agent가 함께 일하는 방식
5. [`04-trust-control-and-completion.md`](04-trust-control-and-completion.md) — 권한, 근거, 결과 확인, 복구
6. [`05-ux-writing-guide.md`](05-ux-writing-guide.md) — 화면 제목, 상태, 버튼, 알림의 작성 기준
7. [`06-technical-crosswalk.md`](06-technical-crosswalk.md) — 원론 용어와 product/domain/UI 용어의 대응
8. [`07-example-lifecycle.md`](07-example-lifecycle.md) — 하나의 실제 예시로 보는 전체 lifecycle

구현과 copy test에서 사용할 기계 판독 기준은 [`product-language.yaml`](product-language.yaml)에 있다.

## 제품이 지켜야 할 일곱 약속

Helm 사용자는 언제든 다음을 이해하고 바꿀 수 있어야 한다.

1. **목표:** 우리가 이루려는 것은 무엇인가?
2. **현재 상황:** 돌아온 뒤 무엇이 달라졌고 왜 중요한가?
3. **가능성:** 어떤 설명과 해법을 검토하고 있으며 근거는 무엇인가?
4. **맡긴 일:** 누가 무엇을 어디까지 하고 있는가?
5. **다음 흐름:** 그대로 두면 다음에 무엇이 일어나는가?
6. **내 선택:** 지금 내가 정해야 하는 것은 무엇이며 다른 선택은 무엇인가?
7. **결과:** 무엇을 확인했고 전체에 어떻게 반영했는가?

## 한 문장

> Helm은 agent를 더 많이 돌리는 앱이 아니라, 사람이 방향을 잃지 않고 중요한 선택에 집중하면서 agent와 함께 믿을 만한 결과를 만드는 작업 공간이다.
