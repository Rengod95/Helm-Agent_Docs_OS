---
id: review.m2-plan
layer: meta
domain: review
kind: review
status: draft
depends_on: [product.scope.spec, review.open-issues, review.decisions-2]
binds: []
---

# M2 구현 계획

## 1. 목적과 읽는 법

- `product.scope.spec` §4.3 M2(능력과 Helm)와 §4.4 M2 종료 조건을 구현 작업으로 나눕니다. 원천은 각 층 `plan.md`의 M2 항목과 `review.open-issues`의 열린 항목입니다.
- 이 문서는 작업을 고르고 순서를 정합니다. 작업 내용의 정본은 원천 plan의 작업 행입니다. 구현자는 작업 ID 옆 원천 ID로 해당 plan 행을 찾아 읽습니다.
- 작업 ID 형식은 `<트랙>.<번호>`입니다(예: `WEB.3`). 원천 plan에 없고 이 문서가 더한 작업은 원천 칸에 `신규`로 적습니다.
- 규모는 구현자 1명 기준 작업일입니다. 원천 plan의 S·M·L을 S=0.5~1, M=1.5~2.5, L=3~5일로 환산한 추정입니다 [가정].

## 2. 범위

### 2.1 포함

| 묶음 | 내용 | 원천 |
|---|---|---|
| L2 능력 1차 | `cap-web`(검색 단계 ①~③, fetch), `cap-mcp`, `cap-knowledge`, `cap-work`(작업·계획 승인), `cap-dialog`(질문·명령·상태줄·첨부) | L2.web/mcp/knowledge/work/dialog.plan |
| 승인 프로토콜 통합 | `approval.respond` 완성, U-19 env 주입 승인 증거 전달, 질문 도구·계획 승인·MCP 질문을 같은 `approval.requested` 레코드로 기록 | L1.tools.plan TL-5·TL-12, L4.host-service.plan H18, open-issues M-02 |
| 그룹 기반 | `group-kit` M2 항목. `group-helm` H-02~H-15는 M3로 옮겼습니다(§9 D-a) | L3.group-kit.plan, L3.helm.plan |
| 데스크톱 | Tauri 셸, 엔진 사이드카(stdio 호스트), 승인 대기열, 최소 설정 화면(키 등록, 모델 선택, 첫 실행 안내, §9 D-b) | L4.desktop.plan, L4.host-service.plan |
| 비밀 관리 명령 | `xeon secret list/add/rm/reveal`, reveal의 OS 재인증(가능한 곳) | L0.secrets.plan SC-14·SC-23, L4.cli.plan C9 |
| 이 묶음이 의존하는 하위 층 | L1 승인·위임·영속, L0 stdio 전송, X 임대 중재·리소스 레지스트리 | 각 plan M2 행 |

### 2.2 M2에서 뺌

| 항목 | 이유 |
|---|---|
| `web.browse` playwright provider(L2.web B10) | M2 종료 조건에 없습니다. 결정 D4로 M3 초입에 둡니다 |
| 첫 실행 권장 흐름(검색 ④), `web-exa`·`web-brave` 플러그인 | `product.scope.spec` §4.3이 M3에 둡니다 |
| 목표 지속·완료 보고(L2.work T9~T12), 알림(L2.dialog D11) | 원천 plan이 M3에 둡니다 |
| 위장 provider 플러그인(L1.models M-8~M-10) | L1.models.plan이 "별도 줄기"로 둡니다. M2 종료 조건과 무관합니다 |
| MCP Tasks·구독·OAuth(MC8~MC10), X 격리 실행(L-22~L-25) | 원천 plan의 2차입니다 |
| 서비스 모드, 예약, 원격(H10~H14, H20, PR-09~PR-14) | M3입니다 |
| 외부 확장 탐색·로더·훅·안전 모드(X.5: L-13, L-14, L-18, L-28, L-29, O-20~O-26, V-09) | 종료 조건 밖입니다. 결정 D9로 M3에 둡니다. 프로젝트 신뢰(X.4)만 M2에 남습니다 |
| 데스크톱 Developer ID 서명과 공증(L4.desktop D10의 macOS 공증 부분) | 결정 D3으로 M3 릴리즈 후보에 둡니다. M2는 ad hoc 서명입니다 |
| pi 메시지 스키마 깊은 검증(F.conversation.spec §10 미결 2) | M2 종료 조건과 무관합니다. 사용자 결정으로 M3에 둡니다 |
| Helm 본체 `group-helm` H-02~H-15, E1, 도구 메타(G1-05), on 핸들러 효과 목록 ADR(G1-06) | 2026-10-25 결정 D-a로 M3에 둡니다(§9, `review.m3-plan`) |
| 비밀 env를 쓰는 stdio MCP 서버 | 2026-10-25 결정 D-c로 M3에 둡니다(§9, ADR-0011) |

## 3. 트랙 규칙 (worktree 병렬 실행)

1. 트랙마다 소유 경로가 있고 트랙끼리 겹치지 않습니다. 트랙은 자기 소유 경로와 자기 층 문서(`docs/xeon/<층>/<도메인>/`)만 고칩니다.
2. 공유 파일은 한 레인만 고칩니다. 공유 파일은 `xeon/package.json`(catalog), `xeon/bun.lock`, `xeon/justfile`, `xeon/scripts/**`(새 파일 `build-sidecar.ts` 제외), `xeon/.oxlintrc.json`, `xeon/knip.json`, `xeon/.dependency-cruiser.cjs`, `xeon/turbo.json`, `xeon/tsconfig.json`, `.github/workflows/**`, `docs/xeon/_routing/routes.yaml`, `docs/xeon/review/open-issues.md`입니다. M2 초반에는 F 레인이, 끝에는 Z 트랙이 고칩니다.
3. 각 패키지의 `package.json` 의존 선언은 그 패키지 소유 트랙이 고치되, catalog 항목과 lockfile 갱신은 F.1에서 미리 끝냅니다. 그래서 worktree마다 `just setup`(잠금 파일 기준 설치)만 하면 됩니다.
4. `contracts/**`는 F 레인, `ext-host/**`는 X 레인만 고칩니다. 다른 트랙이 계약 변경이 필요하면 원천 문서 절과 함께 레인 담당에게 요청하고, 그 변경이 병합된 뒤 rebase합니다.
5. worktree: `git worktree add ../wt-m2-<트랙> -b m2/<트랙> xeon/foundation`. 병합은 `xeon/foundation`으로 rebase 뒤 fast-forward입니다. 병합 전 `just verify` 종료코드 0이 조건입니다.
6. 작업 시작 전 `just docs-route --task implement <소유 경로>`의 문서 목록을 읽습니다. 다른 층 패키지는 가짜 포트(`src/ports/*.ts` + 테스트 가짜)로 먼저 테스트하고, 실제 연결은 HOST 트랙의 조립에서 합니다.

## 4. 트랙과 작업

### 4.1 트랙 요약

| 트랙 | 소유 경로 | 선행 | 규모(일) |
|---|---|---|---|
| F 계약 레인 | `xeon/packages/contracts/**`, 공유 파일(M2 초반) | 없음 | 13 |
| X 확장 호스트 레인 | `xeon/packages/ext-host/**` | F.2(일부) | 20 |
| SEC L0 비밀 | `xeon/packages/platform-secrets/**` | F.1 | 9 |
| PLT L0 실행·전송 | `xeon/packages/platform-process/**`, `platform-exec/**`, `platform-os/**`, `platform-store/**`, `platform-sandbox/**` | F.1 | 12 |
| L1A 도구·승인·루프 | `xeon/packages/core-tools/**`, `core-loop/**` | F 완료 | 16 |
| L1B 영속·위임·태스크 | `xeon/packages/core-persistence/**`, `core-agents/**`, `core-tasks/**` | F 완료, X.1 | 22 |
| L1C 모델·컨텍스트 | `xeon/packages/core-models/**`, `core-context/**` | F 완료 | 14 |
| WEB | `xeon/packages/cap-web/**` | F 완료, L1C.3(B9만) | 24 |
| MCP | `xeon/packages/cap-mcp/**` | F 완료, X.1, L1A.4(MC5만) | 19 |
| KN | `xeon/packages/cap-knowledge/**` | F 완료, L1A.4(K6만), L1B.1(K8만) | 29 |
| WK | `xeon/packages/cap-work/**` | F 완료, L1A.4(T5·T6만) | 12 |
| DG | `xeon/packages/cap-dialog/**`, `cap-workspace/**` | F 완료, L1A.4(D2만) | 15 |
| GK | `xeon/packages/group-kit/**` | F 완료, X.1 | 20 |
| HM | `xeon/packages/group-helm/**` | GK 완료, L1A.6, L1B.4 | 18 |
| HOST | `xeon/apps/host/**` | F 완료, PLT.1, L1A.4 | 17 |
| CLI | `xeon/apps/cli/**` | F 완료, HOST.2·HOST.4 | 10 |
| DESK | `xeon/apps/desktop/**`(`src-tauri/` 포함, `src/settings/` 제외), `xeon/scripts/build-sidecar.ts` | HOST.5, 상태 관리 결정 | 30(TS 부분 10) |
| Z 통합 | 공유 파일(M2 끝), `docs/xeon/review/**` | 다른 트랙 병합 | 5 |

