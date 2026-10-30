---
id: L4.desktop-ux.plan
layer: L4
domain: desktop-ux
kind: plan
status: draft
depends_on: [L4.desktop-ux.spec, L4.desktop.plan, L4.settings-ui.plan]
binds: [xeon/apps/desktop/src/views/**]
---

# L4 데스크톱 UX 구현 계획 (desktop-ux)

`L4.desktop-ux.spec`의 화면을 M4에서 만드는 순서입니다. 화면의 항목, 상태, 부품은 spec이 정하고, 이 문서는 순서와 완료 기준만 정합니다.

## 1. 목표와 마일스톤 배치

- M0~M3b: 해당 작업 없음. 화면 코드는 M4입니다 [결정: 2026-10-28 사용자 지시]. M3b까지는 view-model, wire, 상태 논리만 만듭니다(`review.m3b-plan` §1.2).
- M4: spec §5의 P0 화면 전부와 P1 화면 전부. P2 화면은 wire 간극(spec §10.1)이 풀린 만큼 만듭니다 [제안].

## 2. 패키지와 파일 배치

- 화면: `xeon/apps/desktop/src/views/`. 셸 부품은 `views/shell/`, 화면은 `views/pages/<id>-<이름>/` [제안].
- 화면이 쓰는 순수 view-model: `xeon/packages/client/src/<영역>/`(adr.0020). spec §10.2의 새 view-model이 여기에 갑니다.
- 셸 목업: `xeon/apps/desktop/mockups/p02-<모델>/`(spec §8.2). 고른 뒤에는 목업을 지우고 셸 부품만 `views/shell/`로 옮깁니다.
- 디자인 시스템: `xeon/external/caustic`(submodule), `@caustic/react`, `@caustic/tokens`.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| UX-0 | 셸 목업 세 개(같은 브리프, 세 모델 병렬) | spec §8.2 | S×3 |
| UX-1 | 사용자가 모델을 고름. 고른 목업의 셸을 `views/shell/`로 옮김 | UX-0 | S |
| UX-2 | 셸(S-01~S-04), 바로 가기 키 표, 데스크톱 로컬 설정 저장소(V-14, V-15) | UX-1 | M |
| UX-3 | P-02 대화와 승인 카드 네 종류, O-01·O-02·O-04·O-07 | UX-2 | L |
| UX-4 | P-03 받은 요청(V-02, V-03), S-02 명령 팔레트(V-01) | UX-3 | M |
| UX-5 | P-01 첫 실행, P-09 설정 일반 폼(V-09), P-10 비밀(V-10, O-05, O-06) | UX-2 | L |
| UX-6 | P-11, P-12, P-13 설정 전용 화면 | UX-5 | M |
| UX-7 | P-06 제안, P-07 예약(V-04, O-08), P-08 연결(V-05) | UX-2 | L |
| UX-8 | P-04 변경 검토(V-06), P-05 탐구(V-07) | UX-3, W-02, W-04 | M |
| UX-9 | P-14 목표와 작업, P-15 진단, O-03, O-09 | UX-3 | M |
| UX-10 | 접근성 점검과 수정(axe, 키보드 경로), 다크 테마 점검 | UX-3~UX-9 | M |

- UX-3과 UX-5, UX-7은 UX-2 뒤 병렬로 갑니다.
- 각 작업의 끝 시험은 화면별 상태 여섯 가지(spec §6.0)를 고정 데이터로 그리는 시험입니다.

## 4. 채택 코드

- caustic 부품을 그대로 씁니다. caustic에 없는 부품(spec §9)은 앱 안에서 caustic 토큰만으로 만들고, 쓰임이 굳으면 caustic 저장소에 제안합니다.
- 지금 `views/`의 M2 화면(`thread-list.tsx`, `transcript.tsx`, `approvals.tsx`, `settings.tsx` 등)은 UX-3·UX-5에서 caustic 부품으로 바꿉니다. 판단 함수(`approval-form.ts`, `composer-model.ts`, `trust-model.ts`, `workspace-model.ts`)는 그대로 씁니다.

## 5. 단위 테스트 목록

| 시험 | 확인할 동작 |
|---|---|
| `shell.layout-steps-at-breakpoints` | 1100px 이하에서 끝 영역이 시트, 720px 이하에서 시작 영역이 시트 |
| `keybindings.default-map-covers-actions` | spec §4.8의 동작 id마다 기본 키가 있고 겹치지 않음 |
| `approval-card.same-in-three-places` | 같은 승인 id의 카드가 트랜스크립트, 끝 영역, P-03에서 같은 부품이고 `approval.resolved`로 함께 사라짐 |
| `inbox.counts-sum` | 받은 요청 수 = 대기 승인 + 대기 제안 + 읽지 않은 알림 |
| `settings.fields-equal-schema-keys` | P-09 필드 키 집합이 스키마 화면 키 집합과 같음(X10) |
| `secrets.value-never-in-state` | 값 보기 뒤 React 상태와 거울에 값이 없고 30초 뒤 가려짐 |
| `web-order.keyboard-move-saves` | 키보드 이동 뒤 `settings.set`이 새 순서로 불림 |
| `pages.six-states-render` | 화면마다 빈, 읽는 중, 오류, 오프라인, 권한 필요, 긴 내용 상태가 그려짐 |

## 6. 완료 기준

- spec §11.2 수용 기준을 모두 만족합니다.
- `just verify`가 통과합니다. 화면 시험은 DOM 없는 view-model 시험과 데스크톱 화면 점검(원격 점검 Phase 2, `review.m3b-plan` §1.2)으로 나눕니다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| wire 간극(spec §10.1) 때문에 P-04, P-05, P-14가 반쪽이 됨 | P1·P2 화면은 명령 결과와 이벤트로 시작하고 간극을 [미결]로 올림 |
| 비밀 값 보기가 데스크톱에서 안 됨(W-10) | X8 화면 부분을 W-10 결정 뒤로 미루고 CLI 안내를 보임 |
| caustic 간극 부품이 앱마다 다르게 만들어짐 | UX-2에서 셸 부품(상태 표시줄, 팔레트)을 먼저 만들고 다른 화면은 그것을 씀 |
| 목업 세 개의 셸이 서로 달라 비교가 어려움 | 같은 브리프, 같은 고정 데이터, 같은 완료 기준(spec §8.2) |
