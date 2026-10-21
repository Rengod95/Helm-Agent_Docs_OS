# pi-durable (packages/durable + coding-agent/experimental/durable) 조사 보고서

표기: [원문] 소스·문서에서 직접 확인, [추측] 추론. 약어: `D` = `packages/durable`, `S` = `D/docs/spec.md`("Pico5 specification", 규범 문서), `CA` = `packages/coding-agent/src`, `AG` = `packages/agent/src`, `ABS` = `~/projects/_ref/absurd`. 줄 번호는 pi-src 커밋 `cdaf6c2` 기준. `pi-src`는 `~/projects/_ref/pi-src`.

---
## 0. 대상 정보

| 항목 | 값 |
|---|---|
| 저장소 | https://github.com/earendil-works/pi (`git remote -v`로 확인) [원문] |
| 커밋 | `cdaf6c227d4718a72b59ccd02152c9614df44cfc`, 2026-10-11, "feat(durable): prepare images in a worker thread in /images/node" |
| 패키지 | `@earendil-works/pi-durable` 1.1.0 (`D/package.json`) |
| 라이선스 | MIT (`D/README.md` 끝, 루트 `LICENSE` "Copyright (c) 2025 Mario Zechner"). `D/package.json:122` `"license": "MIT"` |
| 언어 | TypeScript (ESM, `node --experimental-strip-types`로 예제 실행) |
| 안정성 표시 | README 첫 줄 "Experimental. The API changes without notice between releases." (`D/README.md:3`) |
| 런타임 의존 | `@earendil-works/chord`, `@earendil-works/pi-ai`, `@silvia-odwyer/photon`(이미지), `diff`, `typebox` (`D/package.json` dependencies) |
| 규모 | `D/src` 22,842줄, 테스트 36,590줄(기존 `pi-report.md` 1.1절 값). `S` 5,123줄 |
| 소비자 | `CA/experimental/durable`(TUI 코딩 에이전트), `CA/experimental/vacation`(여행 플래너 예제 앱), `CA/experimental/session-worker.ts:788`(서버 worker가 Harness를 연다) |

패키지 구성 (`D/src`): `types.ts`(저장소 계약 1,154줄), `session/`(Session·트랜잭션·관찰·fork), `storage/{memory,jsonl,sqlite}`, `harness/`(Harness·scheduler·generation·tool·compaction·registry·agent 해석), `tools/`(read/write/edit/bash), `env/`(실행 환경 추상), `images/`, `testing/`(저장소·환경 적합성 스위트).

내가 읽은 것: `D/README.md` 전체, `S`의 1~8장·10~13장 대부분(2.2 공개 표면, 3장 문서, 9장 관찰/이벤트, 8.7 compaction은 훑기만 함), `harness/{tool,scheduler(부분),registry,agent,define,generation(부분),types(부분)}.ts`, `storage/jsonl/storage.ts`·`storage/sqlite/{migrations,node}.ts`(부분), `CA/experimental/durable/{README,harness-setup,runtime(부분),sessions}.ts`, `vacation/vacation.ts`(부분), `AG/agent-loop.ts`(대조용), absurd `README`·`docs/concepts.md`·`docs/patterns/{pi-ai-agent,living-with-code-changes}.md`·`sdks/typescript/src/index.ts`(step 부분), `packages/chord/{README,PLANNING}.md`.

못 본 것 / 한계:
- 코드를 실행하지 않았다(지시). 테스트 36k줄 중 `harness-tools-recovery.test.ts`의 `it` 제목만 봤고 본문은 읽지 않았다. 규범 문서와 구현이 어긋나는지는 `tool.ts`, `scheduler.ts`의 핵심 경로만 대조했다.
- `compaction.ts`, `events.ts`(watchEvents), `view.ts`, `session/transaction.ts`, 문서 체크포인트·마이그레이션(S 3장)은 본문을 읽지 않았다.
- 얕은 clone(50커밋)이라 이력·변경 속도는 모른다. Chord 구현은 README/PLANNING만 봤다.
- absurd는 `5b97022`(2026-08-04) 작업 트리 기준이며 Postgres SQL(`sql/absurd.sql`)은 보지 않았다.

---
## 1. 한눈 요약

1. pi-durable은 "코드 재실행(replay)으로 상태를 복원하는" 방식이 아니라 "체크포인트에서 이어가는 상태 기계(task)" 방식이다. 핸들러 결정성을 요구하지 않고, 대신 단계(phase)마다 체크포인트가 바뀌어야 하며 바뀌지 않으면 fault로 처리한다 (S:1886~1890 규칙 5·6) [원문].
2. 저널이라는 별도 이벤트 로그는 없다. "Session-kernel semantic event journal"은 명시적 비목표다 (S:5115). 저널 역할은 커밋 하나에 묶인 (불변 entry, 전체 task 레코드 교체, Chord 문서 delta)이다 (S:43~44).
3. 원자성은 "한 커밋 = entry 추가 + task 체크포인트 교체 + 문서 변경 + 하위 task 생성"으로 정의된다. 외부 효과는 커밋 밖에서 실행한다 (S:63~78 불변식 1·4).
4. 부작용 도구는 "의도 커밋 → 실행 → 결과 커밋"이다. 의도에 인자와 재실행 정책이 기록되고, 재시작 시 정책이 `safe`(저장값과 현재 선언 둘 다)일 때만 재실행한다. 기본값은 `unsafe`이며 그때는 부분 출력이 담긴 `interrupted` 오류 결과를 모델에 준다 (`D/src/harness/tool.ts:163`, `:169-186`; S:3306~3312).
5. 모델 호출은 부작용이 없다고 보고 같은 모델·같은 cutoff·같은 stream 옵션으로 다시 요청한다. 스트리밍 도중 커밋된 부분 응답은 `aborted` assistant entry로 바꿔 남기고 다음 요청 컨텍스트에서는 뺀다 (S:3790~3796, `generation.ts:353-360`).
6. 자체 루프는 `pi.generation`/`pi.tool`/`pi.compaction` 세 내장 task다. agent-core의 `runLoop`(메모리 상 while 루프, 영속화 없음)와 달리 루프 상태 자체가 task 체크포인트이고 steering/follow-up 큐도 문서(`pi.inbox`)로 영속된다.
7. 확장 객체 `{tools, sections, hooks, wraps, tasks}`는 데이터 객체이고 이름으로 레지스트리에 설치·교체된다 (`types.ts:352-361`). 강제 수준은 sections·wraps=형성(3), hooks=관찰~주입(1~4, 훅별로 다름), tools=형성(3)이면서 도구 안에서 하위 대화·task를 구동하면 5, tasks=구동(5)이다. 내장 루프 자체는 교체할 수 없다.
8. tasks는 같은 프로세스 안에서 동시에 실행되는 비동기 핸들러이며 동시 실행 개수 상한은 코드에서 찾지 못했다. 소유 트리, `background` 경계, `waiting`(자식 대기), 아래→위 순서의 abort를 가진다 (S:2156~2243).
9. absurd와는 코드·문서 의존이 없다. 같은 조직(earendil-works)의 별개 제품이고, absurd 쪽 `pi-ai-agent.md` 패턴은 pi-durable이 아니라 `pi-agent-core`의 `runAgentLoopContinue`를 쓴다. 모델도 다르다(Postgres, 코드 재실행 + 이름 붙은 step 캐시, 리스 기반).
10. 가장 큰 제약은 단일 프로세스 소유(프로세스 간 잠금 없음), SQLite `synchronous=NORMAL`(전원 손실 시 마지막 커밋 유실 가능), 저장소 오류 = Harness 종료, 확장은 코드로만 설치(매니페스트·파일 탐색 없음)이다.

