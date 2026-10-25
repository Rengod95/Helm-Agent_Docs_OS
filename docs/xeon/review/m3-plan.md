---
id: review.m3-plan
layer: meta
domain: review
kind: review
status: draft
depends_on: [product.scope.spec, review.m2-plan, architecture.security.spec]
binds: []
---

# M3 계획 입력

## 1. 목적과 읽는 법

- M2에서 M3로 넘긴 항목과, 다른 레인이 M3에 맡긴 요청을 한곳에 모읍니다. 마일스톤 재점검 G3-02의 산출물이고 입력은 G1-14와 M2 마감 결정(`review.m2-plan` §9)입니다.
- 이 문서는 M3 작업 분해 전의 입력 목록입니다. M3 트랙과 작업 ID는 M3 착수 때 `review.m2-plan` 형식으로 정합니다.
- 항목 번호 `M3-NN`은 이 문서 안에서만 씁니다. 원천 칸에는 재점검 번호(G1-14 등)나 원 감사 ID를 적습니다.
- M3의 범위와 종료 조건 정본은 `product.scope.spec` §4.3·§4.4입니다.

## 2. M2에서 옮긴 항목 (2026-10-25 결정)

| # | 항목 | 원천 | 선행 | 받는 문서 |
|---|---|---|---|---|
| M3-01 | Helm 본체 `group-helm` H-02~H-15와 UC-2 통합 시험(E1) | G4-04, D-a | M3-02, M3-03 | `L3.helm.plan` |
| M3-02 | Helm 쓰기 거부용 도구 메타(`risk`, `hints`, `caller`)를 `ToolCallPayload`에 싣기, `tool_execution_end`의 `input`, `ToolSpec.locks` | G1-05, D-a | F 계약 | `F.records.spec`, `L1.tools.plan` |
| M3-03 | on 핸들러 외부 효과 금지와 `delegate`, `loop.spawn`, 능력 호출의 충돌을 정하는 ADR | G1-06, D-a | 사용자 결정 | 새 ADR, `X.primitives.spec` |
| M3-04 | `l3.helm.autoStart`, `maxLenses`, `writeGuard` 키 | open-issues N-06, D-a | M3-01 | `L3.helm.spec` §6 |
| M3-05 | 비밀 env를 쓰는 stdio MCP 서버의 기동 승인 단위와 승인 레코드 | G1-04, D-c, ADR-0011 | M3-14 | `L2.mcp.spec`, `L1.tools.spec` |
| M3-06 | 승인 만료 구현(`expiresAt`, 만료 결과). 계약 필드는 M2 F에서 넣음 | G1-11 | 무인 실행(M3-08) 전 | `L1.tools.plan` |

## 3. 다른 레인이 M3에 맡긴 요청 (G1-14)

M2 문서에 "M3에서"라고만 적고 받는 문서가 없던 요청입니다.

| # | 항목 | 원 ID | 받는 문서 |
|---|---|---|---|
| M3-07 | 워크트리 연산과 파일 감시 root 완화 요청(`L2.schedule.spec` §10-13)을 L0.os가 받음 | L2-01 (a), L0-12 | `L0.os.spec` |
| M3-08 | 예약 세션의 무인 승인 정책(`L2.schedule.spec` §10-6) | L2-01 (b) | `L1.tools.spec` |
| M3-09 | 승인 kind `review`(`L2.artifacts.spec` §10-4, `L2.readme` §10-14) | L2-01 (c) | `L1.tools.spec`, `F.records.spec` |
| M3-10 | 루프를 `ActivitySnapshot`에 넣기(§10-11) | L2-01 (d) | `L4.host-service.spec` |
| M3-11 | 알림 소유(`L2.dialog.spec` D-6, `L2.readme` §10-15)와 원격 알림(UC-5 주 흐름 5번)을 M3 종료 조건에 넣을지 | L2-01 (e), L4-19 | `L2.dialog.spec`, `product.scope.spec` §4.4 M3 |
| M3-12 | 웹 검색 플러그인 provider를 등록할 X API와 헤더 비밀 해석 경로(`L2.web.plan` §8.5), 키 플러그인 첫 사용 고지 | L2-06, A-14 | `X.primitives.spec`, `L0.secrets.spec`, `L2.web.spec`, `architecture.security.spec` T-08 |
| M3-13 | 학습 그룹이 입력 출처(사용자, 예약, 원격)를 알 수 있는 지점 페이로드 | L3-05 | `F.extensions.spec`, `L1.loop.spec`, `L3.learning.spec` |
| M3-14 | 샌드박스 네트워크 정책(SB-13)과 비격리 실행 감사 이벤트(`tool.sandbox_bypassed`)의 소유자, MCP stdio 서버별 샌드박스 정책 | L0-05, ADR-0011 §3.7 | `L0.sandbox.spec`, `eng.context-map.design` |
| M3-15 | 외부 확장 로더, 훅, 안전 모드, pi 어댑터(X.5)의 M3 범위와 종료 조건 | X-03, `review.m2-plan` §8 D9 | `X.loading-trust.plan`, `product.scope.spec` §4.4 M3 |
| M3-16 | 무인 경로(예약, 루프)의 명령 실행 안전 시간 상한. 일반 대화의 기본값은 0(제한 없음) | L0-16 | `L0.exec.spec` §10 6, `L2.workspace.spec`, `L2.schedule.spec` |
| M3-17 | `xeon group new`와 그룹 템플릿을 2차로 확정하고, M3 S1 확인을 학습 그룹 변경의 diff 검사 스크립트 하나로 줄이기 | L3-07 | `L3.slots.plan`, `L4.cli.spec` |
| M3-18 | 지식 제안 대기열 wire | A-22 | `F.wire-settings.spec`, `L2.knowledge.spec` |
| M3-19 | U-04 판정표에서 M3로 둔 wire(`settings.readFile`·`writeFile`, 사용량, 알림) | G1-08 | `F.wire-settings.spec` |
| M3-20 | 명령 wire의 `status.list`와 첨부 | G1-01 | `F.wire-settings.spec`, `L2.dialog.spec` |
| M3-21 | 승인 origin 구현 정리(규칙은 M2 spec) | G1-09 | `L1.tools.plan` |
| M3-22 | 자동 끄기 알림 `scope.handler_failed` 발신, `l0.os.log.level` 적용 중 M2에 넣지 않은 부분 | G1-12 | `X.operations.spec`, `L0.os.spec` |
| M3-23 | 프로세스 간 파일 잠금의 `settings.json` 적용(`trust.json`은 M2) | G1-10 | `L0.os.spec`, `L1.persistence.spec` |