- 주 경로(가장 긴 의존 사슬): F → X.1 → GK → HM(UC-2 통합 시험)입니다. 약 13 + 8 + 20 + 18 = 59일입니다. L1A·L1B가 이 기간 안에 HM.9 선행(LP15, AG-2)을 끝내야 합니다.
- 두 번째 경로: F → L1A.4(승인 프로토콜) → WK·DG·MCP·HOST.4입니다. L1A.4를 L1A 트랙의 첫 작업으로 둡니다.
- 동시에 도는 worktree는 F·X 레인 둘과 SEC·PLT로 시작하고, F 완료 뒤 L1A·L1B·L1C·WEB·MCP·KN·WK·DG·GK·HOST가 붙습니다(최대 12개).

### 4.2 F 계약 레인 (초반 직렬)

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| F.1 | 공유 파일 일괄: catalog 정확 고정 추가(`@modelcontextprotocol/client` 2.3.1, `guarded-fetch` 0.1.6, `@mozilla/readability` 0.6.0, `linkedom` 0.18.13, `turndown` 7.2.4, `defuddle` 0.19.5, `age-encryption` 0.3.1, `@vscode/ripgrep`, `@opentelemetry/api` 1.10.0, React 19 패키지(결정 D2, 상태 관리 패키지는 상태 관리 결정 뒤), `@tauri-apps/cli` 2.12.3), lockfile 갱신, 허용 목록 `DR-02/group-kit-helm`·`DR-02/group-kit-learning`, WEB-R16 lint override와 check-layers 패턴, DR-07 소유 표 행(`@mozilla/readability`, `linkedom`), just 레시피 자리(`web-pricing`, `desktop-sidecar`, `desktop-run`, `desktop-build`) | open-issues M-04, L3.group-kit G-03, L2.web B6 비고, L4.desktop §2 | 없음 |
| F.2 | L2 능력 정의: `capabilities/defs/web.ts`·`web-provider.ts`, `mcp.ts`, `knowledge.ts`, `work.ts`, `dialog.ts`(1차 4개 + 2차 정의만, 순수 함수 `checkAskQuestions` 등) 와 `validateCapability` 이슈 0건 시험 | WEB B1, MCP MC1, KN K1, WK T1, DG D1 | F.1 |
| F.3 | 기록 카탈로그 `records/catalog/work.ts`(10종), `dialog.ts`, 내장 L2 카탈로그 병합 | F.records R11, WK T1, DG D1 | F.2 |
| F.4 | 서비스·포트 추가: `HostedSearchPort`(services/models), `childDecision`(policy, F 요청 9), `CommandInfoSchema`(dialog D-2), L2 공통 `ApprovalsPort` 모양 확정(L2.readme §5.7) | L1.models M2, L1.tools TL-13, L2.dialog §7, L2.work W-1·W-2·W-4 | F.2 |
| F.5 | wire 추가: `secret.beginReveal`과 in-process 값 전달 API, W16 오류 구간 표, W17 `WireMeta`·`traceparent` | L4.cli C9(spec §10-3), F.wire-settings W16·W17 | F.1 |
| F.6 | M-06·M-08 계약 부분: `ThreadStartedPayload.workspace` 사용 확정, `ThreadSummary` 등 M2 계약 모양 확정 | open-issues M-06, M-08 | F.1 |
| F.7 | 문서 정정 D-03·D-04·D-05와 F 쪽 V-08 반영 | open-issues D-03~D-05, V-08 | F.2 |

- F.2~F.6이 병합되면 "F 완료"입니다. 이후 F 레인은 요청 창구로 남고, 요청 하나를 커밋 하나로 처리합니다.

### 4.3 X 확장 호스트 레인 (초반 직렬)

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| X.1 | 그룹·MCP가 기다리는 항목: 임대 중재 설정(P-22), 상태 마이그레이션(P-23), 공급자 선택(P-27), thread별 scope 상태(P-28), group-kit 요청 4개(`LeaseCandidate.enabledAtSeq`, `leaseId` 조회, 변경 구독, 테스트 호스트 재시작), 확장 테이블 API `Result`화(N-08) | X.primitives P-22·P-23·P-27·P-28, L3.group-kit.spec §3.13, open-issues N-08 | F.2 |
| X.2 | 리소스 레지스트리 전체(P-24)와 이름 정책(O-18, O-19), UI 포트 래핑(O-07) | X.primitives P-24, X.operations O-18·O-19·O-07 | X.1 |
| X.3 | detached tap(P-25), 그룹 간 이벤트 격리(P-26), 재열기 `scope.changed` 중복(N-01), Cordis 재시작 재적용 시점(N-02, 결정 D8 (b)로 구현됨) | X.primitives P-25·P-26, open-issues N-01·N-02 | X.2 |
| X.4 | 프로젝트 신뢰: `trust/store.ts`·`resources.ts`·`resolve.ts` 포크(L-15~L-17). MCP `.mcp.json`과 프로젝트 스킬이 씁니다 | X.loading-trust L-15~L-17 | X.3 |
| X.5 | M3로 옮김(결정 D9). 외부 탐색·로더·훅·안전 모드 L-13, L-14, L-18, L-28, L-29, O-20~O-26, host 로더 사용(V-09) | X.loading-trust, X.operations, open-issues V-09 | X.4 |

### 4.4 L0 트랙

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| SEC.1 | 메타 쓰기, 감사 파일(추가 전용, fsync, 0600) | SC-02(M2), SC-09(M2) | F.1 |
| SEC.2 | 관리 서비스 메서드 `ls`, `usage`, `add`, `set`, `meta`, `rotate`, `references`, `rm`, `test`, `run` | SC-14 | SEC.1 |
| SEC.3 | `reveal`: `HumanReauth`(60초, `os-auth` 우선, 없으면 `tty-confirm`), `show` 1회 뒤 0 덮기, `secret.revealed` 감사 | SC-23 | SEC.2 |
| SEC.4 | `withBrowserInput`(M4), sops `put`·`remove`(stdin 지원 확인 뒤에만) | SC-17, SC-18 | SEC.2 |
| SEC.5 | `age-encryption` 연결과 키체인 provider Linux 확인. macOS·Windows는 기록만 남김 | open-issues M-04, SC-19 | F.1 |
| PLT.1 | 줄 단위 프레이밍, stdio 전송, 전송 적합성 스위트, 자식 엔진 임대와 shutdown 협조, `fake-engine` | PR-02~PR-05 | F.1 |
| PLT.2 | 잠금 실패 정책, 재개 후보, `ProcessPort.run`(외부 훅용) | PR-15, PR-16, PR-21 | PLT.1 |
| PLT.3 | `startBackground`, spill 위치(결정 없이 [제안] 적용: `secretEnv` 호출은 spill 끔), 포크 정리 단계 Logger(N-10) | EX-20, L0.exec R-9, open-issues M-05·N-10 | F.1 |
| PLT.4 | `@vscode/ripgrep` 연결과 `binaries.lock.json`, `openTestStore` 교체 | open-issues M-04 | F.1 |