---
## 2. 층별 표

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| F 메시지/이벤트 스키마 | pi-ai `Message`를 `EntryRecord.model`에 담는 불변 entry. 이벤트 스트림은 커밋에서 파생(`watchEvents`) | S:151, S:4368~; `D/src/harness/events.ts:29-160` | 실험 |
| F 도구 스키마 | TypeBox `parameters` + `defineTool`. 결과 3채널 `output/structuredOutput/details` | `D/README.md` Tools 절; S:2763~2880; `define.ts:12-15` | 실험 |
| F 세션 로그 형식 | SQLite 테이블(conversations/entries/tasks/submissions/documents/document_revisions) 또는 JSONL(main + doc/task sidecar) | `sqlite/migrations.ts:10-88`; `jsonl/storage.ts:25-58`; S:4897~4964 | 실험 |
| F 확장 매니페스트 | 없음. 코드 객체 `Extension` | `harness/types.ts:352-361` | 실험 |
| F 설정 | `HarnessSettings`, 매 사용 시 읽는 getter, 저장하지 않음 | `types.ts:508-538`; `CA/.../harness-setup.ts:25-47` | 실험 |
| F 버전 정책 | task `version`+`migrate`, 문서 `version`+`migrate`, 저장 포맷 버전(JSONL `FORMAT_VERSION=1`, SQLite 스키마 migration) | S:1898~1912; `jsonl/storage.ts:25`; `sqlite/migrations.ts:88-113` | 실험 |
| L0 OS 추상 | `ExecutionEnv`(파일·exec·watch), 호출마다 `env()` 콜백으로 생성 | `D/README.md` Environment; `env/node.ts` | 실험 |
| L0 프로세스 모델 | 한 프로세스가 저장소 소유. 프로세스 간 잠금 없음. coding-agent 쪽은 디렉터리 잠금(10초 후 stale) | `D/README.md` Storage; `CA/.../durable/README.md`; `sessions.ts:2`(proper-lockfile) | 실험 |
| L1a 태스크 엔진 | 내구 상태 기계 + 스케줄러(직렬 예약, 병렬 실행) + 소유 트리 | S:1641~2243; `scheduler.ts` | 실험 |
| L1b 에이전트 루프 | `pi.generation` task의 phase: prepare/request/retry/poll/tools | S:3707~3868; `generation.ts:118-250` | 실험 |
| L1c 모델 게이트웨이 | pi-ai `Models`를 그대로 사용(`streamSimple`, `fetchDeferred`) | S:3540~3546 | 실험 |
| L1d 도구 디스패치 | `pi.tool` task, `beforeTool`/`afterTool`, `callers`, 중첩 호출 | `tool.ts:109-200`; S:2763~3320 | 실험 |
| L1e 컨텍스트 조립·컴팩션 | head 마커 + edits 기반 컨텍스트 도출, `pi.compaction` task | S:257~294, 3995~4157 | 실험 |
| L1f 세션 영속 | 원자 커밋, resume, requestId 중복 제거, fork, 부작용 불명 처리 | S:1571~, 1898~1933, 2245~2375 | 실험 |
| L1g 서브에이전트 | task 소유 하위 conversation, 같은 프로세스 | `D/README.md` Abort and Subagents; `test/examples/22,23` | 실험 |
| L2 내장 도구 | read/write/edit/bash(+이미지) | `D/src/tools/*` | 실험 |
| L2 MCP/skills/memory | durable 패키지에는 없음. 호스트가 확장으로 구성(`prompt.ts`가 skills/AGENTS.md 섹션) | `CA/.../durable/README.md` Layout | - |
| 확장 지점 | 6종 객체 + 레지스트리 설치/교체 + 대화별 선택 | S:2376~2635 | 실험 |

---
## 3. 층별 상세

### 3.0 구조 개요: 무엇이 "저널"인가

핵심 규칙 한 줄 (S:43~44): "A Session atomically commits immutable entries, full task records, and Chord-tracked documents. Only committed state is observable." [원문]

기록 단위는 네 종류다.

| 단위 | 성격 | 근거 |
|---|---|---|
| Entry | 불변, Session 전역 순서 ID, `kind`/`model`(pi-ai 메시지)/`data`/`head`/`edits`/`byTaskId` | S:151~161 |
| Task 레코드 | 살아 있는 동안 "전체 교체"되는 상태 기계 레코드(`state`, `input`, `memos`, `abortRequested`, `owner`, ...) | S:1649~1700 |
| Document | 가변 JSON 상태. Chord 연산(delta) + 가끔 전체 base로 저장 | S:965~, `D/README.md` Your Own State |
| Submission | 외부 입력의 대기·배치·완료 레코드 | S:164~215 |

별도의 "사건 순서 로그"는 없다. 의미 이벤트 채널도 의도적으로 없다: "There is no public semantic event channel; current UI status is document state" (S:2657~2658). 이벤트가 필요하면 `watchEvents`가 커밋에서 파생해 준다(한 커밋당 한 배치, 100배치 이상 뒤처지면 snapshot으로 대체: S:4527, `D/README.md` Agent Events). 감사용 전체 전이 이력이 필요하면 "각 사실을 불변 entry로 남기고 직접 스캔하라"고 명시한다 (S:5056 "Buffered watches").

Entry의 모델 컨텍스트 도출은 순수 함수 규칙이다 (S:262~290): 최신 head 마커에서 시작, edits(omit/replace)는 최신 것이 이김, assistant의 도구 결과를 호출 뒤로 재배치, **결과 없는 호출에는 오류 결과를 합성**(규칙 8, S:280), `aborted`/`error`/`deferred` assistant 메시지는 이후 요청에서 제외(규칙 9). 이 규칙 덕분에 "중단된 꼬리"를 별도 수리 없이 읽는 쪽에서 복구한다.

### 3.1 F 계약

- 메시지 스키마: pi-ai `Message`를 그대로 쓴다. 단 pi-ai PR #9548의 `SystemMessage` 계약을 전제하며 `sections`/`toolsAdded`/`toolsRemoved`를 가진 위치 기반 시스템 메시지를 transcript에 기록한다 (S:6~8, 첫머리 인용 블록). 즉 시스템 프롬프트와 도구 노출 변화도 `pi.system` entry로 남는다 (S:3557~3565; "Pico always writes `content: ""`").
- ID: 숫자 브랜드 타입(`Id<"entry">` 등), 컴파일 타임 전용. 저장소에선 일반 숫자 (S:90~110). `Seq`는 커밋 순번(gap 허용).
- 세션 로그 형식 두 가지.
  - SQLite: 한 SQL 트랜잭션 = 한 Session 커밋 (S:4899~4900). 테이블 `conversations, entries, tasks, submissions, documents, document_revisions, record_ids, durable_metadata` (`migrations.ts:10-86`). 스키마 버전 1 (`:88`). 살아 있는 task 전이는 "한 행 교체", 종료 task는 작은 레코드로 남김 (S:4905~4907). 커밋은 `db.transaction` 하나 안에서 table write와 document action을 적용 (`sqlite/storage.ts:179-189`).
  - JSONL: `main.jsonl`(표·문서 레코드·커밋당 마커 한 줄) + `doc-<id>.jsonl`, `task-<id>.jsonl` sidecar (S:4919~4923, `jsonl/storage.ts:25-58`). 발행 절차: sidecar에 완전한 레코드 추가 → main 마커 한 줄 추가 → 성공 후 메모리 발행 (S:4925~4930). 마커가 커밋 지점이다.
- 확장 매니페스트: 없음. 확장은 TS 객체이고 이름 문자열만 저장된다 (`D/README.md` Extensions: "Nothing in the registry is stored; conversations store extension names").
- 설정: `HarnessOptions.settings`는 저장되지 않고 매번 읽는다. getter로 파일 설정에 연결 가능 (`D/README.md` Settings; `CA/.../harness-setup.ts:25-47`). 대화별로 저장되는 것은 `pi.agent` 문서(모델, thinking, 확장 이름, tools 필터, modelTools, instructions, cwd) 뿐이다 (S:2560 해석 표).
- 버전 정책: task 정의는 `name`+`version`+`migrate(input, checkpoint, fromVersion)` (S:1655~1710). 저장 버전이 더 새롭거나 정의가 없거나 migrate가 실패하면 task는 `pending`/`waiting`에서 **막힌 채로 유지**되고 종료시키지 않는다 (`missing_task`/`task_too_old`/`migration_failed`, S:2062~2092). 내장 `pi.tool`은 version 2이며 version 1 입력을 `kind:"model"`로 이전한다 (`tool.ts:114-121`). 문서 kind·내장 task 이름은 영속 프로토콜이라 이름 변경 불가 (S:5044 "Schema stability").

