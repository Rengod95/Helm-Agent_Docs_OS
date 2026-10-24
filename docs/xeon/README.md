---
id: xeon.readme
layer: meta
domain: index
kind: guide
status: draft
depends_on: []
binds: []
---

# Xeon 문서

Xeon(임시 이름)은 대화형 에이전트 런타임이다. 층(F~L3)으로 나눈 런타임 전체를 배포하고, 사용자는 층마다 플러그인과 의도 그룹을 추가하거나 교체한다. Helm은 L3 의도 그룹으로 기본 제공된다.

이 디렉터리는 Xeon의 제품 기획, 층별 스펙과 구현 계획, 구속력 있는 엔지니어링 규칙을 담는다. 사람과 에이전트가 같은 구조로 읽고 쓴다.

## 층 지도

| 층 | 뜻 | 디렉터리 | 코드 |
|---|---|---|---|
| F | 계약: 타입, 스키마, 규약 | `F/` | `xeon/packages/contracts` |
| X | 확장 체계: on·post·drive·scope, 로딩, 신뢰 | `X/` | `xeon/packages/ext-host` |
| L0 | 플랫폼: OS별 구현이 바뀌는 부분 | `L0/` | `xeon/packages/platform-*` |
| L1 | 코어: 거의 바뀌지 않는 코어 플러그인 | `L1/` | `xeon/packages/core-*` |
| L2 | 능력: 서비스 API와 모델 도구 쌍 | `L2/` | `xeon/packages/cap-*` |
| L3 | 의도 그룹: Helm, 학습 그룹, 추가 그룹 | `L3/` | `xeon/packages/group-*` |
| L4 | 배포 런타임: CLI, 데스크톱, 서비스, 설정 화면 | `L4/` | `xeon/apps/*` |

층 순위(의존 방향)는 F → X → L0 → L1 → L2 → L3 → L4다. 자세한 규칙은 `engineering/dependency-rules/guide.md`에 있다.

## 디렉터리 규칙

`docs/xeon/<층>/<도메인>/<문서종류>.md`

| 문서종류 | 파일명 | 쓰임 |
|---|---|---|
| 층 개요 | `<층>/README.md` | 층의 목적, 하위 도메인 목록, 층 안팎 경계 |
| 스펙 | `spec.md` | 무엇을 만드는가: 인터페이스, 동작 규칙, 실패, 수용 기준 |
| 설계 | `design.md` | 왜 이렇게 만드는가: 대안 비교, 구조, 흐름 (필요할 때) |
| 구현 계획 | `plan.md` | 어떻게 만드는가: 작업 분해, 순서, 테스트 목록, 완료 기준 |
| 가이드 | `guide.md` | 지켜야 할 규칙 (engineering) |
| 결정 기록 | `decisions/ADR-NNNN-<slug>.md` | 되돌리기 어려운 선택과 근거 |

그 밖의 디렉터리:

- `product/`: 제품 기획(비전, 유즈케이스, 범위)
- `architecture/`: 전체 구조(층, 런타임 흐름)
- `engineering/`: 모든 구현 작업에 적용되는 구속 문서
- `decisions/`: ADR
- `review/`: 정합성 검증 결과
- `_routing/`: 작업별로 읽을 문서를 고르는 표
- `_templates/`: 문서 템플릿
- `_research/`: 조사 원자료(정본 아님, 인용용)

## 읽는 순서

1. 이 문서
2. `_routing/README.md`: 내 작업에 필요한 문서를 고르는 법
3. `engineering/` 전부: 구현 전에 항상 읽는다
4. 작업 대상 층의 `README.md`, 해당 도메인의 `spec.md`, `plan.md`

## 프런트매터

모든 문서는 YAML 프런트매터를 둔다. 형식은 `_templates/README.md`에 있다.
