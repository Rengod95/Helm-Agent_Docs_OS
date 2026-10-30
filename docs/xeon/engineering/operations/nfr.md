---
id: eng.operations.nfr
layer: eng
domain: operations
kind: guide
status: draft
depends_on: [eng.performance.guide, eng.testing.guide, eng.onboarding.guide, adr.0004, adr.0011, adr.0012, adr.0016, architecture.security.spec, F.wire-settings.spec, F.records.spec, X.loading-trust.spec, L0.os.spec, L0.store.spec, L0.secrets.spec, L0.sandbox.spec, L1.persistence.spec, L2.web.spec, L4.host-service.spec, L4.release.spec, review.m3-design-inputs, review.m3b-plan, eng.operations.recovery, eng.operations.runbook, eng.domain-types.guide]
binds: []
---

# 비기능 요구

이 문서는 기능 요구가 아닌 요구를 모읍니다. 성능, 크기와 플랫폼, 신뢰성, 보안, 호환성, 다국어, 관측성, 접근성입니다. 각 항목 끝의 괄호는 근거입니다. 표지 `[결정]`, `[제안]`, `[가정]`, `[미결]`은 원문의 것을 그대로 옮겼습니다.

성능 수치는 참고 수치입니다. 예산은 아직 정하지 않았습니다. 예산을 정할 사용자 결정은 `[미결]`입니다.

## 1. 성능

### 1.1 예산 상태

- 모든 예산 칸은 `[미결]`이고 사용자 결정 대기입니다(`eng.performance.guide` §2, §2.1). 2026-10-29 기준입니다.
- 예산을 정하면 `xeon/scripts/bench.ts`의 `BUDGET_MS`(§2)와 `xeon/scripts/bench-server.ts`의 `SERVER_BUDGET`(§2.1)을 같은 커밋에서 고칩니다(`eng.performance.guide` PF-03).
- M3에서 예산을 넘으면 실패하는 게이트로 바꿉니다(`eng.performance.guide` §1). `just bench-gate`는 `--strict`가 없으면 예산 대기를 실패로 보지 않습니다. `--strict`를 주면 예산 대기도 실패로 봅니다(`eng.performance.guide` §4).

### 1.2 측정 레시피

- `just bench`: 콜드 스타트와 첫 토큰을 잽니다. `just bench --server`: 서버 측정을 돌립니다. `just bench-gate`: 서버 측정 결과로 게이트를 돌립니다(`eng.performance.guide` §1).
- `just bench --first-token`은 실제 provider를 부릅니다. 비용과 키가 들어가므로 사람이 확인한 뒤 `--yes`로 한 번만 돌립니다(`eng.performance.guide` PF-02).
- 측정 기기와 날짜는 표 바로 위에 적었습니다. 기기가 다르면 값을 비교하지 않습니다(`eng.performance.guide` PF-03).

### 1.3 참고 수치: 콜드 스타트와 첫 토큰 (`eng.performance.guide` §2)

원표의 기준선 열에 기기와 날짜가 들어 있습니다. 값과 문장은 원표를 그대로 옮겼습니다. 마지막 열은 이 문서가 붙인 표지입니다.

| 지표 | 뜻 | 측정 | 기준선 | 예산 | 비고 | 표지 |
|---|---|---|---|---|---|---|
| `cold_start_cli` | `bun apps/cli/src/main.ts version --json` 시작부터 종료까지 | `just bench` | WSL2 중앙값 143.6 ms(3회, 2026-10-25). 서버(WSL2) 중앙값 189.8 ms(2026-10-27) | [미결] | 번들 전 소스 진입. 모듈 적재 비용을 봅니다 | 참고 수치(indicative) |
| `cold_start_sidecar` | 컴파일한 사이드카 `xeon-<triple> version --json` 시작부터 종료까지 | `just desktop-sidecar host` 뒤 `just bench` | WSL2 약 131 ms(`--bytecode`, `L4.desktop.plan` §3 spike S2). 서버(WSL2) 중앙값 46.9 ms(2026-10-27) | [미결] | macOS 값은 `review.macos-checklist` M-07 | 참고 수치(indicative) |
| `first_token` | `xeon chat -p` 시작부터 첫 `stream.chunk` 알림까지 | `just bench --first-token --yes` | 서버(WSL2) 1289.5 ms(1회, 실제 provider, 2026-10-27) | [미결] | 실제 모델 호출. 사용자 확인 뒤 1회(결정 D-e) | 참고 수치(indicative) |
| 사이드카 크기 | triple별 바이너리 크기 | `just desktop-sidecar <triple>` | WSL2 `x86_64-unknown-linux-gnu` 109.8 MiB(T7, `L4.desktop.plan` 구현 기록), macOS 26.5.2 `aarch64-apple-darwin` 91.0 MiB(`ws mac` 작업 20261025-224508-0141) | 500 MiB(회귀 상한) | ADR-0012 §3 2번. 줄이는 목표가 아닙니다. macOS 값은 `review.macos-checklist` M-07 | 참고 수치(indicative) |