### 3.2 L0 플랫폼 / 프로세스 모델

- 실행 환경: `HarnessOptions.env`가 도구 호출·섹션 렌더·`runtime.env()`마다 `ExecutionEnv`를 만든다. 대화 ID와 agent `cwd`를 받으므로 대화별 디렉터리나 컨테이너로 분기 가능 (`D/README.md` Environment). `env` 구성에서 던지면 해당 호출의 오류 결과가 된다. 복구 시 재실행 도구는 환경을 다시 만들며 그때의 현재 `cwd`를 쓴다 (S:5087 "Environment on recovery") [원문].
- 샌드박스·비밀·알림: durable 패키지 범위에 없다.
- 프로세스 모델: "One process owns a storage at a time; there is no cross-process locking" (`D/README.md` Storage). coding-agent 데모는 `proper-lockfile`로 세션 디렉터리를 잠그고 비정상 종료 후 10초 지나야 stale 처리한다 (`sessions.ts:2`, `CA/.../durable/README.md`). 서버 모드에서는 세션마다 worker 프로세스가 Harness를 연다 (`CA/experimental/session-worker.ts:788`).
- 이식성: SQLite·JSONL 코어는 Node API 없이 `SqliteDatabase`/`FileSystem` facade 위에서 돌고 Cloudflare Durable Object 어댑터가 있다 (`D/README.md` Storage 표).

### 3.3 L1a 태스크 엔진

정의 (S:1641~1830):

- `TaskState` = `pending | running | waiting(on, policy) | completing | terminal`. 체크포인트 `S`는 `{phase: string, ...}` 합집합이며 `phases`는 phase 이름별 핸들러 맵이다 (`defineTask({name, version, initial, phases, abort, migrate?, hooks?})`, S:1760~1790).
- 핸들러는 `runtime.commit(change)`로만 상태를 바꾼다. 콜백이 돌려준 다음 상태가 같은 커밋에서 교체되므로 "체크포인트 + entry + 문서 + 자식 task 생성"이 원자적이다 (S:1830~1850). `Tx`에는 task 교체 연산이 없다 (같은 곳).
- 단계 사이 규칙 (S:1876~1891): 매 phase 앞에서 스케줄러가 Session 줄 위에서 한 번 규칙을 적용한다. (1) 종료/completing/waiting이면 중단 (2) Session 종료 중이면 체크포인트와 abort 표시를 보존하고 중단 (3) abort 표시가 있으면 run 호출을 끝내고 abort 호출로 교체 (4) 잡히지 않은 오류 → terminal `faulted` (5) 체크포인트가 바뀌었으면 다음 phase 호출(또는 정의가 바뀌었으면 handover) (6) **체크포인트가 그대로면 `faulted`** ("no durable progress was made").
- 병렬성: 스케줄러는 적격 task를 직렬로 예약(`#reserve`)하고 핸들러는 줄 밖에서 실행한다 (S:1972~1974). `#drain`이 예약된 task마다 `#start`하며 (`scheduler.ts:1102-1107`) 동시 호출 상한을 두는 코드는 grep(`concurren|limit|maxRunning`)으로 찾지 못했다 [원문, 부재 확인은 grep 한정].
- 소유 트리 (S:2156~2243): 모든 task는 소유자(대화 또는 task)를 만들 때 지정해야 한다 (`TaskOptions.ownership` 필수). 소유 작업은 소유자의 종료 뒤로 살아남지 못한다: 소유 작업이 살아 있으면 소유자는 `completing`에서 대기한다. abort는 위로→아래로 표시되고 실행 순서는 아래→위(자식 abort 핸들러가 먼저)다 (S:2226 "Abort order is bottom-up").
- `waiting`: 핸들러가 `{status:"waiting", checkpoint, on:[...], policy:"failFast"|"allSettled"}`를 커밋하면 코드 실행 없이 대기하고, `on`이 모두 terminal이 되면 체크포인트에서 재개한다 (S:2214~). `failFast`는 첫 실패 시 나머지 자식에 abort 표시한다. 이것이 fork-join의 내구 형태다 (예: `test/examples/24-child-tasks.ts`의 4건 결제).
- `background`: 대화 소유 task에만 허용. 대화 abort·idle 판정·cascade의 경계이며, `root.abort(ctx, {background:true})`로만 건넌다 (S:2010~2030, 2156~2170).
- `memo(name, candidate)`: task 봉투에 저장되는 first-writer-wins 작은 값. 후보 삽입과 승자 읽기가 한 커밋이다 (S:1930~1934). 후크도 같은 네임스페이스를 공유한다 (S:2657, 5036 "Hook memo names").
- 재시작 시 포기: `abandonOnRestart: true`인 task는 생성자가 메모리에서만 기다리던 것이라 다음 Harness가 스케줄링을 시작할 때 `abortReason:"restart"`로 abort된다 (S:2094~2110). replay 불가 도구가 만든 중첩 호출과 `api.createTask()` 자식은 자동 적용 (`D/README.md` "Tasks a restart abandons").
- 정의 교체(handover): phase 경계마다 레지스트리 스냅샷을 새로 받고, 이름으로 찾은 정의 객체가 달라졌고 새 정의가 task를 받을 수 있으면 task를 `pending`으로 돌려 새 정의로 새 호출을 시작한다 (S:2144~2155). 한 phase 안에서 안 끝나는 핸들러는 handover되지 않는다.

### 3.4 L1b 에이전트 루프 (자체 루프)

`pi.generation`은 버전 1이고 `{phase:"prepare", attempt:1}`에서 시작한다 (S:3745, `generation.ts:118`). 체크포인트 phase는 다음과 같다 (S:3715~3745, `generation.ts:53-90`).

| phase | 하는 일 | 체크포인트에 고정되는 값 |
|---|---|---|
| prepare | 에이전트 해석, 시스템 델타(`pi.system`) 추가, 컴팩션 임계 검사 | - (`compacted`, `overflow`) |
| request | 부분 응답 정리 후 모델 스트리밍 | `model`, `thinkingLevel`, `streamOptions`, `cutoff`(요청에 포함된 최신 entry) |
| retry | 백오프 sleep | `until` (벽시계) |
| poll | deferred provider 결과 폴링 | `handle`, `pollAt` |
| tools | 도구 라운드 대기 | `assistant` entry, `tools` task ID 목록, 아직 시작 안 한 `pending` 호출 |

흐름 요점 [원문, S:3770~3868]:
- 결과 분류는 한 커밋에서: `stop/length`→ 답을 쓰고 run 입력을 `done`으로 정산(또는 `onYield` 연속). `toolUse`→ assistant entry와 도구 task 생성을 같은 커밋에서. 문맥 초과 `error`→ 컴팩션 task를 만들고 `waiting`. 재시도 가능 `error`→ `retry`. 그 외 `error`→ 입력 `unanswered(model_error)`로 정산하고 실패.
- 종료 조건: 답이 나오면 final 경계, 도구 라운드 전체가 `terminate`를 요구하거나 어느 결과가 `handoff`를 요구하면 라운드 후 run 종료 (S:3293~3300, 3939~3950).
- 도구 라운드 병렬/순차: `settings.toolExecution`(기본 병렬)이 `sequential`이거나 호출된 도구 중 하나라도 `executionMode:"sequential"`이면 순차. 순차일 때는 첫 호출만 task를 만들고 나머지는 체크포인트의 `pending`에 두며 한 건씩 이어서 만든다 (`generation.ts:562-593`, S:3835~3855). 병렬이면 전부 한 번에 task를 만든다. 결과 entry는 `pi.live.tools` 슬롯에서 읽고 호출 순서대로 정렬된다 (S:3941~3944).
- `afterTools` 후크, `addTools` 처리, `postTools` 경계(steer 배치)는 라운드 끝 한 커밋에서 이루어진다 (S:3936~3955).

