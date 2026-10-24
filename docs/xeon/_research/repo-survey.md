# 기존 저장소 상태와 재사용 지점 (2026-10-21 조사)

정본 아님. Explore 에이전트 조사 결과 원문.

# Helm 저장소 탐색 결과 (Xeon 추가 전 기준)

기준: `/home/user/projects/helm/code/helm`, 브랜치 `design/restructure` (HEAD `08042d2`). 읽기 전용으로만 조사했다. 파일은 만들거나 고치지 않았다. `.helm/` 디렉터리는 이 체크아웃에 없었고 읽지도 않았다.

## 0. 핵심 요약

1. 저장소에는 성격이 다른 세 층이 있다. (a) 커밋된 설계 문서 `docs/design/` (Helm 정본, 약 5.5만 줄), (b) 커밋되지 않은 구현 코드 (루트 `package.json`, `apps/`, `experiments/`, `packages/helm-*`), (c) 로컬 전용 작업 공간 `.helm-design-work/`.
2. 설계 정본은 이미 TypeScript 스택을 확정해 두었다 (Node 24, TS 6.0 strict ESM, pnpm 11, Vitest, ESLint flat config, `tsc -b`, TypeBox, better-sqlite3). 현재 구현 코드는 JavaScript(.mjs), npm workspaces, `node --test`이며 린트·포맷·tsconfig 설정이 없다. Xeon을 TS로 만들면 어느 관례를 따를지 먼저 정해야 한다.
3. Xeon의 "대화형 에이전트 런타임"은 Helm 설계의 12 런타임 엔진, 13 도구, 07 pi 재사용과 영역이 겹친다. 결정 23("자체 런타임을 만든다"), 결정 27·28(pi-ai 얇은 인터페이스, pi-agent-core 포크)이 이미 있다. 같은 루프·모델·도구·세션 저장을 두 번 설계할 위험이 가장 크다.
4. 루트 워크스페이스 글롭 `apps/*`, `experiments/*`, `packages/*`는 셋 모두 새 패키지를 자동 편입한다. 설계 06 §3.15는 `experiments/`를 워크스페이스 밖으로 정했는데 현재 `package.json`은 이를 포함하고 있어 불일치한다.
5. 저장소 안에는 CLAUDE.md, AGENTS.md, `.claude/`가 없다. justfile은 현재 브랜치에 없고 `ws-adopt` 브랜치(커밋 `972d72b`)에만 있으며, 외부 `ws` CLI(`~/.config/ws/ws.just`)에 의존한다.
6. "xeon" 이름 충돌은 없다. `.git`과 `node_modules`를 제외한 저장소 전체를 대소문자 무시로 검색해 0건이었다.

## 1. Git 기준 상태

| 항목 | 값 |
|---|---|
| 현재 브랜치 | `design/restructure` (HEAD `08042d2`) |
| 로컬 브랜치 | `design/helm-v1`, `main`, `ws-adopt`, `design/restructure` |
| `ws-adopt` worktree | `/tmp/claude-1000/-home-user-projects-homelab/.../scratchpad/helm-ws` 에 연결됨, 상태 `prunable` |
| 태그 | `pre-restructure`, `v1.0.0` |
| 최근 커밋 | `08042d2` ADR 문서 24를 archive로 이동, `026b17f` process를 브리프만 남기고 archive로, `5a8ba38`, `cbfab5f` 등 구조 정리가 이 브랜치에서 진행 중 |

- HEAD에 추적되는 최상위 항목: `.github/`, `.gitignore`, `LICENSE`, `README.md`·`README.ko.md`·`README.zh.md`, `archive/`, `docs/`, `packages/` (단, `packages/agent-docs-init/` 27개 파일만).
- 미추적 (`git status`의 `??`) 7항목: `package.json`, `apps/`, `experiments/`, `packages/helm-cli/`, `packages/helm-core/`, `packages/helm-sdk/`, `packages/helm-server/`.
  - 워크스페이스 설정과 구현 코드 전체가 커밋되지 않은 상태다. Xeon 작업에서 `git add -A`를 쓰면 이 미추적분이 함께 들어간다.
- `.helm-design-work/`는 `.git/info/exclude`(로컬 파일)에만 등록돼 있고 `.gitignore`에는 없다. 추적 파일은 0개다. 다른 클론에는 이 제외 규칙이 전달되지 않는다.
- `.gitignore`는 `node_modules/`, `*.tgz`, `.DS_Store`, `.omc/` 4줄뿐이다. `dist/`, `.env`, `*.db`는 없다.
- 이 세션의 도구 버전: node v24.19.0, npm 11.17.0, pnpm 11.21.0, just 1.58.0.