### 4.5 L1 트랙

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| L1A.1 | 승인 대기 `next` 값 `await_input` 통일과 `isApprovalWait` 하나로(D-06), 문서 정정 | open-issues D-06 | F 완료 |
| L1A.2 | 정책 평가 전체(티어 4종, `registerRules`), 권한 모드 4종 | TL-3(M2), TL-4 | L1A.1 |
| L1A.3 | 승인 대기 복원 `ApprovalService.restore`, 승인 키 함수 정리(N-07) | TL-5, open-issues N-07 | L1A.1 |
| L1A.4 | 질문·계획 승인 통합(`kind: plan`, `question`), 비밀 `needs_approval` → 승인 연결, `await_input` 재진입 응답 연결 | TL-12, TL-18(M2), LP12 | L1A.2, L1A.3 |
| L1A.5 | 지연 노출 `tool_search`, `read_tool_output`, `runUserShell`, 태스크 엔진 M2(`limiter("tools")`, `suspendWhile`) | TL-7(M2), TL-10, TL-11, TL-16, TL-17(M2) | L1A.2 |
| L1A.6 | 자식 turn `runChildTurn`, 서브에이전트 ceiling, drive 정식 시험, 완료 게이트 상한, 추론 예산 | LP15, TL-13, LP10, LP7, LP6 | L1A.2, F.4 |
| L1A.7 | 재개 뒤 `loop.run_rejected` 원인 제거 | open-issues N-03, V-10 | L1A.1 |
| L1B.1 | 확장 레코드·상태 쓰기(`ext.commit`·`queryRecords`, kind 등록, `scopeLeaseEpoch`), 확장 투영 등록 | PS-16(ext-port), PS-4, open-issues M-01 | F 완료, X.1 |
| L1B.2 | 승인 대기 복원 `p_approvals`, 수명주기 나머지, 분기, 설정 노출, 지점 5개, 보관 정리 | PS-8(M2), PS-9, PS-10, PS-14, PS-17, PS-18 | L1B.1 |
| L1B.3 | 자식 thread 연결 `p_agents`, `TxView.agentByRequestId` | PS-23 | L1B.1 |
| L1B.4 | core-agents 전체 M2(자식 생성, 수명, 권한 교집합, 차단 목록, 결과 검사, requestId, 정의 로더, 등록, 동시 상한, `spawnRecorder`) | AG-0~AG-6, AG-9~AG-12 | L1B.3, L1A.6 |
| L1B.5 | 풀 limiter, limits 키, `next`·`aside`(결정 D7), 서브에이전트 풀 시험 | TK-4, TK-6(M2), TK-8, TK-9 | L1B.4 |
| L1C.1 | 역할 표와 라우팅, provider 등록 API, 캐시 정책, 설정 M2 키, `sk-ant-oat` 가드 | M-2, M-4, M-5, M-6(M2), M-7(M2) | F 완료 |
| L1C.2 | 나머지 지점 5개, 비밀 헤더 가림 | M-11 | L1C.1 |
| L1C.3 | `HostedSearchPort` 구현(내장 검색 래퍼용) | L1.models M2, WEB B9 선행 | F.4 |
| L1C.4 | 컴팩션 포크, 요약, 임계, `thread.compacted`, 오버플로우 복구, 캐시 표식, toolset diff, 지점 발화 | C-2~C-9 | L1C.1 |
| L1C.5 | M1 고정값 제거(토큰 예산, BlobRef 생산자, detached 필드)와 `l1.context.*` | open-issues M-07 | L1C.4 |

### 4.6 L2 트랙

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| WEB.1 | 공통 계약, 설정 키 `l2.web.*` | B2, B11 | F 완료 |
| WEB.2 | 도메인 정책, SSRF, robots, `GuardedHttp`(guarded-fetch 소스 확인 포함) | B3 | WEB.1 |
| WEB.3 | 캐시 3계층, 비용 계측 | B4, B5 | WEB.2 |
| WEB.4 | fetch 파이프라인(브라우저 승격 경로는 비워 둠) | B6 | WEB.3 |
| WEB.5 | search 레지스트리와 선택 체인 | B7 | WEB.3, X.2 |
| WEB.6 | SearXNG 감지와 provider, 내장 검색 래퍼 | B8, B9 | WEB.5, L1C.3 |
| MCP.1 | SDK 어댑터와 전송, 레지스트리 상태 기계, 인메모리 스텁 서버 | MC2 | F 완료, PLT.1 |
| MCP.2 | 서버 정의 로더·설정 14키·정책, 프로젝트 신뢰 연동 | MC3 | F 완료, X.4(신뢰 부분) |
| MCP.3 | 동적 도구 광고, 단계 경계 반영, 결과 변환 | MC4 | MCP.1, MCP.2, X.2 |
| MCP.4 | `input_required` → 승인(kind `question`) → 재시도 | MC5 | MCP.3, L1A.4, 결정 D5 |
| MCP.5 | annotations 매핑, `cap_mcp_` 상태 저장 | MC6, MC7 | MCP.3 |
| KN.1 | 스킬 포크·색인·`list`·`view`, 원장과 롤백, 위협 패턴 검사, 설정 키 | K2, K5, K7, K10 | F 완료 |
| KN.2 | 쓰기 승인 게이트와 제안 대기열 | K6 | KN.1, L1A.4 |
| KN.3 | 스킬 쓰기 연산, 메모리 스토어(쓰기 도구 광고는 여기서 켬) | K3, K4 | KN.2 |
| KN.4 | FTS5 trigram 투영기·소비자, 검색 질의 | K8, K9 | KN.3, L1B.1 |
| KN.5 | 인덱스 델타 알림 | K11 | KN.3 |
| WK.1 | 작업 모델, `task_write`, 투영기 | T2, T3 | F 완료 |
| WK.2 | 계획 객체와 버전, 모드 진입·이탈 | T4, T5 | WK.1, L1A.2 |
| WK.3 | `submit_plan` → 승인(kind `plan`), 산출물 등록 비활성 경로, 설정·명령 | T6, T7, T8 | WK.2, L1A.4 |
| DG.1 | 질문 도구 `ask`와 승인(kind `question`), 답 검증·시간 제한 | D2, D3 | F 완료, L1A.4 |
| DG.2 | 명령 템플릿 포크, 명령 등록 API | D4, D5 | F 완료, L1A.5(`runUserShell`) |
| DG.3 | 상태 세그먼트, 첨부와 `workspace.images` 최소형, 설정 13키 | D6, D7, D8, open-issues M-05 | F 완료 |
| DG.4 | 작업 폴더 root를 `thread.create`의 workspace로 계산 | open-issues M-06 | F.6 |

