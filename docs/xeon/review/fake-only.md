---
id: review.fake-only
layer: meta
domain: review
kind: review
status: draft
depends_on: [eng.testing.guide, review.m2-plan]
binds: []
---

# 가짜로만 검증한 것

## 1. 목적과 읽는 법

- 층마다 가짜 포트, 모델 테이프, 루프백 가짜 서버로만 시험하고 실제 바이너리·OS·provider로는 시험하지 않은 동작을 모읍니다. 마일스톤 재점검 G3-06의 산출물이고 M2 마감 절차(`review.m2-plan` §11)의 입력입니다.
- 기준일은 2026-10-25, 기준 커밋은 `xeon/foundation` be63a94입니다. 확인은 시험 파일 목록과 grep으로 했습니다.
- "실제 확인 수단" 열이 비어 있지 않은 항목은 M2 마감 전에 그 수단으로 한 번 실행합니다. 결과는 이 표의 "결과" 열과 `review.m2-plan` §11에 적습니다.
- 근거 상태 용어는 `architecture.security.spec` §2를 따릅니다.

## 2. 목록

| # | 층·패키지 | 동작 | 지금의 시험 | 빠진 실제 확인 | 실제 확인 수단 | 맡는 곳 | 결과 |
|---|---|---|---|---|---|---|---|
| FK-01 | L0 `platform-sandbox` | 샌드박스 `bash`의 작업 폴더 밖 쓰기 거부(M1 종료 조건) | 단위 시험과 `fake-sandbox`. int 시험 0개 | bwrap·socat 실제 실행, macOS Seatbelt | `platform-sandbox` int 시험(CI는 bwrap·socat 설치), `just exit-tests`, macOS 확인 목록 | T3, Z, Mac | |
| FK-02 | L0 `platform-sandbox` | 자가 시험 6항목 | `self-test.test.ts`(가짜 셸). 조립 루트 호출 없음 | 실제 샌드박스에서 자가 시험 | 시작·doctor 경로 연결(G1-12) 뒤 int 시험 | T3, T2 | |
| FK-03 | L4 `apps/host` | 셸 도구가 쓰는 승인·주입 경로 | 실제 엔진 int 시험이지만 `l0.sandbox.enabled: false`(`approval.int.test.ts`, `approval-restart.int.test.ts`, `shell-injection.int.test.ts`) | 샌드박스를 켠 변형(설계 감사 A-17) | 샌드박스를 켠 host int 시험 1개 | T2 | |
| FK-04 | L0 `platform-secrets` | `reveal` 재인증 `os-auth` | `tty-confirm` 경로만 실측 | macOS Touch ID·암호 확인 | macOS 확인 목록 | Mac | |
| FK-05 | L0 `platform-secrets` | age 키를 OS 키체인에 두기 | Linux는 `secret-tool`이 없어 파일 폴백만 | macOS 키체인, Linux Secret Service | macOS 확인 목록 | Mac | |
| FK-06 | L0 `platform-store`, L2 `cap-knowledge` | FTS5 trigram, `fullfsync`, 잠금 | Linux `bun:sqlite` 실측 | macOS 시스템 SQLite와 FTS5 dylib | macOS 수동 CI job, 확인 목록 | Z, Mac | |
| FK-07 | L0 `platform-os` | 한글 NFD 파일 이름, 경로 정규화 | Linux 실측 | macOS APFS NFD | macOS 확인 목록 | Mac | |
| FK-08 | L1 `core-models` | provider 응답 처리 전체 | 모델 테이프 7개, 모두 `origin: "authored"` | 녹화한 실제 provider 응답 | `just tape-record`(D-e, 사용자 확인 뒤 1회) | L1C, Z | |
| FK-09 | L1 `core-models`, L2 `cap-web` | 호스티드 검색 결과 정규화와 내장 검색 래퍼 | 테이프의 `rawEvents` | 실제 Anthropic `web_search` 응답, 조직 차단 400 문구(`[가정]`) | `just tape-record` 시나리오에 검색 1건, D11 측정 | L1C, T5 | |
| FK-10 | L2 `cap-web` | SearXNG provider | 루프백 가짜 서버(`searxng.test.ts`, `e4-search-selection.int.test.ts`) | 실제 SearXNG 컨테이너 | 수동 스모크(docker, 선택) | T5 | |
| FK-11 | L2 `cap-web` | public 모드 SSRF 방어(연결 시점 IP 고정) | 루프백 가짜 서버 | Bun 런타임에서 실제 DNS 응답 | host 수준 loopback 스모크(G4-05) | T5 | |
| FK-12 | L2 `cap-web` | 래퍼 비용과 지연 | 없음. 비용 $0.011은 `[가정]` | 실제 키 약 20회 | D11 측정(`just bench --first-token`과 별도 래퍼 측정, 사용자 확인 뒤 1회) | Z, 사용자 | |
| FK-13 | L2 `cap-mcp` | stdio 서버 | 인메모리 스텁, HTTP 서버. stdio 경로는 `m2/fx-mcp`에만 있음 | 실제 stdio 자식 프로세스 | host int 시험(E6, G1-04) | T3, T5, T2 | |
| FK-14 | L4 `apps/host` | E2 메시지 열 동일 | 같은 프로세스 안 스트림 쌍 비교 | 컴파일한 사이드카 바이너리 stdio | `transport-parity` 컴파일 바이너리 변형(G4-03) | T7 | |
| FK-15 | L4 `apps/desktop` | 사이드카 수명(E3) | Rust 시험 47개, 엔진은 가짜 | 실제 엔진 사이드카, Tauri 종료 순서 | 데스크톱 e2e(`*.e2e.test.ts`, G4-03) | T7 | |
| FK-16 | L4 `apps/desktop` | WebView UI | 상태 reducer 시험. WebView 실행 없음 | WKWebView, 한글 IME | Vitest + `mockIPC`(WSL), macOS 확인 목록(IME) | T7, Mac | |
| FK-17 | L0 `platform-process` | 자식 엔진 임대와 stdin EOF 종료 | `fake-engine` 자식 프로세스 | 실제 엔진 바이너리 | FK-14와 같은 시험 | T7 | |
| FK-18 | X `ext-host` | 프로젝트 신뢰 프롬프트 | X 단위 시험. 클라이언트 카드 없음 | CLI·데스크톱의 실제 선택 | CLI 테이프 스모크, 데스크톱 카드 시험(G1-03) | T6, T7 | |

## 3. 건너뛰기로 숨는 시험

- 실제 바이너리가 없으면 건너뛰는 시험이 있습니다(`describe.skipIf(!real)`, `realTest = gate.blocker === undefined ? test : test.skip`). 대상은 `platform-secrets`의 `admin.int.test.ts`(E7)와 `sops-real.int.test.ts`, `apps/host/test/int/*.int.test.ts`(실제 엔진)입니다.
- CI에서 이 시험이 건너뛰어지면 종료 조건이 확인되지 않은 것입니다. `just exit-tests`가 이 목록을 실행하고 건너뛴 수를 출력하며, 하나라도 건너뛰거나 파일이 없으면 실패합니다(`xeon/scripts/exit-tests.txt`).

## 4. 미결 사항

- [미결] FK-10 실제 SearXNG 스모크를 M2 마감 조건에 넣을지. H1 뒤에는 사용자가 설정했을 때만 쓰는 provider입니다.
