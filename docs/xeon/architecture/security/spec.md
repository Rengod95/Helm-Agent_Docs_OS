---
id: architecture.security.spec
layer: architecture
domain: security
kind: spec
status: draft
depends_on: [architecture.layers.spec, X.loading-trust.spec, L0.sandbox.spec, L0.secrets.spec, L2.web.spec, L2.mcp.spec, adr.0006]
binds: []
---

# 위협 모델과 신뢰 경계

## 1. 목적과 범위

### 1.1 정하는 것

- Xeon이 지키는 자산과 신뢰 경계를 한 문서에 모읍니다.
- 위협마다 통제 수단, 통제를 정한 문서, 구현과 시험의 현재 상태를 적습니다.
- 마일스톤 재점검 G3-01의 산출물입니다. 흩어져 있던 D6(MCP stdio), U-19(비밀 `env` 주입), U-11(원격), 프로젝트 신뢰, 확장 신뢰 등급을 이 표에서 연결합니다.

### 1.2 다루지 않는 것

| 주제 | 담당 문서 |
|---|---|
| 샌드박스 정책의 세부(보호 경로, srt 설정 매핑) | `L0.sandbox.spec` |
| 비밀 참조 문법, 사용 모드, 마스킹 계층 | `L0.secrets.spec` |
| SSRF 규칙, 도메인 정책 | `L2.web.spec` §4.6 |
| 확장 신뢰 등급 표와 프로젝트 신뢰 판정 순서 | `X.loading-trust.spec` §4.6·§4.7 |
| 릴리즈 서명, 공증, 공급망 고지 | M3 `L4/release/spec.md`(`review.m3-plan`) |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 신뢰 경계 | 한쪽의 입력을 다른 쪽이 검사 없이 믿지 않는 경계입니다. 표의 `B-NN`입니다 |
| 통제 | 위협을 막거나 줄이는 수단입니다. 승인, 샌드박스, 신뢰 판정, 마스킹, 정책이 있습니다 |
| 근거 상태 | `실측`(실제 바이너리·OS로 시험), `가짜`(가짜 포트나 테이프로만 시험), `없음`(시험 없음), `미구현` |

## 3. 자산과 경계

### 3.1 자산

| 자산 | 위치 | 잃으면 |
|---|---|---|
| A-1 비밀 값(모델 키, API 키) | SOPS 파일, OS 키체인 또는 파일 폴백의 age 키 | 계정 도용, 과금 |
| A-2 사용자 파일 | 작업 폴더와 홈 디렉터리 | 데이터 손실, 유출 |
| A-3 대화와 이벤트 DB | 상태 디렉터리의 SQLite | 대화 내용 유출, 재개 불가 |
| A-4 Xeon 상태 파일 | `trust.json`, 설정 파일, spill 파일 | 신뢰 판정 우회, 설정 손상 |
| A-5 사용자 계정의 실행 권한 | OS 사용자 | 임의 코드 실행 |

### 3.2 신뢰 경계

| 번호 | 경계 | 안쪽 | 바깥쪽 | 경계를 넘는 것 |
|---|---|---|---|---|
| B-01 | 모델 출력 | 엔진 | 모델 provider 응답 | 도구 호출, 텍스트. 모델 출력은 신뢰하지 않습니다 |
| B-02 | 도구 결과와 외부 콘텐츠 | 모델 컨텍스트 | 웹 페이지, 파일 내용, MCP 결과 | 프롬프트 주입 가능 텍스트 |
| B-03 | 샌드박스 | 엔진 프로세스 | `bash` 자식 프로세스 | 명령, 작업 폴더 쓰기 |
| B-04 | 프로젝트 | 사용자 설정·내장 확장 | 저장소의 `.xeon/`, `.mcp.json` | 확장, MCP 정의, 스킬, 설정 |
| B-05 | MCP 서버 | 엔진 | stdio 자식 프로세스, HTTP 서버 | 도구 정의, 도구 결과, 서버 주도 요청 |
| B-06 | 비밀 | 비밀 서비스(L0.secrets) | 모델 컨텍스트, 이벤트 DB, 로그, 자식 env | 참조(`secret://`)만 넘고 값은 넘지 않습니다 |
| B-07 | 네트워크 | 엔진 | 인터넷, 사설망, 루프백 서비스 | `web.fetch`, `web.search`, MCP HTTP |
| B-08 | 호스트 전송 | 엔진 | 클라이언트(CLI in-process, 데스크톱 stdio, M3 서비스 소켓) | wire 요청, 승인 응답 |
| B-09 | 데스크톱 WebView | Tauri 셸 | WebView UI | 바이트 릴레이. CSP `default-src 'self'` |
| B-10 | 다른 Xeon 프로세스 | 한 엔진 | 같은 DB·상태 파일을 여는 다른 엔진 | 쓰기 경합 |

## 4. 위협과 통제