### 4.7 L3·L4 트랙

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| GK.1 | `defineGroup`, `groupManifest`, 상태 없는 그룹, `checkGroup`, `GroupApi` 래퍼 | G-04, G-05, G-06, G-23 | F 완료, X.1 |
| GK.2 | 임대 중재 `DriveArbiter`와 포트 어댑터 | G-07, G-08 | GK.1 |
| GK.3 | 상태 레코드 어댑터, 레코드 래퍼 검사, 설정 2키 | G-09, G-10, G-11 | GK.1, L1B.1 |
| GK.4 | `GroupService`, `/group` 명령, 상태줄, 리소스 등록 래퍼, delegate 입력 검사 | G-12, G-13, G-22, G-14(M2분) | GK.2, X.2 |
| GK.5 | `replayDrive` 최소형, smokeGroup 이전, 그룹 간 import 실패 시험 | G-15, G-16, G-21 | GK.3 |
| HM.1 | 매니페스트·레코드·상태 스키마, 설정 6키(`autoStart`, `maxLenses`, `writeGuard` 포함) | H-02, H-03, H-04, open-issues N-06 | GK 완료 |
| HM.2 | 신호, 단계 전이, 주입, 쓰기 거부, 문서 대조 시험 | H-05~H-08, H-17 | HM.1, L1A.5(도구 메타, Helm 미결 8) |
| HM.3 | drive 단계 머신 | H-09 | HM.2, L1A.6, L1B.4 |
| HM.4 | 지식 소비(저하 동작 포함), 발견 기록과 작업 연결, 명령, 조립 | H-10~H-13 | HM.3 |
| HM.5 | 재생·재개 단위 시험, UC-2 통합 시험(int, fault) | H-14, H-15 | HM.4 |
| HOST.1 | `thread.open` 잠금과 대안, `LeaseToken` 전달 | H9 | F 완료, PLT.2 |
| HOST.2 | 나머지 처리기(`thread.list/fork/revert/delete/close`, `turn.interrupt`, `events.unsubscribe`, `host.status`), 설정 쓰기 처리기 | H16, H17 | HOST.1, L1B.2 |
| HOST.3 | `secret.*` 처리기(`list`, `meta`, `remove`, `test`, `beginEntry`, `beginReveal`)와 비밀 관리 서비스 연결 | 신규(L4.host-service.plan 작업 표에 없음) | F.5, SEC.3 |
| HOST.4 | `approval.respond`, env 주입 승인 증거를 `withEnv`까지 전달(U-19), A1 요청 → SIGKILL → 재개 → 응답 한 엔진 시험 | H18, open-issues M-02 | HOST.2, L1A.4 |
| HOST.5 | 컴파일 바이너리 spike, stdio 종료 절차, 최상위 await 제거, `transport-parity` | H15, H19, open-issues M-08 | PLT.1 |
| HOST.6 | M2 능력·그룹 조립 등록(`cap-web`, `cap-mcp`, `cap-knowledge`, `cap-work`, `cap-dialog`, `group-helm`). 각 L2·L3 트랙 병합 직후 하나씩 등록 | 신규, L3.helm H-13 조립 행 | 해당 트랙 병합 |
| HOST.7 | 문서 정정 D-12(ConnectionHub, AssembleIssue, EnginePorts, 순서 규칙) | open-issues D-12 | HOST.2 |
| CLI.1 | `sessions`, `config set/reset/list`, `--set`, 슬래시 명령 | C10, C13 | HOST.2 |
| CLI.2 | 승인 프롬프트, `thread.locked` 프롬프트, Ctrl+C `turn.interrupt` | C11 | HOST.4 |
| CLI.3 | `secret` 명령(`ls`, `add`, `rm`, `test`, `reveal` TTY 전용) | C9 | HOST.3 |
| CLI.4 | `host --stdio` 컴파일 진입, `doctor`(검색 provider 상태 포함) | C16, C15 | HOST.5, WEB.6 |
| CLI.5 | 전역 시각·sleep 제거(V-02), TUI 스파이크(결정 D10) | open-issues V-02, C8 | 없음 |
| DESK.1 | spike S1~S4(종료 원인 4종, 바이너리 크기, stdio 처리량, stdin EOF) | S1~S4 | 없음(결정 D1로 툴체인 설치됨) |
| DESK.2 | Tauri 프로젝트, `engine.rs`, `relay.rs` | D2, D4, D5 | DESK.1 |
| DESK.3 | 사이드카 빌드 스크립트 `scripts/build-sidecar.ts`와 대응 시험 | D3 | HOST.5 |
| DESK.4 | UI 셸(ipc, 스레드 목록, 트랜스크립트, 입력창, 상태 표시줄), 승인 대기열. React 19(결정 D2) | D6, D7 | 상태 관리 결정, HOST.4 |
| DESK.5 | macOS FTS5 SQLite 번들 규칙, e2e(한 턴 → 종료 → 잔존 프로세스, CLI 메시지 열 비교) | D8, D11 | DESK.2, DESK.4 |
| Z.1 | 트랙이 요청한 공유 파일 변경 일괄(just 레시피, CI Linux `desktop-build` job과 `desktop-macos` job(L4.desktop 작업 D9, 결정 D1)). `xeon/knip.json`의 `ignoreIssues["package.json"]`(F.1이 미리 넣은 catalog 항목의 미사용 보고 제외)를 M2 끝에 지우고 `knip`이 catalog 오류 0건인지 확인 | 각 트랙 요청, L4.desktop D9 | 다른 트랙 병합 |
| Z.2 | M2 종료 조건 전체 실행, `review.open-issues` 상태 갱신, M2 결과 기록 | 이 문서 §5 | Z.1 |

## 5. 트랙별 시험과 종료 기준

M2 종료 조건 번호의 정본은 `product.scope.spec` §4.4.1입니다. 아래는 요약입니다.

- E0: 저장소 루트 `just verify` 종료코드 0(모든 트랙의 병합 조건). CI가 같은 검사를 돌립니다.
- E1: Helm 확산 단계 쓰기 거부, 렌즈 N개 → 서브에이전트 N개 결과 커밋 뒤 적용 턴 1회(UC-2). M3로 옮겼습니다(§9 D-a).
- E2: 같은 모델 테이프와 입력으로 CLI(in-process)와 데스크톱 사이드카(stdio, 컴파일 바이너리)의 호스트 메시지 열이 같음.
- E3: 앱 정상 종료 뒤 사이드카 프로세스 없음.

E2·E3의 재현은 `just exit-tests`(`xeon/scripts/exit-tests.txt`)가 맡습니다. E2는 `apps/host`의 `transport-parity.contract.test.ts`와 `apps/desktop`의 `sidecar.e2e.test.ts`, E3는 `apps/host`의 `stdio-shutdown.int.test.ts`와 같은 e2e 파일을 돌리고, 건너뛴 시험이 하나라도 있으면 실패합니다. `exit-tests`는 이 기기의 사이드카가 없으면 `just desktop-sidecar host`로 먼저 빌드하므로(CI의 `exit-tests` job과 `desktop-macos` job도 같은 경로) 바이너리 시험이 조용히 건너뛰어지지 않습니다.

컴파일 바이너리가 모델 테이프를 받는 길은 없습니다(모델은 조립 때 정해지고, 운영 진입에 시험 전용 환경 변수 관문을 두지 않습니다. `XEON_SCENARIO_TAPE`는 `apps/cli/test/fixtures/scenario-main.ts`라는 시험 진입이 읽습니다). 그래서 E2의 "같은 테이프로 같은 메시지 열" 비교는 `turn`을 포함한 in-process 대 stdio 쌍(`transport-parity`)이 맡고, 컴파일 바이너리에는 `turn` 없이 같은 요청열의 응답·이벤트열이 소스 진입과 같음을 e2e가 확인합니다. 바이너리의 한 턴 비교는 [미결]입니다(`L4.desktop.plan` 미결 사항).
- E4: SearXNG 주소를 설정하지 않으면 `web.search`가 내장 검색 래퍼, 설정하면 SearXNG. 실제 조립 엔진에서 확인(§9 H1).
- E5: 질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록됨.
- E6: 테스트 MCP 서버(HTTP, stdio)의 도구가 실제 엔진 도구 목록에 노출됨.
- E7: 비밀 관리 명령(목록, 등록, 삭제, 열람)과 열람의 재인증.

