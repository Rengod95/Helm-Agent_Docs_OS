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

- M2에서 M3로 넘긴 항목과, 다른 레인이 M3에 맡긴 요청을 한곳에 모읍니다. 마일스톤 재점검 G3-02의 산출물이고 입력은 G1-14와 M2 마감 결정(`review.m2-plan` §9)입니다. M2 마감 재검토(2026-10-26, `be63a94..dbef8b2`)가 M3로 넘긴 항목도 원천 칸에 "재검토 결함 N"으로 적습니다.
- 이 문서는 M3 작업 분해 전의 입력 목록입니다. M3 트랙과 작업 ID는 M3 착수 때 `review.m2-plan` 형식으로 정합니다.
- 항목 번호 `M3-NN`은 이 문서 안에서만 씁니다. 원천 칸에는 재점검 번호(G1-14 등)나 원 감사 ID를 적습니다.
- M3의 범위와 종료 조건 정본은 `product.scope.spec` §4.3·§4.4입니다.
- 2026-10-28 사용자 결정으로 M3를 M3a와 M3b로 나눴다. M3a의 트랙은 §7에 적었다. M3b 상세 계획은 `review.m3b-plan`이다. M3b가 끝나면 첫 공개 릴리즈 후보다 [결정: 2026-10-28 사용자].
- M3 설계 단계 입력은 `review.m3-design-inputs`(미결 수집과 사용자 결정 D-M3-01~32)와 `review.m3-lower-requirements`(하위 층 요구 M3-REQ-NN)입니다. 2026-10-26 사용자 결정을 이 문서의 항목에 반영했습니다. 결정 인용은 `[결정: review.m3-design-inputs D-M3-NN]` 형식입니다.

## 2. M2에서 옮긴 항목 (2026-10-25 결정)

| # | 항목 | 원천 | 선행 | 받는 문서 |
|---|---|---|---|---|
| M3-01 | Helm 본체 `group-helm` H-02~H-22와 UC-2 통합 시험(E1). Helm은 기본 플러그인으로 낸다(별도 패키지, 설치하면 켬, 자체 확장 API로 X 로더가 실음) [결정: review.m3-design-inputs D-M3-01] | G4-04, D-a | M3-02, M3-03, M3-15 | `L3.helm.plan` |
| M3-02 | Helm 쓰기 거부용 도구 메타(`risk`, `hints`, `caller`)를 `ToolCallPayload`에 싣기, `tool_execution_end`의 `input`, `ToolSpec.locks` | G1-05, D-a | F 계약 | `F.records.spec`, `L1.tools.plan` |
| M3-03 | on 핸들러 외부 효과 금지와 `delegate`, `loop.spawn`, 능력 호출의 충돌을 정하는 ADR. 완료: ADR-0015(2026-10-25 C안). 구현은 M3-new-01 | G1-06, D-a, L1R-09, LP-01, SC-04 | 사용자 결정(받음) | `adr.0015`, `X.primitives.spec` |
| M3-04 | `l3.helm.autoStart`, `maxLenses`, `writeGuard` 키 | open-issues N-06, D-a | M3-01 | `L3.helm.spec` §6 |
| M3-05 | 비밀 env를 쓰는 stdio MCP 서버의 기동 승인 단위와 승인 레코드 | G1-04, D-c, ADR-0011 | M3-14 | `L2.mcp.spec`, `L1.tools.spec` |
| M3-06 | 승인 만료 구현(`expiresAt`, 만료 결과). 계약 필드는 M2 F에서 넣음 | G1-11 | 무인 실행(M3-08) 전 | `L1.tools.plan` |

## 3. 다른 레인이 M3에 맡긴 요청 (G1-14)

M2 문서에 "M3에서"라고만 적고 받는 문서가 없던 요청입니다.

| # | 항목 | 원 ID | 받는 문서 |
|---|---|---|---|
| M3-07 | 워크트리 연산과 파일 감시 root 완화 요청(`L2.schedule.spec` §10-13)을 L0.os가 받음 | L2-01 (a), L0-12 | `L0.os.spec` |
| M3-08 | 예약 세션의 무인 승인 정책(`L2.schedule.spec` §10-6). 기본은 대기 뒤 승인 만료(M3-06)에서 거부이고 설정으로 대기·거부를 고릅니다 [결정: review.m3-design-inputs D-M3-12]. print 모드는 사전 허용 규칙만 적용하고, 전체 자동 승인 옵션(모두 허용 포함)을 따로 둡니다 [결정: review.m3-design-inputs D-M3-14]. 규칙은 ADR-0018 승인 프로토콜 하나를 따릅니다 | L2-01 (b) | `L1.tools.spec`, `L4.cli.spec` |
| M3-09 | 승인 kind `review`(`L2.artifacts.spec` §10-4, `L2.readme` §10-14). 승인 프로토콜 통합은 ADR-0018 | L2-01 (c) | `L1.tools.spec`, `F.records.spec`, `adr.0018` |
| M3-10 | 루프를 `ActivitySnapshot`에 넣기(§10-11) | L2-01 (d) | `L4.host-service.spec` |
| M3-11 | 알림 소유(`L2.dialog.spec` D-6, `L2.readme` §10-15)와 원격 알림(UC-5 주 흐름 5번). M3 종료 조건의 알림은 연결된 클라이언트 전달과 OS 알림입니다. 클라이언트 창이 앞에 있어도 기본으로 보내고 설정으로 조정합니다. 웹·모바일 알림(푸시)은 후순위입니다 [결정: review.m3-design-inputs D-M3-17] | L2-01 (e), L4-19 | `L2.dialog.spec`, `L0.os.spec`, `product.scope.spec` §4.4 M3 |
| M3-12 | 웹 검색 플러그인 provider를 등록할 X API와 헤더 비밀 해석 경로(`L2.web.plan` §8.5), 키 플러그인 첫 사용 고지. 자동 선택 순서는 설정 화면 드래그앤드롭(등록된 검색 도구 목록, 기본 웹 검색 도구 포함, 플러그인 기본 후순위), 여러 provider 동시 질의 기본 기능, robots.txt 기본 무시 + 옵션. Parallel·Jina는 넣지 않습니다 [결정: review.m3-design-inputs D-M3-23] | L2-06, A-14 | `X.primitives.spec`, `L0.secrets.spec`, `L2.web.spec`, `L4.settings-ui.spec`, `architecture.security.spec` T-08 |
| M3-13 | 학습 그룹이 입력 출처(사용자, 예약, 원격)를 알 수 있는 지점 페이로드 | L3-05 | `F.extensions.spec`, `L1.loop.spec`, `L3.learning.spec` |
| M3-14 | 샌드박스 네트워크 정책(SB-13)과 비격리 실행 감사 이벤트(`tool.sandbox_bypassed`)의 소유자, MCP stdio 서버별 샌드박스 정책. 네트워크는 기본 허용 + 차단 도메인 목록, 자격 파일 읽기는 기본 허용 + 옵션으로 막음, 샌드박스 밖 재시도는 기본 끔·매번 승인 [결정: review.m3-design-inputs D-M3-18]. MCP stdio 서버는 출처별 기본값(프로젝트 출처 켬, 사용자 출처 끔)이고 sampling은 지원하지 않습니다 [결정: review.m3-design-inputs D-M3-19] | L0-05, ADR-0011 §3.7 | `L0.sandbox.spec`, `L2.mcp.spec`, `eng.context-map.design` |
| M3-15 | 외부 확장 로더(자체 확장 API, `.xeon-plugin/plugin.json`)와 안전 모드. pi 어댑터(X.5)는 만들지 않습니다(pi 호환 없음) [결정: review.m3-design-inputs D-M3-11 c]. 기본 플러그인 Helm을 싣는 경로와 가상 모듈(`@xeon/contracts`, `@xeon/group-kit`, `typebox`) 등록을 포함합니다. 외부 훅은 M3 밖이고 M4로 옮겼습니다(§7) [결정: 2026-10-28 사용자] | X-03, `review.m2-plan` §8 D9 | `X.loading-trust.plan`, `X.operations.spec`, `product.scope.spec` §4.4 M3 |
| M3-16 | 무인 경로(예약, 루프)의 명령 실행 안전 시간 상한. 일반 대화의 기본값은 0(제한 없음) | L0-16 | `L0.exec.spec` §10 6, `L2.workspace.spec`, `L2.schedule.spec` |
| M3-17 | `xeon group new`와 그룹 템플릿을 2차로 확정하고, M3 S1 확인을 학습 그룹 변경의 diff 검사 스크립트 하나로 줄이기 | L3-07 | `L3.slots.plan`, `L4.cli.spec` |
| M3-18 | 지식 제안 대기열 wire. 대기열은 둘(학습 그룹, L2.knowledge)이고 L4가 한 목록으로 합쳐 보입니다 [결정: review.m3-design-inputs D-M3-32 a] | A-22 | `F.wire-settings.spec`, `L2.knowledge.spec`, `L3.learning.spec` |
| M3-19 | U-04 판정표에서 M3로 둔 wire(`settings.readFile`·`writeFile`, 사용량, 알림) | G1-08 | `F.wire-settings.spec` |
| M3-20 | 명령 wire의 `status.list`와 첨부 | G1-01 | `F.wire-settings.spec`, `L2.dialog.spec` |
| M3-21 | 승인 origin 구현 정리(규칙은 M2 spec) | G1-09 | `L1.tools.plan` |
| M3-22 | 자동 끄기 알림 `scope.handler_failed` 발신과 클라이언트 표시, `l0.os.log.level` 적용 중 M2에 넣지 않은 부분. M2 마감 상태: kind와 페이로드 스키마는 F에 있고, 호스트 조립 루트가 `OperationsNotifier`를 넘기지 않아 운영 로그에만 남는다. CLI는 이 kind를 그리지 않는다 | G1-12, M2 마감 재검토 결함 5 | `X.operations.spec`, `L4.host-service.spec` §10 33번, `L4.cli.spec`, `L4.desktop.spec`, `L0.os.spec` |
| M3-23 | 프로세스 간 파일 잠금의 `settings.json` 적용(`trust.json`은 M2) | G1-10 | `L0.os.spec`, `L1.persistence.spec` |

