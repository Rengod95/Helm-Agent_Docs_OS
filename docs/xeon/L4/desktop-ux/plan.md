---
id: L4.desktop-ux.plan
layer: L4
domain: desktop-ux
kind: plan
status: draft
depends_on: [L4.desktop-ux.spec, L4.desktop.plan, L4.settings-ui.plan, adr.0021, review.m4-plan]
binds: [xeon/apps/desktop/src/views/**]
---

# L4 데스크톱 UX 구현 계획 (desktop-ux)

`L4.desktop-ux.spec`의 화면을 M4에서 만드는 순서입니다. 화면의 항목, 상태, 부품은 spec이 정하고, 이 문서는 순서와 완료 기준만 정합니다. 트랙 배치, 에이전트 구성, 종료 조건 Y1~Y17은 `review.m4-plan`이 정본입니다. 아래 UX 작업 id는 그 트랙에 묶입니다.

## 1. 목표와 마일스톤 배치

- M0~M3b: 해당 작업 없음. 화면 코드는 M4입니다 [결정: 2026-10-28 사용자 지시]. M3b까지는 view-model, wire, 상태 논리만 만듭니다(`review.m3b-plan` §1.2).
- M4: spec §5의 P0 화면 전부와 P1 화면 전부. P2 화면은 wire 간극(spec §10.1)이 풀린 만큼 만듭니다 [제안].
- [결정: 2026-10-30 사용자] 대화와 런타임 LightCraft가 둘 다 1급입니다.
- [결정: 2026-10-31 사용자] LightCraft 화면 전부(P-16~P-21, 시험 실행, 측정, 구성기, 플러그인 화면)가 M4입니다. P-16·P-13·P-17은 P0, 나머지는 P1입니다(spec §5, §12.3 U-2). 플러그인 화면은 두 모드(ADR-0021)이고, 구성과 만들기는 구성기 하나입니다(spec §6.28).

## 2. 패키지와 파일 배치

- 화면: `xeon/apps/desktop/src/views/`. 셸 부품은 `views/shell/`, 화면은 `views/pages/<id>-<이름>/` [제안].
- 화면이 쓰는 순수 view-model: `xeon/packages/client/src/<영역>/`(adr.0020). spec §10.2의 새 view-model이 여기에 갑니다.
- 셸 목업: `xeon/apps/desktop/mockups/p02-<모델>/`(spec §8.2). 고른 뒤에는 목업을 지우고 셸 부품만 `views/shell/`로 옮깁니다.
- 디자인 시스템: `xeon/external/caustic`(submodule), `@caustic/react`, `@caustic/tokens`.
- LightCraft 화면: `views/pages/<id>-<이름>/`(대화 화면과 같은 규칙). LightCraft view-model은 `packages/client/src/workbench/`, 플러그인 화면 호스트(트리 검사, 바인딩, 화면 장부, CLI 글 렌더)는 `packages/client/src/views/` [제안](spec §10.2 V-16~V-24).
- LightCraft 시안: `xeon/apps/desktop/mockups/wb-<모델>/`(spec §14). 공용 셸 `mockups/_shell`에 영역 바꾸기와 LightCraft 왼쪽 패널을 더합니다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| UX-0 | 셸 목업 세 개(같은 브리프, 세 모델 병렬). 끝남 | spec §8.2 | S×3 |
| UX-1 | 고른 목업(Opus 시안)의 셸을 `views/shell/`로 옮김(T-SHELL) | UX-0 | S |
| UX-2 | 셸(S-01~S-04), 바로 가기 키 표, 데스크톱 로컬 설정 저장소(V-14, V-15) | UX-1 | M |
| UX-3 | P-02 대화와 승인 카드 네 종류, O-01·O-02·O-04·O-07 | UX-2 | L |
| UX-4 | P-03 받은 요청(V-02, V-03), S-02 명령 팔레트(V-01) | UX-3 | M |
| UX-5 | P-01 첫 실행, P-09 설정 일반 폼(V-09), P-10 시크릿(V-10, O-05, O-06) | UX-2 | L |
| UX-6 | P-11, P-12, P-13 설정 전용 화면 | UX-5 | M |
| UX-7 | P-06 제안, P-07 예약(V-04, O-08), P-08 연결(V-05) | UX-2 | L |
| UX-8 | P-04 변경 검토(V-06), P-05 탐구(V-07) | UX-3, W-02, W-04 | M |
| UX-9 | P-14 목표와 작업, P-15 진단, O-03, O-09 | UX-3 | M |
| UX-11 | LightCraft 시안(spec §14), 캔버스·구성기 시안(옛 `wb-canvas`는 삭제, 이력 `b726e9a9`. `wb-compose`와 크래프트 8차 `wb-v5`). 끝남. 캔버스 2차 시안은 진행 중 | UX-1 | M |
| UX-12 | 셸 영역 바꾸기(대화 ↔ LightCraft), 영역별 왼쪽 패널과 오른쪽 탭, 맥락 칸 모델(전체·대화·프로필·시험, 따라가기·고정, V-25). 연결은 대화 주 내비에 남음(T-SHELL) | UX-2, UX-11 | M |
| UX-13 | wire 선행: `review.m4-plan` T-F, T-WA, T-WB, T-WC | 없음(M4 착수 즉시) | L |
| UX-14 | 대화 영역 런타임 표시: 런타임 줄, 트랜스크립트 런타임 행, 런타임 탭(V-24) | UX-3, UX-13 | M |
| UX-15 | P-13, P-16 선택 패널·층 패널 데이터(크래프트 8차 시안, 전역만), P-17(버전 탭 §6.24.1), P-15 엔진, O-10(V-16~V-18)(T-BENCH) | UX-12, UX-13 | L |
| UX-16 | F·X 선행: 매니페스트 `views` 두 모드, 확장 메서드와 등록 API, 예산 등급 `view`, 화면 진단, `composition`, `loop.ask`, 계측 링 버퍼, 시험 멈춤, 버전 기록(T-F, T-XV, T-XD, T-GK) | ADR-0021 accepted(2026-10-31) | L |
| UX-17 | P-18 플러그인 화면 호스트, 여섯 슬롯, 선언형 렌더러와 위젯 카탈로그 v1, 프레임 호스트와 다리, 화면 장부(V-19, V-29). Helm 기여로 P-05 대체(X-9)(T-VIEW) | UX-14, UX-16 | L |
| UX-18 | P-19 시험 실행, P-20 측정과 평가, O-11, O-12(V-20, V-21)(T-TRIAL) | UX-15, T-WB | M |
| UX-19 | P-16 크래프트 개요: 지도·순서·링크, 선택 패널, 자세히 보기, 훅 순서 경고 모달(V-26, V-27)(T-CANVAS, 스펙 §6.22.0) | UX-15, T-WA, T-WB | L |
| UX-20 | P-21 구성기(그룹·흐름·프로필·코드, "새 그룹", Plugin Builder 연결)(V-22, V-28)(T-COMPOSE) | UX-15, T-WB, T-AUTH | L |
| UX-10 | 접근성 점검과 수정(axe, 키보드 경로), 다크 테마 점검 | UX-3~UX-9, UX-12~UX-18 | M |

- UX-3과 UX-5, UX-7은 UX-2 뒤 병렬로 갑니다.
- UX-13(wire 선행)과 UX-16(F·X 선행)은 화면 작업과 따로 앞서 갑니다. UX-6의 P-13은 UX-15로 옮겼습니다. 옛 P-22 만들기는 UX-20에 합쳤습니다.
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
| `area.switch-restores-place` | 대화 → LightCraft → 대화로 오가면 같은 대화, 스크롤, 오른쪽 탭 |
| `runtime-tab.drive-queue-matches-group-status` | 런타임 탭의 보유·대기·거부가 `GroupStatus.drive`와 같고 Helm 밖의 drive 그룹도 보임 |
| `ext-list.exempt-tier-switch-locked` | guard·core tier의 켜짐 토글이 잠김 |
| `view-host.unknown-widget-placeholder` | 카탈로그 밖 노드만 자리표시, 나머지 트리는 그려짐 |
| `view-host.ledger-disables-view-only` | 화면 실패 5번 연속이면 그 화면만 `view_disabled`, 확장은 켜짐 |
| `view-host.no-secret-binding` | `secret: true` 설정은 핸들 부품으로만, 값 바인딩 거부 |
| `view-host.helm-renders-with-catalog-v1` | Helm `helm/inquiry` 트리가 위젯 카탈로그 v1만으로 검사를 통과 |
| `view-host.frame-only-page-well` | `card`·`status`·`settings`의 `frame` 선언은 `view_mode_not_allowed` |
| `view-host.frame-bridge-allowlist` | 허용 목록 밖 `op`, 선언 밖 메서드, 상한 초과 메시지는 거부되고 장부에 셈 |
| `workbench.context-drives-all-pages` | 맥락 칸 값 하나로 LightCraft 화면의 맥락이 바뀜. 크래프트 8차 시안 화면(P-16, P-13)은 전역 고정이라 이 시험의 대상에서 빠질 수 있음 [미결: spec §12.1 32번] |
| `canvas.selection-sync` | 지도와 순서가 고른 것을 함께 읽음(시안 구조에 맞춰 이름과 내용이 바뀔 수 있음) |
| `canvas.order-persists-and-resets` | 층 안 순서가 재시작 뒤 같고 초기화로 자동 배치 [미결: 시안의 층 패널 순서가 불러오는 순서라면 시험 대상이 바뀜] |
| `compose.undeclared-group-single-block` | `composition` 없는 그룹은 블록 하나 "구성 정보 없음" |

## 6. 완료 기준

- spec §11.2 수용 기준을 모두 만족합니다.
- `just verify`가 통과합니다. 화면 시험은 DOM 없는 view-model 시험과 데스크톱 화면 점검(원격 점검 Phase 2, `review.m3b-plan` §1.2)으로 나눕니다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| wire 간극(spec §10.1) 때문에 P-04, P-05, P-14가 반쪽이 됨 | P1·P2 화면은 명령 결과와 이벤트로 시작하고 간극을 [미결]로 올림 |
| 시크릿 값 보기가 데스크톱에서 안 됨(W-10) | X8 화면 부분을 W-10 결정 뒤로 미루고 CLI 안내를 보임 |
| caustic 간극 부품이 앱마다 다르게 만들어짐 | UX-2에서 셸 부품(상태 표시줄, 팔레트)을 먼저 만들고 다른 화면은 그것을 씀 |
| 목업 세 개의 셸이 서로 달라 비교가 어려움 | 같은 브리프, 같은 고정 데이터, 같은 완료 기준(spec §8.2) |
| LightCraft가 wire 간극(W-15, W-20~W-24) 때문에 빈 화면이 됨 | UX-13을 M4 착수 즉시 시작. 그 전에는 설정 키와 이벤트(`scope.*`, `lease.*`)로 채우고 간극을 화면에 문장으로 보임 |
| 프레임 모드의 IPC 격리를 플랫폼에서 확인하지 못함 | `x.ui.apps = false`로 내고(2026-11-04 격리 시험 통과로 기본은 켬) 선언형과 `fallback`만 씀(ADR-0021 §6 1번) |
| 캔버스 시각 언어가 2차 시안을 기다림 | 동작과 데이터를 먼저 만들고 시각 값은 토큰 교체로 나중에 |
| replay·benchmark는 개발 모드에서만 돎(spec §12.3 U-4) | 배포 앱 P-19는 Test run과 지난 결과 읽기, 실행 항목은 잠금 |