| 트랙 | 시험 | 종료 기준 |
|---|---|---|
| F | `validateCapability` 이슈 0건(능력 5종), 카탈로그 왕복, wire 스키마 시험 | E0. 정의 파일이 각 L2 spec §3과 같음 |
| X | X.primitives·X.operations M2 표시 시험, group-kit 요청 4개 시험 | E0. GK가 [가정] 없이 X API를 씀 |
| SEC | L0.secrets.plan §6 5번, `reveal` 재인증 실패 시 값 미출력 시험 | E7(서비스 부분). WSL은 `tty-confirm` 경로만 확인하고 `os-auth`는 기록으로 남김 |
| PLT | `transport-conformance.int.test.ts`(in-process, stdio 자식), `watchChildLease` 시험 | E2·E3의 전송 부분 |
| L1A | TL-5·TL-12 시험, 재시작 뒤 승인 대기 복원, `runChildTurn` 멱등 | E5(레코드 스키마), E1 선행 |
| L1B | M-01 그룹 drive가 `lease.released reason=error` 없이 끝남, `agent.spawned`·`settled` 순서, 재개 때 자식 재사용 | E1 선행 |
| L1C | 컴팩션·라우팅 시험, `HostedSearchPort` 테이프 시험 | E4 선행 |
| WEB | L2.web.spec §9 수용 기준 1~13, 루프백 밖 요청 0, WEB-R16 lint 실패 확인 1회 | E4 |
| MCP | `connect.test.ts` `exposes tools at next step boundary`, 테이프 스모크의 모델 요청 도구 목록, kind `question` 레코드 | E6, E5(MCP 질문 형식) |
| KN | L2.knowledge.plan §6 1~7(승인 전 불변, 원장 롤백, FTS 멱등, 테스트 그룹 호출) | 종료 조건 직접 항목 없음. HM의 저하 없는 경로 |
| WK | `plans-decision.int.test.ts`, `plans-mode.test.ts`, `plans-resume.fault.test.ts` | E5 |
| DG | `ask-flow.test.ts`(같은 레코드 형식), `ask-restart.fault.test.ts` | E5 |
| GK | L3.group-kit.plan §6 M2 행, `replayDrive` `ok: true` | E1 선행 |
| HM | `uc2.write-deny-and-n-lenses`, `resume.after-kill-in-explore`, `contracts`·`ext-host`·`group-kit` diff 0 | E1 |
| HOST | `transport-parity`(in-process와 같은 프로세스 안 스트림 쌍 stdio, 한 턴 포함, 컴파일 바이너리는 제외), `thread-locked-alternatives`, `forced-kill-resume`, `stdio-eof-checkpoint-exit`(`stdio-shutdown.int.test.ts`), 승인 응답 한 엔진 시험 | E2, E3(엔진 쪽), E5(wire) |
| CLI | L4.cli.plan §5.1 M2 시험, `secret reveal` TTY 아님 → 거부 | E7(명령 부분) |
| DESK | `test/e2e/sidecar.e2e.test.ts`(컴파일 사이드카: 소스 진입과 같은 응답·이벤트열, stdin EOF만으로 종료 0과 홈을 쥔 프로세스 없음, `host.shutdown` 응답 뒤 종료 0과 3초 안 종료), Rust 셸 시험(`just desktop-test`) | E2·E3(Tauri 부분). 환경 제약은 §6, 결정 D1 |
| Z | 위 시험 전부를 한 커밋에서 실행, 결과를 open-issues와 이 문서에 기록 | E0~E7 |

## 6. 환경 제약 (2026-10-23 확인)

| 항목 | 상태 | 영향과 대응 |
|---|---|---|
| `which cargo rustc` | 둘 다 1.99.1(rustup 사용자 영역 설치, 2026-10-24). `libwebkit2gtk-4.1`과 Tauri 시스템 패키지도 사용자가 설치함 | 결정 D1. DESK.1·DESK.2·DESK.5와 E2·E3의 Tauri 부분을 이 기기에서 실행합니다 |
| bwrap, socat | 2026-10-25 기준 bwrap 0.9.0은 있고 socat은 없음(open-issues E-02) | 샌드박스 int 시험은 socat이 없으면 종료코드 2로 알립니다. CI는 둘 다 설치합니다(G4-01). MCP stdio 서버 샌드박스는 M3에 정합니다(ADR-0011) |
| macOS | 이 기기에는 없음. 필요할 때만 씀 | 키체인(SC-19), macOS FTS5·trigram(KN 완료 기준 9), `aarch64-apple-darwin` 사이드카는 CI `desktop-macos` job(`workflow_dispatch`나 PR 라벨 `ci:macos`)이나 실기에서만 확인합니다. 공증은 M3입니다(결정 D3) |
| WSL2 벽시계 | platform-exec watch 적합성 시험 불안정(E-01) | 실패하면 한 번 재실행으로 판단합니다 |
| Secret Service(`secret-tool`) | 없음 | 키는 파일 폴백입니다. `reveal`의 `os-auth` 경로는 확인할 수 없고 `tty-confirm`만 시험합니다 |
| 있는 도구 | bun 1.4.3(mise), node 24.19.0, rustc·cargo 1.99.1, sops 3.13.3, age 1.3.2, docker, google-chrome, playwright chromium-1243 캐시 | SearXNG 수동 확인은 docker로 할 수 있습니다. 자동 시험은 루프백 가짜 서버만 씁니다 |
| `bun` 직접 실행 | mise 심이 전역 bun 버전을 몰라 실패 | `just docs-route`처럼 just 레시피로 실행합니다 |
| 네트워크·유료 호출 | 시험은 루프백만 | 래퍼 비용 측정(`just web-wrapper-measure --yes`)과 실제 코퍼스 FTS 측정은 사람 확인 뒤 실행합니다(결정 D11) |

## 7. 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| F·X 레인이 직렬이라 초반 병목 | L1·L2·L3 착수 지연 | SEC·PLT는 F.1 직후 시작합니다. F.2를 능력별 커밋으로 나눠 해당 능력이 병합되면 그 L2 트랙이 시작합니다. X.1을 X.2보다 먼저 병합해 GK를 앞당깁니다 |
| 승인 프로토콜(L1A.4)에 WK·DG·MCP·KN·HOST가 걸림 | 다섯 트랙 동시 지연 | L1A의 첫 작업으로 둡니다. 소비 트랙은 `src/ports/approvals.ts`와 가짜 서비스로 먼저 시험합니다. payload 스키마는 F `records/catalog/approval.ts`가 정본입니다 |
| 확장 레코드 쓰기 미구현(M-01) | 그룹 drive가 오류로 끝나 GK·HM 시험 불가 | L1B.1을 L1B 첫 작업으로 둡니다 |
| Helm의 코어 diff 0 조건 | HM 중 F·X·group-kit 변경이 필요하면 조건 위반 | HM 착수 전 GK를 끝내고, HM이 찾은 계약 부족은 F·X·GK 작업으로 먼저 병합한 뒤 HM을 이어 갑니다 |
| 조립 통합이 끝에 몰림 | 트랙 단위 시험은 통과하고 실제 엔진에서 실패 | HOST.6에서 트랙 병합 직후 하나씩 등록하고 CLI 테이프 스모크를 돌립니다 |
| MCP SDK 2.3.1의 Bun 동작, guarded-fetch 0.1.6 성숙도 | MCP.1, WEB.2 재작업 | 각 트랙 첫 작업에서 확인합니다. guarded-fetch가 부족하면 request-filtering-agent로 바꿉니다(L2.web.plan §7) |
| Tauri 빌드가 이 기기와 CI에서 다르게 동작 | macOS에서만 생기는 E2·E3 실패를 늦게 발견 | 결정 D1. 로컬 WSL 빌드로 반복하고, macOS는 `desktop-macos` job을 PR 라벨 `ci:macos`로 돌립니다. 엔진 쪽 종료·EOF 동작은 HOST.5와 PLT.1 시험으로 먼저 확인합니다 |
| 서브에이전트 병렬 비용 | Helm 시험·사용 비용 증가 | 시험은 테이프만 씁니다. 운영 기본값은 `maxLenses` 3과 drive 상한입니다 |
| worktree 12개 동시 진행 | 병합 충돌, 설치 시간 | 소유 경로 규칙(§3)과 lockfile 고정. 트랙 병합은 하루 한 번 묶어 rebase합니다 |

## 8. 결정

사용자가 2026-10-23~24에 정했습니다. 각 층 문서는 이 표를 `[결정: review.m2-plan §8 D<번호>]`로 인용합니다.