- 이미 `product.scope.spec` §4.3 M3 범위에 있는 항목은 다시 적지 않습니다: `web.browse`(D4), 목표 판정, 공유 서비스 모드, 예약·원격·알림, 학습 그룹, `cap-workspace`의 `write`·`edit`·`grep`·`find`, `cap-artifacts`, `cap-schedule`, pi 메시지 스키마 깊은 검증(`review.m2-plan` §2.2).

## 4. 데이터·운영·릴리즈

| # | 항목 | 원천 | 받는 문서 |
|---|---|---|---|
| M3-24 | 블롭 `pinBlob`과 GC, spill 파일 보관 정책, 보관 정리 기본값, 로그 회전, 디스크 상한(spill 위치 이동은 M2). 기록은 기본으로 지우지 않고 설정 화면에서 기간을 정하며 참조 없는 블롭만 GC합니다 [결정: review.m3-design-inputs D-M3-21 a] | G2-05 | `L0.store.spec`, `L1.persistence.spec`, `L0.exec.spec`, `L0.os.spec` |
| M3-25 | DB 내보내기와 복구 런북(마이그레이션 전 스냅샷과 오류 kind는 M2) | G2-06 | `L0.store.spec`, L4 런북 |
| M3-26 | 외부 바이너리(sops, age, rg, bwrap, socat) 번들과 서명(필수/선택 표와 점검은 M2). macOS는 sops·age·rg를 번들·서명하고 Linux는 bwrap·socat을 시스템 패키지로 요구합니다 [결정: review.m3-design-inputs D-M3-25 행 5] | G2-07 | `L4/release/spec.md` |
| M3-27 | 릴리즈, 배포, 업데이트, 공급망, 고지 문서. Tauri 내장 서명 + Developer ID 공증(D3, Apple 계정은 곧 확보). 지원 대상은 macOS 14 이상 arm64, Linux x86_64·arm64이고 Intel macOS는 빌드하지 않습니다. 릴리즈는 단일 파일이고 npm 공개는 없습니다 [결정: review.m3-design-inputs D-M3-25]. M3는 이름 `xeon`으로 내고 개명은 M4 전입니다 [결정: review.m3-design-inputs D-M3-24 b]. 의존은 현재 버전 고정 + 점진 업데이트를 운영 정책으로 둡니다 [결정: review.m3-design-inputs D-M3-29 행 1] | G3-04 | `L4/release/spec.md`(새 문서), `product.scope.spec` §4.7 |
| M3-28 | 운영·진단 런북, 용어집, 구현 상태 지도, 데이터·개인정보 문서, 비기능 요구 절(온보딩은 M2) | G3-05 | `eng.onboarding.guide`, architecture, product |
| M3-29 | 성능 예산 게이트(기준선은 M2). 지표별 예산 수치는 macOS 기준선을 본 뒤 사용자가 정합니다 [결정: review.m3-design-inputs D-M3-28 a]. 2026-10-27에 서버(WSL2)에서 `cold_start_cli` 중앙값 189.8 ms, `cold_start_sidecar` 중앙값 46.9 ms, `first_token` 1289.5 ms(1회, 실제 provider)를 쟀습니다(`eng.performance.guide` §2). macOS 기준선과 D11 측정(실제 키 검색 래퍼 약 20회, 개발자 세션 DB 사본 FTS)은 실행 기록이 없어 이 항목이 측정부터 맡습니다 | G2-04, ADR-0012, D11, D-e | `eng.performance.guide` |
| M3-30 | CI 액션 SHA 고정, CI gitleaks. M2 마감 상태: 워크플로가 `actions/checkout@v4`, `actions/setup-node@v4`, `jdx/mise-action@v2`, `extractions/setup-just@v2`처럼 이동하는 태그를 씁니다. 커밋 SHA로 고정하고 판 주석을 답니다 | G4-07, 재검토 결함 12 | `.github/workflows/**` |

## 5. 설계 묶음