### 1.4 참고 수치: 서버 측정 (`eng.performance.guide` §2.1)

측정 기기는 WSL2(Linux 6.18, 12 CPU, 디스크 ext4), 측정일은 2026-10-29입니다. 다른 에이전트가 함께 돌던 기기 부하(load average 9~16)에서 쟀습니다. 꼬리 값(p90, 최대)은 부하 때문에 흔들려서 기준선이 아닙니다. 값과 문장은 원표를 그대로 옮겼습니다.

| 지표 | 뜻 | 중앙값 | p90 | 판정 | 예산 | 근거 요구 | 표지 |
|---|---|---|---|---|---|---|---|
| `index_build_200_skills` | 스킬 200개로 인덱스 블록 만들기(호출 1회) | 0.013 ms | 0.031 ms | 판정 대상 | 사용자 결정 대기 | M3-REQ-98 | 참고 수치(indicative) |
| `like_scan_2char_20000_docs` | 2글자 질의의 세션 LIKE 탐색(문서 20,000개 전체 훑기) | 23~28 ms | 30 ms | 참고 | 없음 | M3-REQ-98 | 참고 수치(indicative) |
| `index_fit_<N>_skills` | 8,000자 예산에 실리는 스킬 수(설명 160자) | 33개(N≥40) | 해당 없음 | 참고 | 없음 | M3-REQ-98 | 참고 수치(indicative) |
| `index_fit_<N>_skills_desc60` | 같은 예산에 설명 60자일 때 | 57개(N≥80) | 해당 없음 | 참고 | 없음 | M3-REQ-98 | 참고 수치(indicative) |
| `lease_turn_overhead` | 임대 그룹이 있을 때 turn당 추가 시간(메모리 호스트, 저장소 I/O 없음) | 0.017~0.022 ms | 0.07~0.08 ms | 판정 대상 | 사용자 결정 대기 | M3-REQ-41 | 참고 수치(indicative) |
| `lease_records_per_turn` | turn당 추가 기록(`lease.acquired`·`lease.released`) | 0.667개 | 해당 없음 | 참고 | 없음 | M3-REQ-41 | 참고 수치(indicative) |
| `dispatch_overhead_per_handler` | 빈 tap 핸들러 하나를 예산 정책(`OperationsPolicy`)으로 돌린 시간 − 정책 없는 시간 | 0 ms(−0.004~0.000) | 0.013 ms | 판정 대상 | 사용자 결정 대기 | M3-REQ-40 | 참고 수치(indicative) |
| `store_commit_event` | 사용자 item 이벤트 커밋 1건(`synchronous=FULL`, WAL, 디스크) | 5.4~7.0 ms | 12.7 ms | 판정 대상 | 사용자 결정 대기 | M3-REQ-64, M3-29 | 참고 수치(indicative) |
| `thread_read_1k_items` | 활성 가지 item 1,000개 읽기(`readBranch`) | 5.6~6.1 ms | 8.4 ms | 판정 대상 | 사용자 결정 대기 | M3-29 | 참고 수치(indicative) |
| `projector_rebuild_10k_events` | 코어 투영기 재생성(이벤트 10,000개) | 217~565 ms | 482~837 ms | 판정 대상 | 사용자 결정 대기 | M3-new-18 | 참고 수치(indicative) |
| `projector_rebuild_events_per_sec` | 재생성 처리량 | 17,700~46,000 건/초 | 해당 없음 | 참고 | 없음 | M3-new-18 | 참고 수치(indicative) |
| `reinject_tokens_5_files_<크기>` | 컴팩션 뒤 최근 파일 5개 재주입의 추정 토큰(글자/3.5) | 2,000자 2,935 / 8,000자 11,510 / 16,000자 이상 22,935 | 해당 없음 | 참고 | 없음 | M3-new-18 | 참고 수치(indicative) |
| `recent_files_compute_2000_items` | 재주입 후보 계산(branch 2,000 item) | 0.026~0.046 ms | 0.05 ms | 참고 | 없음 | M3-new-18 | 참고 수치(indicative) |