## 2. 루트 구조와 디렉터리 성격

### 2.1 루트 파일

- `package.json` (미추적): `name: "helm-workspace"`, `private`, `type: module`, `workspaces: ["apps/*","experiments/*","packages/*"]`, `engines.node >=20.0.0`. 스크립트는 `test:helm`(core·server·cli의 `node --test`), `test:kernel-v02`, `simulate:guided-001`, `simulate:cli-guided-001`, `helm`(`packages/helm-cli/bin/helm.mjs`). 루트 lockfile은 없다.
- `README.md` / `README.ko.md` / `README.zh.md` (추적): 제목은 "Helm"이지만 내용은 "Agent Docs OS"(`npx @helmdocs/init`) 소개다. Helm 제품 설명이 아니다. 배지 기준 MIT.
- `LICENSE` (추적).

### 2.2 디렉터리

| 경로 | 성격 | git 상태 | 요약 |
|---|---|---|---|
| `packages/agent-docs-init/` | 별개 제품 Agent Docs OS. 공개 npm `@helmdocs/init` 1.0.1 | 추적 (main에도 있음) | `bin/cli.mjs`, `bin/init.sh`, `src/onboard.mjs`, `templates/`, `fragments/`(aider, claude-code, cline, codex, cursor, github-copilot, windsurf). `package-lock.json` (npm). 의존 `inquirer ^12`. |
| `packages/helm-core/` | 레거시 구현 (JS), 설계상 `legacy/experimental-v0` 후보 | 미추적 | `@helmdocs/core`, private. `src/`: `application`, `event`, `git-adapter`, `index`, `projections`, `store` (.mjs). `test/core.test.mjs`. |
| `packages/helm-cli/` | 레거시 구현 | 미추적 | `@helmdocs/cli`, bin `helm.mjs`. `test/cli.test.mjs`. |
| `packages/helm-server/` | 레거시 구현 | 미추적 | `@helmdocs/server`. `src/server.mjs`, `src/openapi.mjs`. `test/server.test.mjs`. |
| `packages/helm-sdk/` | 레거시 구현 | 미추적 | `@helmdocs/sdk`. `src/client.mjs`. |
| `apps/helm-web/` | 정적 로컬 GUI (`index.html`, `app.js`, `styles.css`) | 미추적 | `package.json` 없음. README: `@helmdocs/server`가 서빙하며 GUI는 정본 상태를 갖지 않는다. |
| `experiments/helm-kernel-v02/` | 커널 v0.2 실험, `engines.node >=22.5.0` | 미추적 | `contracts/*.schema.json` 9개(command, event, protocol, provider-turn, runtime-tool, adapter-capability, context-projection, observation-candidate, write-result). `src/` 12개(예: `sqlite-kernel.mjs`, `agent-runtime.mjs`, `providers/openai-responses.mjs`). `test/*.test.mjs` 10개. |
| `experiments/helm-sidecar/` | 사이드카 캡처 실험 | 미추적 | `bin/helm-sidecar.mjs`, `src/capture.mjs`, `test/capture.test.mjs`. |
| `experiments/helm-toy/` | 커널 장난감 | 미추적 | `helm.mjs` 한 파일. `package.json` 없음. |
| `experiments/durable-spike/` | pi-durable 스파이크 | 미추적 | `helm-spike.mjs`, `concern-task-spike.mjs`. `@earendil-works/chord`, `pi-ai`, `pi-durable` 1.1.0 (정확 버전). |
| `experiments/pi-lab/` | pi API 실험 6개 | 미추적 | `exp1-core` ~ `exp6-tui` (.mjs). `package-lock.json`. `node_modules` 설치됨. `@earendil-works/*` 8개 `^1.1.0`. `test` 스크립트 없음. |
| `archive/` | 정본 아님 (`archive/README.md` 명시) | 추적 | `foundations-v0.1`, `foundations-friendly`, `architecture`(옛 시스템·커널 후보), `v0.3`, `experience`, `prototypes`, `research-program`, `handoff`, `design-process`(`24-adr.md` 포함). |
| `docs/architecture/` | Docs-Agent OS 원론 | 추적 | `fundamentals.md` 1개 (아래 3.3). |
| `docs/design/` | Helm 설계 정본 | 추적 | `00-README.md`, `01`~`23`, `25`, `26` (24 결번, 26개 md), `process/00-design-brief.md`. |
| `docs/reference/` | 조사 노트 10개 | 추적 | pi API 사실 2종, pi 런타임 선택지, Claude Agent SDK 도입 검토, DeepSeek 하네스, Mastra 검토, 에이전트 백엔드 OSS 조사, 상용 데스크톱 에이전트 UX, pi 레이어 분석, pi 사례 노트. |
| `docs/study/helm/` | 설계를 사람이 리뷰하기 위한 학습 문서 (작성 중) | 추적 (HEAD) | `00-index.md`(노드 인덱스 초안), `01`~`15` 노드, `_packs/`, `_reviews/`, `_artifacts.txt`(외부 아티팩트 링크 목록). |
| `.github/workflows/ci.yml` | 실행 조건: `main` push/PR만 | 추적 | Node 18·20·22 매트릭스. `packages/agent-docs-init`만 시험 (셸 대체 경로, Claude Code 온보딩, Cursor fragment, 멱등성, 여러 에이전트). Helm 코드 테스트는 없다. |
| `.github/workflows/publish.yml` | release published 시 실행 | 추적 | `@helmdocs/init`을 `npm publish --provenance --access public`으로 배포 (`NPM_TOKEN`). |
| `.helm-design-work/` | 설계 작업 공간 (37개 디렉터리: P1~P15, S2a~S4, T1~T3, V1~V7, `coordinator`, `mac-modified`, `research`) | 로컬 exclude | 정본 아님. 실험 스크립트 (P7 bwrap 샌드박스, S3a `exp-a2-tools-codemode.mjs`, S3b `exp7-server-client.mjs`). `.ts` 2,586개, 대부분 `P4/pi-v1.1.0/`(pi 모노레포 사본, `engines.node >=22.19.0`). 내용은 목록 수준만 확인. |