| # | 항목 | 원천 | 받는 문서 |
|---|---|---|---|
| M3-31 | 필수 투영기 예외 격리 경로와 예외 주입 시험 | G2-14 | `X.operations.spec`, `L1.persistence.spec` |
| M3-32 | 관측성(`traceparent`, telemetry 설정), 확장 진단 배열 상한, 로깅 지침 | G2-15 | `L0.os.spec`, `L4.host-service.spec` |
| M3-33 | MCP 평문 env 거부의 마찰(평문 허용 + 비밀 이름 패턴 거부), 프롬프트 명령, 서브에이전트 `tools.deny`와 확장 티어, 저장 이벤트의 비밀 사후 가림(표시·내보내기·모델 입력 단계, 원본 행 유지 [결정: review.m3-design-inputs D-M3-20 b]), 재개 시 모델 요청 재전송 정책, 포크 갱신 정책(현재 버전 고정 + 점진 업데이트 [결정: review.m3-design-inputs D-M3-29 행 1]), 샌드박스 호출 비격리 감사, 비샌드박스 실행 | G2-16, MC-07, AG-04 | 각 레인 spec |
| M3-34 | 선언만 하고 동작 없는 설정 키 정리(`SettingDef.stage` 필드는 M2, D-b) | G5-04 | 각 소유 spec |
| M3-35 | `xeon.domain`의 `kit`와 routes layout `group-kit` 맞추기. `host`와 `host-service`(U-48)도 함께 봅니다 | G5-05, U-48 | `_routing/routes.yaml`, `L3.group-kit.spec`, `architecture.layers.spec` |
| M3-36 | 대화 자동 제목(첫 입력 80자와 `thread.rename`은 M2) | G2-12 | `L1.persistence.spec` |
| M3-37 | fork thread의 원본 history 연속성 구현(규칙은 M2) | G2-11 | `L1.persistence.spec` |
| M3-38 | 데스크톱 `closeBehavior`, `EngineConfig::from_values` 호출처 | G2-09 | `L4.desktop.spec` |
| M3-39 | 접근성, i18n·로케일(IME 확인은 M2). i18n은 ADR-0016(FormatJS, ICU, ko·en, `ui.locale` auto)을 따르고 이전 작업은 M3-new-21입니다 [결정: review.m3-design-inputs D-M3-27] | G2-13 | `L4.desktop.spec`, `L4.cli.spec`, `adr.0016` |
| M3-40 | 원격 점검 Phase 2(Victauri PoC) | M2 마감 계획 T7 | `L4.desktop.plan` |
| M3-41 | 시험 파일의 `Reflect.get` 정리. M2 마감에서 시험 파일 6개에 16곳이 늘었습니다(`apps/desktop/test/e2e/scenario.ts` 7, `sidecar.e2e.test.ts` 2, `test/app/support.ts` 2, `test/transport/tauri-mock.ts` 2, `apps/cli/test/doctor-host.int.test.ts` 2, `turn-resume-host.int.test.ts` 1). 소스에는 없습니다. TypeBox `Value.Check`나 판별 함수로 좁혀 읽게 바꿉니다 | 재검토 결함 9 | `eng.typescript.guide`, `eng.testing.guide` |

### 5.1 M3 설계 단계가 더한 작업

`review.m3-design-inputs` §5.2의 새 작업 후보(M3-new-01~18)와 2026-10-26 사용자 결정이 만든 작업(M3-new-19~23)입니다. 번호는 L3·하위 층 문서가 이미 인용하므로 `M3-new-NN`을 그대로 씁니다. 하위 층 요구 행은 `review.m3-lower-requirements`에 있습니다.