agent-core(`AG/agent-loop.ts`)와의 차이:

| 관점 | agent-core | pi-durable |
|---|---|---|
| 루프 표현 | `runLoop`의 중첩 while(바깥: follow-up, 안: 도구·steering), 메모리 상태 (`agent-loop.ts:163-310`) | `pi.generation` task phase. 상태가 체크포인트 |
| 진행 영속 | 없음. 호출자가 이벤트(`message_end`)를 받아 직접 저장 | 매 단계 커밋. 스트리밍 부분 응답·도구 출력도 100ms 스로틀로 커밋 (`D/README.md` Watching) |
| steering/follow-up | `PendingMessageQueue` 두 개, 메모리 (`AG/agent.ts:143,191-192,247-248`) | `pi.inbox` 문서 + 제출(Submission) 레코드, 경계(`postTools`/`final`)에서 결정적으로 선택 (S:2255~2340) |
| 도구 병렬 | `executeToolCallsParallel` 내부 `Promise.all` (`agent-loop.ts:586-658`), 순차 판정 동일 규칙 (`:508-523`) | 도구마다 별도 task, 부모(generation)가 `allSettled`로 대기 |
| 도구 종료 신호 | `terminate`가 모든 결과에 있으면 종료 (`agent-loop.ts:691`) | 같은 규칙 + `handoff`, `addTools` |
| 컴팩션 | `prepareNextTurn` 같은 콜백으로 호출자가 | `pi.compaction` task, 임계·overflow 대응이 루프에 내장 |
| 재개 | `runAgentLoopContinue(context, ...)`를 호출자가 부름 | Harness 재오픈 후 `resume()` |
| 루프 교체 | `AgentLoopConfig` 콜백과 `streamFn` | 내장 task는 교체 불가 (S:2490 "nothing uninstalls or replaces them"), 후크로만 개입 |

`D`는 agent-core를 import하지 않는다 (`D/package.json` 의존성에 없음) [원문]. 문서 안에서 agent loop는 `terminate` 규칙을 설명할 때 한 번만 언급된다 (S:3295 "as in the pi agent loop").

### 3.5 L1c 모델 게이트웨이

`HarnessOptions.models`(pi-ai `Models`)를 그대로 쓴다. 모델 어댑터를 따로 두지 않는다 (S:3540~3546). 대화마다 `pi.provider` 문서에 UUIDv7 `sessionId`를 두고 pi-ai의 `sessionId`로 전달해 provider 캐시·세션 친화성에 쓴다. 리셋·컴팩션·모델 변경 뒤에도 유지, fork·자식은 새 ID (S:766~775, `D/README.md` Persist and Resume). 프롬프트 캐시 보호 장치: 섹션 변화만 델타로 전송하고 시스템 메시지를 선두로 옮겨 도구 목록 변경이 캐시를 무효화하지 않게 한다 (S:289~294, 3440~3470; 섹션이 시간 등으로 매번 바뀌면 캐시가 깨진다고 명시: S:5093).

### 3.6 L1d 도구 디스패치·권한

`pi.tool`은 version 2, 시작 phase `call` (`tool.ts:114-122`). 한 핸들러 안에서 순서대로 한다 (`tool.ts:123-168`):

1. assistant entry에서 호출 읽기, 에이전트의 `tools`에서 이름 해석. 없으면 `tool_unavailable` 결과.
2. `prepareArguments`(순수 보정) → TypeBox 검증 → `beforeTool` 체인 → 재검증. 실패는 각각 `invalid_arguments`/`blocked` 결과로 정산, 의도 기록 없음.
3. **의도 커밋**: 슬롯을 `running`으로, 체크포인트를 `{phase:"execute", arguments, replay}`로 한 커밋에서 바꾼다 (`tool.ts:160-165`). `replay`는 도구 선언의 `replay ?? "unsafe"`.
4. 같은 핸들러가 실행하고 `afterTool` 체인 후 결과 entry를 커밋. `isError` 결과도 `completed`로 끝나고 run은 계속된다 (S:3896~3908).

권한: 별도 권한 시스템은 없고 `beforeTool`의 `{block}`이 전부다. 후크가 던지면 호출이 차단된다 (`tool.ts:141-148`). 접근 범위는 `callers`(`model`/`tools`)와 대화별 `modelTools`·`tools` 필터로 좁힌다 (`D/README.md` Who may call a tool). 함정으로 명시된 것: 배열 선택에서 가드 확장을 빼면 가드 없이 돈다, 레지스트리 전역 훅·래퍼는 없다 (S:5076 "Guards left out of a selection") [원문].

중첩 호출 `api.executeTool(name, args, ctx, {key})` (S:2900~2960, `D/README.md` Calling tools from tools): 중첩 호출도 자기 `pi.tool` task이며 부모 task가 소유한다. 키(기본은 호출 순서)로 식별하므로, `replay:"safe"` 부모가 재실행되어 같은 순서/키로 호출하면 이미 만든 중첩 호출을 다시 시작하지 않고 되돌려 받는다. 결과는 부모 task 문서(`NestedCallDoc`)에만 있고 transcript에는 들어가지 않는다. replay 불가 부모의 미완 중첩 호출은 재시작 시 폐기된다.

### 3.7 L1e 컨텍스트 조립·컴팩션 (내구 관점만)

- 컴팩션은 `pi.compaction` entry에 요약을 쓰고 `head`가 첫 유지 entry를 가리킨다. 원본 entry는 삭제되지 않는다 (S:3552~3556).
- 임계값 둘: `contextWindow - reserveTokens` 초과면 generation이 컴팩션을 만들고 `waiting`(블로킹), 그보다 `backgroundTokens` 낮은 지점부터는 백그라운드 컴팩션을 조용히 시작한다 (S:3770~3790, `generation.ts:307-324`).
- 컴팩션 중 늦게 끝난 요약이 이미 더 깊은 cut이 있으면 `stale`로 정산 (S:2330~2350). 요약은 head write라서 앞선 cut에 막힌다는 규칙으로만 순서가 정해진다.
- 요약 도중 들어온 응용 편집은 잃을 수 있다고 문서가 인정한다 (S:4989 "Heads and edits during compaction").

### 3.8 L1f 세션 영속성 — 이번 조사의 중심

#### (1) 저장 원자성

- 불변식 (S:63~78): 한 커밋은 모든 기록·문서 쓰기에 대해 원자적. 문서 갱신은 저장 성공 후에만 공개. 눈에 보이는 진행은 모두 내구적(휘발성 공개 경로 없음). 외부 효과는 Session 변경 트랜잭션 안에서 실행 금지. 저장소 오류는 치명적.
- 커밋 콜백은 비동기일 수 있으나 Session의 변경 줄(mutation line)을 점유한다. 콜백 안에서 모델·도구·네트워크를 기다리지 말라는 규칙이 있다 (S:5026 "Long transactions"). 표 읽기는 첫 표 쓰기 전에만 허용(`ReadAfterWrite`, S:1626).
- 오류 규칙 (S:4830~4887, `D/README.md` Errors): 저장소 오류 → 해당 호출 reject, 이후 모든 호출·대기는 `SessionFailed`, watch는 `session_failed`로 종료, Harness 자동 close. 재시도는 저장소 내부 몫. "call that threw may or may not have committed" 이므로 재오픈 후 같은 `requestId`로 재제출하면 이미 수락된 제출을 찾는다. 사용자 코드 오류는 해당 단위(task fault, 도구 오류 결과, 후크 보고 후 건너뜀, 커밋 롤백)만 실패시킨다.
- 내구성 수준 [원문]:
  - SQLite: WAL, `synchronous = NORMAL` (`sqlite/node.ts:190-192`, `D/README.md` Storage 표) → 프로세스 크래시는 안전, 전원/호스트 장애에서 최신 커밋 유실 가능.
  - JSONL: 기본은 fsync 없음. `{fsync:true}`면 sidecar를 flush한 뒤 main 마커를 추가. 단 main.jsonl 자체는 일반 발행 때 flush하지 않아 "acknowledged tail commit may still disappear" (S:4932~4945). 복구: 찢어진 마지막 줄 제거, 미확인 sidecar 꼬리 무시·삭제(`jsonl/storage.ts:731`, `:802`), 확인된 sidecar 데이터가 없으면 손상으로 열기 실패 (S:4949~4956). 불확실한 append 실패는 저장소를 poison (`JsonlStoragePoisonedError`, `jsonl/storage.ts:93`). 전체 이력을 메모리에 올리므로 장기 구동은 SQLite 권장 (`D/README.md`). `main.jsonl`은 압축하지 않는다 (S:4962).
  - 프로세스 간 잠금 없음, 한 저장소 한 소유자.