| # | 결정 | 고른 안 | 반영 |
|---|---|---|---|
| D1 | Tauri 빌드 환경 | 이 WSL에 툴체인을 설치합니다(rustc·cargo 1.99.1 rustup 사용자 영역, `libwebkit2gtk-4.1`과 Tauri 시스템 패키지는 사용자가 설치). macOS는 필요할 때만 씁니다. CI `desktop-macos` job은 `workflow_dispatch`나 PR 라벨 `ci:macos`로만 돌고, Linux `desktop-build` job은 Z.1에서 더합니다 | §6, L4.desktop.plan D9·§3.3 |
| D2 | 데스크톱 프런트엔드 | React 19입니다. Preact는 사용자가 동작 예측성이 낮다고 판단해 채택하지 않습니다. 상태 관리 라이브러리는 [미결]이고 조사 중입니다(`docs/xeon/L4/desktop/_research/state-management.md` 추가 예정) | L4.desktop.spec §4.12·§10 미결 11, DESK 선행 "상태 관리 결정" |
| D3 | M2 데스크톱 서명 수준 | (b) M2는 ad hoc 서명입니다. Developer ID 서명과 공증은 M3 릴리즈 후보로 옮깁니다 | §2.2, L4.desktop.plan D10·§6 |
| D4 | `web.browse`(B10) 배치 | M3 초입입니다 | §2.2, L2.web.plan B10 |
| D5 | MCP `input_required`의 책임 나눔 | (a) L1.tools가 kind `question` 승인을 올리고 `continuation`으로 재호출합니다 | MCP.4, L2.mcp.spec §10 |
| D6 | MCP stdio 서버 샌드박스 | M2는 사용자 권한으로 실행합니다. `.mcp.json`(루트와 `.xeon/mcp.json`)은 프로젝트 신뢰 뒤에만 읽습니다. 샌드박스는 bwrap 시험 환경이 생긴 뒤 정합니다 | L2.mcp.spec §10, ADR-0011 |
| D7 | `post.when = next`와 `aside` | B안(붙기만 하고 스스로 시작하지 않음) + 1안(aside는 L1·CLI 전용)입니다. F `PostWhen` 변경은 없습니다 | L1B.5, L1.tasks.spec §4.9, ADR-0013 |
| D8 | Cordis provider 재시작 뒤 scope 재적용 시점 | (b) 재적용 요청을 기록하고 다음 단계 경계에 적용합니다. X.3에서 구현했습니다 | X.3, open-issues N-02 |
| D9 | X 외부 확장 탐색·로더·훅·안전 모드(X.5) | M3입니다. 프로젝트 신뢰(X.4)만 M2에 둡니다 | §2.2, X.5, X.loading-trust.plan |
| D10 | pi-tui 채택 | 스파이크를 M2에 돌리고 한글 IME·CJK 폭 확인을 통과할 때만 1.3.0을 채택합니다. M2 종료 조건에 넣지 않습니다 | CLI.5, L4.cli.plan C8 |
| D11 | 사람 확인이 필요한 측정 | 실제 키 검색 래퍼 측정(약 20회)과 개발자 세션 DB 사본 FTS 측정은 각각 WEB.6, KN.4 뒤에 사용자 승인을 한 번씩 받습니다. 측정 전까지 비용·크기 값은 [가정]입니다 | §6 |

같은 시기에 정한 나머지 항목입니다.

| 항목 | 결정 | 반영 |
|---|---|---|
| `@vscode/ripgrep` 소유 | `platform-os`가 바이너리 경로를 제공하고 `cap-workspace`가 실행합니다 | eng.dependency-rules.guide DR-07, L2.workspace.plan |
| knip catalog 예외 | `xeon/knip.json`의 catalog 예외는 Z.1까지 둡니다 | Z.1 |
| pi 메시지 스키마 깊은 검증 | M3로 옮깁니다 | §2.2, F.conversation.spec §10 미결 2 |
| `getOrThrow` | 테스트 전용 도우미로 둡니다 | 없음 |
| env-node-spill 스트림 훅 교체 | `Reflect.get`을 쓰는 현재 방식을 유지합니다 | 없음 |
| 테스트 실행 | `just test`(`xeon/scripts/test-capped.sh`, cgroup 메모리 상한 아래에서 패키지 하나씩)로 돌립니다 | eng.toolchain.guide, eng.testing.guide |

## 9. M2 마감 결정 (2026-10-25)

완료 마일스톤 재점검(통합 항목 48건, G1~G5) 뒤 사용자가 권고대로 정했습니다. 각 층 문서는 이 표를 `[결정: review.m2-plan §9 D-<문자>]`로 인용합니다. 재점검 항목 번호(G1-01 등)의 정본은 재점검 보고서이고, 이 문서와 `review.m3-plan`, `review.open-issues`가 번호를 그대로 씁니다.

| # | 결정 | 고른 안 | 반영 |
|---|---|---|---|
| D-a | E1(Helm UC-2)과 I7의 마일스톤 | M3로 옮깁니다. 함께 옮기는 항목은 G1-05 도구 메타(`risk`, `hints`, `caller`), G1-06 on 핸들러 효과 목록 ADR, G4-04 Helm 본체(H-02~H-15)입니다. M2의 그룹 작업은 `group-kit`까지입니다 | `product.scope.spec` §4.1 I7·§4.3·§4.4.1·§4.5, `product.usecases.spec` UC-2, `adr.readme` §6, `review.m3-plan` |
| D-b | 데스크톱 최소 설정 화면 | M2에 넣습니다. 범위는 키 등록, 모델 선택, 첫 실행 안내입니다. 그래서 G5-04의 `SettingDef.stage`(선언만 하고 동작 없는 키를 화면에서 거르는 표지)도 M2로 당깁니다 | `product.scope.spec` §4.1 I14·§4.3, T7 DESK, T1 F |
| D-c | 비밀 env를 쓰는 stdio MCP 서버 | M3로 미룹니다. M2는 `McpProcessPort` 병합과 D6 ADR만 합니다 | ADR-0011, `product.scope.spec` §4.3, `review.m3-plan` |
| D-d | 지원 플랫폼 | macOS 우선, Linux 비공식, WSL은 개발 전용입니다 | `product.scope.spec` §4.7, `review.macos-checklist` |
| D-e | 실제 provider 테이프 녹화와 D11 측정 | M2 마감 전에 각각 한 번 합니다. 실행할 때마다 사용자 확인을 받습니다(종료코드 3 뒤 `--yes`) | `just tape-record`, `just bench`, `eng.performance.guide`, §11 |
| H1 | 웹 검색 기본값(사용자 지시) | SearXNG를 기본값으로 두지 않습니다. 모델용 도구는 활성 모델의 호스티드 검색을 씁니다(ADR-0005 ①). 서비스 API `web.search`의 기본값은 내장 검색 래퍼입니다. SearXNG와 키 API는 사용자가 설정했을 때만 provider 체인에 들어갑니다. 자동 감지는 없앱니다 | ADR-0005 개정(§3.1 ③, §3.3), `product.scope.spec` §4.1 I10·§4.4.1 E4, T5 cap-web, `L2.web.spec` §4.8.2·§4.8.3(L2 소유자) |

- H1의 근거는 2026-10-24 웹 검색 조사입니다. 요약은 다음과 같습니다.
  - Claude Code, Codex CLI, Gemini CLI는 모델 제공자의 호스티드 검색을 기본으로 둡니다. 별도 검색 키나 로컬 서버를 기본으로 요구하지 않습니다.
  - 조사한 런타임 가운데 자체 호스팅 SearXNG를 기본값으로 쓰는 곳은 없습니다. SearXNG는 oh-my-pi와 pi 커뮤니티 패키지에서 선택지로만 나옵니다.
  - Xeon의 SearXNG 감지는 탐침 요청에 실제 검색어를 실어 상위 검색 엔진으로 보내고, 실패가 사용자에게 잘 보이지 않습니다(`L2.web.spec` §4.8.3).
- 함께 정리한 ADR 승격(G3-03)은 다음과 같습니다. ADR-0011(D6, MCP stdio 비샌드박스), ADR-0012(속도 우선), ADR-0013(D7), ADR-0014(단일 `xeon` 바이너리)입니다.

## 10. 트랙 상태 (2026-10-26, M2 마감 병합 뒤)

`xeon/foundation` `dbef8b2` 기준입니다. M2 마감 트랙(T1~T7, Z)은 모두 `xeon/foundation`에 병합했고 아직 push하지 않았습니다. 판정(fixed, partial, missing)은 M2 마감 재검토(`be63a94..dbef8b2`, 106커밋, 2026-10-26)를 따릅니다. 재검토는 코드를 읽기만 했고, 시험 통과 수는 병합 보고서 값입니다. M1.5라는 마일스톤은 없습니다. 통합 검토 L1~L9와 후속 N-1~N-6, 재점검 G1~G5 수정, 마감 트랙은 모두 M2 안의 작업입니다.

### 10.1 마감 트랙