| # | 항목 | 원천 | 받는 문서 |
|---|---|---|---|
| M3-new-01 | ADR-0015 구현: F `MethodDef` 필드와 검증, X 능력 래퍼 문맥 검사와 기본 `requestId`, 코어 멱등의 내구 기록, L2 메서드 분류, `replayDrive` 효과 계수, provider 적합성 시험 | B-06, M-08, LP-01, SC-04 | `adr.0015`, F·X·L1·L2 spec |
| M3-new-02 | 백그라운드 위임과 목표 판정: core-agents 스텁 해소, `completeStructured`, `agent_before_settle` 연결, `agent.judged`. 판정 실패는 `stop`, `maxRuns` 도달 뒤 turn 종료와 알림 [결정: review.m3-design-inputs D-M3-15]. `work.reports`도 M3 [결정: review.m3-design-inputs D-M3-30 행 2] | CD-01, AG-05, AG-14, LP-11, MD-09, WK-11 | `L1.agents.spec`, `L2.work.spec` |
| M3-new-03 | 학습 그룹 1차(LR-01~LR-18, UC-3 스모크)와 L4 연계. 내장 그룹, 기본 켬 [결정: review.m3-design-inputs D-M3-02] | M-05, KN-22 | `L3.learning.plan` |
| M3-new-04 | 공유 서비스 모드: `xeon service`, 소켓, ensure, 유휴 종료(승인 대기 세션은 live), 자동 재개(기본 꺼짐, 서비스 모드에서 설정으로 켬), 리플레이 커서, `ExecService.withCwd` [결정: review.m3-design-inputs D-M3-13] | M-01, M-18, PS-10, U-73, A-100 | `adr.0006`, `L0.process.spec`, `L4.host-service.spec` |
| M3-new-05 | 원격 사용. 형태는 둘입니다. (1) 자체 호스트 서버에 켜 둔 `xeon` 호스트에 다른 기기의 데스크톱·CLI가 접속, (2) 자기 컴퓨터에서 클라이언트가 호스트를 켬 [결정: review.m3-design-inputs D-M3-17]. 접속은 SSH 터널 또는 사설망 TCP이고 TCP일 때만 토큰 필수 [결정: review.m3-design-inputs D-M3-16 c]. PR-20 중계 시험. 웹 클라이언트는 M3에 넣지 않습니다. CLI와 데스크톱만 SSH 터널이나 사설망으로 원격 호스트에 접속하고, 웹 UI는 M4입니다. `packages/client`의 전송 계층은 나중의 브라우저 클라이언트가 쓸 수 있게 분리해 둡니다 [결정: 2026-10-28 사용자] | M-02, B-11 | `L0.process.spec`, `L4.host-service.spec`, `adr.0006` |
| M3-new-06 | 설정 화면 M3: 비밀 탭과 값 열람, 전용 편집기, 게이지, 첫 실행 권장, 관리 잠금 사유, `SettingsTab`, 검색 provider 순서 드래그앤드롭(M3-12). TUI 설정 화면은 만들지 않되 나중에 만들 수 있게 view-model을 `packages/client`에 둡니다 [결정: review.m3-design-inputs D-M3-30 행 3] | M-10, M-17, B-19, U-88, U-89, U-86 | `L4.settings-ui.spec` |
| M3-new-07 | 모델 계정 풀과 레이트 리밋 | MD-08 | `L1.models.spec`, M3-new-23 |
| M3-new-08 | 설정 파일 외부 변경 감시와 통지 | M-16, A-72 | `L0.os.spec`, `L4.host-service.spec` |
| M3-new-09 | 그룹 계측과 승격 보고(G-17, G-18) | M-07, U-30 | `L3.group-kit.plan` |
| M3-new-10 | `cap-workspace` `write`·`edit`·`grep`·`find`와 원자적 쓰기 | WS-10, WS-02 | `L2.workspace.spec` |
| M3-new-11 | `cap-artifacts`(리뷰·diff 승인, 제목·라벨, 레코드 카탈로그) | AR-08, B-07 | `L2.artifacts.spec` |
| M3-new-12 | `cap-schedule`(타이머, 파일 감시, 원격, 루프, cron 세션 종류). 놓친 실행은 1회 따라잡기(최소 간격 300초), 기존 세션 대상 예약은 제외 [결정: review.m3-design-inputs D-M3-13 행 3·4] | SC-08, KN-21, B-07 | `L2.schedule.spec` |
| M3-new-13 | `web.browse`(B10). 기본 브라우저 provider는 Stagehand(Browserbase, MIT, TS 라이브러리 + MCP)이고 Playwright MCP는 후보입니다. Aside·Ego Lite는 공식 API가 생기면 어댑터를 둡니다. 크롤링 자동화는 사용자 프로그램·플러그인 영역입니다 [결정: review.m3-design-inputs D-M3-23] | WB-17, WB-04, A-68, C-036 | `L2.web.spec` |
| M3-new-14 | 기본 프롬프트 문안(응답 언어, 도구 사용 규칙). 모델용 도구 설명은 영어 [결정: review.m3-design-inputs D-M3-27] | LP-10 | `L1.loop.spec` |
| M3-new-15 | pi 메시지 스키마 깊은 검증 | A-12 | `F.conversation.spec` |
| M3-new-16 | 실기 확인 묶음: fake-only FK-01~FK-18 중 M3 몫, Mac 실측(processStartFingerprint, NFD, IME, 키체인). 대상은 macOS 14 이상 arm64 | A-81, C-148~C-161 | `review.fake-only`, `review.macos-checklist` |
| M3-new-17 | 검사·도구 정리 묶음: open-issues E-01~E-05, N-07, V-05, eng 린트·스캔 항목, [가정] 확인. 문서 검사 `STATUSES`에 `superseded` 추가, fast-check 도입(TC-04 절차로 ADR), anti-patterns 항목 추가 승인자는 사용자 [결정: review.m3-design-inputs D-M3-29 행 3~5] | C-077, C-079, C-080, C-082, C-087, C-092, C-097, C-101, C-104, C-131, C-147, C-169, C-172, C-174~C-176, C-178 | `review.open-issues`, `eng.testing.guide`, `adr.readme` |
| M3-new-18 | L1 소항목: 최근 파일 재주입, 게이트 상한 조정, 청크 재생성 기준, 지시문 모방 검사 목록, post.accepted 동봉 코드 삭제, 인덱스 예산 | CX-09, LP-07, PS-07, AG-09, TK-07, KN-11 | 각 L1·L2 spec |
| M3-new-19 | 확장 지점 개정(ADR-0017). M3 F 첫 작업: 자체 이름 표와 일괄 개명, 4번째 fold `collect`, 지점 선언의 실패 정책 필드, 수명주기 지점(`agent.settled`, `lease.rejected`), fail-closed 가드레일 지점 셋(모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전, 내장 검사 없음) [결정: review.m3-design-inputs D-M3-10, D-M3-30 행 1] | D-M3-10, D-M3-11, D-M3-30 | `adr.0017`, `F.extensions.spec`, `X.primitives.spec`, `L1.loop.spec` |
| M3-new-20 | `xeon/packages/client` 신설(ADR-0020). F wire의 런타임 구현(`createHostConnection`, 프레이밍, stdio 전송) 이동, 설정 view-model과 공유 표시 로직, 같은 층 예외 `DR-10/cli-client`·`DR-10/desktop-client` [결정: review.m3-design-inputs D-M3-26] | D-M3-26, U-41, U-56 | `adr.0020`, `architecture.layers.spec`, `eng.dependency-rules.guide` |
| M3-new-21 | i18n 이전(ADR-0016). FormatJS 도입, ko·en 카탈로그와 생성 id, `ui.locale`, CLI·호스트·데스크톱의 하드코딩 한국어 문자열 이전, 호스트 오류를 kind+인자로 [결정: review.m3-design-inputs D-M3-27] | D-M3-27, U-87, WS-08 | `adr.0016`, `L4.cli.spec`, `L4.desktop.spec`, `F.wire-settings.spec` |
| M3-new-22 | Helm 기본 플러그인 패키징: `.xeon-plugin/plugin.json`, 엔트리 번들, 첫 실행 설치, 앱 업데이트 때 교체 규칙 [결정: review.m3-design-inputs D-M3-01 c] | D-M3-01 | `L3.helm.plan` H-22, `X.loading-trust.spec` |
| M3-new-23 | 위장 provider 플러그인과 계정 회전 플러그인. 계정 회전은 API 키 계정과 구독 계정 모두, 둘 다 기본 꺼짐 + 첫 사용 때 약관 위험 고지 [결정: review.m3-design-inputs D-M3-22] | D-M3-22, MD-02, MD-07 | `L1.models.spec`, `L4.settings-ui.spec` |

- 범위에서 뺀 것: pi 확장 어댑터(D-M3-11 c), pi JSONL 대화 기록 가져오기(PS-03, D-M3-31 행 5에서 삭제), 웹·모바일 알림 푸시(D-M3-17 후순위), Intel macOS 빌드(D-M3-25). Windows 엔진 잔존(U-59)과 Windows 서명 인증서(U-64)는 M4 이후입니다.

### 5.2 M2 Mac 실기 마감이 넘긴 항목 (2026-10-27)

M2 Mac 실기(`review.macos-checklist` M-10~M-13, `xeon/foundation` `c8afa8b`)에서 나온 항목입니다. M3 설계 브랜치의 `M3-new-NN`과 겹치지 않게 `M3-m2c-NN`으로 적습니다.

| # | 항목 | 원천 | 받는 문서 |
|---|---|---|---|
| M3-m2c-01 | macOS `os-auth`(Touch ID·암호) 구현. 지금은 `osAuthAvailable` 기본값이 false(`xeon/packages/platform-secrets/src/assemble.ts`)라 macOS `reveal` 재인증이 없습니다. E7의 macOS 부분을 이 항목으로 옮깁니다 | M-05, E7 | `L0.secrets.spec`, `L0.secrets.plan` |
| M3-m2c-02 | HS-78 전에 저장한 모르는 기본 모델 id가 남아 있어도 첫 실행 안내의 "기본 모델 선택" 단계가 완료로 보입니다. 데스크톱에는 모델 목록 wire가 없습니다. 계약(모델 목록, 또는 settings·`host.status`의 유효성 필드) → host → 데스크톱 시작 시 점검 순서로 고칩니다 | M-12, HS-78(`7683dc6`) | `F.wire-settings.spec`, `L4.host-service.spec`, `L4.desktop.spec` |
| M3-m2c-03 | `apps/desktop/src/views/composer.tsx`의 `legacyKeyCode`가 `Reflect.get(event, "keyCode")`를 써서 TS 규칙에 어긋납니다. Mac IME를 다시 확인한 뒤 `KeyboardEvent.keyCode`를 타입으로 읽거나 조합 끝 유예만으로 막도록 바꿉니다 | M-11(`0338353`), M3-41 | `eng.typescript.guide`, `L4.desktop.spec` |
| M3-m2c-04 | 첫 실행 환경 정리 묶음: (a) Finder에서 띄운 앱의 PATH에 sops가 없을 수 있습니다(터미널에서 띄우면 됨). (b) Linux Secret Service에 키를 마련하는 경로가 없습니다. (c) CLI `sopsMissing` 문구(`apps/cli/src/engine.ts` 250행 부근)가 `platform-secrets` 플러그인 실패와 메시지에 sops·age가 들어간 실패를 모두 "sops 또는 age를 찾을 수 없다"로 보입니다. (d) 다른 프로세스가 바꾼 비밀 메타데이터를 사이드카가 바로 보는지 확인하지 않았습니다. (e) Mac에서 디버그 로그 `xeon-desktop-debug.log`가 0바이트였습니다 | M-12 | `L0.secrets.spec`, `L4.cli.spec`, `L4.desktop.spec` |