#### (2) 재개(resume)

열기·재개 절차 (`scheduler.ts:288-318`, S:1898~1915):

1. `Harness.open`이 저장소를 열고 스케줄러 `open()`이 살아 있는 task(`pending/running/waiting/completing`)를 전부 로드한다. `running`이던 것은 한 커밋에서 `pending`으로 되돌린다(체크포인트·abort 표시 보존). `waiting`은 그대로, `completing`·`waiting`은 재평가.
2. 이 시점에는 아무것도 실행하지 않는다 ("Dispatches nothing", `scheduler.ts:288`). `harness.resume()`이 스케줄링을 켠다(`scheduler.ts:321-324`). 제출이나 대기 호출도 스케줄링을 시작시킨다 (`submissions.ts:55,76`, `D/README.md` Persist and Resume).
3. 예약 시점에 정의를 이름으로 찾아 버전 비교 후 migrate, 같으면 그대로 `running` (S:2058~2070). 정의가 없으면 `pending` 상태로 막혀 있다가 레지스트리가 바뀔 때마다 재고려(`registry.subscribe(() => this.#kick())`, `scheduler.ts:290`).
4. 재시작 후 이어지는 모델 요청은 `request` phase가 체크포인트의 같은 `model/thinkingLevel/streamOptions/cutoff`를 써서 같은 메시지를 다시 보낸다. `beforeRequest` 후크는 다시 실행된다 (S:3797~3800). 정규 `prepare`가 아닌 `request`에서 복구하므로 도구·섹션 구성이 요청 도중 바뀌지 않는다.
5. 제출 멱등성: `requestId`가 대화 안에서 제출을 중복 제거한다 (`submissions.ts:155-160`, S:2310 부근). `harness.submission(id)`로 재획득해 `wait()` 가능.
6. 변경된 정의의 핫 스왑: 앞의 handover 규칙.
7. 닫을 때 `close()`는 task 결과를 쓰지 않는다. 호출을 신호로 멈추고 재오픈 후 재개된다 (S:2011 "`close()` stops every invocation ... without writing an outcome"). 협조하지 않는 코드가 있으면 close가 끝나지 않는다 (S:5096 "Non-cooperative code at close").

#### (3) replay (복원 방식)

용어 정리가 중요하다. pi-durable에서 "replay"라는 단어는 세 가지 다른 뜻으로 쓰인다.

| 쓰임 | 의미 | 근거 |
|---|---|---|
| transcript replay | `pi.system` 델타를 순서대로 적용해 현재 프롬프트·도구 상태를 얻는다 | S:3395, 3455~3466 |
| document replay | base + 이후 delta를 재생해 문서 값을 만든다. `checkpointWhen()`이 base 시점을 정해 재생 길이를 제한 | S:1434~1486, 4686 |
| 도구 `replay` 정책 | 도구를 재시작 후 다시 실행해도 안전한가 | S:2851, 3306 |

즉 **핸들러 코드를 처음부터 다시 돌려 결정적으로 상태를 복원하는 Temporal/absurd식 replay는 없다**. 핸들러는 체크포인트에서 다시 호출될 뿐이며 이전 호출의 로컬 변수는 모두 사라진다. 따라서 결정성 요구는 코드 전체가 아니라 두 곳에만 걸린다.
- 도구 재실행: 부작용·무작위·시간·변하는 설정 읽기 값은 재실행 시에도 같아야 하는 것이면 먼저 memo·체크포인트·task 입력에 캡처해야 한다 (S:3165~3170). "Recovery does not rerun `beforeTool` and passes the same stored arguments".
- 섹션 렌더러: "Renderers must be deterministic for equal inputs" (S:3440). 아니면 매 요청 시스템 델타가 생겨 캐시를 깬다. 정합성 요구가 아니라 비용 요구다.
- 후크: "a crash before the consuming commit may rerun them" (S:2644). 그래서 후크의 결정은 memo로 first-writer-wins로 고정하도록 안내한다 (S:2657).

#### (4) 부작용 도구 결과 불명 처리

"Effect sandwich" (S:1917~1928): 의도 커밋 → 외부 효과 → 결과/다음 phase 커밋. "Reopening in an intent phase means the effect may have happened. The phase handler retries safely, polls an external handle, or records interruption."

도구에 대한 구체 규칙 (`tool.ts:169-186`, S:3306~3312):
- 의도 단계에서 죽었고 저장된 정책과 현재 선언이 모두 `safe` → 저장된 인자로 `beforeTool` 없이 다시 실행. 이때 슬롯의 이전 진행 표시를 지운다 (`tool.ts:173-178`).
- 그 외(기본 `unsafe`, 현재 선언이 unsafe로 바뀜, 도구가 더 이상 해석되지 않음) → 커밋된 부분 출력·details·diagnostics를 담은 `interrupted` 오류 결과 `"Tool X was interrupted and may have partially run"`를 쓰고 task는 `failed`로 끝난다 (`tool.ts:182-185`). 모델이 그 결과를 읽고 다음 행동을 정한다. 현재 `safe`라도 저장된 정책이 unsafe면 승격하지 않는다 (S:3308~3309).
- 의도 커밋 이전에 죽었다면 `call` phase부터 다시 시작하므로 `beforeTool`이 다시 돈다. 이때 효과는 아직 없다 (`harness-tools-recovery.test.ts:213`의 테스트 제목 "reruns beforeTool when interrupted before intent, and executes once" [원문, 본문 미확인]).
- 재시작으로 abandon된 중첩 호출은 abort 핸들러가 `interrupted`(실행 중이었음)와 `abandoned`(시작 전)를 구분한다 (`tool.ts:190-198`).
- `replay:"safe"`라도 외부 효과가 있는 도구는 자체 멱등성이 필요하다: "a replay-safe tool with external effects still needs its own idempotency" (S:2938~2940). 즉 pi-durable은 exactly-once를 약속하지 않고, **안전하다고 선언된 도구에 한해 at-least-once, 나머지는 at-most-once + 불명 표시**다. [판단]
- 결과 entry가 없을 때: 도구 task가 fault/orphan으로 끝나 결과 entry가 없으면 컨텍스트 도출 규칙 8이 오류 결과를 합성한다 (S:2121~2128, 280).
- 모델 요청 쪽: 응답 수신 전 죽음 → 같은 요청 재전송(부작용 없음 가정). 커밋된 부분 응답 → `aborted` assistant entry로 변환되어 transcript에 남고 usage에는 집계, 이후 요청 컨텍스트에서는 제외 (S:3574, 3790). 제공자 비동기(deferred) 요청은 `poll` phase에 핸들러(`DeferredHandle`)를 저장해 재시작 후에도 폴링한다 (S:3735~3742).
- `bash` 같은 도구의 기본값은 `unsafe`다. `CodingTools`가 어떤 도구를 `safe`로 선언하는지는 확인하지 못했다. 서브에이전트 예제는 `replay:"safe"`로 선언하고 자식 대화를 `scanConversations({ownerTaskId})`로 다시 찾는다 (`D/README.md` Abort and Subagents, `vacation.ts:44`).
- 알려진 한계 [원문]: 커밋 간격(기본 100ms) 안의 부분 출력은 유실될 수 있다 (`D/README.md` Watching, S:5063 "Durable progress cadence"). 스스로 외부에 멱등 키를 전달하는 일(예: 결제 `key`)은 작성자 몫이다 (S:1936~1944 예제).