## 2. 크기와 지원 플랫폼

### 2.1 사이드카 크기 상한

- 사이드카 크기 상한은 triple별 500 MiB입니다(`adr.0012` §3 2번). 회귀를 잡는 상한이고, 크기를 줄이는 목표가 아닙니다.
- 실행 체감 속도(빠른 시작과 종료, 끊김 없는 응답)를 앱 크기보다 우선합니다(`adr.0012` §1, 사용자 결정 2026-10-24).
- 측정값은 §1.3의 "사이드카 크기" 행을 봅니다.

### 2.2 지원 플랫폼

`review.m3-design-inputs` D-M3-25 행 1~6의 `[결정 2026-10-26]`입니다.

| triple | 상태 | 외부 바이너리 | 근거 |
|---|---|---|---|
| `aarch64-apple-darwin` | macOS 14 이상 arm64 지원 | sops, age, rg를 아카이브에 번들하고 서명합니다. 버전은 `eng.operations.runbook` §1.1 | `L4.release.spec` §3.4, D-M3-25 행 1·3 |
| `x86_64-unknown-linux-gnu` | Linux x86_64 지원. X11 스모크를 CI에서 돌립니다 | 시스템 패키지 rg, bwrap, socat을 설치합니다 | `L4.release.spec` §3.3~§3.4 |
| `aarch64-unknown-linux-gnu` | 빌드 대상. 스모크 검사가 없습니다 `[미결]` | 시스템 패키지 | `L4.release.spec` §3.4, §8.2 7번 |
| `x86_64-apple-darwin` | Intel macOS는 지원하지 않습니다. 빌드하지 않습니다 | 해당 없음 | D-M3-25 행 2 |
| `x86_64-pc-windows-msvc` | 범위 밖입니다 | 해당 없음 | `L4.release.spec` §1.2 |

- 최소 macOS 버전은 D-M3-25 행 3에 권고 13과 결정 14가 있습니다. 결정 14를 따릅니다. 권고 13은 `[가정]`이었습니다.
- Windows 서명과 npm 공개는 범위 밖입니다(D-M3-25 행 6, `L4.release.spec` §1.2).

### 2.3 개발 기기의 메모리와 시간 상한

- `just test`는 패키지를 하나씩 메모리 상한 아래에서 돌립니다. `just verify`는 단계마다 메모리 상한을 둡니다(`eng.onboarding.guide` ON-02, ON-03, `eng.testing.guide`).
- 온보딩 가이드의 값은 단계 2G, 패키지 시험 1.5G, 시간 상한 300초입니다. `scripts/guard.sh`의 기본값은 run 1500M, verify 3G, run 시간 900초입니다. 두 값이 다릅니다. 레시피가 넘기는 값을 확인하지 않았습니다 `[미결]`.
- 온보딩 가이드는 여러 시험, 빌드, cargo, 브라우저를 동시에 돌리지 말라고 적고, 작은 기기에서는 VM이 멈춘다고 적습니다. 그래서 상한을 둡니다(`eng.onboarding.guide` ON-03).

## 3. 신뢰성