- 설계 06 §3.15는 `packages/helm-{core,cli,sdk,server}`와 `apps/helm-web`을 `legacy/experimental-v0/`로, `packages/agent-docs-init`을 `legacy/agent-docs-init/`으로 옮길 계획이다. 현재 구현 코드는 이 이전 대상이다.

## 3. 문서 규칙 (`docs/`)

### 3.1 구조와 명명

- 색인: `docs/design/00-README.md`. 1절 문서 목록 표 (번호, 제목, 한 줄 요지, 담당 범위), 2절 역할별 읽는 순서, 3절 사용자 결정 1~64 요약, 4절 판정·검증 결과 위치, 5절 미결·사람 작업 위치.
- 파일명: `NN-slug.md` (두 자리 번호, 소문자와 하이픈, 제목은 한국어). 번호 24는 결번이다.
- 문서 머리: YAML 프런트매터는 없다. `docs/`와 `archive/`의 모든 `.md`를 검사해 첫 줄이 `---`인 파일은 0개였다. 대신 `- 작성:`, `- 상태:`, `- 소유:`, `- 기준 결정:`, `- 함께 읽을 문서:`, `- 표시 규칙:`, `- 출처 줄임말:` 같은 불릿 블록을 쓴다.
- 본문 골격 (`00-design-brief.md` §5.3, 06·09·18의 헤딩을 따름): §1 목적과 범위(1.1 정하는 것, 1.2 다루지 않는 것), §2 전제와 결정, §3 명세 본문, §4 실패·예외·경계 사례, §5 다른 문서와의 인터페이스(5.1 제공, 5.2 요구), §6 구현 단위와 완료 기준, §7 미결 사항, §8 출처.
- 표지 태그 (`00-design-brief.md` §5.2):
  - `[결정 n]`: 사용자가 정한 결정에만 쓴다.
  - `[제안: 결정 n 기본값]`: 조정자 기본값.
  - `[판정 n]`, `[판정 J-nn]`: 조정자 판정.
  - `[제안]`: 문서 작성자의 설계 선택.
  - `[가정]`, `[원문 …]`, `[실험 …]`, `[검색 …]`, `[지식]`: 확인 수준 표시.
- 판정 J-01~J-351과 결정 1~64는 본문에서 번호로 인용된다. 원본 `rulings-stage2a.md`는 `archive/design-process/`로 이동했다.

### 3.2 문서 종류

- 설계 규격 `docs/design/NN-*.md`: 정본.
- 색인·용어집: `00-README.md`, `25-glossary.md`.
- ADR: `archive/design-process/24-adr.md`로 이동했다. 설계 06 §3.15는 `docs/adr/README.md` 한 줄 포인터를 계획했으나 `docs/adr/`는 아직 없다.
- 학습 노트: `docs/study/helm/` (목차 + 노드 번호, 작성 중).
- 조사 노트: `docs/reference/`.
- 원론: `docs/architecture/fundamentals.md`.
- 작업 기록·판정·검증: `archive/design-process/`.

### 3.3 `docs/architecture/fundamentals.md`의 성격