#### (5) fork·분기

`conversation.fork(entryId)`는 부모 entry를 cap까지 보고 독립 진행한다. 에이전트 선택은 fork 지점의 것을 복사하고 `pi.provider`는 새로 발급한다 (`D/README.md` More Conversations and Forks, S:2520 인근). 문서는 `fork: "initial"|"current"|"asOf"` 정책을 정의 토큰에 둔다 (S:1521~1570). 소유된(자식) 대화는 owner의 `pi.agent`를 만들 때 한 번 복사한다 (S:5084 "Copies are one-time").

### 3.9 L1g 서브에이전트·멀티에이전트

- 서브에이전트는 도구가 `api.commit()` 안에서 `createConversation({ownership:{kind:"task", taskId: api.taskId}})`로 자식 대화를 만들고 `api.conversation(id).submit(...)`로 입력을 넣은 뒤 `wait()`하는 패턴이다 (`D/README.md` 코드 예, `test/examples/22-subagent-foreground.ts`). 같은 프로세스·같은 Harness·같은 저장소다. 별도 프로세스가 아니다.
- 권한 상속: 자식은 소유 대화의 `pi.agent`를 만들 때 복사한다(모델·확장·tools·cwd). 예제는 자식에서 서브에이전트 확장을 빼 재귀를 막고 더 싼 모델을 지정한다. 이후 owner의 변경은 반영되지 않는다 (S:5084).
- 생명주기: 소유자 abort → 자식 abort. 부모가 idle이 되려면 자식도 idle. `background:true` task가 만든 대화는 부모의 abort와 busy 판정을 건너뛴다 (`D/README.md` Abort and Subagents).
- 결과 반환: 포그라운드는 도구 결과로, 백그라운드(`23-subagent-background.ts`)는 reporter task가 후속 입력(follow-up)으로 부모에 게시하고 `requestId`로 재시작 중복 게시를 막는다. 비용 이중 집계 주의 (S:5004 "Double-counted subagent spend").
- `vacation.ts:60-133`은 `tasks:[Research]`로 백그라운드 task를 확장에 넣고, 도구가 그 task와 자식 대화를 만들어 보고를 되돌려 받는 완성 예이다.

### 3.10 L2 능력

내장 도구는 `read/write/edit/bash`와 `CodingTools` 묶음뿐이다. 파일·프로세스 접근은 모두 `api.env`를 통한다. MCP 브리지·지식·메모리·skills는 패키지에 없다. `CA/.../durable/prompt.ts`가 pi의 시스템 프롬프트(도구, 규칙, 문서, AGENTS.md, skills, cwd)를 확장 하나로 감싼 것만 있다. 코딩 에이전트 데모가 "Not here"라고 밝힌 것: 세션 목록/재개 선택기, 포크·트리 이동, 확장, 프롬프트 템플릿, 이미지, `/login` (`CA/.../durable/README.md` 끝).

### 3.11 확장 지점

#### (1) 확장 데이터 객체와 강제 수준

`Extension = {name, tools?, sections?, hooks?, wraps?, tasks?}` (`harness/types.ts:352-361`). 강제 수준은 템플릿의 다섯 단계(1 관찰, 2 차단, 3 형성, 4 주입, 5 구동)로 분류한다.

| 항목 | 정의 | 강제 수준 | 근거·메모 |
|---|---|---|---|
| `sections` | 이름 붙은 프롬프트 조각의 렌더 함수. `undefined`를 돌려주면 생략 | 3 형성 | 선택된 확장의 섹션을 순서대로 렌더. 같은 key는 뒤가 덮어씀 (S:2573) |
| `tools` | TypeBox 스키마 + `execute`. 이름이 같으면 뒤 확장이 앞을 대체 | 3 형성(도구 노출). 도구 안에서 `api.commit`/`createTask`/`conversation().submit`/`executeTool`을 쓰면 하위 흐름을 5 구동 | S:2573, 2825~2880. 결과의 `control:{addTools,terminate,handoff}`는 도구가 루프 종료·도구 노출을 바꾸는 3~4 |
| `wraps` | 이름으로 찾은 도구·섹션의 데코레이터(`wrapTool`/`wrapSection`) | 3 형성 | 선택된 확장 순서대로 적용. 던지거나 이름을 바꾸면 그 도구를 제공하지 않고 `onReport` (S:2581). 래퍼가 대상 `execute`를 호출하지 않으면 사실상 대체 |
| `hooks` | task 이름에 거는 핸들러 (`hook(ToolTask, {...})`) | 훅별로 1~4 (아래) | 사건이 아니라 "task가 커밋 전에 묻는 질문" (S:2638~2642) |
| `tasks` | `defineTask` 정의. 이름으로 전역 해석, 대화 선택 여부와 무관 | 5 구동 | `types.ts:359` 주석 "Resolved by name for every task, whichever conversations select this extension". 내장 루프를 대체하지는 못함 |

훅별 수준과 합성 규칙 (S:2644~2656의 표, 시그니처 S:2672~2744):

| 훅 | 수준 | 합성 | 일반 throw |
|---|---|---|---|
| `GenerationTask.beforeRequest` | 3 형성(그 요청의 messages 교체) | 교체 체인 | 보고 후 계속 |
| `afterResponse` | 1 관찰 | 전부 관찰 | 보고 후 계속 |
| `onYield` | 4 주입(`{continue: UserInput}`로 user 메시지를 붙이고 run 계속) | 첫 연속이 승리 | 보고 후 계속 |
| `afterTools` | 1 관찰 | 전부 관찰 | 보고 후 계속 |
| `ToolTask.beforeTool` | 2 차단(`block`) + 3 형성(인자 재작성) | 인자 교체 체인, 첫 block 승리 | **호출 차단** |
| `afterTool` | 3 형성(결과 대체) | 결과 교체 체인 | 보고 후 계속 |
| `CompactionTask.beforeCompact` | 2 차단(`decline`) / 3 형성(자체 `summary`) | 첫 결정 승리 | 보고 후 계속 |

`tasks`가 5인 이유 [판단]: 확장 코드가 `phases` 핸들러로 스케줄러에 의해 실행되고, `runtime.commit`으로 entry·문서·하위 task·대화를 만들고 다른 대화에 입력을 제출하며 `waiting`으로 자식을 기다린다. 즉 흐름을 직접 진행한다. 단 이 구동은 task 단위이고, 사용자 입력→응답의 기본 사이클(generation/tool)은 내장 task가 소유한다. 반대로 `sections`/`wraps`/`hooks`는 어느 것도 루프의 순서를 바꾸지 못한다(`onYield`의 연속만 예외적 주입).

#### (2) 설치·선택·토글