- 이미 `product.scope.spec` §4.3 M3 범위에 있는 항목은 다시 적지 않습니다: `web.browse`(D4), 목표 판정, 공유 서비스 모드, 예약·원격·알림, 학습 그룹, `cap-workspace`의 `write`·`edit`·`grep`·`find`, `cap-artifacts`, `cap-schedule`, pi 메시지 스키마 깊은 검증(`review.m2-plan` §2.2).

## 4. 데이터·운영·릴리즈

| # | 항목 | 원천 | 받는 문서 |
|---|---|---|---|
| M3-24 | 블롭 `pinBlob`과 GC, spill 파일 보관 정책, 보관 정리 기본값, 로그 회전, 디스크 상한(spill 위치 이동은 M2) | G2-05 | `L0.store.spec`, `L1.persistence.spec`, `L0.exec.spec`, `L0.os.spec` |
| M3-25 | DB 내보내기와 복구 런북(마이그레이션 전 스냅샷과 오류 kind는 M2) | G2-06 | `L0.store.spec`, L4 런북 |
| M3-26 | 외부 바이너리(sops, age, rg, bwrap, socat) 번들과 서명(필수/선택 표와 점검은 M2) | G2-07 | `L4/release/spec.md` |
| M3-27 | 릴리즈, 배포, 업데이트, 공급망, 고지 문서. Developer ID 서명과 공증(D3) | G3-04 | `L4/release/spec.md`(새 문서) |
| M3-28 | 운영·진단 런북, 용어집, 구현 상태 지도, 데이터·개인정보 문서, 비기능 요구 절(온보딩은 M2) | G3-05 | `eng.onboarding.guide`, architecture, product |
| M3-29 | 성능 예산 게이트(기준선은 M2) | G2-04, ADR-0012 | `eng.performance.guide` |
| M3-30 | CI 액션 SHA 고정, CI gitleaks | G4-07 | `.github/workflows/**` |

## 5. 설계 묶음

| # | 항목 | 원천 | 받는 문서 |
|---|---|---|---|
| M3-31 | 필수 투영기 예외 격리 경로와 예외 주입 시험 | G2-14 | `X.operations.spec`, `L1.persistence.spec` |
| M3-32 | 관측성(`traceparent`, telemetry 설정), 확장 진단 배열 상한, 로깅 지침 | G2-15 | `L0.os.spec`, `L4.host-service.spec` |
| M3-33 | MCP 평문 env 거부의 마찰, 프롬프트 명령, 서브에이전트 `tools.deny`와 확장 티어, 저장 이벤트의 비밀 사후 삭제, 재개 시 모델 요청 재전송 정책, 포크 갱신 정책, 샌드박스 호출 비격리 감사, 비샌드박스 실행 | G2-16 | 각 레인 spec |
| M3-34 | 선언만 하고 동작 없는 설정 키 정리(`SettingDef.stage` 필드는 M2, D-b) | G5-04 | 각 소유 spec |
| M3-35 | `xeon.domain`의 `kit`와 routes layout `group-kit` 맞추기 | G5-05 | `_routing/routes.yaml`, `L3.group-kit.spec` |
| M3-36 | 대화 자동 제목(첫 입력 80자와 `thread.rename`은 M2) | G2-12 | `L1.persistence.spec` |
| M3-37 | fork thread의 원본 history 연속성 구현(규칙은 M2) | G2-11 | `L1.persistence.spec` |
| M3-38 | 데스크톱 `closeBehavior`, `EngineConfig::from_values` 호출처 | G2-09 | `L4.desktop.spec` |
| M3-39 | 접근성, i18n·로케일(IME 확인은 M2) | G2-13 | `L4.desktop.spec`, `L4.cli.spec` |
| M3-40 | 원격 점검 Phase 2(Victauri PoC) | M2 마감 계획 T7 | `L4.desktop.plan` |

## 6. M3 착수 조건

- `review.m2-plan` §11 판정표에서 E0, E2~E7이 모두 충족이어야 합니다.
- M3-03(효과 목록 ADR)은 사용자 결정이 필요합니다. M3-01 착수 전에 받습니다.
- M3-14(샌드박스 네트워크 정책)는 CI에서 bwrap 샌드박스 int 시험이 돌고 macOS Seatbelt 결과가 `review.macos-checklist`에 있어야 시작합니다(ADR-0011 §3.7).

## 7. 미결 사항

- [미결] M3 트랙 나눔과 순서. M3 착수 때 정합니다.
- [미결] `product.scope.spec` §10 미결 4(Helm 내부 설계 착수 시점)는 M3-01 전에 닫아야 합니다.