- 단계 경계 커밋은 한 트랜잭션입니다. 쓰기 연결은 항상 `synchronous=FULL`입니다. WAL에서 FULL은 커밋마다 WAL을 한 번 더 동기화해 정전 뒤에도 커밋을 보존합니다(`L0.store.spec` §4.3, `adr.0004`).
- 블롭 쓰기는 임시 파일을 `wx`로 열어 쓰고, `fsync`, `rename`, 디렉터리 `fsync` 순서입니다. 이벤트 커밋 전에 끝나야 합니다(`L0.store.spec` §4.9).
- 한 thread의 쓰기 소유는 OS 잠금과 `sys_leases.epoch` 펜싱으로 지킵니다. Linux 두 프로세스 시험이 실측되었습니다(`L0.store.spec` §4.7, `architecture.security.spec` T-12).
- 프로세스 사이의 파일 쓰기는 `fileLock`으로 막습니다. 대상은 `settings.json`과 `trust.json`입니다(`L0.os.spec` §3.11, M3-REQ-51). 설정 파일 쓰기의 잠금 적용은 B3-SET 이월입니다.
- 마이그레이션 전에 스냅샷을 만들고, 실패하면 어떤 단계도 실행하지 않습니다. 같은 DB의 스냅샷은 최근 3개만 남깁니다(`L0.store.spec` §4.6.1).
- 더 새 버전이 만든 DB는 읽기 전용으로 엽니다(`L0.store.spec` §4.11, `eng.operations.recovery` §3).
- 복구 절차는 `eng.operations.recovery`가 맡습니다. 손상된 예약 상태, 투영기 실패, 설정 충돌, 저장 스키마 위반, 마이그레이션 스냅샷, DB 내보내기를 다룹니다.
- 알려진 한계는 `eng.operations.status-map` §5에 있습니다. 예를 들어 터널이 끊긴 뒤 재연결하면 replay가 없습니다(이월 B1-SVC). 원자적 쓰기는 실행 권한과 하드 링크를 잃을 수 있습니다(이월 B1-WS).

## 4. 보안

위협 목록과 통제는 `architecture.security.spec` §4(T-01~T-15)가 정본입니다. 여기서는 NFR 관점의 요점만 적습니다. 근거 상태(실측, 가짜, 없음, 미구현)는 그 문서의 열을 봅니다.

- 샌드박스: Linux는 bubblewrap과 socat, macOS는 Seatbelt를 씁니다. 샌드박스를 쓸 수 없는 기기(Windows 네이티브, WSL1, socat 없음)는 기본값에서 셸 도구가 꺼집니다. 사용자가 격리 없이 실행을 고르면 도구 결과에 `unsandboxedBy`가 남습니다(`architecture.security.spec` §5, T-02, `L0.sandbox.spec`).
- macOS Seatbelt는 실기 확인 전입니다(이월 B3-SEC2). 근거 상태 "실측"은 실제 바이너리와 OS로 시험했다는 뜻입니다(`architecture.security.spec` §2).
- 프로젝트 신뢰: 판정 전에는 프로젝트 확장, MCP 정의, 스킬, 설정을 읽지 않습니다. 판정 순서와 결과 저장은 `X.loading-trust.spec` §4.7이 정합니다(T-03).
- 확장 권한: 신뢰 등급과 허용 연산 표로 확장이 할 수 있는 일을 정합니다. 외부 확장 로더는 M3에 있습니다. 비협조 확장 코드의 격리는 M4입니다(T-09, M3-REQ-34).
- 비밀: 참조만 넘기고 값은 넘기지 않습니다. 로그, 이벤트, 모델 입력, 외부 전송은 마스킹 계층을 거칩니다. `reveal`의 재인증 증거는 60초 안이어야 합니다(`L0.secrets.spec` §3.8, §4.4, T-05, T-06). `os-auth`는 macOS에서 실기 확인 전입니다.
- 네트워크: 웹 가져오기는 기본 승인이고 대화에 나온 URL만 허용합니다. 사설망과 메타데이터 주소를 막습니다(`L2.web.spec` §4.6, T-01, T-07).
- 원격: 서비스는 비루프백 리스너를 만들지 않습니다. 원격 접속은 SSH 터널이나 사설망입니다(T-10, HS-87). `--listen-tcp`의 비루프백 허용 정책은 사용자 결정 대기입니다(이월 목록, P-13).
- 전체 위협 열람: `architecture.security.spec`. 개인정보 관점의 저장과 전송은 `eng.operations.data-privacy`를 봅니다.

## 5. 호환성