- 제목은 "Docs-Agent OS: Architecture Fundamentals", 344줄, 추적됨.
- Helm 설계와 별개인 Agent Docs OS(`agent-docs-init` 제품)의 원론이다. 4계층 (State, References, Features, Decisions), CLAUDE.md → `docs/README.md` 라우터 비유를 다룬다.
- Xeon의 설계 근거로 직접 쓸 내용은 적다. "문서가 에이전트 진입점" 개념 정도만 참고 가치가 있다. restructure plan(`.helm-design-work/coordinator/restructure/plan.md` §0.1)은 이 파일을 archive 대상으로 분류했고 사용자 확인이 필요하다고 적었다.

### 3.4 Xeon에 참고할 기존 문서

모든 경로는 `/home/user/projects/helm/code/helm/` 아래다. 줄 번호는 헤딩 기준이다.

| 주제 | 경로 (줄 수) | 참고할 절과 한 줄 요약 |
|---|---|---|
| 보안 | `docs/design/18-security.md` (1253줄) | §3.10 (575행) 비밀 저장·주입·마스킹: `SecretStore`는 `Map`을 감싸고 `get(name)`만 허용하며 `toJSON`·`inspect`를 막는다(§3.10.1). 도구 프로세스에 비밀을 주지 않는다(§3.10.2). 로그·이벤트·투영에 비밀이 들어가지 않게 하는 지점(§3.10.3). 마스킹기(§3.10.4), 정본 HMAC 키(§3.10.5), 이미 기록된 비밀 가림(§3.10.6). §3.11 (669행) 도구 실행 격리와 권한: 요구(§3.11.1), 격리 수단 순서(§3.11.2), 보호 경로(§3.11.5), 권한 레이어 고정 기준선(§3.11.6), 허용 폴더 등록(§3.11.7). §3.12 프롬프트 주입, §3.13 감사 기록과 체인 재작성 감지, §3.14 속도·크기 한도, §3.15 공급망, §3.17 보안 테스트 목록. |
| 도구·실행 | `docs/design/13-tools-and-execution.md` (1745줄) | §3.2 등록과 도구 묶음 (213행), §3.4 자원 URI와 경로 정책 (513행), §3.5 쓰기 범위 검사와 bash 우회 방지 (594행, 방법 비교 611행), §3.6 격리 (766행): S0~S2 샌드박스 수준 표. S1은 bubblewrap 네임스페이스. |
| 런타임 엔진 | `docs/design/12-runtime-engine.md` (2492줄) | §3.2 run·thread 상태 기계 (277행, 표 357행). §3.3 모델 계층 `@helm/ai`: pi-ai를 얇은 인터페이스 뒤에 둔다 (444행), 키 주입 (605행), pi 재시도·세션 기능 끄기 목록 (644행). §3.4 루프 포크와 커널 연결점: 이벤트 싱크 (754행), `beforeToolCall` (802행), `afterToolCall` (868행), `prepareRequest` (923행), `finishTurn` (956행). §3.5 모델 컨텍스트 투영 (1044행). |
| 이벤트 저장소 | `docs/design/09-event-store.md` (2866줄) | §3.2 이벤트 envelope (98행): 카테고리 6종(domain, governance, runtime, kernel, system, measurement), authority 문법, TypeBox 스키마. §3.2.2 해시 (213행). §3.3 이벤트 이름 규칙 (223행). §3.7 DDL (1218행). §3.8 단일 쓰기 경로와 늦은 쓰기 차단 (1635행). §3.9 멱등 키와 낙관적 동시성 (1741행). §3.10 해시 체인과 HMAC 체크포인트 (1815행). §3.11 투영 (1888행). §3.14 백업·복구 (2107행). |
| 클라이언트 프로토콜 | `docs/design/19-client-protocol.md` (2854줄) | §3.3.1 JSON-RPC 2.0 규칙 (329행): 배치 거부, `<영역>.<동사>` 메서드 명명, params는 객체, 중첩 깊이 64 제한. §3.4 핸드셰이크 (513행). §3.5 seq와 lastSeq 기준 재전송 (755행). |
| pi 재사용 | `docs/design/07-pi-reuse-and-fork.md` (1474줄) | §3.1 기준 버전 pi v1.1.0 (170행). §3.3 vendor 배치: private 패키지, `UPSTREAM.json`, `PATCHES.md` (242행). §3.4 pi-agent-core 파일 계획 (411행). §3.5 수정 사항 A1~A7 (439행). §3.6 coding-agent 도구 가져오기 (583행). §3.12 codemode REPL, §3.13 MCP, §3.14 pi-tui. §3.17 라이선스 고지 (1167행). §3.18 업스트림 추적 (1216행). §3.19 테스트 (1288행). |
| 테스트 전략 | `docs/design/22-testing-strategy.md` (2068줄) | §3.1 테스트 계층 (117행). §3.5 결정성 (282행). §3.5.4 모델 테이프, 즉 가짜 모델 재생 (370행). §3.7 커널 테스트 (523행). §3.8 유즈케이스 시나리오 (705행). |
| 기술 스택·패키지 경계·저장소 트리 | `docs/design/06-system-architecture.md` (2037줄) | §3.4 패키지 책임과 금지 의존 (409행). §3.5 의존 규칙의 기계적 강제: ESLint와 `scripts/check-architecture.ts` (756행, 781행, 825행). §3.12.1 확정 스택 표 (1439행). §3.12.2 Node 24·TS 6.0을 고른 이유 (1472행). §3.13 벤더 중립 런타임 어댑터 (1567행). §3.15 목표 저장소 트리 (1673행). §3.16 justfile 레시피 (1753행). |
| 구현 계획 | `docs/design/23-implementation-plan.md` (1376줄) | §3.1 구현 에이전트 3단계, Opus·Sonnet·Haiku 배정 (결정 52·58, 115행). §3.4 마일스톤 M0~M13 상세 (295행). |
| 용어 | `docs/design/25-glossary.md` (1048줄) | §3.7 런타임·도구 (396행), §3.8 저장·이벤트·커널 (472행). Xeon 용어와 충돌 점검용. |
| 자체 런타임 선택지 | `docs/reference/pi-runtime-options.md` | "pi를 쓰면 런타임을 쉽게 만들 수 있다"는 전제는 절반만 맞다고 결론(§0). 실험 6개, 사례 13건. Xeon 런타임 설계와 직접 관련. |
| Claude Agent SDK | `docs/reference/claude-agent-sdk.md` | "도입 검토" 문서. 결론 절은 확인하지 않았다. Xeon의 런타임 선택과 직접 관련. |
| 설계 브리프 | `docs/design/process/00-design-brief.md` (342줄) | 확정 결정 1~64 원문. §3.1 패키지 이름 트리 (`@helm/*`). §5 작성 규칙. |

