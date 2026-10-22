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
| Helm 1차 | `group-kit` M2 항목, `group-helm` H-02~H-15 | L3.group-kit.plan, L3.helm.plan |
| 데스크톱 | Tauri 셸, 엔진 사이드카(stdio 호스트), 승인 대기열 | L4.desktop.plan, L4.host-service.plan |
| 비밀 관리 명령 | `xeon secret list/add/rm/reveal`, reveal의 OS 재인증(가능한 곳) | L0.secrets.plan SC-14·SC-23, L4.cli.plan C9 |
| 이 묶음이 의존하는 하위 층 | L1 승인·위임·영속, L0 stdio 전송, X 임대 중재·리소스 레지스트리 | 각 plan M2 행 |

### 2.2 M2에서 뺌

| 항목 | 이유 |
|---|---|
| `web.browse` playwright provider(L2.web B10) | M2 종료 조건에 없습니다. 배치는 결정 D4입니다 |
| 첫 실행 권장 흐름(검색 ④), `web-exa`·`web-brave` 플러그인 | `product.scope.spec` §4.3이 M3에 둡니다 |
| 목표 지속·완료 보고(L2.work T9~T12), 알림(L2.dialog D11) | 원천 plan이 M3에 둡니다 |
| 위장 provider 플러그인(L1.models M-8~M-10) | L1.models.plan이 "별도 줄기"로 둡니다. M2 종료 조건과 무관합니다 |
| MCP Tasks·구독·OAuth(MC8~MC10), X 격리 실행(L-22~L-25) | 원천 plan의 2차입니다 |
| 서비스 모드, 예약, 원격(H10~H14, H20, PR-09~PR-14) | M3입니다 |
| 외부 확장 탐색·훅·안전 모드(L-13, L-14, L-18, L-28, L-29, O-20~O-26) | 종료 조건 밖입니다. 배치는 결정 D9입니다 |

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
| DESK | `xeon/apps/desktop/**`(`src-tauri/` 포함, `src/settings/` 제외), `xeon/scripts/build-sidecar.ts` | HOST.5, 결정 D1·D2 | 30(TS 부분 10) |
| Z 통합 | 공유 파일(M2 끝), `docs/xeon/review/**` | 다른 트랙 병합 | 5 |

- 주 경로(가장 긴 의존 사슬): F → X.1 → GK → HM(UC-2 통합 시험)입니다. 약 13 + 8 + 20 + 18 = 59일입니다. L1A·L1B가 이 기간 안에 HM.9 선행(LP15, AG-2)을 끝내야 합니다.
- 두 번째 경로: F → L1A.4(승인 프로토콜) → WK·DG·MCP·HOST.4입니다. L1A.4를 L1A 트랙의 첫 작업으로 둡니다.
- 동시에 도는 worktree는 F·X 레인 둘과 SEC·PLT로 시작하고, F 완료 뒤 L1A·L1B·L1C·WEB·MCP·KN·WK·DG·GK·HOST가 붙습니다(최대 12개).

### 4.2 F 계약 레인 (초반 직렬)

| ID | 내용 | 원천 | 선행 |
|---|---|---|---|
| F.1 | 공유 파일 일괄: catalog 정확 고정 추가(`@modelcontextprotocol/client` 2.3.1, `guarded-fetch` 0.1.6, `@mozilla/readability` 0.6.0, `linkedom` 0.18.13, `turndown` 7.2.4, `defuddle` 0.19.5, `age-encryption` 0.3.1, `@vscode/ripgrep`, `@opentelemetry/api` 1.10.0, 결정 D2에 따른 프런트엔드 패키지, `@tauri-apps/cli` 2.12.3), lockfile 갱신, 허용 목록 `DR-02/group-kit-helm`·`DR-02/group-kit-learning`, WEB-R16 lint override와 check-layers 패턴, DR-07 소유 표 행(`@mozilla/readability`, `linkedom`), just 레시피 자리(`web-pricing`, `desktop-sidecar`, `desktop-dev`, `desktop-build`) | open-issues M-04, L3.group-kit G-03, L2.web B6 비고, L4.desktop §2 | 없음 |
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
| X.3 | detached tap(P-25), 그룹 간 이벤트 격리(P-26), 재열기 `scope.changed` 중복(N-01), Cordis 재시작 재적용 시점(N-02, 결정 D8) | X.primitives P-25·P-26, open-issues N-01·N-02 | X.2 |
| X.4 | 프로젝트 신뢰: `trust/store.ts`·`resources.ts`·`resolve.ts` 포크(L-15~L-17). MCP `.mcp.json`과 프로젝트 스킬이 씁니다 | X.loading-trust L-15~L-17 | X.3 |
| X.5 | (결정 D9가 M2면) 외부 탐색·로더·훅·안전 모드 L-13, L-14, L-18, L-28, L-29, O-20~O-26, host 로더 사용(V-09) | X.loading-trust, X.operations, open-issues V-09 | X.4 |

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
| DESK.1 | spike S1~S4(종료 원인 4종, 바이너리 크기, stdio 처리량, stdin EOF) | S1~S4 | 결정 D1 |
| DESK.2 | Tauri 프로젝트, `engine.rs`, `relay.rs` | D2, D4, D5 | DESK.1 |
| DESK.3 | 사이드카 빌드 스크립트 `scripts/build-sidecar.ts`와 대응 시험 | D3 | HOST.5 |
| DESK.4 | UI 셸(ipc, 스레드 목록, 트랜스크립트, 입력창, 상태 표시줄), 승인 대기열 | D6, D7 | 결정 D2, HOST.4 |
| DESK.5 | macOS FTS5 SQLite 번들 규칙, e2e(한 턴 → 종료 → 잔존 프로세스, CLI 메시지 열 비교) | D8, D11 | DESK.2, DESK.4 |
| Z.1 | 트랙이 요청한 공유 파일 변경 일괄(just 레시피, CI `desktop-build` job D9) | 각 트랙 요청, L4.desktop D9 | 다른 트랙 병합 |
| Z.2 | M2 종료 조건 전체 실행, `review.open-issues` 상태 갱신, M2 결과 기록 | 이 문서 §5 | Z.1 |