## 6. M3 착수 조건

- `review.m2-plan` §11 판정표에서 E0, E2~E7이 모두 충족이어야 합니다.
- M3-03(효과 목록 ADR)은 사용자 결정을 받았습니다(ADR-0015, 2026-10-25 C안). M3 설계 결정 D-M3-01~32도 2026-10-26에 모두 받았습니다(`review.m3-design-inputs` §3).
- M3-14(샌드박스 네트워크 정책)는 CI에서 bwrap 샌드박스 int 시험이 돌고 macOS Seatbelt 결과가 `review.macos-checklist`에 있어야 시작합니다(ADR-0011 §3.7).

## 7. 미결 사항

- M3 트랙 나눔 [결정: 2026-10-28 사용자]. M3a 트랙은 A0~A6이다. A0은 결정 기록, A1은 확장 지점 개정과 `packages/client`와 작은 정리, A2는 F 추가와 X 로더, A3는 X 원시 연산과 L1 에이전트(목표 판정 구현 포함)와 L1 도구·루프, A4는 L2와 group-kit, A5는 Helm과 학습, A6은 마감이다. M3b는 M3a 마감 때 계획한다.
- 닫음: `product.scope.spec` §10 미결 4(Helm 내부 설계 착수 시점)는 "M2 마감 직후, M3 설계 단계 첫 트랙. 선행은 M3-03(ADR-0015)"으로 닫았습니다.
- 닫음: 외부 훅은 M3 밖이고 M4로 옮겼다(M3-15, ADR-0017 §6, `X.operations.spec` §10 21) [결정: 2026-10-28 사용자].
- 닫음: 웹 클라이언트는 M3에 넣지 않는다. CLI와 데스크톱만 쓰고 웹 UI는 M4다. `packages/client`의 전송 계층은 브라우저 클라이언트가 쓸 수 있게 분리해 둔다 [결정: 2026-10-28 사용자].
- 닫음: Helm은 사용자 신뢰 수준의 기본 플러그인이라 설정 이름공간을 `ext.helm.*`로 옮겼다(A5, `L3.helm.spec` C5) [결정: 2026-10-28 오케스트레이터].
- [제안] 소켓 전송의 클라이언트 구현은 `packages/client`에 둔다. 구현은 M3b 서비스 트랙이다(ADR-0020 §6). 기본값이며 사용자 결정은 아니다.
- 닫음: 위장 provider·계정 회전 플러그인(M3-new-23, D-M3-22)과 모델 계정 풀(M3-new-07)은 M3b에 둔다 [결정: 2026-10-28 사용자].

## 8. M3a 마감 판정 (2026-10-28)

- 범위: `61f137b..HEAD`(M2 병합 뒤 M3a 전체). 마지막 확인 시점의 foundation은 A5 병합과 마감 수정(`/helm start` 직후 drive 재호출)까지다.
- 마감 정책: 전체 강제 검증(`just verify-full`)은 M3b 마감 때 M3 전체에 한 번 돌린다 [결정: 2026-10-28 사용자]. M3a는 병합마다 빠른 `just verify`와 `just exit-tests`로 확인했다.

| 조건 | 판정 | 근거 |
|---|---|---|
| X1 Helm(E1·UC-2) | 충족 | `exit-tests` X1 줄: `group-helm` `test/int/uc2.int.test.ts`·`plugin.int.test.ts`, `apps/host` `test/int/helm.int.test.ts`(실제 엔진: 확산 단계 bash 거부와 승인 창 없음, explorer 3개 생성, 결과 3개 커밋, 적용 turn 1회, 명령만 보낸 경우 `uc2.command-only`). 15/15줄 통과, 건너뜀 0(2026-10-28) |
| X2 학습(UC-3) | 충족 | `exit-tests` X2 줄: `group-learning` `test/uc3.int.test.ts`, `apps/host` `test/int/proposals.int.test.ts`(실제 SQLite 투영, 승인 전 파일 0, 승인 창 없음) |
| X3 S1 무수정 | 충족 | `bun scripts/core-diff-check.ts efe8d83 --head dc920ae`: 바뀐 경로 91개 중 contracts·ext-host·platform-*·core-* 0개. 학습 그룹에 필요한 하위 층 변경은 별도 트랙(T-X4·T-X5·T-X6)으로 먼저 들어갔다 |
| T-F1 확장 지점 개정 | 충족 | 옛 이름 리터럴 0(grep), `contracts/test/extensions/points.doc.test.ts`가 `F.extensions.spec` §3.4 표와 일치 |
| T-C `@xeon/client` | 충족 | CLI·데스크톱이 `@xeon/client`로 접속, 사이드카 e2e(E2·E3) 통과 |
| T-X1 로더·안전 모드 | 충족 | `ext-host/test/loading-trust/external-loader.int.test.ts`, `group-helm/test/int/plugin.int.test.ts` |
| T-X2·T-K 재생 2회 효과 1회 | 부분 | `group-kit/test/replay.test.ts`, Helm·학습 `replay.test.ts`. group-kit 하네스가 능력 쓰기 효과를 세지 않는다(Helm은 자체 하네스로 셈). M3b B4-GRP |
| T-L1a 위임·판정 | 충족 | `core-agents/test/delegate.test.ts`, `cap-work/test/goals-gate.test.ts`. 실제 core-loop 경로 시험은 M3b B1-NTF(X6) |
| Mac 실기 | 부분 | 데스크톱에서 Helm 기본 플러그인 첫 실행 설치 확인. 데스크톱이 슬래시 명령을 `command.run`으로 보내지 않아 `/helm`이 채팅으로 갔다(M3b B3-SET). CLI에서 엔진 명령 목록에 `helm`·`learning` 확인, `/helm start` 뒤 drive가 다음 입력까지 멈추는 결함을 찾아 고쳤다(`e3ce1db`). 수정 뒤 Mac 재확인은 M3b 사용자 묶음 |

- M3a 중 추가된 트랙: T-X4(M3-REQ-102 ambient), T-X5(`loop.spawn` 실구현 등 Helm이 찾은 하위 층 틈), T-X6(M3-REQ-78 확장 도구 위험 선언). 하위 요구가 트랙에 배정되지 않아 생긴 일이라 M3b는 차수마다 요구 장부 검사를 둔다(`review.m3b-plan` §3.3).
- 이월: `review.m3b-plan` §2 각 트랙의 "이월" 항목.


## 9. M3b 마감 판정 (2026-10-29)