설계 결정 중 Xeon에 직접 걸리는 것 (`docs/design/00-README.md` §3):

- 결정 23: 자체 런타임을 만든다. pi 패키지 중 재활용할 수 있는 것은 가져와 쓴다.
- 결정 27: pi-ai를 가져와 얇은 인터페이스 뒤에 둔다.
- 결정 28: pi-agent-core를 포크하고 커널 검사는 루프 훅에 연결한다.
- 결정 29: 기준 원본은 Helm 이벤트 로그(SQLite WAL)다.
- 결정 30: 크래시 복구는 실행 의도, 실행, 결과 순으로 기록한다.
- 결정 31: JSON-RPC 2.0 over WebSocket.
- 결정 36과 44: 결정 36(TS strict, ESM, pnpm, Vitest, TypeBox, better-sqlite3) 중 Node와 TS 버전만 결정 44(Node 24, TS 6.0)로 대체됐다. 나머지는 06 §3.12.1이 유지한다.
- 결정 40: 설계 문서는 `docs/design/`에 쓰고 설계 브랜치 `design/helm-v1`에 커밋한다. push는 사용자 확인 후다.
- 결정 45: 비밀은 데몬 시작 시 메모리에만 주입한다.
- 결정 46: 루프백 바인딩은 격리 경계가 아니다.
- 결정 55: MVP 도구에 웹 탐색과 고급 도구를 넣는다.

## 4. 기존 코드 관례