## 5. 트랙별 시험과 종료 기준

M2 종료 조건 번호(`product.scope.spec` §4.4 M2 행과 §4.3 비밀 관리 행):

- E1: Helm 확산 단계 쓰기 거부, 렌즈 N개 → 서브에이전트 N개 결과 커밋 뒤 적용 턴 1회(UC-2).
- E2: 같은 모델 테이프와 입력으로 CLI(in-process)와 데스크톱 사이드카(stdio)의 호스트 메시지 열이 같음.
- E3: 앱 정상 종료 뒤 사이드카 프로세스 없음.
- E4: `web.search`가 SearXNG를 감지하면 SearXNG, 없으면 내장 검색 래퍼.
- E5: 질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록됨.
- E6: 테스트 MCP 서버의 도구가 도구 목록에 노출됨.
- E7: 비밀 관리 명령(목록, 등록, 삭제, 열람)과 열람의 재인증.
- E0: `cd xeon && just verify` 종료코드 0(모든 트랙의 병합 조건).

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
| HOST | `transport-parity`(컴파일 바이너리 stdio 포함), `thread-locked-alternatives`, `forced-kill-resume`, `stdio-eof-checkpoint-exit`, 승인 응답 한 엔진 시험 | E2, E3(엔진 쪽), E5(wire) |
| CLI | L4.cli.plan §5.1 M2 시험, `secret reveal` TTY 아님 → 거부 | E7(명령 부분) |
| DESK | `no-grandchild-left.int.test.ts`, `shutdown-message-then-exit.int.test.ts`, e2e(`*.e2e.test.ts`) | E2·E3(Tauri 부분). 환경 제약은 §6, 결정 D1 |
| Z | 위 시험 전부를 한 커밋에서 실행, 결과를 open-issues와 이 문서에 기록 | E0~E7 |

## 6. 환경 제약 (2026-10-23 확인)

| 항목 | 상태 | 영향과 대응 |
|---|---|---|
| `which cargo rustc` | 둘 다 없음. `libwebkit2gtk` 개발 패키지도 없음 | Tauri 빌드 불가. DESK.1·DESK.2·DESK.5와 E2·E3의 Tauri 부분은 이 기기에서 실행할 수 없습니다. 결정 D1 전까지 DESK는 TS 부분(DESK.3, DESK.4의 화면 로직)만 진행합니다 |
| bwrap, socat | 없음(open-issues E-02) | 샌드박스 int 시험은 건너뜁니다. MCP stdio 서버 샌드박스(결정 D6)도 시험할 수 없습니다 |
| macOS | 없음 | 키체인(SC-19), macOS FTS5·trigram(KN 완료 기준 9), 공증, `aarch64-apple-darwin` 사이드카는 CI나 실기에서만 확인합니다 |
| WSL2 벽시계 | platform-exec watch 적합성 시험 불안정(E-01) | 실패하면 한 번 재실행으로 판단합니다 |
| Secret Service(`secret-tool`) | 없음 | 키는 파일 폴백입니다. `reveal`의 `os-auth` 경로는 확인할 수 없고 `tty-confirm`만 시험합니다 |
| 있는 도구 | bun 1.4.3(mise), node 24.19.0, sops 3.13.3, age 1.3.2, docker, google-chrome, playwright chromium-1243 캐시 | SearXNG 수동 확인은 docker로 할 수 있습니다. 자동 시험은 루프백 가짜 서버만 씁니다 |
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
| Tauri를 이 기기에서 빌드할 수 없음 | E2·E3 확인 불가 | 결정 D1. 엔진 쪽 종료·EOF 동작은 HOST.5와 PLT.1 시험으로 먼저 확인합니다 |
| 서브에이전트 병렬 비용 | Helm 시험·사용 비용 증가 | 시험은 테이프만 씁니다. 운영 기본값은 `maxLenses` 3과 drive 상한입니다 |
| worktree 12개 동시 진행 | 병합 충돌, 설치 시간 | 소유 경로 규칙(§3)과 lockfile 고정. 트랙 병합은 하루 한 번 묶어 rebase합니다 |