병합 범위의 해시는 대표 커밋입니다. 이력이 한 줄이라 트랙 사이에 다른 트랙 커밋이 섞여 있습니다.

| 트랙 | 상태 | 대표 커밋 | 재검토 판정과 남은 일 |
|---|---|---|---|
| T1 F 계약 | 병합 | b66522c(G1-08)~87f9eaa(F README), 병합 차수 추가 ac105dc, b8ad9f4, 55a9e3f | 모두 fixed. BP-11 예외 3건은 §10.3 |
| T2 HOST | 병합 | 24361c0(G1-12 조립)~0230af1, 55c8e63, 병합 차수 h2의 c12cf80, 9dda5ba, 326a949, c1afe1d | fixed: 신뢰, 명령, 재개, 제목, 설정 알림, 비밀 참조, 작업 폴더, 쪽 질의, 바이너리 점검, 수동 컴팩션, `hostedSearch` 조립, stdio MCP, `unknown_approval`. missing: G1-12 `scope.handler_failed` 발신. `L4.host-service.spec` §10 33번과 `review.m3-plan` M3-22가 추적합니다. 남은 `[미결]`: 수동 컴팩션과 `thread.revert` 겹침(`L4.host-service.spec` §10 32번). 수동 컴팩션과 `turn.start` 겹침은 닫혔습니다(31번) |
| T3 PLT | 병합 | 89ced1e(G1-04)~54ca52c(G4-01) | fixed: G1-04, G1-10, G2-05, G2-06, G2-07, G1-12 `selfTest`·`log.level`. partial: G4-01은 `sandbox.int.test.ts`가 환경이 없으면 `describe.skip`이라 `exit-tests`의 건너뜀 0 검사에 기댑니다. macOS Seatbelt는 실기에서 실제 srt 시험 8건이 한 번 통과했고 CI는 미실행입니다(`review.macos-checklist` M-03). macOS 실측 수정 브랜치 `m2c/mac`(`1a1ac35`~`3aae85e`, 5커밋)은 아직 병합하지 않았습니다 |
| T4 L1 | 병합 | 3c38739(G2-03)~4c38310(G2-11), 67dc4b4, 병합 차수 h2의 9b0300b | fixed: G2-03, G2-01 임계·오버플로와 수동 컴팩션, G2-11, G1-09, G2-10. partial: 자동 컴팩션 뒤 대화가 이어지는 시험은 루프 수준 가짜 컨텍스트뿐이고, 실제 엔진에서 작은 창으로 이어지는 host 시험이 없습니다. 재검토 결함 2(컴팩션 뒤 스킬 색인과 메모리 블록이 두 번 들어갈 가능성, PLAUSIBLE)를 두 층을 합친 시험으로 확인해야 합니다 |
| T5 L2 | 병합 | 2358033(G1-09)~be3b46f(L2 문서), f5d9f30 | fixed: H1 자동 감지 제거, `.xeon/commands` 신뢰 게이트, `McpRuntime.reload`와 작업 폴더 기준 루트, cap-knowledge 컴팩션 재주입, G4-05. partial: 공개 모드 SSRF 방어가 Bun에서 실제 DNS로 도는지 미확인(FK-11). 재검토 결함 4: 모델용 호스티드 검색(`decideModelSearchTool`)이 시험에서만 불리고 L1.models 요청에 연결되지 않았습니다(E4 `web.search`와 별개) |
| T6 CLI | 병합 | 5c30343(G1-07)~2816bb7(종단 시험), 병합 수정 4e5b338, 75170ca, b3afbca | fixed. 남은 일: CLI는 `settings.invalidated`를 구독하지 않습니다. `L4.cli.spec` §10 15번(승인 카드가 재개 질문보다 먼저 보임)은 `[미결]`입니다 |
| T7 DESK | 병합 | 6e60969(카드)~efeaf98(작업 폴더), 병합 수정 5cf7d83, dbef8b2 | fixed: 설정 화면, 첫 실행 안내, 바이너리 점검 표시, 승인·신뢰 카드, `thread.locked` 대화 상자, 작업 폴더, `untilScopesCommitted`, 원격 점검 Phase 1. partial: single-instance는 Rust 코드만 있고 두 프로세스로 확인하지 않았습니다(M-13). `snapshot_macos.rs`는 미실행입니다(M-10). 사이드카 e2e에 `turn`이 없고, 컴파일 바이너리는 로컬 빌드에만 있습니다(§11 메모). `L4.desktop.spec` §10 15번(`secret.beginEntry` `started: true` 미확인), 17번(작업 폴더를 경로로 입력)은 `[미결]`입니다 |
| Z 문서·검증 | 병합 | 8aac424(위협 모델)~9613673(온보딩), aa12722, d6184b1, 44d09c7, 1071f1a | fixed: D-a~D-e·H1 기록, ADR-0011~0014, 위협 모델, `review.m3-plan`, 미결 추적표, `review.fake-only`, 온보딩, justfile v2와 `guard.sh`, CI `exit-tests` 작업, `xeon-macos.yml`, `just tape-record`, `just bench`. partial: G5-02(이 표, 2026-10-26 갱신), G5-03(재검토 결함 6의 새 어긋남, 2026-10-26 문서 수정으로 일부 닫음), G4-02(`review.macos-checklist` 일부 채움), G2-04(`first_token` 미측정). missing: D11 측정과 `just bench --first-token` 실행 기록. 테이프 녹화는 `bef8c87`에서 했습니다 |

- 재검토 새 결함 13건의 정본은 재검토 보고서 §4입니다. 문서로 추적하는 곳은 각 행과 §10.3, `review.m3-plan`(M3-22, M3-29, M3-30, M3-41)입니다.

### 10.2 §4.1 트랙

§4.1 트랙은 모두 M2 마감 전에 병합했습니다. 셋째 열은 M2 마감에서 처리한 재점검 항목과 맡은 마감 트랙입니다. 처리 결과는 §10.1에 있습니다.

| 트랙 | 상태 | 병합 | M2 마감에서 처리한 것(재점검 번호, 맡은 트랙) |
|---|---|---|---|
| F 계약 | 병합 | 13c7241(F.1)~d828512(F.7), 9f69590(F.8) | G1-01, G1-02, G1-03, G1-07, G1-08, G1-09, G1-11 계약 필드, G2-06, G2-11, G2-12, G5-04 `stage`(T1) |
| X 확장 호스트 | 병합(X.5는 M3, D9) | 93dad8d(X.1)~8efd085(X.4) | G1-03 `.xeon/commands` 신뢰 자원 표(T5) |
| SEC L0 비밀 | 병합 | 9f045f9(SEC.1~5) | 없음. `os-auth`·키체인 macOS 확인(G4-02)은 미실행입니다(`review.macos-checklist` M-05) |
| PLT L0 | 병합 | 4a8215c(PLT.1)~4c75c7a(PLT.4) | G1-04 `McpProcessPort`, G1-10 `fileLock`, G2-05 spill 위치, G2-06 스냅샷, G2-07 외부 바이너리 점검, G4-01 샌드박스 int 시험, G1-12 `selfTest`(T3) |
| L1A 도구·승인·루프 | 병합 | 6d2bf72(L1A.1)~45016bb(L1A.7) | G1-09 origin 정리, G2-03 systemPrompt 반영 결함, G2-10 동의 표시(T4) |
| L1B 영속·위임·태스크 | 병합 | 9d5789d(L1B.1)~ced3b78(L1B.5) | G2-11 `before`·`limit`와 fork 연속성 규칙(T4) |
| L1C 모델·컨텍스트 | 병합 | 50d696f(L1C.1)~0117d3c(L1C.5) | G2-01 컴팩션 호출 배선(T4), G4-06 실제 테이프 2개(D-e, `bef8c87`) |
| WEB | 병합 | e2d80b9(WEB.1)~33a66d8(WEB.6) | H1 자동 감지 제거, G4-05 host 수준 시험(T5), G1-12 `hostedSearch` 조립(T2) |
| MCP | 병합 | 0354272(MCP.1)~40fd28e(MCP.4) | G1-04 stdio 경로(T3, T5), G2-02 대화 작업 폴더 기준(T5) |
| KN | 병합 | b27916d(KN.1)~e8e901a(KN.5) | G2-01 재주입(T5), G2-02 기준 폴더(T5) |
| WK | 병합 | ac378d5(WK.1)~9a781ff(WK.3 통합 시험) | 없음 |
| DG | 병합 | 4e8c72a(DG.1~3)~92daeec | G2-02 기준 폴더(T5) |
| GK | 병합 | 5acca50(GK.1)~efa6a6c(GK.5 문서) | 없음 |
| HM | M3로 옮김(D-a) | 없음(`group-helm`은 설정만) | G4-04, G1-05, G1-06(`review.m3-plan`) |
| HOST | 병합 | eeff08d(HOST.1)~8a96d81(HOST.6), 통합 검토 후속 be63a94까지 | G1-01·G1-02·G1-03·G1-07·G1-08 처리기, G1-12 조립, G2-02, G2-06, G2-07, G2-12(T2) |
| CLI | 병합 | 78f2705(CLI.1~4), 7d64181(CLI.5 V-02) | 명령 실행, 재개, 신뢰 카드, `xeon trust`, 비밀 참조, 동의 표시, 제목(T6) |
| DESK | 병합 | 1e6fb9f(DESK.1)~1cbc13d(DESK.4), DESK.5는 T7의 f9483e5·ca43943 | DESK.5 e2e(G4-03), G2-08 최소 설정 화면(D-b), G2-09 single-instance, 신뢰·승인 카드(T7) |
| Z 통합 | 병합, 마감 절차 진행 중(§11) | 이 문서 §9~§11 | G3-01~G3-03, G3-05, G3-06, G5-01~G5-03, G5-06, G2-13, G4-01 CI, G4-02, G4-06, G4-07, G2-04, guard 채택(Z) |