| 항목 | 현황 | 근거 |
|---|---|---|
| 언어 | JavaScript ESM (.mjs). `.helm-design-work`와 `archive` 밖의 TS 파일은 0개 | `find` 결과 |
| 모듈 | `package.json`에 `type: module`, 파일 확장자 `.mjs` | 각 `package.json` |
| 테스트 러너 | `node:test` (`node --test`), 파일명 `*.test.mjs`, `test/` 폴더. Vitest 없음 | `packages/helm-*/package.json`의 `test` 스크립트, 루트 `test:helm` |
| 테스트 실행 위치 | 루트 `test:helm`이 core·server·cli를 돈다. CI는 `agent-docs-init`만 시험 | `.github/workflows/ci.yml` |
| 린트 | 설정 없음 (`eslint.config.*`, `.eslintrc*`, `biome.json` 모두 없음) | `find` 결과 |
| 포맷 | 설정 없음 (`.prettierrc*`, `.editorconfig` 없음) | `find` 결과 |
| tsconfig | 루트와 모든 패키지에 없음 | `find` 결과 |
| Node 버전 | 루트 `>=20.0.0`, core·cli·server·sdk `>=20.0.0`, `helm-kernel-v02` `>=22.5.0`, `helm-sidecar` `>=18.0.0`, `agent-docs-init` `>=18.0.0`. CI 매트릭스 18·20·22. 설계 확정 Node 24 LTS (`>=24.15.0 <25`). `.mise.toml`은 현재 없다 | 각 `package.json`, `ci.yml`, 06 §3.12.1 |
| 패키지 매니저 | npm workspaces. lockfile은 `packages/agent-docs-init/package-lock.json`(추적)과 `experiments/pi-lab/package-lock.json`(미추적). 루트 lockfile과 `pnpm-workspace.yaml`은 없다. 설계는 pnpm 11 | 루트 `package.json`, 06 §3.15 |
| 패키지 스코프 | 구현 `@helmdocs/*`, 설계 `@helm/*`, 공개 npm은 `@helmdocs/init` 하나 | 각 `package.json`, brief §3.1 |
| 의존 고정 | `durable-spike`는 정확 버전 1.1.0. `pi-lab`은 `^1.1.0`. 설계는 정확 버전 고정 원칙 | `experiments/*/package.json`, 06 §3.12.1 |
| 진입점 | `helm`은 `packages/helm-cli/bin/helm.mjs`. `agent-docs-init`은 `bin/cli.mjs` | `package.json` |
| 작업 실행기 | 구현 코드 쪽에는 just 없음. `package.json` scripts만 있다 | 루트 `package.json` |

## 5. 에이전트 지침과 작업 도구

### 5.1 지침 파일

- 워킹트리 전체에서 `CLAUDE.md`, `AGENTS.md`, `.claude/`, `GEMINI.md`, `CLAUDE.local.md`, `.cursorrules`, `justfile`, `Makefile`을 찾았으나 없었다. `.git`, `node_modules`, `.helm/`은 검색에서 제외했다.
- 찾은 것은 두 개다. 둘 다 이 프로젝트의 지침이 아니다.
  - `.helm-design-work/coordinator/agents.md`: 조정자가 쓴 에이전트 ID 메모(커밋하지 않음).
  - `.helm-design-work/P4/pi-v1.1.0/AGENTS.md`: vendored pi 저장소의 규칙. 설계 07 §3.3.3이 이 규칙(상대 import의 `.ts` 확장자, `erasableSyntaxOnly`, `verbatimModuleSyntax`)을 전제로 한다.
- 설계상 계획 (06 §3.15): `AGENTS.md`(프로젝트 규칙), `CLAUDE.md`(`@AGENTS.md` 한 줄), `justfile` + `.just/{core,node,helm}.just`, `.mise.toml`, `lefthook.yml`, `.npmrc`(`engine-strict`), `pnpm-workspace.yaml`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `scripts/check-architecture.ts`. 현재 워킹트리에는 아직 없다.
- 사용자 규칙 (06 §3.16): 빌드·검증·배포는 just 레시피로만 하고, `just verify` 통과를 완료로 본다. 종료 코드 2는 환경 문제다.

### 5.2 justfile 현황

- 현재 브랜치 `design/restructure`에는 justfile이 없다.
- `ws-adopt` 브랜치 커밋 `972d72b` "ws: adopt the justfile contract (ws repo adopt, verify, .env.example)"에 다음이 있다 (`git show`로만 읽음).
  - `justfile`: "justfile 계약 v1" 주석 8줄 규칙 (동사 사전 사용, env·target·mode 값으로 변형, 10줄 넘는 레시피는 `scripts/<이름>.sh`로). `import? '~/.config/ws/ws.just'`. 레시피 `setup`(`packages/agent-docs-init`에서 `npm ci`), `test`(`scripts/test.sh`), `verify`(`test` 후 `ws check`).
  - `.mise.toml`: just 1.58.0, jq 1.8.2, yq 4.54.1, lefthook 2.1.16, gitleaks 8.30.1.
  - `lefthook.yml`: pre-commit에서 `ws check`와 `gitleaks git --staged`.
  - `.github/workflows/verify.yml`: private 저장소 `Rengod95/dotfiles`를 `DOTFILES_TOKEN`으로 체크아웃해 `ws`, `secrets`, `remote`를 PATH에 넣고 `just verify`를 실행.
  - `.env.example`: 주석 한 줄.
- 이 계약은 외부 `ws` CLI와 개인 dotfiles에 의존한다. 설계 06의 `.just/core.just`·`node.just` 템플릿(`~/.dotfiles/templates/just/`)과도 다른 계보다. Xeon이 쓸 계약을 정해야 한다.

### 5.3 `.helm/private/`

- 이 체크아웃에는 `.helm/` 디렉터리 자체가 없다 (`ls -la` 확인). 읽지 않았다.

