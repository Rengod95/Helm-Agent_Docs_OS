---
id: review.unresolved
layer: meta
domain: review
kind: review
status: draft
depends_on: [review.m2-plan, review.m3-plan, adr.readme]
binds: []
---

# 미결 추적표

## 1. 목적과 규칙

- 문서 곳곳의 `[미결]`을 마일스톤과 소유자 기준으로 추적합니다. 마일스톤 재점검 G3-03의 산출물입니다.
- 규칙은 네 가지입니다.
  1. `[미결]`의 정본은 그 문서의 "미결 사항" 절입니다. 이 표는 위치와 소유자만 적습니다.
  2. 수는 `just docs-route --unresolved`로 셉니다. 문서마다 `[미결` 표지 수를 출력하고 마지막 줄에 합계를 적습니다. `_research/`는 세지 않습니다.
  3. 사용자 결정으로 닫으면 그 자리를 `[결정: <근거>]`로 바꾸고, 이 표의 행을 "닫힘"으로 고칩니다.
  4. 되돌리기 어려운 결정은 ADR로 올립니다(`adr.readme` §4 승격 기준). 승격 상태는 §4 표에 적습니다.

## 2. 현재 수 (2026-10-25)

`just docs-route --unresolved` 결과입니다. 합계는 109개 문서에 989개입니다. 재점검 보고서가 적은 "F·X·L0 spec 169회"는 spec만 센 값이고, 아래 표는 plan, README, guide를 포함합니다.

| 묶음 | 수 | 많은 문서 |
|---|---|---|
| product | 15 | `usecases/spec.md` 8 |
| architecture | 26 | `runtime-flow/design.md` 13 |
| engineering | 93 | `typescript/guide.md` 27, `domain-types/guide.md` 17 |
| decisions | 79 | `README.md` 14, `ADR-0005` 11 |
| F | 57 | `extensions/spec.md` 12, `records/spec.md` 10 |
| X | 64 | `primitives/spec.md` 22, `loading-trust/spec.md` 15 |
| L0 | 99 | `secrets/spec.md` 18, `sandbox/spec.md` 13, `store/spec.md` 13 |
| L1 | 130 | `persistence/spec.md` 24, `agents/spec.md` 18, `tools/spec.md` 18 |
| L2 | 187 | `knowledge/spec.md` 27, `README.md` 25, `schedule/spec.md` 21 |
| L3 | 93 | `helm/spec.md` 33 |
| L4 | 124 | `host-service/spec.md` 25, `cli/spec.md` 23 |
| review | 20 | `consistency-1.md` 15 |

- 수에는 "[미결]을 승계한다" 같은 설명 문장 속 표지도 들어갑니다. 수는 추세를 보는 값이고 항목 수와 같지 않습니다.

## 3. M2 마감과 이어지는 미결

M2 마감 작업(`review.m2-plan` §9~§11)이 닫거나 소유자를 정한 항목입니다.

| 위치 | 내용 | 상태 | 소유자 |
|---|---|---|---|
| `L2.web.spec` §10 미결 5 | SearXNG 자동 감지 대상과 탐침 형식 | H1로 결정됨. 문서 갱신 필요 | T5(L2.web) |
| `L2.web.spec` §10 미결 4, ADR-0005 §6 | 키 플러그인과 SearXNG 순서 | 열림. 둘 다 사용자 설정이 되어 영향이 줄었음 | 사용자 |
| `L4.readme` §8 미결 2 | 단일 `xeon` 대 `apps/host` 단독 사이드카 | ADR-0014로 결정됨. 문서 갱신 필요 | T6·T7(L4) |
| `L2.mcp.spec` §10 미결 4 | MCP 정의 평문 env·headers 허용 | 열림. M2는 거부 유지(ADR-0011 §3.4) | M3(`review.m3-plan` M3-33) |
| `L2.mcp.spec` §10 미결 5 | stdio 서버 샌드박스 범위 | M3로 옮김(ADR-0011 §3.7) | M3(M3-14) |
| `L0.sandbox.spec` §10 2번 | 격리 없는 실행의 감사 이벤트 소유자 | M3로 옮김 | M3(M3-14) |
| `product.scope.spec` §10 미결 2 | 제품 이름 | 열림 | 사용자 |
| `product.scope.spec` §10 미결 4 | Helm 내부 설계 착수 시점 | M3 시작 전으로 옮김(D-a) | 사용자 |
| `adr.readme` §6 | on 핸들러 효과 목록 ADR(G1-06) | M3로 옮김(D-a) | 사용자, M3(M3-03) |
| `adr.readme` §6 | ADR 승격 후보(SOPS 기본값, 승인 프로토콜 통합) | 열림 | 사용자 |
| `architecture.security.spec` §10 | 프로젝트 신뢰 재판정 조건, 키 플러그인 고지 | 열림 | X, L2.web |
| `eng.performance.guide` §5 | 속도 예산 수치 | 기준선 측정 뒤 결정 | 사용자 |

## 4. ADR 승격 상태

| 결정 | 이전 위치 | ADR | 상태 |
|---|---|---|---|
| D6 MCP stdio 비샌드박스 | `review.m2-plan` §8 | ADR-0011 | 승격(2026-10-25) |
| 속도 우선 | `L4.desktop.plan` §3 spike S2 | ADR-0012 | 승격(2026-10-25) |
| D7 `post.when = next`, `aside` | `review.m2-plan` §8, `L1.tasks.spec` §4.9 | ADR-0013 | 승격(2026-10-25) |
| 단일 `xeon` 바이너리 | ADR-0001 §4.1, `L4.readme` §3 | ADR-0014 | 승격(2026-10-25) |
| H1 웹 검색 기본값 | 사용자 지시 2026-10-25 | ADR-0005 개정 | 반영(2026-10-25) |
| SOPS 비밀 기본값 | `adr.readme` §4 | 없음 | 후보. 사용자 확인 대기 |
| 승인 프로토콜 통합 | `adr.readme` §4 | 없음 | 후보. 사용자 확인 대기 |
| on 핸들러 효과 목록 | 재점검 G1-06 | 없음 | M3 Helm 착수 전 |

## 5. 미결 사항

- [미결] 표지 수를 CI에서 추세로 기록할지. 지금은 수동 실행입니다.