- 범위: `61f137b..17374466`(M3a 마감 뒤 M3b 전체, 389커밋). 트랙 브랜치는 모두 `xeon/foundation`에 병합됐습니다(B1-SCH2, B3-FIX, B3-SEC2, B5-FIX2 포함).
- 마감 검증: `just verify-full`은 오케스트레이터가 주 체크아웃에서 돌립니다(결과는 그쪽 보고에 따릅니다). 이 절의 판정은 B6 검토 담당이 종료 조건 줄마다 시험 파일을 읽고 `just test <패키지>`로 돌린 결과입니다. 패키지 시험은 turbo 캐시(소스 해시가 같은 앞선 실행) 재생을 포함합니다.
- `just exit-tests`: 26줄 가운데 26줄 ok, 건너뜀 0(사이드카 바이너리가 없을 때 스크립트가 먼저 빌드한 상태). 사이드카 바이너리가 이미 있고 X11 스모크가 만든 `0.0.0-smoke` 판이면 E2·E3 줄이 실패합니다(§9.4 알려진 결함).

- 요구 장부: `M3b:<트랙 id>` 60행 중 43행을 `M3b`(완료), 16행을 `M4`로 옮겼습니다(사유는 `review.m3-lower-requirements` §10). 합계는 M3a 53, M3b 43, M4 16이고 `just req-ledger`는 문제 0입니다. `[미결]`로 남긴 행은 없습니다.

### 9.1 종료 조건 X4~X11

| 조건 | 판정 | 근거 |
|---|---|---|
| X4 서비스 유휴·예약 실행(UC-4) | 충족 | `exit-tests` X4 줄(16 통과): `apps/host` `test/int/service-schedule.int.test.ts`(연결 0, 대기 예약 1에서 유예를 3번 지나도 유휴 종료 없음, 기한 뒤 틱이 실행을 기록하고 끝나면 유예 뒤 종료), `service-idle.int.test.ts`(연결이 있으면 종료하지 않고 0이 되면 유예 뒤 종료, 재연결이 계획을 취소), `service-schedule-wire.int.test.ts`(소켓 너머 `schedule.create/list/cancel/fire`, 손상된 상태 파일은 `store_failed`와 바이트 보존), `service-lifecycle.int.test.ts`. 단서: 유예와 시계는 가짜 시간입니다. 승인 대기 세션 때문에 종료하지 않는 경우는 `service-idle`이 다루는 범위만 확인했습니다 |
| X5 SSH 터널 원격 사용(UC-5) | 충족(실기 제외) | `apps/host` `test/int/service-transport.int.test.ts`(3 통과): `socat` 중계 가짜 터널 너머 클라이언트가 `thread.list`, `thread.create`, `turn.start`, `approval.respond`를 하고 두 번째 터널 클라이언트가 같은 세션을 이어받음. 서비스 리스너가 루프백 TCP와 Unix 소켓뿐임을 `/proc` 값으로 확인. 단서: `/proc`을 못 읽는 OS(macOS)에서는 리스너 확인이 건너뛰어집니다. 실제 호스트·ssh 확인은 사용자 묶음 |
| X6 목표 판정 `maxRuns` | 충족 | `apps/host` `test/int/goal-judge.int.test.ts`(1 통과): 실제 core-loop에서 판정 3회 뒤 `limit_reached`, `turn.completed` 1건, 두 클라이언트가 알림 1건씩 수신, 테이프 불일치 0 |
| X7 모델 계정 설정 저장(I14) | 충족(재범위) | `packages/client` `test/accounts/x7.test.ts`(6), `packages/core-models` `test/rotation.test.ts`(15), `apps/host` `test/int/x7-settings-file.int.test.ts`(3): view-model 편집이 실제 `settings.writeFile`을 거쳐 사용자 파일에 같은 키로 저장, 사이에 바뀐 파일은 `conflict`와 상대 편집 보존, 스키마를 못 지나는 값은 `settings.fileInvalid`와 파일 무변경. 화면은 M4 |
| X8 비밀 재인증 뒤 열람(UC-6) | 충족(재범위) | `packages/client` `test/settings/x8.test.ts`(9): 가짜 재인증 성공 뒤 값 상태, 실패는 값 없음, 값은 직렬화에 없고 `clear()`가 바이트를 지움, 표시 시간이 지나면 숨김, wire 어댑터는 값을 view-model에 넘기지 않음. 단서: 실제 재인증(os-auth Touch ID)과 서비스에 붙은 상태의 비밀 열람(§9.3 사용자 결정 3)은 확인하지 못했습니다 |
| X9 검색 provider 상태·키 플러그인 권장 | 충족(분할) | `apps/cli` `test/doctor-web.test.ts`(13)가 `xeon doctor` 출력(Exa·Brave 권장 상태, provider 순서, 고정 provider), `packages/client` `test/web/tools-web.test.ts`(16)가 "도구와 웹" view-model. SearXNG 항목은 계획에서 뺐습니다. 단서: Playwright MCP 도구 이름은 [가정]이고 실제 서버로 확인하지 않았습니다 |
| X10 설정 키 집합 일치 | 충족(재범위) | `apps/cli` `test/x10-settings-keys.int.test.ts`(1): 파일 스키마 키 = `config list` 키 = view-model 항목 키. 예약된(`reserved`) 학습 curator 키 4개는 스키마에만 있고 쓰기를 거부하는 것까지 값으로 확인. 화면 렌더는 M4 |
| X11 macOS·Linux 같은 릴리즈 스모크 | 부분 | `scripts/release-smoke.test.ts`(1): Linux x86_64에서 릴리즈 아카이브 빌드와 스모크 통과(로컬 실행). `.github/workflows/xeon-macos.yml`의 macOS arm64 job(`just release-smoke`)과 `xeon-release.yml`은 아직 돌지 않았습니다. 서명·공증과 Mac 실기는 사용자 묶음 |

- 시험 실행: `apps/host` 788 통과·1 건너뜀, `packages/client` 213, `packages/core-models` 268, `apps/cli` 661 통과·1 건너뜀, `scripts` 187. 실패 0. 건너뛴 2개는 종료 조건 줄 밖의 시험입니다.

### 9.2 트랙 결과

| 트랙 | 결과 | 남은 것 |
|---|---|---|
| B0 F·OS·SBX·LED | 완료. 계약, 플랫폼 층, 요구 장부와 `just req-ledger` | `@parcel/watcher`·FormatJS·Stagehand 어댑터는 의존 승인 뒤 |
| B1 SVC·SCH(+SCH2)·NTF·WS | 완료. 서비스 모드, 예약(`schedule.*` wire, CLI), 알림, 쓰기 도구 | 끊김 뒤 재생, cron·시간대, 예약 도구, 쓰기 때 실행 비트(M4 이월 표) |
| B2 RMT·ART·MDL·WEB | 완료. 원격 전송, 산출물 리뷰, 계정 회전, 검색·브라우즈 provider | 산출물 wire 메서드 없음, 회전 상태 메모리 전용 |
| B3 SEC(+SEC2)·SET·DATA·L1M·FIX | 완료. 설정 view-model, `db export`, 블롭 고정·GC(기본 꺼짐), 위임·재주입 | 설정 키 26개 읽는 코드 없음(사용자 결정), 블롭 GC 켜기 |
| B4 GRP·I18N·DSK | 완료. 그룹 계측, 문자열 이전, 사이드카 정리 | 데스크톱이 로케일을 정하지 않음(§9.5), 하위 층 문장 통과 |
| B5 REL·PERF·CLN·DOC(+FIX2) | 완료. 릴리즈 스모크, 성능 게이트 골격, 정리, 운영 문서 | 서버 예산 수치(사용자 결정), macOS 릴리즈 경로 미실행 |