## 6. Xeon 추가 시 충돌과 재사용 지점

### 6.1 충돌 (우선순위 높은 순)

1. 언어·도구 관례 (TS 대 JS). 설계 정본은 TS strict, 현재 코드는 JS다. 린트·타입 설정도 현재 없다.
2. 패키지 매니저 (npm workspaces 대 pnpm 11). 설계 06 §3.12.1과 §3.15는 pnpm을 쓴다. 현재 루트 `package.json`은 미커밋이라 루트 설정이 아직 확정되지 않았다.
3. 런타임 영역 중복. Helm 설계의 12(런타임), 13(도구), 07(pi 포크)과 Xeon의 "대화형 에이전트 런타임"이 겹친다. 세 가지 관계 중 하나를 정해야 한다: Xeon을 Helm 런타임의 하위 패키지로 흡수, 독립 제품으로 분리하고 공유 부분만 재사용, Xeon을 설계 정본에 편입.
4. 문서 위치 규칙. 결정 40은 설계 문서를 `docs/design/`에 두라고 한다. `docs/xeon/`은 이 규칙의 예외이므로 Xeon 색인에 예외 근거를 적어야 한다. 설계 브랜치도 결정 40은 `design/helm-v1`로 적었으나 현재는 `design/restructure`다.
5. 이름 체계. 설계는 `@helm/*`(06 §3.4, brief §3.1), 구현은 `@helmdocs/*`, 원론은 "Docs-Agent OS", README는 "Agent Docs OS"를 쓴다. Xeon의 패키지 스코프는 아직 없다. 다만 "xeon" 이름 자체는 저장소에 없다.
6. 미커밋 상태. 루트 `package.json`, `apps/`, `experiments/`, `packages/helm-*`가 git에 없다. Xeon 커밋 범위를 기존 미커밋 파일과 분리해야 한다. 루트 `workspaces`를 바꾸면 기존 미커밋 파일과 충돌한다.
7. 깨진 참조.
   - `docs/design/24-adr.md`를 가리키는 파일이 3개다 (`docs/design/00-README.md`, `docs/design/06-system-architecture.md`, `docs/design/process/00-design-brief.md`). 실제 위치는 `archive/design-process/24-adr.md`다.
   - `docs/design/00-README.md` §4·§5가 `process/rulings-stage2a.md`, `process/implementation-readiness.md`를 인용한다. 이 파일들은 archive로 이동했고 `docs/design/process/`에는 `00-design-brief.md`만 남아 있다.
   - 06 §3.15가 계획한 `docs/adr/README.md`는 아직 없다.
8. 워크스페이스 글롭과 설계의 불일치. 06 §3.15는 `experiments/`와 `legacy/`를 워크스페이스 밖으로 정했다. 현재 루트 `package.json`은 `experiments/*`를 포함한다.
9. 글롭에 걸리지만 `package.json`이 없는 디렉터리: `apps/helm-web/`, `experiments/helm-toy/`. npm이 이를 무시하는지 오류로 보는지는 실행하지 않아 확인하지 못했다.
10. CI 범위. `ci.yml`은 `main` 브랜치만 대상이라 `design/restructure`에서 push해도 돌지 않는다. CI의 Node 18 매트릭스는 설계의 Node 24와 맞지 않는다. `ws-adopt`의 `verify.yml`을 채택할지도 정해야 한다.
11. `.gitignore`에 `dist/`, `.env`, `*.db`가 없다. 설계 06 §3.15의 목록을 참고해 추가해야 한다.

### 6.2 재사용 지점 (코드)

- `packages/helm-core/src/` (`event.mjs`, `store.mjs`, `projections.mjs`, `application.mjs`, `git-adapter.mjs`): 이벤트·저장소·투영의 JS 프로토타입. 구조만 확인했고 내용은 정독하지 않았다. 설계 09와 맞는지 대조가 필요하다.
- `experiments/helm-kernel-v02/contracts/*.schema.json` (9개): command, event, protocol, provider-turn, runtime-tool 등의 JSON Schema. Xeon의 TS 타입과 대조할 수 있다. 설계 정본은 TypeBox를 쓴다.
- `experiments/helm-kernel-v02/src/sqlite-kernel.mjs`, `src/agent-runtime.mjs`, `src/providers/openai-responses.mjs`: 커널 기반 런타임 실험. 대화형 런타임 참고 후보다. `test/agent-runtime.test.mjs`, `test/openai-provider.test.mjs`도 함께 볼 만하다.
- `experiments/pi-lab/exp1-core.mjs` ~ `exp6-tui.mjs`, `experiments/durable-spike/*.mjs`: pi-agent-core, pi-durable, pi-tui 사용 실험. 설계 07의 pi 재사용 근거다.
- `packages/helm-server/src/server.mjs`, `src/openapi.mjs`: 서버 측 참고.
- `apps/helm-web/`: 정적 GUI 참고.
- `.helm-design-work/P4/fork-proto/tsconfig.json`, `tsconfig.i5.json`, `.helm-design-work/V6/compile/tsconfig.json`, `tsconfig.typetest.json`: TS 설정 실험 (미추적). `P4/pi-v1.1.0/`은 pi 모노레포 사본으로 TS 소스를 담고 있다.
- `.helm-design-work/P7/exp-bwrap*.sh`: bubblewrap 샌드박스 실험. 설계 13 §3.6의 근거다.
- `.helm-design-work/S3a/exp-a2-tools-codemode.mjs`, `.helm-design-work/S3b/exp7-server-client.mjs`, `exp8-tui.mjs`: 도구·서버·TUI 실험.