- 설치: 호스트 코드가 `createRegistry()` 후 `registry.install(ext)` (`D/README.md` Extensions; `CA/.../harness-setup.ts:52-57`는 `CodingTools`와 pi 프롬프트 확장을, `runtime.ts:133-134`는 `Subagent`를 설치). 매니페스트·패키지 탐색·권한 선언·서명은 없다. 이름이 같으면 제자리 교체, 다르면 뒤에 추가 (`registry.ts:73-80`). `uninstall`은 이름으로 제거 (`:82-86`).
- 검증: `install()`은 교체 후 레지스트리 전체를 검증해 task 이름 충돌·같은 확장 안 도구/섹션 중복·섹션 key 형식(`^[a-z][a-z0-9_-]*$`)·예약 key `instructions`를 위반하면 throw하고 아무것도 발행하지 않는다 (`registry.ts:26,96-106`, S:2495~2500). `defineExtension()`·`section()` 자체는 검사하지 않는다.
- 선택: 대화가 `pi.agent.extensions`에 **이름**을 저장한다. 미설정이면 `settings.extensions` 또는 설치된 전부(설치 순서) (`agent.ts:245-264`, S:2560~2580). 배열은 "정확히 이것들", `{add, remove}`는 호스트 기본 선택을 편집. 확장·도구는 객체로 넘겨도 이름으로 저장된다.
- 토글 시점: 런타임 중 언제든 가능하며 진행 중 작업에는 영향이 없다. 도구 호출은 시작한 구현으로 끝난다. 새 코드는 다음 phase·요청·호출부터 적용된다. 한 phase는 레지스트리 스냅샷을 한 번만 취한다 (S:2506~2516, `D/README.md` Reload). 모델·프롬프트·노출 도구는 요청이 준비된 순간 고정된다. 확장 선택 변경은 다음 `prepare`에서 `pi.system` 델타로 transcript에 남고, 이 때문에 기본 선택을 따르는 대화는 설치·설정 변경마다 프롬프트 캐시를 놓친다 (S:5090~5093 "Moving default selections").
- 충돌·순서: 도구 이름은 확장 간 중복 허용, 뒤 확장이 앞을 대체; 래퍼는 이긴 도구에 적용; 훅은 확장 순서. task 이름은 전역 유일. 확장 간 의존 선언은 없다.
- 실패 격리: 사용자 코드 오류는 해당 단위만 실패(후크 throw는 보고 후 건너뜀, `beforeTool` throw는 차단, 도구 throw는 `tool_error` 결과, task phase throw는 task `faulted`). 프로세스·스레드 격리는 없다. "forced termination of non-cooperative extension code inside one process"는 명시적 비목표다 (S:5123). 확장을 제거해도 이미 시작된 호출은 계속되므로 자원 해제는 확장이 참조 카운트로 직접 해야 한다 (S:2553).
- 이름이 코드보다 오래 산다: 제거된 확장을 선택한 대화는 그 확장을 단지 받지 못하고, 다시 설치하면 복귀한다. 그 확장의 `tasks`가 남아 있으면 해당 task는 정의가 올 때까지 막혀 있다 (S:2062~2092).
- 확장 간 상태 공유: 확장 전용 JSON 문서(`defineDoc`, scope/history/fork 정책) (`D/README.md` Your Own State). 예: 플랜 모드는 문서 + `beforeTool` 훅으로 구현되고 `configure()`/문서 변경으로 대화별 토글 (S:2706~2722, `test/examples/27-plan-mode.ts`).

#### (3) Chord와의 관계

짧게. `D`는 Chord를 두 용도로 쓴다: `Context`(취소·호출값 전달, `BACKGROUND_CONTEXT`)와 문서 상태 추적/복제(`replicatedState`, delta `Op`, `copyJson`) (`D/src`에서 `@earendil-works/chord` import 약 40건; `D/docs/pico-v5-chord-usage.md:1-30`). 반대로 **pi-durable의 확장 레지스트리는 Chord facet 시스템이 아니다**. Chord는 "Pi 패키지에 의존하지 않는" 범용 facet/서비스/복제 상태 런타임이며 (`chord/PLANNING.md:5-40`, `chord/README.md`) Session·Harness·tool·hook 같은 용어를 Chord 개념으로 만들지 않는다고 못 박는다 (`PLANNING.md:35~39` 부근). 둘의 접점은 호스트 쪽에서 Harness를 Chord 서비스로 공개하고 클라이언트가 복제 상태를 구독하는 층이다 (S:1911의 "hosting layer withdraws services ... disposing its Chord facet host"). 따라서 "확장 설치·선택"을 Chord facet과 같은 것으로 보면 안 된다. 기존 `pi-report.md` 0절의 세 시스템 구분과 일치한다.

---
## 4. absurd와의 관계

### 4.1 사실 관계

- 코드·문서 참조 없음: `pi-src`에서 `*.md`, `*.ts`, `*.json` 전체를 대소문자 무시로 "absurd" 검색했을 때 결과가 없었다 [원문, grep]. `D/package.json`에 absurd 의존도 없다.
- 같은 조직: pi 저장소는 `github.com/earendil-works/pi`, absurd 문서는 `earendil-works.github.io/absurd`와 `earendil-works/absurd` (`ABS/README.md`). 라이선스는 pi=MIT, absurd=Apache-2.0 (`ABS/LICENSE`).
- absurd의 pi 연동 문서 `docs/patterns/pi-ai-agent.md`는 `@mariozechner/pi-agent-core`의 `runAgentLoopContinue`를 쓴다(`:11-17`, `:97`). 이 import 이름은 현재 pi의 패키지명(`@earendil-works/pi-agent-core`)과도 다르다(pi-src `AG`는 같은 패키지, 이름이 이전 scope인 것은 [추측]: absurd 문서가 개명 이전에 작성). 즉 absurd 패턴은 pi-durable 위에 올라간 것이 아니라 pi-agent-core + absurd의 조합이다.
- 결론: pi-durable은 absurd를 대체·래핑·사용하지 않는다. 두 제품은 같은 문제(LLM 에이전트 내구 실행)에 대한 독립된 두 해법이다 [원문 + 판단].

### 4.2 모델 비교

| 관점 | absurd | pi-durable |
|---|---|---|
| 저장소 | Postgres 필수, SQL 한 파일(`ABS/README.md`) | 내장: SQLite/JSONL/메모리/Cloudflare DO |
| 복원 방식 | 핸들러를 처음부터 다시 실행하고 이미 끝난 `step`은 캐시 값을 돌려줌. "Code outside steps may execute multiple times" (`ABS/docs/concepts.md:87`) | 핸들러를 체크포인트 phase에서 호출. 이전 로컬 변수 없음 |
| 단계 정의 | `ctx.step(name, fn)` 이름 있는 체크포인트. 같은 이름 반복은 `name#2`로 번호 부여 (`sdks/typescript/src/index.ts:265,351-362,430-433`) | task phase 이름 + 체크포인트 값. phase는 합집합 타입 |
| 결정성 요구 | 코드 변경 시 step 이름/결과 호환을 작성자가 관리 (`docs/patterns/living-with-code-changes.md:1-30`) | 요구 없음. 정의 버전 + `migrate` |
| 부작용 처리 | 의도 기록 없음. step 도중 죽으면 step 전체가 다시 실행되므로 step이 멱등이어야 함 (`concepts.md:87,131-133`). 리스 만료 후 겹침 실행 가능 | 의도 커밋 + 도구별 `replay` 정책, 기본 `unsafe`는 재실행하지 않고 `interrupted` 결과 |
| 외부 이벤트 | `awaitEvent`/`emitEvent`, 이름당 첫 emit 승리 (`concepts.md:139`) | 제출(Submission)·문서 변경·자식 task `waiting`. 이름 있는 외부 이벤트 큐는 없음 |
| 병렬 일꾼 | 풀 기반 pull, 리스, 여러 프로세스 | 한 프로세스가 저장소 소유 |
| 재시도 | run(시도) 단위 백오프, step 캐시 공유 | 모델 요청은 정책(`retry`) phase, 도구는 재시도하지 않음(결과로 모델에게 알림) |
| 에이전트 의미론 | 없음. 일반 워크플로 | transcript·도구·컴팩션·steering이 일급 |

### 4.3 absurd 패턴의 공백 (보고용)

`pi-ai-agent.md`는 `message_end`마다 `step`을 하나씩 완료로 기록하고 재시도 시 로그에서 컨텍스트를 만든 뒤 마지막 메시지가 assistant가 아니면 `runAgentLoopContinue`로 이어간다. 코드상 `last.role === "assistant"`이면 stopReason을 보지 않고 "이미 끝남"으로 반환한다(`pi-ai-agent.md:91-94`). 마지막이 도구 호출을 담은 assistant 메시지(도구 실행 전 크래시)라면 이어가지 않고 끝낼 수 있다 [추측: 코드만 읽은 결론, 실행 안 함]. 도구 결과를 `message_end`로 기록하는 순간 이전에 죽으면 도구가 다시 실행될 수 있으나 그 정책 선언은 없다. 이것이 pi-durable이 의도/정책/합성 오류 결과로 메우는 지점이다.

---
## 5. 채택 판단

### 5.1 그대로 가져다 쓸 수 있는 것