| 번호 | 위협 | 경계 | 통제 | 정본 | 근거 상태 | 남은 일 |
|---|---|---|---|---|---|---|
| T-01 | 외부 콘텐츠의 프롬프트 주입으로 모델이 위험한 도구를 부름 | B-01, B-02 | 도구 승인 규칙과 권한 모드, 쓰기·셸 도구 승인, `web.fetch` 기본 `ask`와 대화에 나온 URL만 허용 | `L1.tools.spec`, `L2.web.spec` §4.6.6 | 가짜(승인 흐름은 실제 `ApprovalService` 시험) | G2-10 동의 표시 요건, `always` 강등 표시(T4) |
| T-02 | 샌드박스 `bash`가 작업 폴더 밖에 쓰거나 보호 경로를 읽음 | B-03 | `xeon.sandbox`(bubblewrap·socat, Seatbelt), 자가 시험 6항목, 격리 불가 시 기본 `disable_execute` | `L0.sandbox.spec` §4.4·§4.5 | 없음. int 시험 0개, `selfTest` 호출처 없음 | G4-01 int 시험(T3), G1-12 `selfTest` 호출(T2), CI 설치(Z), macOS Seatbelt 확인(`review.macos-checklist`) |
| T-03 | 신뢰하지 않은 저장소의 프로젝트 자원이 코드를 실행하거나 설정을 바꿈 | B-04 | 프로젝트 신뢰. 판정 전에는 프로젝트 확장을 import하지 않고 `.mcp.json`, 스킬, 설정을 읽지 않음. `untrusted`는 로드하지 않음 | `X.loading-trust.spec` §4.6·§4.7 | 가짜(X 단위 시험). 클라이언트 신뢰 카드 없음 | G1-03 wire 이름 통일(T1), 카드(T6, T7), `.xeon/commands` 자원 표(T5), G1-10 `trust.json` 잠금(T3) |
| T-04 | stdio MCP 서버가 사용자 권한으로 임의 동작 | B-05 | 프로젝트 정의는 신뢰 뒤에만, 평문 env 거부, 비밀 env 서버는 M2에서 띄우지 않음, 서버 허용·차단 목록 | ADR-0011, `L2.mcp.spec` §4.3·§4.4 | 가짜(인메모리 스텁, HTTP 서버) | G1-04 `McpProcessPort`(T3, T5), M3 샌드박스 정책과 기동 승인 |
| T-05 | 비밀 값이 모델 요청, 이벤트 DB, 로그, 자식 env로 새어 나감 | B-06 | 참조만 저장, 사용 모드(`runtime-http`, 승인된 `env`), 마스킹 5계층, 자식 env 필터 `SENSITIVE_ENV_PATTERNS` | `L0.secrets.spec` §4.3~§4.5, `review.decisions-2` U-19 | 실측(실제 sops, Linux). 승인 증거 전달은 host 시험 | 비밀 사후 삭제(G2-16, M3) |
| T-06 | 화면 앞의 다른 사람이 비밀을 열람 | B-06 | `reveal`의 재인증(60초, `os-auth` 우선, 없으면 `tty-confirm`), 감사 기록 | `L0.secrets.spec` §3.8·§4.9 | `tty-confirm`만 실측. `os-auth`·macOS 키체인 없음 | G4-02 macOS 확인 |
| T-07 | `web.fetch`가 사설망·메타데이터 주소에 요청(SSRF)하거나 리다이렉트로 우회 | B-07 | URL 검사, 연결 시점 IP 검사와 고정, 리다이렉트 재검사, provider endpoint 예외 | `L2.web.spec` §4.6 | 가짜(루프백 가짜 서버). public 모드 SSRF 방어가 Bun에서 도는지 미확인 | G4-05 loopback 스모크(T5) |
| T-08 | 검색어가 의도하지 않은 수신자에게 나감 | B-07 | 사용자가 설정한 provider만 체인에 넣음. SearXNG 자동 탐침 없음. 키 플러그인은 등록이 동의 | ADR-0005 §3.3(2026-10-25 개정) | 미구현(감지 제거는 T5) | H1(T5), 키 플러그인 첫 사용 고지 [제안] |
| T-09 | 사용자·프로젝트 확장 코드가 엔진 권한으로 실행 | B-04 | 신뢰 등급 × 허용 연산 표, 설치 위치 상한, 예약 이름 거부. 외부 확장 로더는 M3 | `X.loading-trust.spec` §4.6, `review.m2-plan` §8 D9 | 가짜 | M3 외부 로더, 프로세스 격리는 2차(보안 경계 아님) |
| T-10 | 로컬·원격 클라이언트가 엔진을 조작 | B-08 | 비루프백 리스너 없음. 데스크톱은 자식 stdio. M3 원격은 SSH 터널·사설망 | `L4.host-service.spec` §4.11, `review.decisions-2` U-11, ADR-0006 | 가짜(전송 적합성 시험) | M3 서비스 소켓 권한 |
| T-11 | WebView에 원격 콘텐츠가 들어와 IPC를 부름 | B-09 | CSP `default-src 'self'`, 셸은 바이트만 릴레이 | `L4.desktop.spec`, `src-tauri/tauri.conf.json` | 없음(WebView e2e 없음) | G4-03 e2e(T7), 원격 점검 디버그 기능은 `cfg(debug_assertions)` 아래(T7) |
| T-12 | 두 엔진이 같은 DB·상태 파일을 동시에 씀 | B-10 | 세션 OS 잠금과 `sys_leases.epoch` 펜싱, `thread.locked` 대안 | ADR-0004, `L0.store.spec` | 실측(Linux 두 프로세스 시험) | G1-10 `fileLock`(T3), G2-09 single-instance(T7) |
| T-13 | 상태 파일과 임시 파일이 평문으로 남음 | A-3, A-4 | spill 파일을 상태 디렉터리로 옮김(M2), `secretEnv` 호출은 spill 끔 | `L0.exec.plan` §7 R-9, `L0.exec.spec` §10 미결 4 | 미구현(현재 OS 임시 폴더) | G2-05(T3), GC·회전·상한은 M3 |
| T-14 | 업데이트·마이그레이션이 사용자 DB를 손상 | A-3 | 마이그레이션 전 `VACUUM INTO` 스냅샷, 손상과 미래 버전 오류 구분 | `L0.store.spec` | 미구현 | G2-06(T1, T3, T2) |
| T-15 | 공급망: 의존성, CI 액션, 배포 바이너리 변조 | 전체 | catalog 정확 고정, `bun install --frozen-lockfile`, `binaries.lock.json`, 로컬 gitleaks 훅 | `eng.toolchain.guide`, ADR-0001 | 부분. CI 액션 SHA 고정 없음, CI gitleaks 없음, 서명은 ad hoc | G4-07 일부(Z), 서명·공증 M3(D3) |