### 6.3 재사용 지점 (설계 문서)

§3.4의 표를 그대로 쓴다. 보안(18 §3.10·§3.11), 도구 격리와 쓰기 범위(13 §3.5·§3.6), 런타임 연결점(12 §3.4), 이벤트 envelope과 해시 체인(09 §3.2·§3.10), JSON-RPC 규칙(19 §3.3), pi 포크 계획(07 §3.4·§3.5), 테스트 계층과 모델 테이프(22 §3.1·§3.5.4)가 Xeon에 직접 쓰일 수 있다.

## 7. 배치 판단 근거 (워크스페이스 충돌)

| 후보 위치 | 워크스페이스 글롭 포함 여부 | 충돌 가능성 | 비고 |
|---|---|---|---|
| `docs/xeon/` | 무관 (글롭 밖) | 낮음 | 문서 전용. `docs/design/` 정본 규칙의 예외를 색인에 명시해야 한다. |
| `xeon/` (루트 직하) | 아니다 | 낮음 | 자체 `package.json`과 lockfile을 갖는다. 루트 `workspaces`에 넣지 않으면 루트 설치에 영향이 없다. 설계 06의 `packages/`·`apps/` 트리와는 맞지 않아 나중에 옮겨야 한다. |
| `packages/xeon-*/` | 예 (`packages/*`) | 중간 | 루트 설치 때 편입된다. 설계 06 §3.15의 `packages/` 구조와 맞는다. 다만 루트 `package.json`이 미커밋이고 npm·pnpm 결정이 남아 있다. |
| `apps/xeon/` | 예 (`apps/*`) | 중간 | 설계상 `apps/`는 데스크톱·모바일·CLI 같은 앱이다. `package.json` 없는 `apps/helm-web/`과 같은 글롭에 있다. |
| `experiments/xeon/` | 예 (`experiments/*`) | 높음 | 설계 06은 `experiments/`를 워크스페이스 밖으로 정했다. 현재 `package.json`과 어긋난다. |

판단 근거는 다음과 같다.

- 문서는 `docs/xeon/`에 두면 어떤 워크스페이스와도 충돌하지 않는다.
- 코드는 npm 유지와 pnpm 전환 중 무엇을 택할지 정하기 전에는 워크스페이스 밖(예: `xeon/`)에 두는 편이 기존 미커밋 `package.json`을 건드리지 않는다.
- 워크스페이스 편입을 원하면 `packages/xeon-*/`가 설계 06 트리와 맞는다. 이때 `apps/helm-web`과 `experiments/helm-toy`의 `package.json` 부재 및 `experiments/*` 편입 문제를 함께 정해야 한다.
- `experiments/xeon/`은 설계 정본과 가장 어긋나므로 피하는 편이 낫다.

## 8. 한계

- 명령은 실행하지 않았다 (`npm install`, `npm test`, `just` 없음). npm이 `package.json` 없는 워크스페이스 디렉터리를 어떻게 처리하는지는 확인하지 못했다.
- 문서는 헤딩, 머리말, 표 중심으로 확인했다. `docs/design/` 본문 전체는 정독하지 않았다. `08-domain-model.md`, `16`, `17` 본문, `docs/study/` 본문, `docs/reference/` 조사 노트의 결론 대부분은 제목과 일부만 확인했다.
- `.helm-design-work/` 내용은 목록과 일부 경로만 확인했다.
- `ws-adopt` 브랜치는 `git show`로만 읽었고 체크아웃하지 않았다.
- npm 레지스트리에서 `xeon` 패키지 이름 사용 가능 여부는 네트워크 조회를 하지 않아 확인하지 못했다.
- 파일은 만들지 않았다. 계획 파일도 만들지 않았다.