- M3b 중 추가된 트랙: B1-SCH2(예약 wire·CLI·X4 끝 시험), B3-FIX(cap-knowledge·cap-web·cap-workspace의 블롭 고정 틈과 사용량 게이지 수정), B3-SEC2(MCP stdio 샌드박스 연결), B5-FIX2(S-15 자리표시 참조, 반복 감지 설정). 계획에 선언이 없었고 B5-DOC이 지적해 `review.m3b-plan` §2에 적었습니다.

### 9.3 M4로 넘기는 것 (영역별, 중복 없음)

출처는 트랙 리드 보고에서 모은 이월 목록입니다. 한 항목은 한 영역에만 둡니다.

| 영역 | 항목 |
|---|---|
| 서비스·원격 | 끊긴 터널 뒤 재생(`createReplayResolver`, `modelRequestResendOf`의 host 연결, `thread.open replayFrom` F 필드). `resolveLaunchMode` managed 파일 위치. 프로젝트 확장의 공유 promise·AbortSignal. 서비스에 붙은 상태의 `secret add/set/rotate/reveal`(서비스 쪽 입력 창이 필요: OS 대화상자·pinentry). TCP 토큰은 `XEON_REMOTE_TOKEN`만. IPv6 리터럴 거부. 터널 SIGKILL 2000ms 시험 없음. 서비스 TCP 토큰 회전 명령 없음 |
| 예약·알림 | cron 식·시간대. `schedule.create`의 `requestId` 멱등. `schedule_list`·`schedule_cancel` 모델 도구. `schedule.*` 이벤트 발신자와 다중 프로세스 틱 임대(HS-39/40). `awaiting_approval` 결과 신호. 발화 claim 저장 실패가 `store_failed`가 아니라 `failed`로 나옴. commit이 저장보다 메모리를 먼저 적용. `handler_failed`와 `dialog.status`의 n 카운터 분리. CLI "[완료]" 소음. 종료 때 늦은 `notify.delivered` 유실. 창이 앞에 있을 때 알림 억제(D-6). 검토 승인 요청 알림 없음. `handler_failed` 데스크톱 표시 |
| 작업 공간·산출물 | 원자적 이름 바꾸기가 실행 비트·하드링크를 잃음(L0.exec 미결 14). 남은 임시 파일 정리. 산출물 wire 메서드(F), `titleSource`, `retentionDays`, `reviews.autoRequest`, `fuzzLines`, export·handoff, `ArtifactService` §3.9. `artifact_update`가 `mediaType`을 지움. 리뷰 재시작 복구. 병렬 배치 순서. 삭제·바이너리·이름 바꾸기·새 파일 hunk |
| 모델·웹 | 회전 상태가 메모리 전용(`core_models_*` 표). `reservePct` 미공급. 위장 provider 와이어 동등성 래퍼(M-8). DR-09·`L1.models.spec` §3.11이 옛 결정을 서술. `routing.*` 문제 점검. Playwright MCP 도구 이름 실서버 확인. `orderUpdateOf` 부분 목록. 헤더 비밀 설정의 `ext.<ext>.<key>` 카탈로그. 첫 사용 고지가 호출 뒤 경고. 바이너리 본문 echo 검사. `browse-close` int 시험. 인증 종류 `query` 등록 거부와 F 스키마 불일치. 사용량 게이지가 메모리 전용이고 창·한도·계정 게이지는 비어 있음(HS §10-46) |
| 보안·샌드박스 | 시작 승인 증거가 메모리 전용(재시작·다른 thread에서 다시 물음). 새 MCP 도구가 한 단계 늦게 보임. 비밀 메타가 `mcp.start:*`를 허용해야 함. 샌드박스 설정만 바꿔서는 막힌 서버가 풀리지 않음(L2 mcp §10-15). `wrapArgv`가 위반을 모으지 않음. srt `cleanupAfterCommand`가 프로세스 전역. macOS Seatbelt 실기. ADR-0011에 M3 재결정 주석. `lastError`가 성공 뒤 지워지지 않음. ext-host `restoreAs` 넓힌 캐스트(TY-06). `load-generated.ts`의 `as GroupModule`(TY-06 승인) |
| 설정 | 설정 탭 13개와 spec 12개 불일치. managed `readFile`이 빈 읽기 전용을 돌려줌. `writeFile`이 provider 비밀을 다시 잇지 않음(HS-45). project·local 파일 감시 없음. 설정 쓰기 reducer·초안. `settings.invalidated`에 thread 필터 없음. `l4.ui.locale` 저장값을 엔진 연결 전에 읽지 않음. `unitKey`(contracts) |
| 데이터 | 블롭 GC 기본 꺼짐(`blobGcEnabled=false`, 켜려면 넓은 감사와 긴 GC 시험). GC는 서비스 모드에서만(HS-40). 자동 제목 출처 메모리 전용. `L0.store` S-13·S-14와 export ENOENT 경합. `apps/cli`가 `@xeon/platform-store`를 import(spec은 host만). `cap.*` 투영기 격리(L1 §10-19). 진단 배열의 wire 소비자 없음. "1 blobs" 문구. cap-knowledge 고정 전 행. cap-web 고정 해제→고정 틈. group-kit `delegate`가 signal을 받고 무시 |
| L1·그룹 | 검토 포크 system-prompt 공유(`SpawnRequest` 옵션)와 REQ-70 fork 사용량 귀속. 컴팩션 뒤 skill 본문 재주입 없음. M3-21 잔여. 저장된 자식 취소가 보고 입력을 큐에 넣지 않음. 재생 하네스 thread id 불일치 오류 종류(§3.10). `delegateStatus` 소유자 범위. 다중 thread 사용량 표시. 생성된 `package.json` 의존. 내장 그룹 이름이 `runtime.ts`에 복사됨. `test/.generated` 잔여. §3.3.5 편차. S-02 참조 정책 플러그인 미구현. 반복 감지 임계는 실제 테이프 필요, 전체 오류 연속 모호, 재개 때 연속 초기화, `storedOutcome`이 feed를 seq 0부터 훑음 |
| 데스크톱 | `desktop_settings_read/write`. 트레이 아이콘·메뉴 없음. Mac 확인 항목(트레이 닫기 e2e D-10, 두 번째 실행 재열기 D-13, `RunEvent::Reopen` 컴파일, Finder PATH sops·age·rg와 `xeon secret add`, 디버그 로그 내용, §4.15 릴리즈 점검). Cmd+Q가 `ExitRequested`를 건너뛸 수 있음 [미확인]. Tauri 번들 자원 매핑. 인앱 업데이터. 화면 컴포넌트 전부(`M3b` 계획 §1.2) |
| i18n | 하위 층 문장 통과: cap-dialog classify, cap-work commands, platform-os binaries requirements/resolve, web probe detail, group-account-rotation manifest, 하위 층 라벨 198줄. 데스크톱 `errorOf` 이슈 메시지. `db.ts:58` 영어 리터럴 |
| 성능·릴리즈 | 서버 예산 수치(§9.4 사용자 결정). macOS 기준선. 재주입 파일 상한 8000과 `keepRecentTokens`. REQ-64 `synchronous=NORMAL` 비교와 `processStartFingerprint` 타이밍. 부하 중 측정한 수치는 참고용. SHA256SUMS 무서명. gitleaks가 xeon 워크플로에 없음(M3-30 절반). `release-sign.sh` 키체인 목록 복원 안 함. macOS 릴리즈 경로 미실행. `L0.os` §3.6·§10-3 번들 정책 문구 |
| 정리·문서 | host-service의 `xeon.domain` 거부(DR-03, L4 규칙 결정). cli가 `@xeon/group-kit`을 시험에만 씀(devDependencies로). E-01·02·04·05, N-07(`requestKeyFor` 48 대 `requestCommitKey` 64), V-05 잔여. `F/README:207`의 `check-points-doc.ts` 없음. m3-design-inputs G-IN-13·H-IN-17 상태 칸. `Reflect.get` src 약 50곳(22 파일, L4 4곳)은 타입 있는 도우미 설계 필요. B5-DOC 미결: 설치 위치·PATH, `l0.os.dirs.override`, 로그 회전과 `OsDirs log`, `XEON_SAFE_MODE`·`/safe-mode`·`--disable-ext`, `engine.ts`가 `future_version`·`corrupt`·`migration_failed`를 구분하지 않음, 읽기 전용 열기 명령, 복원·`store.corrupt` 절차, `schedule/state.json` 복구 도구, 자동 비활성 확장 재활성 CLI, `secret add --provider` 허용값, `l2.web.cache.maxMegabytes` 미구현, `trust.json` 위치 불일치, 시험 메모리 상한 문서, docs-route 경고 6(operations id 이름) |
| 인프라 | caustic 비공개 submodule: CI에 `CAUSTIC_READ_TOKEN`(fine-grained PAT)을 Dependabot 비밀로도 등록, auto-merge와 필수 검사. Dependabot이 `bun.lock`을 갱신하지 않음(`just caustic-update`). 루트 lefthook·oxlint가 `apps/desktop/mockups`를 제외 |