## 5. 실패와 경계 사례

- 샌드박스를 쓸 수 없는 기기(Windows 네이티브, WSL1, socat 없음)는 기본값에서 셸 도구가 꺼집니다. 사용자가 `run_unsandboxed`나 `enabled = false`를 고르면 격리 없이 실행되고, 도구 결과에 `unsandboxedBy`가 남습니다(`L0.sandbox.spec` §4.5).
- 프로젝트 신뢰는 폴더 단위입니다. 신뢰한 폴더에 나중에 들어온 파일도 같은 신뢰를 받습니다 [가정: 재판정 조건은 `X.loading-trust.spec` §4.7].
- `AGENTS.md`, `CLAUDE.md` 같은 컨텍스트 파일은 신뢰와 무관하게 읽힙니다. 내용은 모델 입력일 뿐 코드로 실행되지 않지만 T-01의 입력입니다.
- 프로세스 격리(2차)는 같은 OS 사용자 권한이므로 보안 경계가 아닙니다(`X.loading-trust.spec` §4.6.3).

## 6. 설정 노출

| 키 | 통제 | 정본 |
|---|---|---|
| `l0.sandbox.enabled`, `l0.sandbox.onUnavailable` | T-02 | `L0.sandbox.spec` §6 |
| `x.loading-trust.defaultProjectTrust` | T-03 | `X.loading-trust.spec` §3.6 |
| `l2.mcp.servers` | T-04 | `L2.mcp.spec` §6 |
| `l2.web.search.provider`, `l2.web.search.searxng.url`, `l2.web.search.pluginOrder` | T-08 | `L2.web.spec` §6 |
| `l0.secrets.*` | T-05, T-06 | `L0.secrets.spec` §6.1 |

## 7. 확장 지점

- `project_trust` 지점의 `on`은 `builtin`과 `user` 등급만 겁니다(`X.loading-trust.spec` §4.6.2).
- `tool_call` 지점의 first 핸들러 거부는 T-01의 추가 통제로 쓸 수 있습니다. 예외는 거부로 처리합니다(fold 실패 정책).

## 8. 다른 문서와의 인터페이스

| 문서 | 관계 |
|---|---|
| ADR-0011 | T-04의 결정 |
| ADR-0005 | T-08의 결정 |
| `review.fake-only` | §4 근거 상태 열의 근거 목록 |
| `review.macos-checklist` | T-02, T-06의 macOS 확인 |
| `review.m3-plan` | 남은 일 중 M3 항목 |

## 9. 수용 기준

- §4의 모든 위협에 통제, 정본 문서, 근거 상태가 있습니다.
- 근거 상태가 `없음`이나 `미구현`인 M2 위협(T-02, T-08, T-11, T-13, T-14)은 `review.m2-plan` §10에 맡는 트랙이 있습니다.
- 새 신뢰 경계를 만드는 변경(새 전송, 새 자식 프로세스 종류, 새 외부 호출)은 같은 커밋에서 이 문서의 §3.2와 §4를 고칩니다.

## 10. 미결 사항

- [미결] 프로젝트 신뢰 판정 뒤 새로 생긴 프로젝트 자원의 재판정 조건.
- [미결] 키 플러그인 provider 첫 사용 때 "검색어가 새 수신자에게 나간다"는 고지를 둘지(T-08).
- [미결] 저장 이벤트의 비밀 사후 삭제 경로(G2-16, M3).
- [미결] 샌드박스 네트워크 정책과 `tool.sandbox_bypassed` kind의 소유자(G1-14, M3).