| 대상 | 패키지 경계 | 라이선스 | 의존 | 이유와 조건 |
|---|---|---|---|---|
| `@earendil-works/pi-durable` 전체 | npm 패키지(1.1.0) | MIT | chord, pi-ai, photon, diff, typebox | 내구 대화 런타임이 필요하면 가장 가까운 부품. 단 pi-ai 메시지 타입과 Chord 문서·Context에 강하게 묶임. API 무고지 변경이라 버전 고정과 포크 가능성 전제 |
| 저장소 어댑터(SQLite/JSONL) + 적합성 스위트 | `pi-durable/storage/*`, `pi-durable/testing`의 `registerStorageConformance` | MIT | 없음(Node 내장 SQLite 또는 facade) | Session 커밋 API가 맞는 경우에만. 자체 저장소를 쓰려면 적합성 스위트를 그대로 돌릴 수 있다는 점이 재사용 가치 |
| `ExecutionEnv` 계약 + 적합성 스위트 | `pi-durable/env` | MIT | 없음 | 셸·파일 추상. 대화별 환경 생성 방식이 단순함 |

주의: 위는 "코드 재사용 가능성"이지 Helm 요구에 맞는다는 뜻이 아니다. Helm이 JSONL 호환 세션 로그를 이미 가정한다면 pi-durable의 로그 형식(SQLite/JSONL main+sidecar)은 pi 코딩 에이전트의 JSONL 세션과 호환되지 않는다 [원문: `CA/experimental/durable`은 별도 `session.sqlite`를 쓰고 안정 pi는 다른 JSONL] 점을 확인해야 한다.

### 5.2 설계만 참고할 것

1. 의도 → 효과 → 결과의 3단 + 도구별 `replay: "safe"|"unsafe"`(기본 unsafe) + 저장 정책과 현재 선언 둘 다 safe일 때만 재실행. 결과 불명 문제에 대한 가장 명시적인 답이다.
2. "결과 없는 호출은 읽는 쪽이 오류 결과를 합성" (컨텍스트 도출 규칙 8): 로그를 고치지 않고 읽기 규칙으로 중단을 수습한다.
3. 부분 스트림은 `aborted` 메시지로 보존하되 모델 컨텍스트에서만 제외: 사용량·감사 기록을 잃지 않는다.
4. `requestId`로 제출 멱등성 확보, 저장소 오류 시 "커밋됐을 수도 있다"를 전제로 한 재제출 규약.
5. 소유 트리 + `completing` 보류 + 아래→위 abort: 서브에이전트·백그라운드 작업의 수명 규칙.
6. 체크포인트 불변 규칙(진전 없으면 fault)과 phase 경계의 정의 handover(핫 리로드와 내구성의 결합).
7. 모든 가시 진행을 커밋 후에만 노출 (불변식 3): UI가 저장 안 된 것을 보여주지 않는다. 대가는 커밋 간격(기본 100ms) 내 유실 가능.
8. 도구 결과 3채널(`output` 모델용 / `structuredOutput` 프로그램용 / `details` UI용).
9. 확장을 "이름만 저장하는 코드 데이터"로 두고 대화별 선택을 저장하는 분리: 코드 교체와 상태 영속이 독립.
10. 후크를 "커밋 직전 질문"으로 정의하고 합성 규칙(체인/첫 승리/전부 관찰)과 throw 정책을 훅별로 표로 고정한 점.

### 5.3 피할 것

1. 프로세스 간 잠금 없는 단일 소유 저장소 전제: 다중 클라이언트/데몬 구조에서는 Helm이 따로 소유권 규칙을 만들어야 한다. 데모의 디렉터리 락(stale 10초)도 임시 해법이다.
2. SQLite `synchronous=NORMAL`, JSONL 기본 무fsync: 전원 손실 시 마지막 확인된 커밋 유실 가능. 내구 요구가 "응답한 것은 잃지 않는다"라면 설정을 바꾸거나 다른 저장소가 필요.
3. 저장소 오류 = Harness 종료, 재시도는 저장소 책임: 장기 상주 프로세스에서는 재오픈 루프를 호스트가 구현해야 한다 (`harness.closed`).
4. 확장 설치가 코드 객체 전용: 서드파티 확장 배포·권한·격리가 필요하면 별도 계층이 필요. 프로세스 격리 없음(비목표).
5. JSONL 백엔드의 전체 메모리 적재와 `main.jsonl` 무압축: 장기 세션에 부적합 (README가 직접 경고).
6. 내장 루프 교체 불가: 루프 정책(재시도, 도구 라운드, 경계)을 바꾸려면 포크해야 한다. 후크는 좁은 지점만 연다.
7. 도구 기본값 `unsafe`가 안전하지만 재개 시 모델에게 "중단됨"만 전달: 사용자 확인 흐름이나 자동 보상(abort 핸들러에서 취소 호출)은 도구 작성자가 직접 만들어야 한다.
8. Chord 문서 모델 의존: delta 추적의 성능 이슈가 문서에 정리되어 있다(2백만 점 문서에서 JS 힙 약 139.5 MiB, `D/docs/chord-delta-findings.md`). 큰 문서를 확장 상태로 쓰는 설계는 피하고 entry/별도 저장으로 둘 것 [원문].

---
## 6. 다른 대상과 비교할 때 볼 특징

1. **체크포인트 재개이지 코드 replay가 아니다.** 핸들러에 결정성 요구가 없고 phase 체크포인트가 바뀌지 않으면 fault. Temporal/absurd식과 구분되는 가장 큰 설계 선택.
2. **별도 이벤트 저널이 없다.** 불변 entry + task 레코드 교체 + 문서 delta가 한 커밋으로 묶이며 UI 이벤트는 파생물이다. "저널을 따로 두지 않는다"를 비목표로 못 박았다.
3. **의도/정책 기반 결과 불명 처리.** 도구별 `replay`, 저장 정책과 현재 선언의 교차 검증, 부분 출력이 담긴 `interrupted` 결과.
4. **루프가 task다.** 에이전트 루프, 도구 호출, 컴팩션이 모두 같은 내구 상태 기계이고 사용자 확장 task와 같은 스케줄러·소유 트리를 공유한다. 확장 task는 5 구동, 내장 루프는 교체 불가.
5. **steering/follow-up이 영속 문서이고 경계에서 결정적으로 배치**된다. 메모리 큐인 agent-core와 대비.
6. **구조적 동시성**: 소유 트리, `completing` 보류, `background` 경계, 아래→위 abort, `abandonOnRestart`.
7. **확장은 이름만 저장되는 데이터 객체이며 대화별 선택이 영속**된다. 훅은 task 종류에 걸리고 선택된 확장에서만 작동한다(전역 훅 없음).
8. **정의 버전 불일치는 종료가 아니라 "막힘"**: 코드가 돌아올 때까지 task 상태를 보존한다.
9. **absurd와는 독립**: 같은 조직이지만 기술적 연결이 없고, absurd의 pi 연동은 pi-agent-core 기반이며 도구 부작용 정책이 없다.

---
## 7. 확인하지 못한 것 / 후속 확인 후보

- `CodingTools`의 각 도구(`read/write/edit/bash`)가 `replay`를 `safe`로 선언하는지 (`D/src/tools/*.ts`). 기본 `unsafe`이므로 선언이 없으면 모두 재시작 시 `interrupted`가 된다.
- `scheduler.ts` 동시성 상한의 부재(grep으로만 확인). 실제 부하 시 동작은 실행 확인 불가.
- `compaction.ts`의 크래시 복구 세부(요약 중 크래시, stale 처리)와 `session/transaction.ts` 1,043줄의 읽기/쓰기 허용 검사.
- 문서 `checkpointWhen()` 정책과 마이그레이션이 실제 장기 세션에서 재개 비용에 미치는 영향. `S:5039` 경고("replay can grow without bound")만 확인.
- pi-ai PR #9548(`SystemMessage` 계약)이 병합되었는지: S 첫머리는 "targets ... once the PR lands"로 적고 있다. pi-ai 쪽 실제 타입은 보지 않았다.