### 9.4 사용자 결정 묶음과 알려진 불안정 시험

사용자 결정(`review.m3b-plan` §4와 이월 목록의 사용자 결정 표시):

1. Mac 실기: os-auth Touch ID 열람 재인증(M3-m2c-01, X8 실기), `composer.tsx` IME, 데스크톱 슬래시 명령 라우팅, macOS 알림, X11 Mac 앱 스모크와 macOS job 첫 실행, `fullfsync`·`processStartFingerprint`(64), M3-new-16 Mac 몫, 위 데스크톱 행의 Mac 확인 항목.
2. 서버 예산 수치 6개(`SERVER_BUDGET`, `bench-gate --strict`, macOS 기준선 뒤).
3. 서명·공증 비밀(Apple Developer ID, CI 서명)을 `just secret-add`로 등록. 끝나면 서명 단계가 건너뛰지 않고 돕니다.
4. 새 외부 의존 승인: `@parcel/watcher`(48), FormatJS(ADR-0016), Stagehand(96). 승인되면 각 어댑터 1커밋.
5. 실제 원격 확인: 서버에서 `xeon service`를 켜고 다른 기기에서 SSH 터널 접속(`ws on`), 키체인 없는 서버의 Secret Service 키(m2c-04 b).
6. `L4/README.md`의 낡은 설정 경로와 §8 도메인 수(README 수정 금지라 사용자 몫).
7. `[결정: 오케스트레이터 기본값]` 검토: X4~X11 번호와 재범위, M3-40 M4 이월, 새 의존 승인 전 대체 구현 3건, 위장·회전 플러그인 위치.
8. P-13: `--listen-tcp`의 비루프백 주소는 `--allow-non-loopback` 없이는 거부합니다. X5·T-10 문구와 맞출지 결정.
9. ADR-0020 §3.5: `apps/host`가 `@xeon/client/endpoint`·`socket`을 import합니다(DR-10 확대). 유지할지 결정.
10. M3-34: 읽는 코드가 없는 설정 키 26개와 읽기만 하고 쓰지 않는 5개(전체 242개)를 지울지 결정.
11. `schedule.entries` 새 능력 id, `schedule_create` 위험 `exec`, `service_mode_off` 경고, CLI 한도, `add --remote`가 전역 `--remote`를 가림, `--auto-approve`는 도구 승인에만 적용(D-M3-14 b보다 좁음)의 사용자 확인.
12. 배포 고지: age BSD-3 저작권 문구(notices).
13. 반복 감지 임계(`l1.loop.repeat.*`)는 `just tape-record --yes`로 실제 테이프를 만든 뒤 조정.
14. 블롭 GC 켜기(`blobGcEnabled`) 시점.
15. `apps/cli`의 `@xeon/platform-store` import, host-service의 `xeon.domain`(DR-03), `Reflect.get` 도우미 설계 같은 층 규칙 결정.

알려진 불안정 시험:

- `core-models`가 부하 중 두 번 실패했습니다(시험 이름 기록 없음). 이 마감 실행은 268 통과입니다.
- `cap-mcp`의 HTTP 연결 시험.
- `ensure-sidecar.test.ts`가 부하 중 5초 제한에 한 번 걸렸습니다.
- 종료 조건 줄 순서 문제(결정적): `scripts/release-smoke.test.ts`(X11)가 개발용 사이드카 바이너리(`apps/desktop/src-tauri/binaries/xeon-<triple>`)를 `0.0.0-smoke`로 덮어씁니다. 그 뒤 `just exit-tests`는 바이너리가 이미 있다고 보고 다시 빌드하지 않아, `apps/desktop` `test/e2e/sidecar.e2e.test.ts`의 E2가 `version "0.0.0"` 대 `"0.0.0-smoke"`로 실패합니다(`just test scripts` 뒤 첫 실행에서 확인했고, 바이너리를 지우고 다시 돌리면 26/26). `just test apps/desktop`(사이드카 e2e)이 `scripts` 시험 뒤에 돌면(`just verify-full`의 시험 단계) 같은 판 불일치가 날 수 있습니다. 확인하지 못했습니다.

### 9.5 첫 릴리즈 후보를 막는 결함

| 결함 | 위치 | 영향 |
|---|---|---|
| 데스크톱이 `setActiveLocale`을 부르지 않습니다 | `apps/desktop/src/main.tsx:43`(렌더 전 로케일 설정 없음, `apps/desktop/src`에서 `setActiveLocale`·`resolveLocale` 호출 0). 기본 번역기는 `packages/client/src/i18n/translator.ts:31`의 `"en"`입니다 | 이전한 문장이 `ui.locale`과 무관하게 영어로 나옵니다. CLI는 `apps/cli/src/main.ts:22`에서 부릅니다 |
| `exit-tests`가 X11 뒤 남은 사이드카에서 실패 | `xeon/scripts/exit-tests.ts`(바이너리가 있으면 재빌드하지 않음), `xeon/scripts/release.ts:246`(`--version`을 같은 경로 바이너리에 주입) | `scripts` 시험 뒤에 사이드카 e2e나 `exit-tests`가 돌면 E2가 거짓 실패합니다. 릴리즈 스모크가 다른 출력 위치를 쓰거나 exit-tests가 버전을 확인하게 고쳐야 합니다 |