- 옛 SHA 위의 후보 브랜치 `m2/fx-host`, `m2/fx-mcp`, `m2/fx-apps`, `m2/fx-m`은 그대로 병합하지 않았습니다. 필요한 hunk는 T2·T3·T5·T6·T7이 `xeon/foundation` 위에서 다시 써서 넣었습니다. `m2/fx-l1`은 변경이 없었습니다.

### 10.3 BP-11 예외: 계약 커밋의 기계적 소비 층 수정

`eng.best-practices.guide` BP-11은 한 커밋이 한 층만 고치고, F 계약 변경과 소비 층 구현을 나누라고 정합니다. T1의 contracts 커밋 3건이 소비 층 소스를 함께 고쳤습니다. 재검토가 결함 7로 짚었고, 아래 이유로 예외로 받아들입니다.

| 커밋 | 계약 변경 | 함께 고친 소비 층 | 고친 내용 |
|---|---|---|---|
| `cdbf11d` | 승인 origin 공급 규칙(G1-09): `CallerInfo` 값과 필수 호출 문맥 | `core-tools/src/entries.ts`, cli·desktop 시험 도우미 | 직접 등록 도구의 호출에 `threadId`와 `context`를 채우는 두 줄, 시험 기대값의 `caller` 값 교체 |
| `737f5c8` | 비밀 wire 보강(G1-07): `SecretTestResult` 필드, `secret.references` | `apps/host/src/handlers/secret.ts`, cli 시험 도우미 | 늘어난 필수 결과 필드를 채움, `secret.references` 자리에 `notImplemented` 처리기 |
| `55a9e3f` | 수동 컴팩션 `thread.compact`(G2-01) | `apps/host/src/handlers/index.ts` | 철저한 처리기 표에 `notImplemented("thread.compact")` 한 줄 |

- 받아들이는 이유:
  - 처리기 표와 결과 타입은 F 메서드 목록에 대해 철저합니다. 계약만 바꾸면 소비 층이 타입 검사에서 깨집니다. 커밋마다 타입 검사가 통과하는 이력을 지키려면 소비 층을 같은 커밋에서 맞춰야 했습니다.
  - 소비 층 수정은 동작을 더하지 않는 기계적 맞춤입니다. 실제 처리기는 뒤따른 T2 커밋(`53d108b`, `326a949`)과 T4·T5 커밋이 넣었습니다.
  - BP-11의 이름 변경 예외와 같은 성격입니다. 다만 커밋 설명에 이유를 적지 않아 규칙의 "PR 설명에 이유를 적는다"는 지키지 못했습니다. 이 절이 그 기록입니다.
- 다음부터 피하는 방법 [제안]:
  - (a) F 커밋이 새 메서드를 선택 처리기 표(소비 층이 아직 처리하지 않는 메서드는 `methodNotFound`로 답하는 표)에 넣습니다. 그러면 소비 층은 고치지 않아도 타입 검사를 통과하고, 소비 층 커밋이 처리기를 더할 때 철저한 표로 옮깁니다.
  - (b) 필수 필드나 철저한 표를 바꾸는 F 변경이면, 같은 차수에 소비 층의 자리 표시 커밋을 바로 뒤에 둡니다. 두 커밋 사이에 `just check`를 F 패키지에만 돌리고, 저장소 전체 검사는 둘을 함께 병합한 뒤 돌립니다.
  - (c) 어쩔 수 없이 한 커밋에 넣을 때는 커밋 본문에 "BP-11 예외: 기계적 맞춤"과 고친 소비 파일을 적습니다.

## 11. M2 마감 절차와 종료 조건 판정

마감은 4차에서 순서대로 합니다. 판정 결과는 이 절의 표에 적습니다.

1. 각 차수 병합마다 rebase, `--ff-only`, 저장소 루트 `just verify`.
2. 재검토자 1명이 항목별 수정과 새 결함을 봅니다.
3. Mac 확인(`review.macos-checklist`). Mac이 꺼져 있으면 `ws mac queue add`로 넣습니다.
4. GitHub macOS 수동 job(`xeon-macos.yml`)을 한 번 실행합니다.
5. D-e: `just tape-record`와 `just bench --first-token`을 각각 한 번. 실행 직전에 사용자 확인을 받습니다.
6. `TURBO_FORCE=true just verify`, PR #2 갱신, 아래 표 기록.

| 조건 | 판정 | 근거(시험, 커밋, 실행 기록) |
|---|---|---|
| E0 | 미판정 | |
| E1 | M3로 옮김(D-a) | |
| E2 | 미판정 | |
| E3 | 미판정 | |
| E4 | 미판정 | |
| E5 | 미판정 | |
| E6 | 미판정 | |
| E7 | 미판정 | |

- 중간 판정 메모(M2 마감 재검토, 2026-10-26). 위 표는 `TURBO_FORCE=true just verify`와 push 뒤에 채웁니다. 그 전의 재검토 의견은 다음과 같고 판정이 아닙니다.
  - E0 부분 충족: 병합 전 각 워크트리에서 `just verify`가 통과했습니다. `TURBO_FORCE=true just verify`, push, CI 실행은 아직입니다.
  - E2 부분 충족: 컴파일 바이너리 증거가 재현되지 않습니다. `sidecar.e2e.test.ts`는 바이너리가 없으면 건너뛰고, 바이너리는 gitignore 대상이라 로컬 빌드에만 있으며 CI는 사이드카를 빌드하지 않습니다. `exit-tests.txt`의 E2 줄은 `platform-process`의 `transport-conformance`만 가리킵니다. 바이너리 e2e에는 `turn`이 없습니다. macOS 바이너리 e2e 3건은 실기에서 한 번 돌았습니다(`review.macos-checklist` M-07).
  - E3 부분 충족: 엔진 쪽(`stdio-shutdown.int.test.ts`, 사이드카 e2e)만 있습니다. Tauri 앱 정상 종료는 Rust 가짜 시험뿐이고 M-09가 비어 있습니다.
  - E4 충족(`cap-web.int.test.ts`의 설정 없음·SearXNG 설정함 두 경우), E5 충족(`approval-shapes.int.test.ts`), E6 충족(`cap-mcp.int.test.ts`, `cap-mcp-stdio.int.test.ts`).
  - E7 조건부 충족: Linux `tty-confirm`(`platform-secrets/test/admin.int.test.ts`)만 돌았고 macOS `os-auth`(M-05)는 미실행입니다.