- 호스트 계약의 버전은 `WIRE_PROTOCOL_VERSION`이고 현재 값은 `0.1.0`입니다(`packages/contracts/src/wire-settings/wire/version.ts`). 호스트 계약과 설정 정의 형식이 이 값을 함께 씁니다 `[제안]`(`F.wire-settings.spec` §3.7).
- 주 버전이 같으면 호환입니다. 0.x 기간에는 부 버전까지 같아야 호환입니다(`F.wire-settings.spec` §3.7 `isCompatible`).
- 메서드, 선택 필드, 오류 kind 추가는 부 버전 변경입니다. 메서드 제거, 의미 변경, 필수 필드 추가는 주 버전 변경입니다 `[제안]`.
- 기능 상태는 `experimental` → `active` → `deprecated` → `removed`입니다. `experimental` 기능은 `host.hello`의 `experimental` 목록에 이름을 넣은 연결에만 열립니다 `[제안]`.
- 폐기 기간 12개월은 `[미결]`입니다(`F.wire-settings.spec` §3.7).
- 클라이언트는 모르는 알림, 모르는 필드, 모르는 오류 kind를 무시하거나 일반 오류로 처리합니다 `[제안]`.
- 저장된 이벤트는 지우지 않고 재생합니다. 필드 추가는 선택 필드로만 합니다. 필드 삭제와 의미 변경은 새 버전 변형으로 합니다(`eng.domain-types.guide` DT-09, `F.records.spec` 업캐스터).
- DB 스키마는 마이그레이션 실행기가 올립니다(`L0.store.spec` §4.6). 미래 버전 DB는 읽기 전용입니다.
- 외부 확장이 쓰는 SDK 가상 모듈(`@xeon/contracts`, `@xeon/group-kit`, `typebox`)은 X 로더가 등록해 번들에 돌려줍니다(X.loading-trust.spec §4.4.6). 번들이 받는 `@xeon/group-kit`이 호스트 쪽 인스턴스와 같은지는 `[가정]`입니다(M3-REQ-110).

## 6. 다국어

- 한국어와 영어를 기본으로 지원합니다(`adr.0016` `[결정]`).
- UI 문자열은 메시지 키 카탈로그로 다룹니다. 스택은 FormatJS(`@formatjs/intl`, `react-intl`)와 ICU MessageFormat입니다(`adr.0016`).
- 모델용 도구 설명은 영어 원문을 씁니다(`adr.0016` `[결정]`, M3-REQ-21).
- 하위 층은 사용자에게 보일 문장을 만들지 않습니다. 오류와 안내는 `kind`와 인자로 넘기고, 문장은 클라이언트가 만듭니다. 시각은 UTC로 저장합니다(M3-REQ-112).
- 진행 상태: B4-I18N이 진행 중입니다. 하위 층 문장 통과 항목과 데스크톱 오류 문구가 남아 있습니다(이월 목록).
- FormatJS는 새 외부 의존이라 승인 대기 상태입니다(`review.m3b-plan` §4 항목 4).

## 7. 관측성과 진단

- 엔진 로그는 한 줄이 JSON 객체 하나입니다. 파일은 `0600`이고 로그 줄은 마스킹을 거칩니다(`L0.os.spec` §3.5, `eng.operations.runbook` §3).
- 로그 수준은 `l0.os.log.level`입니다. 기본은 `info`이고 바꾸면 다음 줄부터 반영합니다(`eng.operations.runbook` §3.1).
- 로그 회전 sink는 스펙에 있지만 호스트 조립에 연결되지 않았습니다. 로그는 한 파일에 계속 덧붙습니다(`eng.operations.runbook` §3.1 미결 3).
- 텔레메트리(OpenTelemetry)는 기본으로 꺼져 있습니다. `l0.os.telemetry.enabled`로 켭니다(`L0.os.spec` §3.9, §6).
- 진단은 `xeon doctor`가 봅니다. 종료 코드와 `--json` 형식은 `eng.operations.runbook` §4가 정합니다.

## 8. 접근성

- 접근성(M3-39의 a11y 부분)은 M4로 옮겼습니다(`review.m3b-plan` §1.2). i18n은 M3b에 남습니다.

## 9. 미결 사항

1. 성능 예산 수치 전부(§1.1). 기준선을 macOS에서 잰 뒤 정합니다.
2. macOS 기준선: 콜드 스타트, 사이드카 크기, 서버 측정 전부(`eng.performance.guide` §5).
3. 테스트 메모리와 시간 상한의 정본 값(§2.3).
4. aarch64 Linux 아카이브의 스모크 검사(§2.2).
5. 제품 이름 상수의 소유 문서(M3-REQ-54). M4 전 개명 작업 전에 정합니다.
6. 폐기 기간 12개월의 `[미결]`(§5).
7. 비루프백 리스너 허용 정책(`--listen-tcp`, 이월 목록 P-13).
8. macOS `fullfsync` 기본값과 `processStartFingerprint`의 macOS 수단(M3-REQ-64).
