---
id: L4.desktop-ux.plan
layer: L4
domain: desktop-ux
kind: plan
status: draft
depends_on: [L4.desktop-ux.spec, L4.desktop.plan, L4.settings-ui.plan, adr.0021]
binds: [xeon/apps/desktop/src/views/**]
---

# L4 데스크톱 UX 구현 계획 (desktop-ux)

`L4.desktop-ux.spec`의 화면을 M4에서 만드는 순서입니다. 화면의 항목, 상태, 부품은 spec이 정하고, 이 문서는 순서와 완료 기준만 정합니다.

## 1. 목표와 마일스톤 배치

- M0~M3b: 해당 작업 없음. 화면 코드는 M4입니다 [결정: 2026-10-28 사용자 지시]. M3b까지는 view-model, wire, 상태 논리만 만듭니다(`review.m3b-plan` §1.2).
- M4: spec §5의 P0 화면 전부와 P1 화면 전부. P2 화면은 wire 간극(spec §10.1)이 풀린 만큼 만듭니다 [제안].
- [결정: 2026-10-30 사용자] 대화와 런타임 작업대가 둘 다 1급입니다. 작업대 P1(P-16, P-13, P-17, P-18)과 플러그인 화면 기여(ADR-0021)를 M4에 넣고, 작업대 P2(P-19~P-22)는 wire·F·X 간극(spec §10.1 W-20~W-39, §10.3)이 풀린 만큼 만듭니다. 작업대를 P0로 올릴지는 spec §12.1 15번입니다.

## 2. 패키지와 파일 배치

- 화면: `xeon/apps/desktop/src/views/`. 셸 부품은 `views/shell/`, 화면은 `views/pages/<id>-<이름>/` [제안].
- 화면이 쓰는 순수 view-model: `xeon/packages/client/src/<영역>/`(adr.0020). spec §10.2의 새 view-model이 여기에 갑니다.
- 셸 목업: `xeon/apps/desktop/mockups/p02-<모델>/`(spec §8.2). 고른 뒤에는 목업을 지우고 셸 부품만 `views/shell/`로 옮깁니다.
- 디자인 시스템: `xeon/external/caustic`(submodule), `@caustic/react`, `@caustic/tokens`.
- 작업대 화면: `views/pages/<id>-<이름>/`(대화 화면과 같은 규칙). 작업대 view-model은 `packages/client/src/workbench/`, 플러그인 화면 호스트(트리 검사, 바인딩, 화면 장부, CLI 글 렌더)는 `packages/client/src/views/` [제안](spec §10.2 V-16~V-24).
- 작업대 시안: `xeon/apps/desktop/mockups/wb-<모델>/`(spec §14). 공용 셸 `mockups/_shell`에 영역 바꾸기와 작업대 왼쪽 패널을 더합니다.

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
| UX-11 | 작업대 시안(spec §14, W1~W5 먼저, W6~W9 다음). `_shell`에 영역 바꾸기·작업대 왼쪽 패널·런타임 탭 | UX-1 | M |
| UX-12 | 셸 영역 바꾸기(대화 ↔ 작업대), 영역별 왼쪽 패널과 오른쪽 탭, 대화 맥락 공유 상태, 연결·진단을 작업대 엔진으로 | UX-2, UX-11 | M |
| UX-13 | wire 선행 트랙: `ext.list`(W-15), `ext.get`(W-20), `ext.reenable`(W-21), `ext.health`(W-22), `group.list`(W-24), `host.status.safeModeCause`·`engine_restart`(W-35). host와 F wire 문서 변경 포함 | 없음(M4 착수 즉시) | L |
| UX-14 | 대화 영역 런타임 표시: 런타임 줄, 트랜스크립트 런타임 행, 런타임 탭(V-24) | UX-3, UX-13 | M |
| UX-15 | P-16 작업대 개요, P-13 확장 목록, P-17 확장 상세, O-10(V-16~V-18) | UX-12, UX-13 | L |
| UX-16 | F·X 선행 트랙: 매니페스트 `views`, 확장 메서드 열기와 등록 API, 예산 등급 `view`, 화면 진단, `ext.view.*`(spec §10.3 X-1~X-7, W-33). ADR-0021 사용자 확인 뒤 | ADR-0021 accepted | L |
| UX-17 | P-18 플러그인 화면 호스트와 여섯 슬롯, 위젯 카탈로그 v1, 화면 장부(V-19). Helm 기여(`helm/inquiry`, `helm/panel`, 카드, 상태 칸, 팔레트)로 P-05 대체(X-9) | UX-14, UX-16 | L |
| UX-18 | P-19 시험 실행, P-20 측정과 평가, P-21 구성, P-22 만들기, O-11, O-12(V-20~V-23) | UX-15, W-23·W-25~W-31·W-34 | L |
| UX-10 | 접근성 점검과 수정(axe, 키보드 경로), 다크 테마 점검 | UX-3~UX-9, UX-12~UX-18 | M |

- UX-3과 UX-5, UX-7은 UX-2 뒤 병렬로 갑니다.
- UX-11(작업대 시안)은 UX-1 뒤 UX-2와 병렬입니다. UX-13(wire 선행)과 UX-16(F·X 선행)은 화면 작업과 따로 앞서 갑니다. UX-6의 P-13은 UX-15로 옮겼습니다.
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
| `area.switch-restores-place` | 대화 → 작업대 → 대화로 오가면 같은 대화, 스크롤, 오른쪽 탭 |
| `runtime-tab.drive-queue-matches-group-status` | 런타임 탭의 보유·대기·거부가 `GroupStatus.drive`와 같고 Helm 밖의 drive 그룹도 보임 |
| `ext-list.exempt-tier-switch-locked` | guard·core tier의 켜짐 토글이 잠김 |
| `view-host.unknown-widget-placeholder` | 카탈로그 밖 노드만 자리표시, 나머지 트리는 그려짐 |
| `view-host.ledger-disables-view-only` | 화면 실패 5번 연속이면 그 화면만 `view_disabled`, 확장은 켜짐 |
| `view-host.no-secret-binding` | `secret: true` 설정은 핸들 부품으로만, 값 바인딩 거부 |
| `view-host.helm-renders-with-catalog-v1` | Helm `helm/inquiry` 트리가 위젯 카탈로그 v1만으로 검사를 통과 |

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
| 작업대가 wire 간극(W-15, W-20~W-24) 때문에 빈 화면이 됨 | UX-13을 M4 착수 즉시 시작. 그 전에는 설정 키와 이벤트(`scope.*`, `lease.*`)로 채우고 간극을 화면에 문장으로 보임 |
| 플러그인 화면 방식(ADR-0021)이 사용자 확인 전에 굳음 | UX-16·UX-17은 ADR-0021 accepted 뒤. 시안(UX-11 W4)으로 먼저 확인 |
| replay·bench가 배포 앱에서 못 돎(W-29, W-30) | P-19는 개발 모드 전용으로 시작하고 spec §12.1 18번 결정을 기다림 |