## 8. 사용자 결정이 필요한 항목

| # | 결정 | 선택지 | 권고 |
|---|---|---|---|
| D1 | Tauri 빌드 환경 | (a) 이 WSL에 rustup(사용자 영역)과 `libwebkit2gtk-4.1-dev` 등(sudo apt) 설치 (b) CI 러너에서만 빌드 | (a)와 macOS CI를 함께 씁니다. 개발 반복(spike S1~S4, relay)을 로컬에서 해야 E3 원인 분석이 빠릅니다 |
| D2 | 데스크톱 프런트엔드 프레임워크(L4.desktop.spec §10 미결 11) | Preact + `@preact/signals` + `bun build`, 다른 프레임워크 | spec 제안대로 Preact입니다. 번들이 작고 별도 빌드 도구가 없습니다 |
| D3 | M2 데스크톱 서명 수준 | (a) Developer ID 서명·공증까지 (b) ad hoc 서명으로 M2 종료, 공증은 M3 릴리즈 후보 | (b)입니다. 인증서 확보 여부와 무관하게 M2 종료 조건(E2·E3)을 확인할 수 있습니다 |
| D4 | `web.browse`(B10) 배치 | M2 후반, M3 초입 | M3 초입입니다. M2 종료 조건에 없고 Helm은 search·fetch만 씁니다 |
| D5 | MCP `input_required`의 책임 나눔(L2.mcp.spec §10 미결 2) | (a) L1.tools가 kind `question` 승인을 올리고 `continuation`으로 재호출 (b) cap-mcp가 `ApprovalsPort`를 직접 호출 | (a)입니다. 승인 기록 경로가 질문 도구·계획 승인과 하나로 모입니다(E5) |
| D6 | MCP stdio 서버 샌드박스(L2.mcp.spec §10 미결 5) | M2에 샌드박스 적용, M2는 사용자 권한 실행 | M2는 사용자 권한 실행으로 두고 `.mcp.json`은 프로젝트 신뢰 뒤에만 읽습니다. 샌드박스는 bwrap 시험 환경이 생긴 뒤 정합니다 |
| D7 | `post.when = next`와 `aside`(L1.tasks.spec §4.9) | B안(붙기만 함) + 1안(aside는 L1·CLI 전용), 다른 조합 | spec 제안대로 B안 + 1안입니다. F `PostWhen` 변경이 없습니다 |
| D8 | Cordis provider 재시작 뒤 scope 재적용 시점(open-issues N-02) | (a) U-01 예외로 즉시 재적용 (b) 재적용 요청만 기록하고 다음 단계 경계에 적용 | (b)입니다. 단계 경계 규칙(U-01)에 예외를 두지 않습니다 |
| D9 | X 외부 확장 탐색·로더·훅·안전 모드(X.5)의 마일스톤 | M2, M3 | M3입니다. M2 종료 조건에 없고 X 레인 길이를 약 15일 줄입니다. 프로젝트 신뢰(X.4)만 M2에 둡니다 |
| D10 | pi-tui 채택(L4.cli C8, 스택 추가) | 스파이크 통과 시 1.3.0 채택, 최소 renderer 유지 | 스파이크를 M2에 돌리고 한글 IME·CJK 폭이 통과할 때만 채택합니다. M2 종료 조건에는 넣지 않습니다 |
| D11 | 사람 확인이 필요한 측정 실행 | 실제 키 래퍼 측정 약 20회(약 $0.22 추정), 개발자 세션 DB 사본 FTS 측정 | 둘 다 WEB.6, KN.4 뒤 한 번씩 승인합니다. 측정 전까지 비용·크기 값은 [가정]으로 둡니다 |
