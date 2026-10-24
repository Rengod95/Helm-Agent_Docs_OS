---
id: L2.dialog.plan
layer: L2
domain: dialog
kind: plan
status: draft
depends_on: [L2.dialog.spec, F.capabilities.plan, L1.tools.plan, L1.tasks.plan]
binds: [xeon/packages/cap-dialog/**]
---

# L2 사용자 대화 구현 계획 (dialog)

대상 스펙: `L2.dialog.spec`. 패키지: `xeon/packages/cap-dialog`.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 없음. 패키지 골격(`"xeon": {"layer": "L2", "domain": "dialog"}`)만 P0에서 만든다 | `_research/foundation-plan.md` §5 P0·P4 |
| M1 | 없음. M1 `xeon chat`은 질문·명령을 쓰지 않는다 | `product.scope.spec` §4.3 M1 |
| M2 | 1차: 질문 도구(`dialog.ask`), 슬래시 명령(`dialog.commands`), 상태줄(`dialog.status`), 첨부(`dialog.attachments`). D1~D8 | `_research/layer-plan-v2.json` L2-f 1차, `product.scope.spec` §4.3 M2 |
| M3 | 알림 분류(`dialog.notify`). D11 [제안] | 3차 결정(예약·원격·알림 범위 포함), `product.scope.spec` §4.1 I13 |
| M3 이후(2차) | 곁가지 질문(`dialog.aside`) D9, 출력 스타일(`dialog.styles`) D10 | `_research/layer-plan-v2.json` L2-f 2차 |
| 보류 | 음성 입력(L4 입력 어댑터) | `_research/layer-plan-v2.json` L2-f 보류, `L2.dialog.spec` §1 |

- M2 종료 조건 중 이 패키지가 맡는 것: "질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록된다"(`product.scope.spec` §4.4 M2). `L2.work.plan`과 공동이다.
- 알림을 M3에 두는 것은 [제안]이다. `_research/layer-plan-v2.json` L2-f에는 알림 행이 없고, 3차 결정이 알림을 범위에 넣었다. 서비스 모드(M3)와 함께 쓰이므로 M3에 둔다(`L2.dialog.spec` §10 D-11).

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/src/                      # F. 선행 작업(D1)
  capabilities/defs/dialog.ts                     # L2.dialog.spec §3.1~§3.6
  records/catalog/dialog.ts                       # DIALOG_EVENT_CATALOG(CatalogEntry, dialog.status 휘발, dialog.notified 내구)

xeon/packages/cap-dialog/
  package.json                                    # "xeon": {"layer":"L2","domain":"dialog"}, 외부 의존 없음
  UPSTREAM.json  PATCHES.md  LICENSE.pi           # pi 포크 출처 기록(ADR-0003 §3.4, L2.readme §3)
  src/
    index.ts                                      # manifest, apply(ctx): 서비스·지점·피드 구독 등록
    manifest.ts                                   # L2.dialog.spec §7
    settings.ts                                   # defineSettings("l2.dialog", …) 13개 키
    service.ts                                    # DialogService 조립
    ports/
      approvals.ts                                # ApprovalsPort(kind question) ← xeon.approvals
      shell.ts                                    # 사용자 개시 셸 실행 ← xeon.tools
      os.ts                                       # OS 알림 ← xeon.os(notify)
      files.ts                                    # 첨부·명령 파일 읽기 ← xeon.exec(FileSystem)
      images.ts                                   # workspace.images
      session.ts                                  # 피드 구독, 이벤트 읽기 ← xeon.session
    ask/
      validate.ts                                 # 정의 쪽 순수 함수의 cap 쪽 사용(검사 호출, 오류 변환)
      service.ts                                  # ask, wait 처리, 출력 대응표
    commands/
      registry.ts                                 # 출처별 명령 표, 우선순위, 동작 명령 처리기
      loader.ts                                   # 명령 파일 읽기(포트 경유), 진단
      shell.ts                                    # !{…} 찾기, 확인 게이트, 실행 결과 치환
      input-handler.ts                            # input 지점 핸들러(템플릿 치환만)
      advertise.ts                                # 명령 목록 광고 조각
      service.ts                                  # register, list, expand, run
    status/
      store.ts                                    # 스레드별 세그먼트 스냅숏(메모리)
      core-segments.ts                            # core.turn, core.tools, core.usage 계산
      service.ts                                  # setItem, clearItem, list, 휘발 발행
    attachments/
      classify.ts                                 # MIME 판정, 원천별 처리 표
      service.ts                                  # add
    aside/                                        # 2차
      service.ts
    styles/                                       # 2차
      registry.ts
      service.ts
    notify/
      classify.ts                                 # classifyNotice(event) 순수 함수
      feed.ts                                     # NoticeFeed, OS 알림 묶음
      service.ts                                  # emit, list
    upstream/pi/
      prompt-templates.ts                         # pi 포크(아래 §4.2)
      slash-commands.ts                           # pi 포크(타입만)
    testing/
      fake-approvals.ts                           # L1.tools 승인 프로토콜 가짜(메모리, 수동 응답, 만료 시계)
      memory-command-files.ts                     # 명령 파일 원천 가짜
  test/
    upstream/prompt-templates.test.ts             # pi 테스트 포크(vitest → bun:test)
    *.test.ts
```

- [제안] 이 도메인은 테이블이 없다. 테이블 접두사 `cap_dialog_`는 예약만 해 둔다(공통 규약 "없음", eng.context-map.design §4.1 "예약", `L2.dialog.spec` §10 D-10). 질문의 기록은 L1의 `approval.*`, 출력 스타일 선택은 `settings.changed`, 알림 emit은 `dialog.notified` 이벤트에 남고, 투영할 상태가 없다.
- 상태줄 스냅숏은 메모리에만 있다. 재시작하면 비고, 피드 구독으로 다시 채운다.

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| D1 | F `capabilities/defs/dialog.ts` 정의 7개와 `records/catalog/dialog.ts`. 1차 4개(`ask`, `commands`, `status`, `attachments`)를 먼저 넣고 `aside`, `styles`, `notify`는 같은 파일에 정의만 둔다. 순수 함수 `checkAskQuestions`, `validateAskAnswer`, `buildAskAnswerSchema`, `defaultAskAnswer`, `renderAsk` 구현과 테스트. `CallOptions.context`(F.capabilities §3.2)와 `dialog` 영역·`TYPE_PREFIX_OWNERS` 행(F.records §3.3.2)이 F에 있는지 확인 | F.capabilities.plan 정의 형식 완료 | M | M2 |
| D2 | `ask` 도구와 `xeon.approvals` 연결: `ApprovalsPort`(kind `question`), 요청 멱등 재시도, `input_required` 매핑(`InputRequiredInfo` 값), 출력 대응표(L2.dialog.spec §4.1.1), `wait: true` 메모리 대기 | D1, L1.tools 승인 프로토콜 | L | M2 |
| D3 | 답 검증과 시간 제한 정책: 만료 시각·만료 결과 전달, 추천 기본 답, 취소·무응답 처리, 비대화형 실행 오류 | D2 | M | M2 |
| D4 | pi `prompt-templates.ts`·`slash-commands.ts` 포크와 치환: `upstream/pi/` 이식, 파일 읽기 포트화, 앞머리 `args` 필드, 출처 우선순위 변경, pi 테스트 포크 | D1 | M | M2 |
| D5 | 명령 등록 API와 클라이언트 선언 스키마: `register`, `list`, `expand`, `run`, `registerAction`, 셸 주입 확인 게이트와 실행(포트), `input` 지점 핸들러, 명령 목록 광고 | D4, L1.tools 사용자 셸 실행 API | L | M2 |
| D6 | 상태 세그먼트 API와 휘발 이벤트: `setItem`, `clearItem`, `list`, `dialog.status` 발행(100 ms 묶음), 내장 세그먼트 셋 | D1, L1.loop 피드(`turn.*`) | M | M2 |
| D7 | 첨부 `add`와 blob 등록: 원천별 처리 표, `workspace.images` 연결과 `unavailable` 시 원본 경로, 크기 한도, 입력 파트 생성 | D1, L2.workspace `workspace.images` 최소형 | M | M2 |
| D8 | 설정 키 13개(`settings.ts`)와 각 기능의 설정 읽기 | D2, D5, D6, D7 | S | M2 |
| D9 | (2차) `aside.ask`: 활성 가지 스냅숏 읽기, 별도 모델 호출(L1.models 용도), 본류 무기록 | D1, L1.models | M | 2차 |
| D10 | (2차) `styles.register`/`select`: 세션 범위 설정 쓰기, 다음 턴 시작에 적용, 시스템 프롬프트 조각 | D1, D8, L1.context | M | 2차 |
| D11 | `notify` 분류: `classifyNotice`, `emit`(`dialog.notified`), `list`(당겨 읽기), `NoticeFeed`, OS 알림 묶음 | D1, D8, L0.os 알림 API | M | M3 |

순서: D1 → (D2, D4, D6, D7 병행) → D3 → D5 → D8 → D11 → (2차) D9, D10.

## 4. 채택 코드

### 4.1 그대로 쓰는 패키지

| 패키지 | 버전 | 쓰임 |
|---|---|---|
| `typebox` | 워크스페이스 catalog 고정 버전(F.capabilities.spec §10 TypeBox 버전 미결을 따른다) | 정의 스키마(F) |

- 외부 패키지를 새로 더하지 않는다. pi는 앞머리 파싱에 `yaml` 2.9.0을 쓰지만(`~/projects/_ref/pi-src/packages/coding-agent/package.json` 74행) 가져오지 않는다. [가정] Bun 1.4의 내장 YAML 파서(`Bun.YAML.parse`)를 쓴다. 쓸 수 없으면 앞머리 키를 `description`, `argument-hint`, `args`로 한정한 작은 파서를 `commands/loader.ts`에 둔다. 확인은 D4 첫 단계에서 한다.

### 4.2 포크

원본: pi 로컬 소스 `~/projects/_ref/pi-src`(pi 1.1.0, 커밋 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`), MIT(`LICENSE`, Copyright (c) 2025 Mario Zechner). `_research/packages.md` §4.4 L2-e 슬래시 행 판정은 "포크, 결합은 config·frontmatter·paths 정도"다. `UPSTREAM.json`에 경로·커밋·버전을, `PATCHES.md`에 아래 표를 적는다.

| 원본 경로 | 이식 위치 | 줄 수 | 그대로 두는 것 | 바꿀 점 |
|---|---|---|---|---|
| `packages/coding-agent/src/core/prompt-templates.ts` | `cap-dialog/src/upstream/pi/prompt-templates.ts` | 320 | `parseCommandArgs`, `substituteArgs`(치환 문법 전부), 파일 하나 = 명령 하나, `description` 기본값(첫 줄 60자), `argument-hint` | (1) `fs`의 `existsSync`, `readdirSync`, `readFileSync`, `statSync` 직접 호출 → 주입한 비동기 `CommandFileSource` 포트(구현은 `xeon.exec` `FileSystem` 읽기. `xeon.os`에는 파일 읽기 API가 없다). 함수가 `async`가 된다. (2) `../config.ts`의 `CONFIG_DIR_NAME`(pi `.pi`) → 인자로 받는 디렉터리 목록(`.xeon/commands` 기본은 [가정]). 디렉터리 이름 `prompts` → `commands`. (3) `../utils/frontmatter.ts`의 `parseFrontmatter`(`yaml` 패키지) → §4.1의 YAML 파서. BOM 제거·줄바꿈 정규화 로직은 같은 파일 안에 옮긴다. (4) `../utils/paths.ts`의 `resolvePath` → `node:path` `resolve` + `~` 확장 한 줄. (5) `./source-info.ts`의 `SourceInfo`, `createSyntheticSourceInfo`와 `./diagnostics.ts`의 `ResourceDiagnostic` → 로컬 타입 `CommandSource`(`CommandSourceSchema` 값 + 경로)와 `CommandDiagnostic`. (6) `expandPromptTemplate`의 첫 일치(전역 먼저) → 우선순위 표(L2.dialog.spec §4.2.3)로 고른 결과를 받는 함수로 바꾼다. (7) 앞머리 `args` 필드 읽기를 더한다. (8) 템플릿에 `!{…}` 셸 자리 찾기 함수를 더한다(치환 함수는 그대로 둔다) |
| `packages/coding-agent/src/core/slash-commands.ts` | 복사하지 않음(§8 참고) | 44 | `SlashCommandInfo`의 이름·설명 구조 | (1) `SlashCommandSource`(`extension`, `prompt`, `skill`) → `CommandSource`(`builtin`, `capability`, `project`, `user`, `extension`). (2) `../config.ts`의 `APP_NAME` import 삭제. (3) `BUILTIN_SLASH_COMMANDS` 목록은 지운다. 클라이언트 고유 명령은 L4.cli.spec·L4.desktop.spec이 `builtin` 출처로 선언한다. pi 목록은 참고로 `PATCHES.md`에만 남긴다 |
| `packages/coding-agent/test/prompt-templates.test.ts` | `cap-dialog/test/upstream/prompt-templates.test.ts` | 654 | `substituteArgs`, `substituteArgs - positional defaults` 등 치환 사례 전부 | `vitest` import → `bun:test`. 파일 시스템을 쓰는 로드 테스트는 `memory-command-files.ts` 가짜로 바꾼다. 우선순위가 바뀐 사례(전역 우선)는 기대값을 프로젝트 우선으로 고치고 주석으로 표시한다 |

- 포크 파일은 `src/upstream/` 밖에서 직접 import하지 않는다. `commands/` 모듈이 감싼다(L2.readme §3).
- 구현에서 두 번째 행(`slash-commands.ts`)은 복사하지 않았다: `SlashCommandInfo`와 `SlashCommandSource`는 F `CommandInfo`와 `CommandSourceSchema`가 같은 구조로 갖고 있어 복사할 코드가 타입 하나도 남지 않는다. 첫 행의 `parseFrontmatter`는 `utils/frontmatter.ts`에서 같은 파일로 합쳤다. 패치 7개는 `cap-dialog/PATCHES.md`에 있다.
- pi npm 1.3.0과 로컬 1.1.0의 두 파일 차이는 D4 시작 때 확인한다 [가정: 치환 함수는 같다].

## 5. 단위 테스트 목록

승인 프로토콜은 M2 통합 뒤 core-tools의 실제 `ApprovalService`로 시험한다(§8). 시계와 ID는 주입한다(eng.testing.guide TS-03). 이 절의 파일 배치(`src/testing/fake-approvals.ts`)는 설계 시점의 계획이고 구현은 §8을 따른다.

| 테스트 파일 | 테스트 이름 | 확인할 동작 |
|---|---|---|
| `test/ask-schema.test.ts` | 질문 스키마 검증 | 질문 0개·5개, 선택지 1개·9개 거부. 같은 질문 id, 추천 둘 이상, 선택지 id 중복은 `checkAskQuestions` 이슈 |
| `test/ask-schema.test.ts` | 답 검증 | `validateAskAnswer`의 이슈 6종이 각각 나오는 사례와 통과 사례. `buildAskAnswerSchema` 결과로 JSON Schema 검사한 결과가 구조 규칙과 같다 |
| `test/ask-defaults.test.ts` | 선택지 추천·시간 제한 기본값 | 모든 질문에 추천이 있으면 `defaultAskAnswer`가 답을 만들고 하나라도 없으면 null. 입력 `timeoutSec` 생략 시 설정값, 0이면 만료 없음 |
| `test/ask-flow.test.ts` | 대기와 출력 대응 | 첫 호출 `input_required`, 응답 `answer` 뒤 같은 키 재호출 `answered`, `deny`는 `cancelled(dismissed)`, 만료+추천은 `answered(defaulted: true)`, 만료+추천 없음은 `cancelled(timeout)` |
| `test/ask-flow.test.ts` | 무응답 취소 | 시간 제한 0에서 시계를 하루 넘겨도 `input_required` 유지. 턴 취소 시 가짜가 요청을 취소하고 재호출은 `cancelled(aborted)` |
| `test/ask-flow.test.ts` | 같은 레코드 형식 | `ask`가 만든 승인 요청이 kind `question`이고 대상이 `AskApprovalSubjectSchema`를 통과한다. `L2.work.plan`의 계획 테스트와 같은 L1 payload 스키마로 검사한다 |
| `test/ask-restart.fault.test.ts` | 재시작 후 단일 완료 | 답 기록 뒤 강제 종료 → 재개 → 재시도 세 번 → 승인 요청 1건, 도구 결과 완료 커밋 1건(`tool:<toolCallId>:result`) |
| `test/ask-wait.test.ts` | 메모리 대기 | `wait: true`가 응답 시 완료 출력을 돌려주고, `signal` 취소 시 `aborted` 오류를 내며 승인 요청은 남는다 |
| `test/upstream/prompt-templates.test.ts` | 인자 치환($1, $@, $ARGUMENTS) 표 | pi 치환 테스트 전부와 §4.2.2 표 여섯 표기, 재귀 치환 없음, `$0` 빈 문자열 |
| `test/commands-priority.test.ts` | 명령 우선순위 | 다섯 출처에 같은 이름이 있으면 `builtin`이 쓰이고 나머지는 `includeHidden`에서만 보인다. 프로젝트 > 사용자. `capability` 중복 등록은 `command_name_taken` |
| `test/commands-shell.test.ts` | 셸 주입 확인 게이트 | `!{…}` 포함 템플릿을 `confirmShell` 없이 `run`하면 셸 포트 호출 0회와 `needs_confirmation`. 확인 뒤 순서대로 실행·치환. 설정 `off`면 `command_shell_disabled`. `input` 지점 핸들러는 셸 포함 템플릿을 치환하지 않는다 |
| `test/commands-action.test.ts` | 동작 명령 | `registerAction` 처리기가 인자와 `requestId`를 받는다. `args` 선언 위반은 `command_args_invalid`. 해제 함수 뒤 `not_command` |
| `test/commands-loader.test.ts` | 명령 파일 읽기 | 앞머리 없음·`description` 없음(첫 줄 60자)·YAML 오류(그 파일만 건너뜀, 진단)·`args` 필드 |
| `test/status-volatile.test.ts` | 상태 이벤트 휘발성 | `setItem` 뒤 `dialog.status` 휘발 이벤트가 피드로 나가고 `openTestStore`의 `events` 행 수가 늘지 않는다. 재생성 결과에 없다. `list`가 현재 스냅숏을 돌려준다. 100 ms 안 변경 셋은 이벤트 하나 |
| `test/status-core.test.ts` | 내장 세그먼트 | `turn.started` → 실행 중, `approval.requested`(question) → 질문 대기, `turn.completed` → 대기와 사용량 갱신 |
| `test/attachments.test.ts` | 첨부 한도 | `maxBytes` 초과는 `attachment_too_large`. 이미지는 `workspace.images` 가짜를 거쳐 `ImageContent` + 이름 텍스트, `unavailable`이면 원본과 `resized: false`. 텍스트 256 KiB 초과는 경로 참조만. URL은 가져오지 않는다(네트워크 포트 호출 0회) |
| `test/notify-classify.test.ts` | 알림 분류 | §4.7.1 표의 원인 이벤트마다 kind가 맞고 `interrupted` 턴은 null. `INPUT_NEEDED_KINDS`가 둘이다. kind별 설정이 꺼지면 OS 알림 포트 호출이 없다. 1초 안 같은 kind는 한 번 |
| `test/defs.contract.test.ts` | 정의 검증 | 일곱 정의 `validateCapability` 이슈 0건(도구 없는 능력 [미결] 동안은 그 이슈만 허용 목록), `validateCapabilitySet`에 도구 이름 충돌 없음, `DialogAttachments.requires`가 `workspace.images` |
| `test/catalog.contract.test.ts` | 카탈로그 | `DIALOG_EVENT_CATALOG`에서 `dialog.status`가 `durable: false`이고 `VOLATILE_TYPE_PATTERN`, `dialog.notified`가 `durable: true`이고 `EVENT_TYPE_PATTERN`을 만족하며 `TYPE_PREFIX_OWNERS`의 `dialog.` 소유가 `cap.dialog` |

## 6. 완료 기준

spec §9 수용 기준과 테스트의 대응:

| spec §9 | 테스트 파일 · 이름 | 마일스톤 |
|---|---|---|
| 1 | `test/ask-flow.test.ts` · 같은 레코드 형식(`L2.work.plan` `test/plans-decision.int.test.ts` · 같은 레코드 형식과 공동), `test/ask-flow.test.ts` · 대기와 출력 대응 | M2 |
| 2 | `test/ask-restart.fault.test.ts` · 재시작 후 단일 완료 | M2 |
| 3 | `test/upstream/prompt-templates.test.ts` · 인자 치환($1, $@, $ARGUMENTS) 표 | M2 |
| 4 | `test/status-volatile.test.ts` · 상태 이벤트 휘발성 | M2 |
| 5 | `test/defs.contract.test.ts` · 정의 검증 | M2 |
| 6 | `test/notify-classify.test.ts` · 알림 분류 | M3 |
| 7 | `test/commands-shell.test.ts` · 셸 주입 확인 게이트 | M2 |
| 8 | `test/commands-priority.test.ts` · 명령 우선순위 | M2 |

M2:

1. §5의 M2 테스트(질문, 명령, 상태줄, 첨부, 정의, 카탈로그)가 통과한다. 위 표의 M2 행(spec §9-1~5, 7, 8)이 모두 포함된다.
2. M2 종료 조건 "질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록"이 `L2.work.plan`의 계획 테스트와 함께 통과한다(두 테스트가 L1.tools의 같은 `approval.requested` payload 스키마로 검사).
3. `cd xeon && just verify`가 종료코드 0이다.
4. `L2.dialog.spec` §10 D-1·D-2·D-3이 F·L1 문서와 합의되어 포트 파일의 [가정] 주석이 실제 이름으로 바뀌었다.

M3:

1. 알림 분류 테스트(spec §9-6)가 통과하고 `dialog.notified`가 카탈로그에 등록되어 있다.
2. `just verify` 종료코드 0.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 승인 프로토콜 인터페이스가 L1.tools 작성 중이라 바뀜 | `src/ports/approvals.ts` 한 곳에 격리한다. 테스트는 가짜 서비스로만 돌린다. 요청 멱등과 재시도 규칙은 D2 시작 전에 L1.tools 작성자와 합의한다(`L2.work.plan` §7과 같은 합의) |
| 클라이언트 명령 선언 형식이 F.wire-settings와 어긋남 | `CommandInfoSchema`를 F에 두고 wire 메서드(`commands.list`)의 결과 원소로 그대로 쓰도록 요청한다(D-2). 확정 전에는 in-process 클라이언트(CLI)만 쓴다 |
| 알림 소유 경계 미결(`L2.readme` §10 미결 15, 제안은 `dialog.notify`가 OS 알림과 푸시를 모두 소유) | M2에는 알림을 넣지 않는다. D11은 `classifyNotice`와 당겨 읽기만 먼저 만들고, 전달 경로는 D-6 결정 뒤 붙인다 |
| 셸 주입이 사용자 모르게 실행됨 | `run`의 확인 게이트를 기본으로 두고 `input` 지점 경로는 셸 템플릿을 치환하지 않는다. 실행은 L1.tools의 일반 권한·샌드박스를 거친다 |
| pi 포크와 원본의 차이가 커짐 | 치환 함수(`parseCommandArgs`, `substituteArgs`)는 손대지 않고 pi 테스트를 그대로 옮겨 회귀를 잡는다. 바꾼 점은 `PATCHES.md`에 모은다 |
| Bun 내장 YAML이 없거나 동작이 다름 | D4 첫 단계에서 확인하고, 안 되면 키 셋 한정 파서로 바꾼다. 외부 `yaml` 패키지는 쓰지 않는다 |
| 첨부 이미지가 이벤트 크기를 키움 | 입력 기록 때 records 문자열 분리 규칙으로 blob 자리표시가 되고, 같은 해시는 한 번만 저장된다. 테스트로 envelope 크기를 확인한다 |

## 8. M2 구현 기록 (DG.1~DG.4, 2026-10-24)

`review.m2-plan` DG.3·DG.4는 `cap-workspace`와 함께 끝냈고, DG.1·DG.2는 L1A의 실제 구현이 병합되기 전이라 가짜 포트 위에서 끝냈다.

| 작업 | 상태 | 비고 |
|---|---|---|
| D1 | F 쪽 완료 | `defs/dialog.ts`, `records/catalog/dialog.ts`가 F.2·F.3에서 들어왔다. `defs.contract.test.ts`, `catalog.contract.test.ts`가 확인한다 |
| D2·D3 (DG.1) | 부분 | `ask`와 승인 연결, 출력 대응, 메모리 대기, 답 검증은 끝났고 core-tools의 실제 `ApprovalService` 위에서 시험한다(`questionApprovalsOver`). 시간 제한은 프로세스 안 타이머의 잠정 구현이다(spec §4.1.3). 비대화형 오류는 `CallContext.interactive`로 낸다 |
| D4·D5 (DG.2) | 부분 | 포크, 등록·목록·치환·실행, 동작 명령, 셸 확인 게이트, `input` 지점, 광고는 끝났다. 셸 포트의 기본 구현 `shellPortOver`(`LoopService.runUserBash` 위)를 만들었고, 실제 `ToolService.runUserShell`과 cap-workspace의 셸 서비스 위에서 시험한다. core-loop의 `runUserBash`는 아직 오류 값을 돌려줘서 loop 한 겹은 시험용 얇은 껍데기다 |
| D6 (DG.3) | 완료 | 상태 세그먼트, 100 ms 묶음, 휘발 발행, 내장 세그먼트 셋. 피드 따라잡기 정책은 [미결] |
| D7 (DG.3) | 완료 | 첨부 `add`와 `workspace.images` 연결, 원본 직접 등록 대체 경로 |
| D8 (DG.3) | 완료 | 설정 키 13개. 읽는 기능이 M2에 있는 것은 `ask.timeoutSec`, `commands.*`, `status.segments`, `attachments.maxBytes`다 |
| D9~D11 | 대기 | 2차(`aside`, `styles`)와 M3(`notify`) |

파일 배치는 §2의 계획에서 다음이 달라졌다.

- 테스트 대역은 `src/testing/` 대신 `test/support/`에 둔다(`real-approvals.ts`, `user-bash.ts`, `memory-command-files.ts`, `harness.ts`, `images.ts`, `timers.ts`). 승인은 대역이 없다: `real-approvals.ts`가 core-tools `testing`의 `realTools`로 실제 `ApprovalService`를 세우고 관찰 창과 장애 주입만 더한다. 다른 패키지가 쓰는 대역은 core-tools가 `testing` 서브패스로 내보낸다.
- `ports/`는 `approvals.ts`(`ApprovalsPortFactory`), `shell.ts`, `files.ts`(첨부 원천), `command-files.ts`(명령 파일과 `CommandRoots`), `images.ts`, `blobs.ts`, `session.ts`(피드 구독과 상태 발행), `timers.ts`로 나눈다. `os.ts`는 M3 알림에서 더한다.
- `session-adapter.ts`가 `xeon.session`을 `session.ts`의 두 포트로 감싼다. `plugin.ts`가 포트를 모아 `DialogDeps`를 만든다.
- `ask/`에 `keys.ts`(요청 키 줄이기), `mapping.ts`(`AskQuestion`·`AskAnswer`와 `QuestionBody`·`QuestionAnswer`), `expiry.ts`(잠정 시간 제한)를 더했다. `commands/`에 `action-args.ts`를 더했다.
- 지점 핸들러는 `input`, `tool_execution_start`, `tool_execution_end`, `before_agent_start`이다. 알림용 지점은 없다.

테스트 대응(§5)은 파일 이름이 같다. 추가로 `plugin.test.ts`(실제 ExtHost에 올려 능력, 지점, 구독 정리 확인), `session-adapter.test.ts`(휘발 봉투), `status-core.test.ts`, `settings.test.ts`, `fork-records.test.ts`를 두었다. `ask-restart.fault.test.ts`는 같은 이벤트 로그 위에 새 `ApprovalService`(메모리 대기 목록이 빈 것)와 새 ask 서비스를 세우는 것으로 재시작을 흉내 낸다. 도구 결과 완료 커밋 1건(`tool:<toolCallId>:result`)과 SIGKILL 재개는 통합 단계(HOST.4)에서 확인한다.

통합 단계(HOST.6)에서 실제 구현으로 바꿀 포트:

| 포트 | 지금 | 실제 |
|---|---|---|
| `ApprovalsPortFactory` | 옵션(`dialogPlugin({ approvals })`)이 없으면 `xeon.approvals`를 `questionApprovalsOver`로 감싼다. 시험은 실제 서비스 | 그대로 |
| `ShellPort` | 옵션(`dialogPlugin({ shell })`)이 없으면 `xeon.loop`를 `shellPortOver`로 감싼다. 시험은 `fakeShell`과 실제 `runUserShell` 위의 얇은 loop 껍데기 | core-loop가 `runUserBash`를 구현하면 껍데기 없이 그대로 |
| `interactive(context)` | 옵션. 기본은 항상 대화형 | `CallContext.interactive`(F.8에서 들어왔다)를 읽는 판정 함수. 조립이 넘긴다 |
| `DialogFeed`·`StatusPublisher` | `xeon.session`이 있으면 `session-adapter.ts`가 만든다 | 그대로. 구독 따라잡기 정책만 정한다 |
| `ImagesPort` | `g.capability(WorkspaceImagesKey)`, 없으면 원본 직접 등록 | 그대로 |
| 시간 제한 | `ask/expiry.ts`의 프로세스 안 타이머 | F의 만료 필드와 L1.tools의 내구 만료. 오르면 `expiry.ts`를 지운다 |

