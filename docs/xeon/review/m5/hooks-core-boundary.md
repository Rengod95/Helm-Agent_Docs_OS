---
id: review.m5-hooks-core-boundary
layer: meta
domain: review
kind: spec
status: draft
depends_on: [adr.0023, review.m5-drive-isolation, F.extensions.spec, F.capabilities.spec, X.primitives.spec, X.operations.spec, L1.tools.spec, L1.loop.spec, L1.agents.spec, L1.context.spec, L2.workspace.spec, L2.dialog.spec, architecture.layers.spec, eng.dependency-rules.guide]
binds: []
---


# 훅 정리, 블록 경계, 층 재편 (마일스톤 M5e와 M5a-2의 층 부분)

> **마일스톤 설계 스펙(상태 draft).** Hook 정리, 블록 경계, 층 재편(M5e)을 정한다. 층 스펙(`docs/xeon/<층>/<도메인>/spec.md`)은 이 문서를 구현하는 트랙이 코드와 같은 커밋에서 바꾼다. 이 문서는 층 스펙을 대신하지 않고 구현 전에 합의할 내용을 모은 것이다.
>
> **이 문서가 바꿀 층 스펙:** `docs/xeon/F/extensions/spec.md`, `docs/xeon/F/capabilities/spec.md`, `docs/xeon/X/primitives/spec.md`, `docs/xeon/X/operations/spec.md`, `docs/xeon/L1/tools/spec.md`, `docs/xeon/L1/loop/spec.md`, `docs/xeon/L1/agents/spec.md`, `docs/xeon/L1/context/spec.md`, `docs/xeon/L2/workspace/spec.md`, `docs/xeon/L2/dialog/spec.md`, `docs/xeon/architecture/layers/spec.md`, `docs/xeon/engineering/dependency-rules/spec.md`.
>
> **원천:** `_notes/design/lc/spec/m5e-hooks-core-boundary.md`(저장소 밖 메모, 2026-11-17 마지막 맞춤본). 문서 이름 대응: M5c = `docs/xeon/review/m5/profile-project-loader.md`, M5d = `turn-record-metrics.md`, M5e = `hooks-core-boundary.md`, 엔진 설계 = `drive-isolation.md`(모두 같은 폴더), 화면 스펙 = `docs/xeon/review/m6/craft-flows.md`, 요구 = `docs/xeon/review/m5-plan.md`, 일정 = `m5-plan.md`와 `m6-plan.md`, 개념과 결정 = `docs/xeon/decisions/ADR-0023-plugin-profile-core.md`. 옛 이름 대응: "PRD" = `m5-plan.md`(R번호 그대로, "PRD §7"은 §14), "craft-flow"·"flow" = 화면 스펙 제1부(흐름 n), "개념 문서"·"개념 §9"·"개념 §10" = ADR-0023(대체한 절은 ADR §6), "로드맵" = `m5-plan.md` §7과 `m6-plan.md`, `craft-plan.md` §7 = ADR §3.2.3. 코드 경로의 `path:line`은 `m4/cyP` 워크트리 읽기 시점의 값이다. [정정 2026-11-18, 2b층: `m4/enH1` HEAD `7857ec7f6` 기준으로 4.2·4.3.1·8절의 줄 번호 다섯을 고쳤다(gate 978, decide 583, ToolApprovalBody 81-97, userApprovalId 657, ApprovalResolution 234-256)]

작성 기준: 2026-11-17, 워크트리 `cyP 워크트리`(브랜치 `m4/cyP`, HEAD `1c866ab00`). 코드 사실은 모두 이 시점의 정적 읽기이고 실행으로 확인하지 않았다. 표기: [결정] 사용자가 정한 것(출처 문서 명시), [제안] 이 스펙의 선택, [미확인] 코드로 확인하지 못한 것, [권고: 메인 세션, 확인 대기] 메인 세션이 권하고 사용자가 아직 정하지 않은 것(작업 기본값). 경로는 따로 적지 않으면 `xeon/packages/` 아래다.

**통합 정리(2026-11-17, `_notes/design/lc/spec/consolidation-log.md`).** 교차 점검 둘의 결과를 반영했다. 이 문서가 정의하는 것: 훅의 **결정값**(§4.2, §4.3)과 그 **표시값**(§4.5의 여섯 값)이다. **기록된 결과값**은 `docs/xeon/review/m5/turn-record-metrics.md` §3.2가 정의하고, 둘의 대응표는 §4.5에 한 벌만 둔다. 같은 말은 엔진 설계 통합본의 "공통 어휘"를 따른다(플러그인 정체 = 이름, 버전 정체 `versionId` = 내용 해시, 깊이 셋, 설정 범위). U2·U3·U4는 2026-11-17에 사용자가 권고대로 정했다([결정: 2026-11-17 사용자]). U6도 2026-11-17 밤에 사용자가 정했다([결정: 2026-11-17 사용자, U6]). 화면이 읽을 것은 `docs/xeon/review/m6/craft-flows.md`가 맡는다. 새 용어와 `terms.json`에서 걷을 항목은 14절 "용어 등록 요청"에 모았다.

## 1. 목적과 범위

### 1.1 다루는 요구와 결정

| 번호 | 내용 | 이 스펙의 자리 |
|---|---|---|
| R10 | 플러그인이 어떤 길로 파일·셸·웹 기능을 부르든 도구 실행 블록을 지난다 | 4.6, 5.3 |
| R21 | 훅 위치를 "블록마다 앞과 뒤 + 경계 셋"으로 정리해 공개하고, 지켜보기는 이벤트 구독 하나로 한다 | 3, 4.1~4.4, 5.1~5.2 |
| R22 | 대체 편집 도구의 변경이 변경 탭과 되감기에 잡힌다(공통 결과 형식) | 4.7, 5.4 |
| 결정 A | 훅은 블록마다 앞과 뒤 + 경계 셋(대화 시작, 입력 받기, 턴 종료 직전). 기록 블록은 이벤트 구독만. 사람에게 묻기와 서브에이전트의 앞뒤는 지금 훅에 없는 새 위치다 (`docs/xeon/decisions/ADR-0023-plugin-profile-core.md` §3.2.2, §3.4.1, [결정: 2026-11-16 사용자]) | 3, 4.3 |
| 결정 B | L2 가운데 코어인 부분을 L1으로 내리고 나머지 플러그인은 한 층으로 본다 (`docs/xeon/review/m5/drive-isolation.md` §8, 2026-11-17). [결정: 2026-11-17 사용자, U4] 확정. "뺄 수 없는 플러그인이 없다"가 개념 초안의 "코어 플러그인은 뺄 수 없다"를 대체한다(ADR §3.12) | 6 |
| 결정 C | 블록의 네 겹(설정, 주입, 부품 교체, 앞뒤 훅)과 못 바꾸는 보장 ([제안]: `docs/xeon/decisions/ADR-0023-plugin-profile-core.md` §3.2.3, 옛 `craft-plan.md` §7.1. "코어 플러그인의 설정 값"은 4.8.1의 소유자 구분으로 대체: 코어 키와 소유 플러그인 키) | 4.8 |
| 결정 D | 플러그인이 부른 L2 기능 호출을 엔진이 도구 실행 블록에 태운다. 직접 호출도 남기되 같은 관문을 지난다 (`docs/xeon/review/m5/drive-isolation.md` §1.3) | 4.6, 5.3 |
| 이름 | 화면 용어는 Inject / Hook / Drive (`docs/xeon/decisions/ADR-0023-plugin-profile-core.md` §3.3.1, [결정: 2026-11-17 사용자]) | 전체 |

### 1.2 다루지 않는 것과 담당

| 항목 | 담당 |
|---|---|
| 주도 단계 함수, `tool`·`model` 명령 자체, 프레임 스택 | 주도·격리 스펙(`docs/xeon/review/m5/drive-isolation.md`, E1~E3). 이 스펙은 `tool` 명령이 부를 "통합 호출 경로"(4.6)의 계약만 정한다. 이 경로의 구현(D-13~D-18)은 로드맵 M5a-2(E2)가 한 곳에서 소유하고 M5e 항목에는 적지 않는다 |
| 플러그인 프로세스 격리(P1·P2) | 격리 스펙. 이 스펙은 격리된 호출자에게도 같은 경로가 이르는 조건(5.3 규칙 U-9)만 정한다 |
| 프로필·프로젝트·로더(M5c), 프로필의 권한 모드 | 프로필 스펙(`m5c-profile-project-loader.md`). 훅 순서의 기본값(5.2)이 `E(T)`의 순서(공통 묶음, 프로필, 덧씌우기)를 쓴다는 것만 요구한다 |
| 턴 기록 저장, 지표(M5d) | 기록 스펙(`m5d-turn-record-metrics.md`). 이 스펙은 훅 결정값과 표시값 여섯(통과, 고침, 물음, 막음, 오류, 시간 초과)의 변환(4.5), 플러그인 호출의 기록 대상(5.3)을 정한다. 저장 모양과 기록된 결과값은 기록 스펙이 정의한다 |
| Craft 화면(M6) | 화면 스펙(`docs/xeon/review/m6/craft-flows.md`). 이 스펙은 화면이 읽을 데이터(4.8, 4.9)만 정한다 |
| 파일 되감기 구현 | 보류(`docs/xeon/review/m5-plan.md와 m6-plan.md` Later). 이 스펙은 되감기가 읽을 입력(4.7)만 정한다 |
| 디렉터리와 패키지 이름 변경 | 하지 않는다. `cap-*`, `group-*`, `core-*` 이름은 그대로 둔다 (`docs/xeon/review/m5/drive-isolation.md` §8) |

### 1.3 모델 컨텍스트 원칙

이 스펙의 어떤 규칙도 시스템 프롬프트, 환경 블록, 도구 설명에 줄을 더하지 않는다 [결정: 2026-11-12 사용자, 하네스 최소 원칙]. 훅의 "묻기" 이유, 파일 변경 기록, 블록 설명 데이터는 모델에 보이지 않고 기록과 화면에만 간다. 모델에 보이는 새 문장은 막음 결과의 사유 한 줄(기존 `[fresnel:denied_by_extension] <reason>` 형식)뿐이다.

## 2. 용어

용어는 `xeon/packages/client/src/i18n/terms.json`을 따른다. 이 문서에서 훅 자리는 "위치", 대화는 "대화"로 쓴다(`terms.json`의 금지 별칭은 쓰지 않는다).

| 용어 | 뜻 |
|---|---|
| 블록 | 코어가 내부를 책임지는 실행 조각. 컨텍스트 조립(`context`), 모델 호출(`model`), 도구 실행(`tools`), 사람에게 묻기(`ask`), 서브에이전트(`agents`), 기록(`record`) |
| 앞, 뒤 | 블록 하나의 들어가는 자리와 나오는 자리. 훅은 여기에 붙는다 |
| 경계 | 블록 안이 아니라 흐름 전체의 세 자리: 대화 시작(`conversation-start`), 입력 받기(`input-received`), 턴 종료 직전(`before-turn-end`) |
| 이벤트 구독 | 막지도 고치지도 못하고 일어난 일을 받기만 하는 단 하나의 공개 면. 지금의 24개 관찰 훅이 여기로 모인다 |
| 위치 종류 | 훅 하나가 가지는 값 하나: 블록 앞·뒤, 경계, 이벤트, 내부 (4.1) |
| 내부 | 이름과 발화는 코드에 남지만 플러그인 작성자에게 공개하지 않는 훅. 내장 코드만 쓴다 |
| 통합 호출 경로 | 플러그인 코드가 부른 효과 있는 기능 호출이 모델의 도구 호출과 같은 파이프라인(`prepare`, `execute`)을 지나는 길 (4.6) |
| 호출 주체 | 호출을 일으킨 쪽. `main`, `subagent:<이름>`, 신규 `plugin:<이름>` |
| 결정값 / 기록된 결과값 / 표시값 | 결정값: 핸들러가 돌려주는 `block`, `ask`, `replace`(그리고 `ask.human.before`의 `cancel`, `answer`). 기록된 결과값: 저장되는 `result`(`passed`, `modified`, `blocked`, `failed`, `skipped`)·`reason`·`decision`(M5d §3.2). 표시값: 화면과 요구의 여섯(`pass`, `modified`, `asked`, `blocked`, `error`, `timeout`), 저장값에서 파생(4.5) |
| 프레임 깊이 / 에이전트 깊이 / 호출 깊이 | 이름을 나눠 쓴다. `frameDepth`: 주도권 스택(엔진 설계, 기본 3). `agentDepth`: 서브에이전트 중첩(승인 서비스가 `depth !== 0`이면 묻지 않는 그 값). `callDepth`: 훅 안에서 시작한 플러그인 호출의 중첩(설정 `l1.tools.pluginCallDepth`, 기본 3) |
| 훅 위치 | `HookPosition`(블록 앞·뒤, 경계, 이벤트, 내부). 화면의 `placement`(전체 화면·옆 패널 등 배치)와 다르다. 화면 문구는 "훅 위치"로 쓴다 |
| 묻기 | 훅의 결정 값 하나. 사람에게 카드를 띄우고 답에 따라 계속하거나 거부한다 |
| 변경 기록 | 도구 결과가 싣는 "파일을 이렇게 바꿨다"는 공통 형식 (4.7) |

크기 표기 [제안]: S 반나절 이하, M 1~3일, L 1주 안팎(한 트랙의 병렬 작업 기준 어림이고 측정값이 아니다).

## 3. 훅 전체 대응표

### 3.1 46개 정방향 표

열: 이름 / fold / 지금 발화하는 곳 / 새 위치 / 할 수 있는 일 / 실패 정책 / 이름 처리 / 번들 사용. 이름 처리는 모든 행이 "유지"다(저장된 문자열과 훅 이름은 바꾸지 않는다, 4.1 규칙). 실패 정책은 `contracts/src/extensions/hooks.ts`의 `HOOKS` 선언이다(closed: 예외가 거부값, open: 기록하고 그 핸들러 몫만 버림, skip: 그 핸들러 패치만 버림). 번들 사용은 `cap-*`, `group-*`, `plugin-builder`, `apps/host`의 `g.on` 호출 위치다. "없음"은 이 범위에서 구독하는 번들이 없다는 뜻이다. 새 위치의 "이벤트"는 `anchor`(화면이 흐름 그림에 놓을 자리)를 괄호로 적는다. "관찰"은 값을 못 바꾸는 것이다.

| # | 훅 | fold | 지금 발화하는 곳 | 새 위치 | 할 수 있는 일 | 실패 | 번들 사용 |
|---|---|---|---|---|---|---|---|
| 1 | `input.user.before` | chain | `core-loop/src/service.ts:627` | 경계 입력 받기 | 고치기(transform), 가로채기(handled) | skip | cap-dialog `plugin.ts:191`, 호스트 cap-web `apps/host/src/assembly/cap-web.ts:318` |
| 2 | `input.bash.before` | first | `core-loop/src/user-bash.ts:261` | 경계 입력 받기(사용자가 친 셸 입력) | 막기(deny), 결과 대신 주기 | closed | 없음 |
| 3 | `input.agent.before` | collect | `core-loop/src/loop/before-start.ts:23` | 컨텍스트 조립 앞(턴 시작, 조립 전) | 보태기(메시지, 시스템 프롬프트 덧붙임) | open | cap-knowledge `plugin.ts:245`, cap-work `plugin.ts:141`, cap-dialog `plugin.ts:202`, group-helm `index.ts:37` |
| 4 | `request.context.before` | chain | `core-context/src/assemble.ts:148` | 컨텍스트 조립 앞 | 고치기(메시지 목록 교체) | skip | 없음 |
| 5 | `request.system.before` | chain | `core-context/src/assemble.ts:210` | 컨텍스트 조립 앞 | 고치기(시스템 메시지 포함 목록 교체) | skip | 없음 |
| 6 | `request.cache.before` | chain | 발화하는 코드 없음(전체 검색 0건) | 내부 | 없음(미배선) | skip | 없음 |
| 7 | `request.provider.before` | chain | `core-models/src/pipeline.ts:349` | 모델 호출 앞 | 고치기(요청 payload) | skip | 없음 |
| 8 | `request.headers.before` | chain | `core-models/src/pipeline.ts:317` | 모델 호출 앞 | 고치기(헤더, null은 삭제) | skip | 없음 |
| 9 | `request.provider.after` | tap | `core-models/src/pipeline.ts:378` | 이벤트(모델 뒤) | 관찰 | open | 없음 |
| 10 | `request.stream` | tap | `core-models/src/pipeline.ts:397` | 이벤트(모델 뒤, 고빈도) | 관찰 | open | 없음 |
| 11 | `request.model.after` | tap | `core-models/src/pipeline.ts:437` | 이벤트(모델 뒤) | 관찰 | open | 없음 |
| 12 | `request.thinking.after` | tap, detached | `core-models/src/pipeline.ts:452` | 이벤트(모델 뒤) | 관찰 | open | 없음 |
| 13 | `tool.call.before` | first | `core-tools/src/pipeline.ts:509` | 도구 실행 앞 | 막기 (신규: 묻기, 결과 대신 주기) | closed | group-helm `index.ts:40`, plugin-builder `src/group.ts:71`과 템플릿 |
| 14 | `tool.result` | chain | `core-tools/src/pipeline.ts:1148` | 도구 실행 뒤 | 고치기(content, details, isError, usage) | skip | 없음 |
| 15 | `tool.execution.before` | tap | `core-tools/src/pipeline.ts:428` | 이벤트(도구 앞) | 관찰 | open | cap-dialog `plugin.ts:196` |
| 16 | `tool.execution.update` | tap | `core-tools/src/pipeline.ts:449` | 이벤트(도구, 고빈도) | 관찰 | open | 없음 |
| 17 | `tool.execution.after` | tap | `core-tools/src/pipeline.ts:473` | 이벤트(도구 뒤) | 관찰 | open | cap-dialog `plugin.ts:199`, group-helm `index.ts:41` |
| 18 | `boundary.turn.before` | tap | `core-loop/src/loop/open-step.ts:21` | 이벤트(턴 시작) | 관찰 | open | group-learning `handlers.ts:209` |
| 19 | `boundary.step.before` | tap | `core-loop/src/loop/open-step.ts:41` | 이벤트(단계 시작) | 관찰. 호스트 cap-mcp는 여기서 정의를 다시 읽는 일을 한다(`apps/host/src/assembly/cap-mcp.ts:185`) | open | apps/host cap-mcp |
| 20 | `boundary.message.before` | tap | `core-loop/src/loop/sink.ts:26` | 이벤트(모델 뒤) | 관찰 | open | 없음 |
| 21 | `boundary.message.update` | tap | `core-loop/src/loop/sink.ts:46` | 이벤트(모델 뒤, 고빈도) | 관찰 | open | 없음 |
| 22 | `boundary.message.after` | chain | `core-loop/src/loop/commit-response.ts:32` | 모델 호출 뒤 | 고치기(어시스턴트 메시지, role 유지) | skip | 없음 |
| 23 | `boundary.step.after` | chain, finalize | `core-loop/src/loop/step-end.ts:166` | 경계 턴 종료 직전(단계마다) | 고치기(entries, continue) | skip | cap-work `plugin.ts:134`, group-learning `handlers.ts:220` |
| 24 | `boundary.settle.before` | chain, finalize | `core-loop/src/loop/step-end.ts:181` | 경계 턴 종료 직전(정착 후보 단계만) | 고치기(continue로 계속하게 함) | skip | cap-work `plugin.ts:138` |
| 25 | `boundary.turn.after` | tap | `core-loop/src/loop/finish-turn.ts:128` | 이벤트(턴 끝) | 관찰 | open | 없음 |
| 26 | `boundary.settle.after` | tap | `core-loop/src/loop/finish-turn.ts:141` | 이벤트(턴 정착) | 관찰 | open | group-helm `index.ts:51`, group-learning `handlers.ts:328`, plugin-builder 템플릿 |
| 27 | `thread.trust.before` | first, threadless | 발화 없음. `emitProjectTrust`를 넘기는 곳이 없다(`ext-host/src/loading-trust/index.ts:280,1507`) | 내부 | 없음(미배선) | closed | 없음 |
| 28 | `thread.resources` | collect | `core-persistence/src/open-chain.ts`가 대화 열기마다 `thread.start` 앞에서 발화한다(H-7, 구현됨) | 경계 대화 시작 | 보태기(스킬, 프롬프트, 테마 경로). [결정: 2026-11-17 사용자, U6] 대화 폴더 `workspace`를 정하는 결과 필드(H-7) | open | 없음 |
| 29 | `thread.mcp.after` | tap, detached | 발화 없음. `onServersChange`가 `undefined`다(`apps/host/src/assembly/cap-mcp.ts:170`) | 이벤트(미배선) | 관찰 | open | 없음 |
| 30 | `thread.start` | tap | `core-persistence/src/points.ts:63` | 경계 대화 시작 | 관찰, `post`, 상태 복원 | open | cap-knowledge `plugin.ts:242`, group-helm `index.ts:54`, plugin-builder `src/group.ts:78` |
| 31 | `thread.info.after` | tap, detached | `core-persistence/src/points.ts:66` | 이벤트 | 관찰 | open | 없음 |
| 32 | `thread.switch.before` | first | `core-persistence/src/points.ts:72` | 내부 | 취소 | closed | 없음 |
| 33 | `thread.fork.before` | first | `core-persistence/src/points.ts:79` | 내부 | 취소 | closed | 없음 |
| 34 | `thread.compact.before` | first | `core-context/src/compaction/compact.ts:363` | 컨텍스트 조립 앞(컴팩션) | 막기(취소), 요약 대신 주기 | open(사유: 컨텍스트 초과 때 대화가 멈추지 않게) | 없음 |
| 35 | `thread.compact.after` | tap | `core-context/src/compaction/compact.ts:556` | 이벤트(컨텍스트 뒤) | 관찰 | open | 없음 |
| 36 | `thread.compact.failed` | tap | `core-context/src/compaction/compact.ts:585` | 이벤트(컨텍스트 뒤) | 관찰 | open | 없음 |
| 37 | `thread.tree.before` | first | `core-persistence/src/points.ts:86` | 내부 | 취소 | closed | 없음 |
| 38 | `thread.tree.after` | tap | `core-persistence/src/points.ts:93` | 이벤트 | 관찰 | open | 없음 |
| 39 | `thread.shutdown` | tap | `core-persistence/src/points.ts:99` | 이벤트(대화 닫힘) | 관찰, 정리 | open | cap-knowledge `plugin.ts:249`, 호스트 cap-web `cap-web.ts:325`, group-guide `src/group.ts:11` |
| 40 | `thread.prompt.before` | tap, detached | `core-tools/src/approvals/service.ts:310` | 이벤트(묻기 앞, 화면이 카드를 띄움) | 관찰 | open | 없음 |
| 41 | `thread.prompt.after` | tap, detached | `core-tools/src/approvals/service.ts:311` | 이벤트(묻기 뒤, 카드가 닫힘) | 관찰 | open | 없음 |
| 42 | `guard.model.before` | first | `core-models/src/pipeline.ts:357` | 모델 호출 앞 | 막기 | closed | 없음 |
| 43 | `guard.tool.before` | first | `core-tools/src/pipeline.ts:548` | 도구 실행 앞(정책·승인 뒤) | 막기 | closed | 없음 |
| 44 | `guard.output.before` | first | `core-loop/src/loop/guard-output.ts:33`(`display`), `core-loop/src/guard-execution.ts:26`(`execution`) | `display`는 모델 호출 뒤, `execution`은 도구 실행 앞 | 막기 | closed | 없음 |
| 45 | `lifecycle.agent.settled` | tap | `ext-host/src/primitives/lifecycle.ts:90` | 이벤트(서브에이전트 뒤) | 관찰 | open | group-learning `handlers.ts:338` |
| 46 | `lifecycle.lease.rejected` | tap | `ext-host/src/primitives/lifecycle.ts:108` | 이벤트. E3가 중재와 거절 이벤트를 없애면 발화가 멈춘다 | 관찰 | open | group-helm `index.ts:55` |

표에서 읽히는 사실:

- fold 수: tap 24, first 10(2, 13, 27, 32, 33, 34, 37, 42, 43, 44), chain 10(1, 4, 5, 6, 7, 8, 14, 22, 23, 24), collect 2(3, 28). 합계 46.
- 위치 종류별 개수: 블록 앞·뒤 또는 경계에서 고치거나 정하는 훅 18개(1, 2, 3, 4, 5, 7, 8, 13, 14, 22, 23, 24, 28, 30, 34, 42, 43, 44), 이벤트 23개(30번을 뺀 tap 23개), 내부 5개(6, 27, 32, 33, 37). 18+23+5=46.
- 지금 발화하지 않는 훅 2개: `request.cache.before`(6), `thread.trust.before`(27). 둘 다 내부이고 아무도 부르지 않는다(4.4.2). `thread.resources`(28)와 `thread.mcp.after`(29)는 M5e 3단계에서 배선되어 발화한다(H-7, H-8). `HookSignatures`는 46행이라고 주석하지만 발화는 42개다(이 표가 쓰인 시점 기준이다. 배선 뒤에는 원래 46행 가운데 44개가, 50행 전체로는 48개가 발화한다).
- 훅을 고치거나 막는 데 쓰는 번들 플러그인은 5개 위치뿐이다: 입력 받기(cap-dialog), 턴 시작(cap-knowledge, cap-work, cap-dialog, helm), 도구 실행 앞(helm), 단계 끝과 턴 종료 직전(cap-work, learning). 이 문서 3절의 표가 근거다.
- 외부 훅 정의(설정 파일에 적는 셸 훅)가 붙을 수 있는 훅은 8개다: `input.user.before`, `input.bash.before`, `tool.call.before`, `tool.result`, `thread.start`, `thread.compact.before`, `boundary.settle.after`, `thread.shutdown`(`ext-host/src/operations/hooks/config.ts:12-21`). 이 8개는 새 위치에서도 모두 공개 위치다. 새 위치 때문에 외부 훅이 떨어져 나가는 일은 없다.
- 기존 화면 표가 따로 있다. `client/src/workbench/canvas/hooks.ts`가 훅별 phase(`start/think/act/wrap`), fold, failure, orderMatters를 중복해서 들고 있고 `hooks.test.ts`가 46개를 대조한다. 이 스펙의 위치 데이터(4.1)가 정본이 되면 이 표는 파생값으로 바꾼다(8절).

### 3.2 역방향 표

| 위치 | 훅 | 비고 |
|---|---|---|
| 경계 대화 시작 | `thread.resources`(보태기), `thread.start`(관찰, post) | `thread.resources`는 미배선 (8절) |
| 경계 입력 받기 | `input.user.before`, `input.bash.before` | |
| 컨텍스트 조립 앞 | `input.agent.before`, `request.context.before`, `request.system.before`, `thread.compact.before` | 턴 시작은 별도 경계가 아니라 이 앞 위치의 첫 훅이다 (4.1) |
| 컨텍스트 조립 뒤 | 고치는 훅 없음. 이벤트 `thread.compact.after`, `thread.compact.failed` | 조립 결과는 모델 호출 앞 훅이 고친다 |
| 모델 호출 앞 | `request.provider.before`, `request.headers.before`, `guard.model.before` | `request.cache.before`는 내부 |
| 모델 호출 뒤 | `boundary.message.after`, `guard.output.before`(`display`) | 이벤트: `request.provider.after`, `request.stream`, `request.model.after`, `request.thinking.after`, `boundary.message.before`, `boundary.message.update` |
| 도구 실행 앞 | `tool.call.before`, `guard.tool.before`, `guard.output.before`(`execution`) | |
| 도구 실행 뒤 | `tool.result` | 이벤트: `tool.execution.before`, `tool.execution.update`, `tool.execution.after` |
| 사람에게 묻기 앞 | 신규 `ask.human.before` | 이벤트 `thread.prompt.before`는 화면이 카드를 띄운 신호로 남는다 |
| 사람에게 묻기 뒤 | 신규 `ask.human.after`(관찰) | 이벤트 `thread.prompt.after` |
| 서브에이전트 앞 | 신규 `agent.spawn.before` | |
| 서브에이전트 뒤 | 신규 `agent.spawn.after`(고치기) | 이벤트 `lifecycle.agent.settled` |
| 경계 턴 종료 직전 | `boundary.step.after`, `boundary.settle.before` | |
| 기록 | 고치거나 막는 훅 없음. 이벤트 구독만 | `boundary.turn.before`, `boundary.turn.after`, `boundary.settle.after`, `thread.info.after`, `thread.tree.after`, `thread.shutdown`, `thread.mcp.after`, `lifecycle.*` |
| 내부 | `request.cache.before`, `thread.trust.before`, `thread.switch.before`, `thread.fork.before`, `thread.tree.before` | 이름과 발화 유지, 매니페스트에서 비내장 플러그인 거부 (5.1 규칙 H-4) |

### 3.3 찾은 빈틈

1. 사람에게 묻기와 서브에이전트에는 고치거나 막는 앞뒤 훅이 없다. 묻기에는 관찰용 `thread.prompt.*`만 있다(분리돼 `detached`로 발화). 서브에이전트에는 관찰용 `lifecycle.agent.settled`뿐이다. 새 쌍 둘로 메운다 (4.3).
2. 도구 실행 앞의 결정은 막기뿐이다. 코드의 `ToolCallDecisionSchema`는 `{ block: true, reason, terminate? }` 하나다(`contracts/src/extensions/hooks/tool.ts:84-98`). `L1.tools.spec` §4.10은 "허용·거부·결과 대체"라고 적는데 결과 대체는 코드에 없다. 묻기와 결과 대신 주기를 더한다 (4.2).
3. 도구 인자를 바꾸는 훅이 없다. `L1.tools.spec` §4.10이 2차로 미뤘다. 이 스펙은 다루지 않는다 (12절 O-6).
4. 컴팩션은 "취소 또는 요약 대체" 하나뿐이고 요약기를 부품으로 바꾸는 길이 훅에 있다. 부품 교체 겹은 4.8의 `parts`에 올린다.

## 4. 인터페이스

### 4.1 위치 데이터 (`contracts`)

훅마다 위치와 하는 일을 기계가 읽는 값으로 둔다. 위치는 `HOOKS` 선언(`contracts/src/extensions/hooks.ts`)의 필드가 아니라 같은 파일 옆의 별도 표 `HOOK_POSITIONS`로 둔다. `HOOKS`는 pi 출처 표기(`pi`)와 섞인 이력 표라서 위치를 그 안에 넣으면 pi 출처가 없는 새 훅의 필드가 어긋난다 [제안].

```ts
// contracts/src/extensions/hook-positions.ts (신규)
export type BlockId = "context" | "model" | "tools" | "ask" | "agents" | "record";
export type BoundaryId = "conversation-start" | "input-received" | "before-turn-end";
export type HookPower = "observe" | "modify" | "decide" | "contribute";

export type HookPosition =
  | { readonly kind: "block"; readonly block: Exclude<BlockId, "record">; readonly side: "before" | "after" }
  | { readonly kind: "boundary"; readonly boundary: BoundaryId }
  | { readonly kind: "event"; readonly anchor?: { readonly block: BlockId; readonly side: "before" | "after" } }
  | { readonly kind: "internal" };

export interface HookPositionRow {
  readonly hook: HookName;
  /** 한 훅이 둘 이상의 위치에 서는 경우(guard.output.before의 display, execution)만 둘 이상 */
  readonly positions: readonly HookPosition[];
  readonly powers: readonly HookPower[];
  /** 지금 코드가 발화하는가(false면 선언만 있다) */
  readonly fired: boolean;
  /** 고빈도 이벤트인가. 구독이 표본 추출을 요청할 수 있다 */
  readonly highFrequency?: true;
}
export const HOOK_POSITIONS: { readonly [N in HookName]: HookPositionRow };
```

규칙:

- 이름을 바꾸지 않는다. `HOOK_NAMES`, `HookSignatures`, 저장된 매니페스트의 `hooks` 문자열, 설정 `x.operations.hookOrder`의 키, 레코드와 `lifecycle` 대응(`LIFECYCLE_HOOKS`)은 그대로다. 위치 표는 이름 위에 얹는 메타데이터라서 별도 공개 이름 층이 필요 없다 [제안: 공개 이름 층은 만들지 않는다]. 화면은 위치로 묶어 보이고 이름은 자세히 보기에서 보인다.
- 검사: `HOOK_POSITIONS`의 키 집합은 `HOOK_NAMES`와 같아야 한다. tap이 아닌 fold를 가진 훅은 `powers`에 `observe`만 있을 수 없다. tap은 `observe`뿐이다. 기존 `hooks.doc.test.ts`와 `client/src/workbench/canvas/hooks.test.ts`가 대조하는 자리에 이 검사를 더한다.
- 위치 종류별 허용: `event`는 tap만, `internal`은 어떤 fold든 가능하다. `block`과 `boundary`는 tap이 아닌 fold(그리고 `thread.start`)만 쓴다.

#### 4.1.1 매니페스트 훅 선언의 결정 선언 [M6 요청 M5e-1 반영]

플러그인 항목(`plugins[]`)에 선택 필드 `hookDecides`를 더한다. 이 훅이 낼 수 있는 결정값(§4.2·§4.3)을 작성자가 미리 선언한다. `hooks`는 훅 이름 문자열 목록이라(F.extensions §3.1) 각 훅 이름에 필드를 붙일 수 없다. 그래서 결정 선언은 훅 이름과 짝을 이룬 `{ hook, decides }` 목록이다. `decides`는 `("block" | "ask" | "replace")[]`다 [구현 결정: 2026-11-18, 2a층. 문자열 목록을 객체 목록으로 바꾸면 소비자 서른 곳 이상이 바뀌어 피했다].

- 검사: 선언한 훅은 같은 플러그인의 `hooks`에 있어야 하고, 선언한 종류는 그 훅이 낼 수 있는 것의 부분집합이어야 한다. 셋을 낼 수 있는 훅은 합치기 지점 `tool.call.before`와 `agent.spawn.before`뿐이다. 아니면 매니페스트 검증 오류 `hook_decision_not_allowed`(`validate.ts`).
- 쓰임: 카드(`PluginCard.does.hook.hooks[].decides`)와 검토 차이(`WhatItDoesDiff`)와 Craft 권한 칸이 "묻거나 막는 Hook"을 정적으로 나열한다. 선언이 없는 훅은 정적으로 알 수 없다고 표시하고 관찰된 결과(`blocks.applied.handlers[].outcome24h`)만 보인다.
- 강제하지 않는다: 선언과 다른 결정이 오면 디스패처는 그 결정을 그대로 처리하고 기록(E의 `HookRun.reason` 진단 `decision_undeclared`)만 남긴다. 거부하면 막기·묻기 동작이 바뀌므로 하지 않는다 [제안]. 선언이 없는 기존 플러그인은 그대로 동작한다.

### 4.2 도구 실행 앞의 결정 어휘

지금: `tool.call.before`(first, closed)는 `{ block: true, reason, terminate? }`를 낸다. 이어서 정책 평가, 승인, 시크릿 사용 승인, `guard.tool.before`가 순서대로 온다(`core-tools/src/pipeline.ts:978-995` `gate`). 훅 결정이 정책보다 먼저 나가고 승인 카드를 띄울 방법이 없다.

새 결정 [제안]:

```ts
// contracts/src/extensions/hooks/tool.ts
export type ToolCallDecision =
  | { block: true; reason: string; terminate?: boolean }                      // 막기 (지금)
  | { ask: true; reason: string }                                              // 묻기 (신규)
  | { replace: { content: ToolContent[]; details?: JsonValue; isError?: boolean }; reason: string }; // 결과 대신 주기 (신규)
```

한 단어씩 뜻을 맞춘다.

| 화면 말 | 값 | 뜻 |
|---|---|---|
| 막기 | `block` | 실행하지 않고 거부 결과를 모델에 돌려준다(지금과 같다) |
| 묻기 | `ask` | 코어의 사람에게 묻기 블록이 카드를 띄운다. 허용되면 계속(정책 평가와 `guard.tool.before`가 이어진다), 거부되면 거부 결과 |
| 고치기 | `tool.result` 패치(지금), `replace`(신규, 실행 없이 결과를 정함) | 고치기는 도구 실행 뒤의 `tool.result`가 정본이다. `replace`는 실행을 건너뛰는 변형이다 |
| 허용 | 값 없음(`undefined`) | 훅은 허용을 값으로 내지 않는다 |

결정 합치기 [결정: 2026-11-17 사용자, U3]. 이 합치기와 5.2의 tier 축소는 2026-11-03의 [결정]("훅 순서는 자유, 기본값은 guard 맨 앞", "처음 결정으로 멈춘다")의 동작을 바꾼다. 사용자가 권고대로 정했다: 이 합치기는 `tool.call.before`·`agent.spawn.before`에만 적용하고 tier는 guard 맨 앞 기본을 유지한 셋이다. 규칙: `ask`와 `replace`는 뒤 핸들러를 멈추지 않는다. 같은 위치의 모든 핸들러가 돈 뒤 강한 쪽이 이긴다: `block` > `replace` > `ask` > 없음. 같은 종류 안에서는 순서가 앞선 핸들러의 값이 이긴다. 근거: 지금 first는 처음 낸 결정으로 멈춘다. 그대로 두면 앞선 플러그인의 "묻기"가 뒤 플러그인의 "막기"를 가린다. 이 합치기는 `tool.call.before`에만 적용하고 다른 first 훅(막기뿐이라서 모두 같은 효과)은 바꾸지 않는다. 구현은 디스패처가 훅별 `FIRST_RANK`를 읽는 것이다(`ext-host/src/primitives/fold/`). 대안(처음 결정이 이김)은 구현이 가장 작지만 "묻기가 막기를 가린다"는 결과를 만든다. 12절 O-1.

묻기의 동작:

- 훅 결정은 `decide()`(`core-tools/src/pipeline.ts:583`)의 입력이 된다. 정책 결과가 `deny`면 거부다(훅이 deny를 ask로 느슨하게 만들지 못한다). `allow`거나 `ask`면 한 장의 카드를 띄운다. 카드 하나에 훅의 사유와 정책의 사유를 함께 싣는다(승인이 두 번 뜨지 않는다).
- 권한 모드가 `bypass`여도 훅의 묻기는 카드를 띄운다. `bypass`는 "코어가 스스로 묻지 않는다"는 뜻이고 훅이 요청한 질문은 코어의 질문이 아니다. 단 저장소가 고른 bypass의 평가 규칙(`bypassAllowed`)은 바뀌지 않는다.
- 카드의 기억 범위는 `once`뿐이다(`remember: ["once"]`, `pipeline.ts:652`와 같다). 훅의 묻기가 영구 허용 규칙이나 "이 대화에서 계속 허용"을 만들지 못한다 [제안, 12절 O-2].
- 카드 본문: `ToolApprovalBody`(`contracts/src/services/approvals.ts:81-97`, 2a층에서 `askedBy`를 더했다)에 `askedBy?: { extension: string; reason: string }`를 더한다. 값이 있으면 `ruleId`는 `hook:<확장 이름>`이다. 화면은 이 필드로 "어느 플러그인이 물었나"를 보인다.
- 사람이 없는 실행(`interactive: false`): 기존 무인 정책을 그대로 탄다(`approvals/unattended.ts:15-35`). 서브에이전트, 깊이가 있는 호출, 표면 대화가 다른 호출은 묻지 않고 거부한다(`resolvedBy: "noninteractive"`). 주 대화의 비대화형 턴은 설정 `l1.tools.unattended.approval`(`deny`, `wait`, `expire`)을 따른다. 거부될 때 모델에 보이는 사유는 `[fresnel:denied_by_extension] <reason> (confirmation unavailable)` 한 줄이다. 턴 기록의 훅 결과는 `asked`로 적고 답은 `noninteractive`로 이어 적는다.
- 응답 기록: 카드의 답(`approval.resolved`)이 기존 방식대로 기록된다. 결과가 "허용"이면 도구가 실행되고 `effect.intent`에 훅 묻기를 거쳤다는 사실을 `approvalId`로 잇는다(지금도 `state.userApprovalId`가 있다, `pipeline.ts:657`). "거부"면 `[fresnel:denied_by_user]` 계열의 기존 거부 결과다.
- 어느 핸들러도 허용을 값으로 낼 수 없으므로 훅이 정책 거부나 승인 요구를 건너뛰게 만드는 길이 없다. 규칙 H-1 (5.1).

`replace`의 동작 [제안]: 실행하지 않고 `effect.intent`를 쓰지 않으며 도구 결과 항목(`effectId: null`)을 기록한다. 차단된 호출의 기록과 같은 모양이다(`L1.tools.spec` §4.2 부속 규칙). `tool.result` 훅은 `replace`가 낸 결과에도 돌지 않는다(이미 훅이 정한 값이다). `details`에는 `{ hook: "replaced", extension }`을 병합한다.

외부 셸 훅의 결과 JSON도 같은 어휘를 받는다: `{"decision":"ask","reason":"…"}`를 `tool.call.before`에서 받는다(`ext-host/src/operations/hooks/runner.ts:114`의 `isDecisionOf`와 `runner.ts:309`의 `tool.call.before` 분기를 확장한다. 셸 출력은 `reason`을 최상위에 싣는다).

### 4.3 새 앞뒤 훅 둘

이름 규칙 `<종류>.<대상>.<시점>`을 따른다. 새 `HookKind` 값 `ask`와 `agent`를 더한다. 기존 훅의 이름은 바뀌지 않는다.

#### 4.3.1 `ask.human.before` (first, 실패 open)

| 항목 | 값 |
|---|---|
| 발화 | 코어의 승인 서비스 `open`(`core-tools/src/approvals/service.ts:394`)이 새 요청을 만들 때, `approval.requested`를 커밋하기 전. 이미 있는 요청(키가 같은 재호출)에는 발화하지 않는다(`service.ts:402-404`의 `known` 분기 뒤) |
| 범위 | 모든 종류의 카드: `tool`(정책, 훅 묻기, 시크릿 사용, 바깥 쓰기, 대체 승인), `question`(`dialog.ask`, `loop.ask`, MCP 질문), `review` |
| payload | `{ threadId, surfaceThreadId, requestKey, askKind: "tool" \| "question" \| "review", title, origin: { turnId?, stepId?, toolCallId?, caller }, summary: { toolName?, risk?, questionIds? }, interactive, unattended: "silent" \| "wait" \| "expire" \| null, askedBy?: string }` |
| 결정 | `{ cancel: true, reason }`(카드 없이 취소 해결), `{ answer: QuestionAnswers, reason }`(`askKind: "question"`일 때만), 없음(사람에게 묻는다) |
| fold, 합치기 | first. 처음 결정으로 멈춘다 |
| 실패 정책 | open. 핸들러 예외, 시간 초과, 스키마 위반은 "결정 없음"으로 보고 사람에게 묻는다. `thread.compact.before`와 같은 예외 사유를 달아 `FailOpenFirstHookName`에 올린다. 근거: 훅 오류가 승인을 조용히 허용하지 않고, 대화도 멈추지 않는다 |
| 시간 | 예산 `first`(30초)이고 사람 응답을 기다리는 동안 시계가 멈추는 기존 장치(`HandlerGate`)를 쓴다 |
| 해결 기록 | 새 `resolvedBy` 값 `extension`(`ApprovalResolution.resolvedBy`, `contracts/src/services/approvals.ts:234-256`에 값 하나 추가)과 `resolvedByExtension: string`. 기존 값 문자열은 그대로다 |

허용 방향 제한이 핵심이다. `tool` 종류와 `review` 종류에서 이 훅은 `cancel`만 낼 수 있다. 자동 허용을 낼 수 없다. `question` 종류는 답을 대신 내줄 수 있다(예: 이미 알고 있는 확인 질문). 이유: 승인은 권한이고, 플러그인 코드가 사용자 대신 권한을 줄 수 있으면 훅이 정책을 우회한다. 규칙 H-1.

#### 4.3.2 `ask.human.after` (tap, 실패 open)

| 항목 | 값 |
|---|---|
| 발화 | 해결이 커밋된 뒤(`approvals/service.ts:385`의 `prompt(entry, "end")` 자리, `thread.prompt.after`와 같은 호출점 옆) |
| payload | `{ threadId, approvalId, askKind, resolution: { decision: "allow" \| "deny" \| "answer", resolvedBy, resolvedByExtension? }, durationMs, origin }`. 질문 답 본문(`answer`)은 싣는다 |
| 결정 | 없다. 값을 바꾸면 사용자의 답을 위조하는 것이라서 고치기 훅을 두지 않는다 |
| 위치 | 사람에게 묻기 뒤. 구독 가능한 이벤트이기도 하다 (4.4) |

`thread.prompt.before/after`(40, 41번)는 이름과 발화를 그대로 둔다. 둘은 화면이 카드를 띄우고 닫은 신호(`detached`)라서 시점이 다르다. 플러그인 작성자 문서는 새 쌍을 정식 위치로 안내하고 `thread.prompt.*`는 "카드 표시 신호"로만 적는다.

#### 4.3.3 `agent.spawn.before` (first, 실패 closed)

| 항목 | 값 |
|---|---|
| 발화 | 코어의 서브에이전트 서비스가 자식 thread를 만들기 전 한 번. 세 입구가 모두 지나는 자리는 `provision`(`core-agents/src/service.ts:1269`)이다. 부모 쓰기 토큰을 확인한 뒤, 같은 requestId의 기존 연결을 본 뒤(`service.ts:1285`), `agent.spawned` 커밋과 자식 생성(`commitSpawned`, `service.ts:645`) 전에 건다. 입구는 `spawn`(`service.ts:1376`)과 `delegate`(`service.ts:1421`)다. 입력 검사(`prepare`)에 걸린 호출과 기존 자식으로 이어 받는 호출은 발화하지 않는다 |
| 진입 경로 | 세 입구 모두 같은 서비스로 모인다. 입구는 자식을 만든 쪽의 소유 종류(`owner.kind`)로 정한다: 모델이 부르는 `agent` 도구(`core-agents/src/tool.ts`)는 `tool`, 주도 함수의 `loop.spawn`(`core-loop/src/service.ts:757-836`)은 `drive`, 그룹의 `g.delegate`(`group-sdk/src/wrap.ts:287-319`)는 `scope`라서 `delegate`다. 따로 표시를 싣지 않는다 |
| payload | `{ threadId(부모), requestId(자식 requestId), agent, task(앞 4,000자), caller(호출자), depth(호출자 깊이), entry, toolCallId?(`tool`일 때만), background, model(자식이 쓸 역할: `request.model ?? 정의 model ?? "subagent"`), limits? }` |
| 결정 | `{ block: true, reason }`, `{ ask: true, reason }`, `{ replace: { report: string }, reason }`(자식을 만들지 않고 보고만 돌려준다, 아래 replace 결과) |
| 합치기 | 도구 실행 앞과 같다: `block` > `replace` > `ask`. 확장 쪽 합치기는 ext-host가 하고 core-agents는 합쳐진 결정만 받는다 |
| 실패 정책 | closed. 디스패치 예외는 거부값이다(`FIRST_DENY["agent.spawn.before"] = { block: true, reason: "extension handler failed" }`) |
| 묻기 | 카드는 `tool` 종류로 띄운다. `toolName`은 `agent`, `args`는 `{ agent, task }`, `ruleId`는 `hook:<확장 이름>`, `askedBy`는 `{ extension, reason }`, `remember`는 `["once"]`다. `origin.toolCallId`는 null로 둔다(승인 서비스가 도구 호출의 대기 체크포인트를 쓰지 않게 한다). 승인 서비스에 새 카드 종류를 만들지 않는다. 깊이가 있거나 사람이 없는 호출은 카드를 열지 않고 거부한다(§7 E-4). 승인 서비스는 `fresnel.approvals` port(core-tools 제공)로 얻는다 |

**replace 결과 [구현 결정: 2026-11-18, 2c층].** 자식을 만들지 않고 아무 기록도 남기지 않는다. thread 생성, `agent.spawned`, `agent.settled`, 보고 입력(`input.queued`), `agent.spawn.after`가 모두 없다 [근거: core-agents/src/service.ts `provision`의 `replaced` 분기]. 결과 모양은 입구마다 이미 있는 모양을 쓴다. 포그라운드(`spawn`: 모델 도구, drive)는 `SpawnResult { status: "completed", answer: 보고, report: null, usage: null, reused: false }`이고, `childThreadId`는 `failure`와 같이 만들지 않은 자리 id다. 백그라운드(`delegate`: `g.delegate`, 백그라운드 도구)는 `DelegateReceipt`에 `status: "replaced"`와 `report`를 더한 변형이다. 이 변형은 계약을 바꾼다(`contracts/src/services/agents.ts`의 `DelegateReceipt`, group-sdk의 같은 타입). 보고는 훅이 준 본문 그대로이고 격리 블록을 씌우지 않는다. 같은 requestId로 다시 부르면 기록이 없으므로 훅이 다시 묻는다.

**발화 횟수.** 새 요청은 한 번 발화한다. 같은 requestId의 순차 재호출은 기존 연결을 이어 받으므로 발화하지 않는다. 같은 requestId의 동시 호출은 앞 훅을 각각 받을 수 있다. 자식은 하나뿐이다. 경쟁은 자식을 만들기 직전의 연결 다시 보기(`provision`, `service.ts:1285`)가 막는다. 정확히 한 번을 동시 호출까지 보장하는 것은 [미결] [근거: core-agents/src/service.ts `provision`의 연결 다시 보기]다.

`agent` 도구 경로에서는 `tool.call.before`(도구 이름 `agent`)와 이 훅이 둘 다 발화한다. 한 행동에 훅이 둘 도는 셈이라서 payload에 `toolCallId`와 `entry: "tool"`을 실어 플러그인이 중복을 가릴 수 있게 한다. 도구 블록이 서브에이전트 블록을 감싸는 구조를 그대로 두는 것이다.

#### 4.3.4 `agent.spawn.after` (chain, 실패 skip)

| 항목 | 값 |
|---|---|
| 발화 | 자식이 정착하고 결과 검사(`guardReport`, `core-agents/src/result-guard.ts`를 부르는 `recordSettled` 안, `service.ts:1095`)를 거친 뒤, 부모 대화에 `agent.settled`를 커밋하기 전(`reportAfterSettled`, `service.ts:1104`; 커밋은 `service.ts:1105`). `recordSettled`를 지나는 모든 정착(정상, 중단, 오류)에 발화한다. 재시작 뒤 끊긴 자식을 닫는 `settleStoredOwnedBy`(`service.ts:953`)는 자식이 돌지 않았으므로 발화하지 않는다 |
| payload | `{ threadId(부모), requestId, agent, status, usage, childThreadId }`. `status`와 `usage`는 자식 정착의 값이다 |
| 값과 패치 | 값 `{ report: { text: string; truncated: boolean } }`(text는 격리 블록을 씌운 본문), 패치 `{ reportText?: string }`. 디스패치가 실패하면 보고를 그대로 두고 정착한다(실패 skip) |
| 제한 | 병합 규칙(`CHAIN_RULES["agent.spawn.after"]`)이 상한을 한 번 적용하고, core-agents가 `STORED_REPORT_MAX`(`core-agents/src/service.ts:64`, 값은 계약의 `AGENT_REPORT_TEXT_MAX`, 60,000자)로 한 번 더 자른다. 잘리면 `truncated`를 참으로 한다. 고친 본문은 `agent.settled` 기록, 부모가 받는 결과와 보고 입력에 같이 들어간다. `status`와 `usage`는 고치지 못한다 |

`lifecycle.agent.settled`(45번)는 그대로 이벤트로 남는다(커밋 뒤 관찰). 디스패치는 `ext-host`의 수명주기 지점이 기록 피드에서 발화한다.

#### 4.3.5 결과: 훅 50개

`HookSignatures`는 46에서 50행이 된다. `HOOK_NAMES`에 네 이름이 더해지고 `HOOKS`, `CHAIN_RULES`(`agent.spawn.after`), `FIRST_DENY`(`agent.spawn.before`), `HOOK_POSITIONS`, F 스펙 §3.4 표, 화면 표가 같이 바뀐다. 이름 길이 상한 48자(`HookNameSchema`) 안이다. 발화를 잇는 층(D-7, D-8)이 들어가기 전까지 `HOOK_POSITIONS`의 네 행은 `fired: false`다. 그 전에 이 훅을 선언한 매니페스트는 `hook_not_fired` 경고를 받는다(H-4). [2c 구현 반영] 서브에이전트 두 행(`agent.spawn.before|after`)은 D-8 구현으로 `fired: true`다.

### 4.4 이벤트 구독

#### 4.4.1 면

관찰 훅 24개 가운데 `thread.start`(대화 시작 경계에서 `post`와 상태 복원을 하므로 위치를 따로 둔다)를 뺀 23개에 새 `ask.human.after`를 더한 24개가 이벤트다(이름 목록은 `HOOK_POSITIONS`에서 `kind: "event"`인 행). 플러그인 작성자에게는 훅 이름 24개를 외우게 하지 않고 하나의 면을 준다 [제안].

```ts
// group-sdk 공개 API (X의 RegistrationApi에도 같은 모양)
g.subscribe(
  events: readonly SubscribableEvent[] | "all",
  handler: (event: EventEnvelope, ctx: EventContext) => void | Promise<void>,
  options?: { sample?: "every" | "coalesce" },   // 고빈도 이벤트만. 기본 every
): void;

interface EventEnvelope<E extends SubscribableEvent = SubscribableEvent> {
  readonly event: E;                     // 지금 훅 이름 그대로
  readonly threadId: ThreadId;
  readonly eventKey: string;             // 디스패치 키. 같은 이벤트의 재발화는 같은 값
  readonly payload: Readonly<PayloadOf<E>>;
  readonly anchor?: { block: BlockId; side: "before" | "after" };
}
```

규칙:

- `subscribe`는 `g.on`의 tap 형태 위의 얇은 도우미다. 매니페스트 `hooks`에는 지금처럼 이벤트의 훅 이름을 적는다(`"all"`은 선언된 이벤트 이름의 전부). 따라서 매니페스트와 신뢰 검토 화면, 설정의 훅 순서가 그대로 동작한다 [제안].
- `g.on("<tap 훅 이름>", handler)`는 계속 받는다. 번들과 기존 템플릿이 옮겨 갈 때까지 호환이다. 새 템플릿과 플러그인 빌더는 `g.subscribe`만 쓴다(8절).
- 막지 못한다: 핸들러 반환값은 무시하고 타입이 `void`다. 예외, 시간 초과(예산 `tap` 5초, `streamTap` 1초, `shutdown` 2초: `ext-host/src/operations/budget.ts:23-33`)는 기록하고 그 호출만 버린다. 턴의 진행을 늦추는 방식은 아직 같다: `detached` 5개(12, 29, 31, 40, 41)를 뺀 나머지는 디스패처가 완료를 기다린다 [미확인: 격리 후 대기 여부는 격리 스펙이 정한다. 이 스펙의 요구는 "이벤트 처리의 지연이 턴의 결과를 바꾸지 못한다"까지다].
- 전달 보장(시험 가능): (1) 이벤트는 커밋 뒤에 전달한다(tap은 커밋 뒤에 실행, `L1.loop.spec` §7). (2) 같은 대화 안에서 한 구독자에게는 발화 순서대로 하나씩 전달한다. (3) 커밋 전에 프로세스가 끊기면 같은 `eventKey`로 다시 전달할 수 있다. 그래서 적어도 한 번이고 핸들러는 `eventKey`로 멱등해야 한다(`L1.loop.spec` §7 "재생" 규칙). (4) 이미 커밋된 결과가 있는 이벤트는 다시 전달하지 않는다. (5) 지금 발화하지 않는 이벤트(`thread.mcp.after`)가 배선되면 같은 규칙을 따른다.
- 읽기 전용: payload는 동결해서 넘긴다(`ext-host/src/primitives/freeze.ts` 기존 장치).
- 부수효과는 허용한다. 구독 핸들러가 `post`, `commit`, `record`, 기능 호출을 해도 된다. 효과 있는 기능 호출은 통합 호출 경로(4.6)를 탄다. 이벤트 처리 중 낸 호출이 같은 이벤트를 다시 일으키면 5.3의 되돌이 방지가 막는다.
- 고빈도 이벤트(`request.stream`, `boundary.message.update`, `tool.execution.update`): `sample: "coalesce"`를 고르면 구독자가 바쁜 동안 쌓인 이벤트를 마지막 하나로 합친다. 기본은 모두 전달이다. 합쳐진 전달에는 `dropped: n`을 싣는다.

#### 4.4.2 내부로 남는 것

| 훅 | 내부로 두는 이유 |
|---|---|
| `thread.trust.before`(27) | 폴더 신뢰는 플러그인을 읽기 전에 결정한다(`ext-host/src/loading-trust/trust/resolve.ts`). 비내장 플러그인은 그 시점에 아직 신뢰받지 못했다. 발화 연결(`emitProjectTrust`)도 없다 |
| `thread.switch.before`(32), `thread.fork.before`(33), `thread.tree.before`(37) | 대화 구조를 바꾸는 사용자 조작을 플러그인이 취소하는 위치다. 번들 사용이 없고 개념 초안도 내부 후보로 두었다(ADR에는 옮기지 않았다). 공개하지 않는다 [제안, 12절 O-3] |
| `request.cache.before`(6) | 발화하는 코드가 없고 캐시 워밍 결정은 코어의 일이다 |

내부 훅의 이름과 발화(있다면)와 `thread.tree.after` 같은 짝 이벤트는 그대로 둔다. 매니페스트 검증이 비내장 플러그인의 내부 훅 선언을 거부한다(5.1 규칙 H-4). 외부 셸 훅 정의의 허용 목록(`config.ts:12-21`)은 공개 위치뿐이므로 영향이 없다.

### 4.5 훅의 결정값, 기록된 결과값, 표시값

세 집합을 한 번씩만 정의한다. 지금까지 세 가지 어휘(R12/이 스펙의 여섯, 기록 스펙의 다섯 + `reason` + `ask`, 돌려 보기의 일곱)가 따로 있었다.

- **결정값**(이 스펙이 정의): 핸들러가 돌려주는 값. `tool.call.before`와 `agent.spawn.before`는 `block`, `ask`, `replace`, `ask.human.before`는 `cancel`, `answer`(4.3.1). 그 밖의 훅은 패치나 기여(`modified`)이고 값이 없으면 통과다. 허용은 값이 아니다(H-1).
- **기록된 결과값**(기록 스펙 `m5d` §3.2가 정의): 저장 문자열은 바꾸지 않는다. `result`는 기존 다섯(`passed`, `modified`, `blocked`, `failed`, `skipped`), `reason`은 `threw`, `timeout`, `result_invalid`, `merge_rejected`, `process_exit`, `process_killed`, `decision`은 `none`, `block`, `ask`, `replace`, `cancel`, `answer`, `ask`는 물음 메타데이터다(`via`: 결정값 길과 `awaitUser` 길).
- **표시값**(R12의 여섯): `pass`, `modified`, `asked`, `blocked`, `error`, `timeout`. 저장 열이 아니라 기록된 값에서 파생하는 값이다. 변환표:

| 기록된 값(`result` / `reason` / `decision`) | 표시값 |
|---|---|
| `passed` / - / `none` | `pass` |
| `modified` / - / `none` | `modified` |
| `passed` / - / `replace` | `modified`(결과를 대신 줬다. 표시에서 "결과 대체" 표지를 단다) |
| `passed` / - / `answer` | `modified`(질문에 답을 대신 냈다) |
| `passed` / - / `ask` (`ask.answer` 무관) | `asked` |
| `blocked` / - / `block` | `blocked` |
| `passed` / - / `cancel` | `blocked`(카드를 취소했다) |
| `failed` / `timeout` / `none` | `timeout` |
| `failed` / `threw`, `result_invalid`, `merge_rejected`, `process_exit`, `process_killed` / `none` | `error` |
| `skipped` / - / `none` | 여섯 값에 없음. 화면이 일곱째로 "건너뜀"을 보인다 |

디스패처가 예외를 거부값으로 대체한 경우(`substituted`)는 `failed`이므로 `error`(시간 초과는 `timeout`)다. 지금 `hookDenialDetails("threw"|"blocked", extension, reason)`(`core-tools/src/pipeline.ts:158-170`)이 막음과 오류를 이미 나눈다. 이 변환을 `contracts`의 순수 함수 `hookOutcomeOf(run): HookOutcome`로 올리고 `HookOutcome`(표시값 여섯) 타입을 함께 둔다. 지난 턴에 돌려 보기의 `candidate.result`와 화면의 일곱 갈래도 같은 함수를 쓴다. 기록 스펙은 `result`, `reason`, `decision`, `ask`를 저장하고 이 변환을 다시 정의하지 않는다.

### 4.6 통합 호출 경로 (R10)

플러그인 코드가 효과 있는 기능 호출을 하면 그 호출은 도구 실행 블록(`prepare`, `execute`)을 지난다. 새 진입점 하나를 둔다.

```ts
// 값: contracts/src/capabilities/plugin-call.ts (구현). services/tools.ts가 다시 내보내고, ToolsPort(extensions/ports.ts)와 ToolService가 쓴다
type PluginCallVia = "hook" | "tool" | "command" | "method" | "drive" | "effect";
type PluginCallTarget =
  | { readonly kind: "tool"; readonly name: ToolName }                       // 주도 `tool` 명령: 도구 이름
  | { readonly kind: "capability"; readonly capability: CapabilityId; readonly method: string };
interface PluginCallRequest {
  readonly threadId: ThreadId;
  readonly plugin: { readonly name: string; readonly scopeId: string };
  readonly via: PluginCallVia;
  readonly target: PluginCallTarget;
  readonly input: JsonValue;            // 도구 대상이면 인자 객체
  readonly requestId: string;           // 1~64자. 재생 멱등 키(스코프, 요청 id)
  readonly parentToolCallId?: string;   // 플러그인 도구 안에서 부른 호출
  readonly hookDepth?: number;          // 훅 스택 길이. `l1.tools.pluginCallDepth`를 넘으면 hook_depth
  readonly inheritApproval?: { readonly approvalId: string; readonly risk?: ToolRisk };  // U-11. 주장일 뿐이고 엔진이 승인 기록과 대조한다(risk는 쓰지 않는다)
  readonly signal?: AbortSignal;
}
interface ToolResultView {
  readonly content: string;                     // 텍스트 내용을 줄바꿈으로 이은 값
  readonly structuredContent: JsonValue | null; // 기능 메서드의 반환 모양(구현이 더했다, 아래 구현 기록)
  readonly isError: boolean;
  readonly details: JsonValue | null;
}
type ToolErrorKind =
  | "unavailable" | "invalid_args" | "denied" | "blocked" | "hook_cycle" | "hook_depth"
  | "aborted" | "storage" | "unknown_outcome";                                   // unknown_outcome은 구현이 더했다
interface ToolError { readonly kind: ToolErrorKind; readonly message: string }
executeForPlugin(request: PluginCallRequest): Promise<Result<ToolResultView, ToolError>>;
```

경로: `g.capability(key).method(input, options)`(`ext-host/src/primitives/host-api.ts:357-393`)가 만드는 래퍼(`guardCapabilityService`, `capability-guard.ts:122`)가 메서드를 `읽기 전용 가벼운 경로`와 `파이프라인 경로`로 나눈다(5.3 규칙 U-1). 파이프라인 경로는 래퍼가 `executeForPlugin`을 부르고 결과를 서비스 메서드의 반환 모양으로 되돌린다. 주도 함수의 `tool` 명령(주도 스펙 E2)과 `hostOf(g).requestEffect`의 효과 작업자(`ext-host/src/primitives/effect-worker.ts:118-124`)도 같은 진입점을 부른다. 어느 쪽이든 서비스를 직접 부르는 줄은 남지 않는다 [결정 D: 직접 호출도 남기되 같은 관문을 지난다].

호출 주체: `CallerId`(`contracts/src/capabilities/tool-meta.ts:22-27`, 옛 패턴 `^(main|subagent:.{1,64})$`, 최대 72자)에 `plugin:<이름>`을 더했다(구현 2026-11-18). 승인 기록의 `APPROVAL_CALLER_PATTERN`(`contracts/src/records/catalog/approval.ts`)도 같은 형식을 받게 넓혔다. 플러그인 이름 스키마는 `^[a-z][a-z0-9-]{1,31}$`(최대 32자, `contracts/src/extensions/name.ts`)라 `plugin:<이름>`은 39자 이하이고 최대 길이 72에 들어간다. 패턴은 `^(main|subagent:.{1,64}|plugin:[a-z][a-z0-9-]{1,31})$`로 고정한다. 읽는 쪽이 모르는 값을 통과시키는지는 열거를 넓힐 때 확인한다(옛 앱이 새 기록을 읽을 때 엄격 검증이 깨지지 않게, 교차 점검 X3). 기록 스펙(M5d)은 호출 주체 종류에 `plugin`을 더해 `callerPlugin`을 이름으로 둔다. 훅 payload의 `caller`와 정책 입력의 `caller`와 승인 기록의 `ApprovalCaller`(`approvalCallerOf`)가 같은 값을 쓴다. 기능 서비스가 받는 `CallContext.caller`(`{ kind: "extension", extension }`, `capability-guard.ts:95-110`)는 이미 있으므로 그대로 두고 도구 쪽 문자열만 더한다.

**구현 기록(층 A, 2026-11-18).** 위 모양은 다음과 같이 구현했다. 이 절의 [제안]은 아래 결정으로 바뀌었다.

- 값의 자리: `PluginCallRequest`, `ToolResultView`, `ToolError`는 `contracts/src/capabilities/plugin-call.ts`에 둔다. `ToolsPort`(`extensions/ports.ts`)가 같은 타입을 써야 하는데, `extensions`가 `services`를 import하면 순환이 생겨 `import/no-cycle`과 dependency-cruiser의 `no-circular`가 막는다. `services/tools.ts`는 이 타입을 다시 내보낸다. `executeForPlugin`은 `ToolsPort`에 있고 `ToolService`는 이것을 상속한다.
- 대상: `target`은 판별 유니온이다. `tool`은 도구 이름이고 `capability`는 기능과 메서드다. 기능 메서드는 `ToolSpec.method` 매핑으로 도구를 찾고, 없으면 합성 이름 `cap:<기능>.<메서드>`의 등록을 본다. 합성 등록은 다음 층이 한다.
- 결과: `ToolResultView`에 `structuredContent`를 더했다. 기능 메서드의 반환 모양을 되돌리려면 구조화 값이 필요하다. 재생은 durable 기록의 상태와 `structuredContent`만 되살린다. 텍스트와 `details`는 저장되지 않으므로 같은 프로세스 안의 재생만 실행 때의 값을 그대로 돌려준다.
- 오류 종류: `unknown_outcome`을 더했다. 같은 (스코프, 요청 id)의 의도만 있고 결과가 없으면 다시 실행하지 않고 이 값을 준다. 결과 커밋이 실패한 호출도 결과가 기록되지 않았으므로 같은 규칙을 받는다. `hook_cycle`은 다음 층이 훅 스택과 함께 낸다.
- 깊이: `hookDepth`가 설정 `l1.tools.pluginCallDepth`(기본 3, 범위 1~8)보다 크면 `hook_depth`로 거부한다(U-8 (다)). 스택 길이를 `>`로 비교한다.
- 승인 상속: 규칙은 U-11 (12.1절 아래)에 있다. `inheritApproval`은 주장이고 엔진(`pipeline.ts`의 `inheritedOf`)이 승인 기록과 대조한다. 맞지 않는 주장은 무시하고 보통의 승인 카드를 띄운다. 기록에 없는 승인 id는 카드를 건너뛰지 못한다.
- 자기 훅: 플러그인 호출이 낸 `tool.call.before`, `guard.tool.before`, `tool.result`, `tool.execution.*`는 호출한 플러그인 자신의 핸들러를 건너뛴다(U-8 (가)). `ext.dispatch` 옵션 `exceptExtension`으로 구현했다(ext-host 변경).
- 턴 없는 기록: 턴이 없으므로 효과 기록에 합성 `trn`·`stp` id를 쓴다. 대화 항목(toolResult)은 남기지 않는다(`silent`). 턴이 없는 승인 요청은 대기 체크포인트를 만들지 않는다(`turnless`, 승인 서비스). 효과 기록 스키마의 `turnId: null` 허용 여부는 O-7로 남는다.
- 다음 층이 할 것: 훅 스택과 순환 검사(U-8 (나)), 가벼운 경로 분류(U-1), 기능 래퍼와 효과 작업자의 연결(D-13, D-17), 합성 도구 등록(D-16 중 스택 부분).

**구현 기록(층 C, 2026-11-18).** 위 "다음 층이 할 것"은 다음과 같이 구현했다.

- 경로 분류 [제안 → 구현]: [제안]이던 `pluginCallRoute(...)` 대신 가장 작은 질의 `ToolsPort.toolMappedFor(capability, method): boolean`을 더했다(`contracts/src/extensions/ports.ts`). 분류는 `ext-host/src/primitives/capability-guard.ts`의 `routeOf`가 한다. 정의가 없거나 포트가 없거나 설정이 꺼져 있으면 `direct`, 도구 매핑이 있으면 `pipeline`, `readOnly`면 `light`, 나머지는 `pipeline`이다. `direct`와 `light`는 옛 직접 경로다. 가벼운 경로의 턴 기록 줄(U-2)은 턴 기록 포트가 아직 없어 남기지 않는다(M5d에서 더한다).
- 설정 [제안]: `l1.tools.pluginCalls`(boolean, 기본 거짓, 파일 네 범위, 반영 `live`)를 core-tools 설정에 더했다. 이름과 기본값은 [제안]이다. ext-host는 `fresnel.settings` 포트로 호출마다 읽고, 값이 `false`가 아니면 켜진 것으로 본다. 끄면(기본) 옛 직접 경로다. 파생 파일(`client` i18n en·ko, `apps/host/schema/settings.*.schema.json`)은 `config schema --core-only`로 다시 만들었다.
- 합성 항목(D-16, U-1 (다)): `cap:<기능>.<메서드>`는 레지스트리에 등록하지 않는다. 기능 정의에서 호출 때 만든다(`core-tools/src/entries.ts`의 `syntheticEntryOf`). 정의 목록은 `ToolsDeps.capabilityDefs`(내장 기능 정의, 매니페스트 기능, 조립이 넘긴 `pluginCapabilities`)다. 등록하지 않으므로 광고, 도구 검색, 도구 목록에 들어갈 길이 없다. 위험 등급은 메서드 정의의 `risk`(F.capabilities.spec `MethodDef.risk`)다. 선언이 없으면 가장 엄한 `exec`다. 호출자는 고를 수 없다. 내장 기능은 메서드마다 선언한다(enE2m, 아래 [결정 대기] 표). 등록 방식을 쓰지 않은 까닭: 도구 등록이 없는 기능(예: `knowledge.ledger`)도 플러그인이 불러야 하는데, 도구 목록(`L2_TOOL_CAPABILITIES`)에서만 만들면 그 호출이 `unavailable`이 된다. 조립은 `pluginCapabilities`로 내장 기능 정의 전체를 넘기고, 같은 목록을 core-tools의 매니페스트 optional에도 더한다(`g.capability`의 선언 검사 때문이다). 매니페스트의 필수 목록은 바뀌지 않는다.
- 합성 이름과 훅 payload [결정 필요 없음, 구현 중 발견]: 합성 이름 `cap:…`은 provider 와이어 패턴 `^[a-zA-Z0-9_-]{1,64}$`를 지나지 못한다. 훅 payload의 `ToolNameSchema`가 이 패턴만 받아서 `tool.call.before`가 검사 실패로 거부했다. 그래서 `ToolNameSchema`가 와이어 이름이나 합성 이름(`SYNTHETIC_TOOL_NAME_PATTERN`)을 받게 넓혔다(`contracts/src/capabilities/ids.ts`). 모델 광고 이름의 검사(`TOOL_NAME_WIRE_PATTERN`, `validate.ts`)는 그대로다.
- 멱등 키(U-5): 명시 `requestId`가 있으면 그것을 쓴다. 없으면 `call:` 뒤에 SHA-256(범위, 계통, 기준 판 번호, 기능.메서드, 순번) 앞 40자를 쓴다. 계통은 `DriveInvocation.lineageId`다. 핸들러 안의 호출은 디스패치 키와 순번을 쓴다(`state.ts`의 `nextIdentity`와 같은 순번 카운터). 상태 쓰기 id의 `leaseId`와 다른 까닭은 재개 뒤에도 같은 호출이 같은 키를 받게 하려는 것이다. 식별할 것이 없으면(대화 없음, 디스패치 키 없음) 옛 경로다.
- 되돌이(U-8 (나)): 핸들러가 도는 칸은 `Ambient.hookStack`에 쌓는다(`dispatch.ts`). 파이프라인 호출은 `{플러그인, 기능.메서드, 인자 해시}` 칸을 더해 그 호출이 낸 훅에 보이게 한다. 같은 (플러그인, 대상, 인자 해시)가 스택에 이미 있으면 `plugin_call_hook_cycle`(메시지 `[fresnel:hook_cycle]`)로 거부하고 실행하지 않는다. 깊이는 스택 길이를 `hookDepth`로 넘기고, core-tools가 `l1.tools.pluginCallDepth`와 비교한다. `hookStack`은 선택 필드다. 리스 쪽 맥락(`lease.ts`)을 바꾸지 않으려고 `undefined`를 빈 스택으로 읽는다.
- 도구 안의 호출: 플러그인 도구 execute의 맥락은 `Ambient.callId`(도구 호출 id)를 가지며 `parentToolCallId`로 싣는다. 승인 상속 주장(`inheritApproval`)은 `CallOptions.inheritApproval`로 받아 싣되 내장 확장(`contextTrusted`)이 넘긴 것만 싣는다(외부·격리 플러그인의 주장은 버린다). 도구 안의 호출은 엔진이 바깥 호출의 승인을 직접 안다(`parentToolCallId`로 진행 중인 호출 상태를 본다). 상속의 규칙과 구현은 U-11의 구현 기록(2026-11-18, enE2u)이다.
- 내장 어댑터의 되돌이 방지: 신뢰한 확장(L1 도구 어댑터)이 도구 호출 id를 싣고 부른 호출은 이미 파이프라인 안에서 도는 것이다. 경로를 다시 고르면 `resolveCapability`의 `g.capability` 호출이 파이프라인으로 되돌아가므로 검사 없이 옛 경로로 부른다.
- 결과 오류: 공급자가 낸 오류 코드(도구 결과 `details.code`)는 그대로 `CapabilityError` 코드로 싣는다. 호출자(예: cap-artifacts)가 코드로 나눠 처리하기 때문이다. 코드가 없으면 `plugin_call_failed`, 파이프라인의 Err는 `plugin_call_<종류>`다.
- 조건: 파이프라인 호출은 대화 조건(`conditions`, interactive와 샌드박스 천장)을 싣는다. 효과 작업자는 요청 때 기록한 값을 싣는다(U-10, U-12). 샌드박스 천장은 같은 모드의 정책 천장으로 옮기므로 더 엄격한 쪽만 남는다.
- 효과 작업자(D-17): `effect-worker.ts`의 `viaPipeline`이 `executeForPlugin(via: "effect")`를 부른다. 요청 키는 기존 `key`다. `effect.requested|started|settled` 기록은 그대로다. 설정이 꺼졌거나 포트가 없거나 정의가 없으면 옛 경로다.
- 승인 카드(해결, enE2m): 이전에는 도구 매핑이 없는 쓰기 메서드가 합성 항목이라 위험 등급이 `exec`였다(메서드 선언에 위험 필드가 없었다). 그래서 기본 권한 모드(`default`)에서 `work.tasks.create`, `dialog.commands.run` 같은 호출이 승인 카드를 띄우고, 사람이 답하지 않는 apps/host 통합 시험 8개가 대기한다(`helm-sigkill`, `ext-method`의 Helm 시험, `dialog-area`의 goal 시험, `proposals`의 UC-3, `goal-judge`, `review-approval`의 hunk 시험, `uc2` 두 시험). U-6대로 묻는 것이 맞는지, 메서드 선언이나 등록에 위험 등급을 주는 길을 열지는 결정이 필요하다. 해결: [제안: 메인 세션, 사용자에게 보고] 기능 메서드 정의에 위험 등급 `risk`를 선언한다. 선언이 없으면 지금처럼 `exec`다. 내장 기능의 등급은 같은 효과의 모델 도구와 맞췄다(표는 아래 6.4절 enE2m 기록). `l1.tools.pluginCalls` 기본값을 켰다.
- 시험: `ext-host/test/primitives/plugin-call-route.test.ts`(경로, 멱등 키, 되돌이, 결과 오류, 효과 작업자), `core-tools/test/plugin-call-pipeline.test.ts`(합성 항목 셋: 실행, 광고 제외, readOnly는 항목이 없음). `apps/host/test/int/capability-guard.int.test.ts`는 설정이 꺼진 기본값으로 옛 기대 값을 그대로 둔다(켠 상태의 효과 표 완화는 ext-host `plugin-call-route.test.ts`가 시험한다). 학습 시험 대역(`group-learning/test/support`)은 `l1.tools.pluginCalls`를 꺼서 옛 경로로 돈다. 그 대역은 파이프라인을 흉내 내지 않는다.

### 4.7 변경 기록 공통 결과 형식 (R22)

지금:

- 데스크톱 변경 탭은 도구 호출 인자에서 만든다. 도구 이름 `edit`과 `write`, 인자 모양(`path`, `content`, `edits[].oldText/newText`)을 본다(`apps/desktop/src/views/approval-form.ts:424-443`, `apps/desktop/src/views/panels/changes/changes-model.ts` 머리 주석: "엔진은 파일 변경을 따로 기록하지 않는다").
- 서버 쪽 리뷰는 도구 결과 항목의 `details`를 `FileChangeSchema`로 읽는다(`cap-artifacts/src/reviews/collect.ts:53-75`). 이름은 보지 않는다.
- 플러그인이 등록한 도구의 결과는 `details: null`이다(`core-tools/src/entries.ts:424-428`). `tool.result` 훅이 `details`를 패치하지 않는 한 리뷰도 변경 탭도 못 본다. 그러므로 대체 편집 도구(`replaces`)는 이름과 인자 모양이 내장과 같아도 리뷰에서 빠지고, 이름이 달라도 변경 탭에서 빠진다.
- 파일 되감기를 읽는 코드는 지금 없다(`restoreFiles`는 문서에만 있다: `docs/xeon/L2/artifacts/spec.md:1088`, 로드맵 Later). 변경 탭과 되감기는 이 형식을 읽는 쪽으로 만든다.

새 형식 [제안]:

```ts
// contracts/src/capabilities/file-change.ts (신규, FileChangeSchema는 그대로 두고 감싼다)
export const FileChangeEntrySchema = Type.Object({
  path: Type.String({ maxLength: 4096 }),              // 정규 경로
  op: Type.Union([Type.Literal("create"), Type.Literal("modify"), Type.Literal("delete"), Type.Literal("rename")]),
  from: Type.Optional(Type.String({ maxLength: 4096 })), // rename의 옛 경로
  existed: Type.Boolean(),                             // 지금 FileChange.existed와 같다
  diff: Type.Optional(Type.String()),                  // unified diff. 이진 파일이나 큰 파일은 생략
  added: Type.Integer({ minimum: 0 }),
  removed: Type.Integer({ minimum: 0 }),
  firstChangedLine: Type.Optional(Type.Integer({ minimum: 1 })),
  before: Type.Optional(ContentRefSchema),             // { sha256, size }. 되감기가 쓴다
  after: Type.Optional(ContentRefSchema),
  source: Type.Union([Type.Literal("observed"), Type.Literal("reported")]),
}, { additionalProperties: false });

/** 도구 결과 details의 예약 키. details = { …도구가 낸 값, fileChanges?: FileChangeEntry[] } */
export const FILE_CHANGES_KEY = "fileChanges" as const;
export function fileChangesOf(details: JsonValue | null): readonly FileChangeEntry[]; // 옛 FileChange 한 건도 읽는다
```

기록 방식:

1. 관찰(`observed`): 파일 변경은 코어가 보는 파일 서비스에서 일어난다. `workspace.files.write/edit`가 이미 `change: FileChange`를 반환한다(`contracts/src/capabilities/defs/workspace.ts:211-216`, `renderChange` `:350-361`). 통합 호출 경로(4.6)는 서비스 반환의 `change`를 `FileChangeEntry`(`source: "observed"`)로 모아 부모 도구 호출(`parentToolCallId`)의 결과 `details.fileChanges`에 합친다. 모델이 부른 `edit`은 지금처럼 `details`가 `FileChange`이고 `fileChangesOf`가 한 건으로 읽는다. [구현 상태: 내장 기능 도구의 결과에 든 `FileChange`는 체인 전에 `observed`로 떼어 두었다가 체인 뒤에 다시 합친다(`core-tools/src/file-changes.ts`, F-3). 플러그인 코드가 `g.capability`로 부른 서비스 호출의 `change`를 부모 호출에 모으는 것(위 통합 경로)은 E2가 만든다. 이 트랙에서는 만들지 않는다.]
2. 보고(`reported`): 코어 서비스를 거치지 않는 도구는 실행 맥락의 `ctx.changes.report(entries)`로 알린다. 코어는 이를 `source: "reported"`로 표시해 합친다. 이 값은 검증되지 않았다.
3. 코어가 쓰는 키: `fileChanges`는 코어의 예약 키다. 병합은 `tool.result` 체인이 끝난 뒤에 한다. 훅이 `details`를 통째로 바꿔도 코어가 관찰한 변경은 마지막에 다시 들어간다. 훅이 변경 기록을 지우지 못한다. `replace` 결과(4.2)에는 관찰한 변경이 없다.
4. 되감기 입력: 되감기는 `before`/`after`의 해시와 `op`를 읽고 `observed`만 자동 복원 대상으로 삼는다. `reported`는 사용자 확인을 거친다. 구현은 범위 밖(1.2)이고 입력 형식만 이 스펙이 정한다.

읽는 쪽:

| 읽는 쪽 | 지금 | 바꾼 뒤 |
|---|---|---|
| 데스크톱 변경 탭 | 도구 이름과 인자 모양(`approval-form.ts:424-443`) | 완료된 도구 결과의 `fileChangesOf(details)`. 결과가 아직 오지 않은 호출은 파일로 세지 않는다(경로와 diff가 결과에서만 오므로 진행 표시는 턴의 실행 중 표시가 맡는다). 인자 기반 그림(`fileChangeViewOfArgs`)은 승인 카드 미리보기에만 남긴다. 추적 밖 목록(명령·하위 에이전트)은 이름 기반 그대로다(P-4 계측 전) |
| 서버 리뷰 `collectDiffs` | `parse(FileChangeSchema, details)` | `fileChangesOf(details)`의 `diff`가 있는 항목 |
| 파일 되감기(보류) | 없음 | `before`/`after` |

`bash`와 `agent`가 바꾼 파일은 여전히 "추적 밖"이다. 셸 실행의 파일 변경 관찰은 이 스펙 범위 밖이다(12절 O-5).

### 4.8 블록 모델 데이터

UI와 플러그인 작성자가 읽는 기계 판독 설명이다. 위치는 `contracts/src/blocks/`(신규)이고 순수 상수와 타입만 둔다(실행 코드 없음, F 규칙).

```ts
// contracts/src/blocks/blocks.ts
export interface SettingRef {
  readonly key: string;                    // 설정 키. 4.8.1의 표가 정본
  readonly owner: string;                  // 이 설정 키를 소유한 쪽: 코어 패키지 이름(core-*, 코어 키 l1.*·l0.*) 또는 소유 플러그인 이름(cap-* 등, l2.*·l3.* 키)
  /** 설정 범위. `thread` 범위는 없다. 우선순위 managed > launch > profile > local > project > user > default (M5c §3.3이 `profile`을 더한다) */
  readonly scope: readonly ("managed" | "launch" | "profile" | "local" | "project" | "user")[];
}
export type InjectKind =
  | "instructions" | "skill" | "tool" | "mcp-server" | "agent-definition"
  | "model-provider" | "web-provider" | "command" | "ui";
export interface ReplaceablePart {
  readonly id: string;                     // 예: "tool:edit", "summarizer", "web-search-provider"
  readonly label: { readonly ko: string; readonly en: string };
  readonly how: "replaces" | "provider" | "hook";   // 매니페스트 replaces, 제공자 등록, 훅으로 대체
  readonly default: "core" | string;       // 기본 구현. 한 층 정리 뒤에는 번들 플러그인 이름
}
export interface Guarantee { readonly id: string; readonly text: { readonly ko: string; readonly en: string }; }

export interface BlockDescription {
  readonly id: BlockId;
  readonly label: { readonly ko: string; readonly en: string };
  readonly settings: readonly SettingRef[];          // 설정 겹
  readonly inject: readonly InjectKind[];            // 주입 겹
  readonly parts: readonly ReplaceablePart[];        // 부품 교체 겹
  readonly hooks: {                                  // 앞뒤 훅 겹
    readonly before: readonly HookName[];
    readonly after: readonly HookName[];
    readonly events: readonly HookName[];            // 이 블록에 닻을 둔 이벤트
  };
  readonly guarantees: readonly Guarantee[];         // 바닥. 잠금. 플러그인이 바꿀 수 없다
}
export interface BoundaryDescription { readonly id: BoundaryId; readonly label: {…}; readonly hooks: readonly HookName[]; }

export interface BlockModel {
  readonly version: 1;
  readonly blocks: readonly BlockDescription[];      // 6개: context, model, tools, ask, agents, record
  readonly boundaries: readonly BoundaryDescription[]; // 3개
  readonly positions: readonly HookPositionRow[];    // HOOK_POSITIONS 전체(50행)
}
export const BLOCK_MODEL: BlockModel;
```

- `hooks.before/after/events`는 `HOOK_POSITIONS`에서 파생한다. 손으로 두 번 적지 않는다. 생성 검사가 `BLOCK_MODEL.blocks[*].hooks`와 `HOOK_POSITIONS`의 일치를 확인한다.
- `guarantees`는 옛 `craft-plan.md` §7.2의 보장 열(ADR §3.2.3으로 옮겨짐)을 정본으로 한다: 컨텍스트("기록된 것만 모델에 보인다", "잘리면 표시된다"), 모델("요청과 응답 기록", "토큰 집계", "요청 가드, 재시도"), 도구("권한 확인", "승인", "샌드박스", "실행 기록", "결과 기록"), 묻기("답이 올 때까지 멈춤", "재시작 뒤 복원"), 서브에이전트("부모의 프로필·권한 상속"), 기록("재시작해도 같은 일을 두 번 하지 않음"). 문구는 Craft가 번역한다.
- 모델 컨텍스트에는 이 데이터가 가지 않는다 (1.3).

#### 4.8.1 블록별 설정 키

설정 키의 정본 목록과 위치는 부록 A에 둔다. 키의 소유자는 둘로 나뉜다. 코어 키(`l1.*`, `l0.*`)는 코어 패키지(`core-context`, `core-models`, `core-tools`, `core-agents`, `core-persistence`)가 소유한다. 웹 허용(`l2.web.policy.*`), MCP(`l2.mcp.*`), 지식(`skills.*`, `memory.*`), `commands.advertise`는 기본 설치 플러그인(`cap-web`, `cap-mcp`, `cap-knowledge`, `cap-dialog`)이 소유한다. 블록의 설정 겹은 "그 블록이 읽는 코어 키 + 그 블록에 걸린 플러그인 키(소유 플러그인 표시)"다 [채택]. 이 키들은 M5c가 `profile` 범위에 개별로 연다(M5c §3.3). "코어 플러그인"이라는 말은 쓰지 않는다: 코어는 코어이고 뺄 수 없는 플러그인은 없다(엔진 설계 §8, [결정: 2026-11-17 사용자, U4]).

### 4.9 블록 읽기 (wire)

오류 코드는 블록 3700~3719를 쓴다(`m5-plan.md` Z1이 C0에서 동결한다).

클라이언트는 같은 데이터를 wire로 읽는다. 기존 읽기 짝(`ext.*` 계열과 `hooks.order.*`)의 곁에 읽기 전용 둘을 더한다 [제안].

| 메서드 | 결과 | 설명 |
|---|---|---|
| `blocks.describe` | `BlockModel` 정적 부분 | 엔진 빌드가 가진 `BLOCK_MODEL`. 입출력 없는 상수라서 대화 없이 읽는다 |
| `blocks.applied` (입력 `{ threadId? , profileId? }`) | `{ blocks: { id, settings: {key, value, source}[], parts: {id, current: "core"\|name, replacedBy?}[], handlers: { hook, plugin, order, outcome24h? }[] }[] }` | 프로필(또는 대화)에 적용된 값. `handlers`는 기존 `hooks.order.get`의 `applied`와 `extReadViewOf().handlers`(`ext-host/src/primitives/dispatch.ts:155-168`의 `sortEntries`)를 위치별로 다시 묶은 것이다. `outcome24h`는 기록 스펙의 `metrics.query`를 `period: { from, to }`(24시간)로 불러 지표 `hook.outcomes`를 인용한 표시값 개수다(일 단위 `{ days }`가 아니다) |

`blocks.describe`는 기록 블록(`record`)의 `hooks.before`와 `hooks.after`가 **비어 있음을 명시**한다(빈 배열이고 생략하지 않는다). 기록 블록에는 이벤트 구독(`hooks.events`)만 있고 고치거나 막는 훅 겹이 없다(결정 A). 화면이 "이 블록에는 Hook이 없다"를 빈 칸이 아니라 설계로 보여 주기 위해서다. 블록은 여섯이고 "다섯"이라 적은 문서(`craft-plan.md` §7.2, 엔진 설계 옛 §13)는 이 스펙이 정본이다(M5e-3은 통합 정리에서 이미 반영됐다).

둘 다 `contracts/src/wire-settings/wire/` 아래에 스키마와 메서드 표를 두고(기존 `ext-read-methods.ts`의 `Io<…>` 형식), 호스트 처리기는 `apps/host/src/handlers/` 아래 새 파일이다. 변화 알림은 두지 않는다(프로필 변경은 단계 경계에서 적용되고 화면이 다시 읽는다) [제안].

## 5. 동작 규칙

### 5.1 훅 정리

- **H-1 좁히기만 한다.** 어떤 훅의 결정도 정책의 `deny`나 승인 요구를 `allow`로 바꾸지 못한다. 결정 값에 허용이 없고(4.2), `ask.human.before`는 `tool`·`review` 종류에서 `cancel`만 낼 수 있다. 시험: 정책이 `deny`인 호출에 모든 핸들러가 `undefined`나 `ask`를 내도 결과는 거부다.
- **H-2 결정 합치기 [결정: 2026-11-17 사용자, U3].** 채택. 사용자가 확인한 것은 `block` > `replace` > `ask` 순과 등급 셋(guard 맨 앞)이다. 아래 나머지는 [제안]이다: 처음 결정으로 멈추는 단순안은 `ask`가 `block`을 가리므로 쓰지 않는다. `tool.call.before`와 `agent.spawn.before`는 모든 핸들러가 돈 뒤 `block` > `replace` > `ask` > 없음 순으로 결정한다. 같은 종류 안에서는 순서가 앞선 값이 이긴다. 다른 first 훅은 바뀌지 않는다(처음 결정에서 멈춤). 시험: 앞 핸들러 `ask`, 뒤 핸들러 `block`이면 `block`이다.
- **H-3 묻기는 한 번만 띄운다.** 같은 호출에 훅 묻기와 정책 ask가 겹치면 카드는 하나이고 두 사유가 함께 실린다. 시험: 카드 수 1.
- **H-4 내부 훅은 공개하지 않는다.** 비내장 플러그인 매니페스트가 내부 훅(`request.cache.before`, `thread.trust.before`, `thread.switch.before`, `thread.fork.before`, `thread.tree.before`)을 선언하면 로딩이 `hook_internal`로 거부한다. 내장은 허용한다. 지금 발화하지 않는 훅을 선언하면 진단 경고 `hook_not_fired`를 남긴다. 시험: 사용자 등급 매니페스트로 `thread.fork.before` 선언 시 거부.
- **H-5 위치표 완전성.** `HOOK_POSITIONS`는 `HOOK_NAMES`(50개)와 키가 같고 위치 종류별 개수는 블록·경계 21, 이벤트 24, 내부 5다. 훅 이름 문자열은 46개 모두 이전 빌드와 같다(스냅샷 시험).
- **H-6 이벤트는 막지 못한다.** 구독 핸들러의 반환값과 예외는 턴의 결과를 바꾸지 못한다. 시험: 모든 이벤트 구독에서 예외를 던져도 턴의 기록은 구독 없을 때와 같다.
- **H-7 `thread.resources` 배선** [결정: 2026-11-17 사용자, U6]의 구현이다. 결과 필드 `workspace`는 사용자가 정한 것이고 배선 세부는 [제안]이다. 대화를 열 때 `thread.start` 앞에서 한 번 발화하고 반환한 경로를 스킬 탐색(`cap-knowledge`의 `skills.paths`와 같은 경로 처리)에 합친다. 실패는 open이다. **[결정: 2026-11-17 사용자, U6] 대화 시작 경계의 결과로 대화 폴더를 정하는 길.** `thread.start`는 관찰·`post`만 하는 tap이라 값을 돌려주지 못한다. `thread.resources`(collect)의 결과에 선택 필드 `workspace`를 더한다. 여럿이 내면 순서가 앞선 핸들러의 값만 쓰고 나머지는 진단(`workspace_conflict`)이다. 쓰기 소유를 얻은 호스트가 첫 턴 전에 코어의 `applyOpenWorkspace`를 부르고, 코어는 같은 프로젝트 루트 안의 폴더일 때만 `thread.updated { workspace }`를 커밋한다. 아니면 무시하고 진단한다(`workspace_outside_project`, 턴이 있으면 `workspace_late`). 프로젝트 루트는 지금 대화의 현재 폴더다(M5c §4.4.9). 같은 폴더 동시 대화의 정책(코어는 알리기만, 폴더는 이 훅이 정함, worktree는 플러그인)도 같은 결정 U6이다(코어는 알리기만, 막지 않고 자동 복사 없음, 훅은 경로 하나를 돌려준다). 이 필드는 결과 모양 그대로 구현한다. M5c 로더가 같은 일을 하면 이 훅은 "코드 플러그인이 동적으로 경로를 낼 때"만 쓴다.
- **H-8 `thread.mcp.after` 배선** [제안]. 발화는 `applyBoundary`를 부른 대화(`boundary.step.before` 핸들러, `apps/host/src/assembly/cap-mcp.ts`)의 것으로 한다. 서버 변화가 대화에 속하지 않는다는 주석의 문제를 "변화를 처음 본 대화에서 발화"로 푼다. 구현은 `createMcp`의 `onServersChange` 콜백을 쓰지 않는다. 그 콜백은 대화를 받지 않고 `applyBoundary`는 직렬로 돌기 때문에, 변화를 낸 호출이 돌려주는 보고서(`changed`, `servers`, `toolsAdded`, `toolsRemoved`, 모양이 `McpServersChangePayload`와 같다)를 그 단계의 핸들러가 받아 `thread.mcp.after`로 보낸다. 키는 `<대화>:mcp.after:<단계>`라서 재발화해도 같은 값이다 [정정: 처음 적은 "`onServersChange`를 연결"은 대화 정보가 없어 쓸 수 없었다].
- **H-9 훅 결과 값.** 핸들러 호출마다 기록된 결과값(`result`, `reason`, `decision`, `ask`)이 남고 4.5의 변환표로 표시값 여섯이 파생된다.
- **H-10 `lifecycle.lease.rejected`.** E3가 중재를 없애면 발화가 멈춘다. 이름과 위치표 행은 남기고 `fired: false`로 바꾼다. 매니페스트 경고(H-4)가 따른다.

### 5.2 같은 위치에 여러 플러그인이 있을 때의 순서

지금: 정렬 키 `(tier, loadIndex, seq)`, tier 순서 `guard, user, project, builtin, core`(`ext-host/src/operations/tier.ts:9-15`, `ext-host/src/primitives/dispatch.ts:158-169`) 뒤에 `x.operations.hookOrder`(설정 키, wire `hooks.order.*`)가 이름 붙은 핸들러의 자리를 덮어쓴다(`ext-host/src/primitives/order.ts`). 적용은 단계 경계다(`ext-host/src/operations/index.ts:279-280`).

규칙:

- **O-1 기본 순서는 `E(T)`의 순서다** [제안]. 공통 묶음의 플러그인, 프로필의 플러그인 목록, 덧씌우기 순이다(M5c §4.1.3). 같은 위치의 핸들러는 앞쪽 플러그인이 먼저 돈다. 프로필에 없는 핸들러(프로필이 없는 구성, 외부 셸 훅)는 지금 키 `(loadIndex, seq)`를 쓴다.
- **O-2 tier는 셋으로 줄인다** [결정: 2026-11-17 사용자, U3: 채택. guard 맨 앞 기본 유지. 등급 이름과 순서는 [제안]]. M5c §4.2.1도 이 규칙을 쓴다: `guard`(코어의 보안 가드와 managed 외부 훅, 맨 앞), `plugin`(번들, 사용자, 프로젝트 플러그인 전부, 한 등급), `core`(코어 자신의 핸들러, 맨 뒤). `user`, `project`, `builtin` 구분은 정렬에서 빠지고 출처 표시(`assignTier`의 `source`)로만 남는다. 지금은 `user`가 `builtin`보다 앞이라서 사용자의 chain 패치가 번들의 패치보다 먼저 적용된다. 새 기본에서는 프로필 목록 순서가 이 일을 한다. 기본 프로필의 번들 플러그인은 지금 로딩 순서대로 나열한다.
- **O-3 덮어쓰기 유지.** `x.operations.hookOrder`와 `hooks.order.get|set|reset|preview`(`contracts/src/wire-settings/wire/ext-read.ts:889-987`)는 그대로 쓰고 이름도 바꾸지 않는다. 가드 위험 미리보기(`previewOrder`, `checkOrder`)는 `guard` tier 핸들러를 옮길 때만 경고한다.
- **O-4 순서가 뜻을 바꾸는 곳.** chain은 값이 흘러가므로 순서가 최종 값을 바꾼다. collect는 기여를 순서대로 모은다. `tool.call.before`와 `agent.spawn.before`는 H-2가 종류의 우선순위를 정하므로 순서는 사유와 `replace` 내용만 바꾼다. 화면의 "순서가 중요" 표시(`client/src/workbench/canvas/hooks.ts`의 `orderMatters`)는 이 규칙으로 다시 계산한다.
- **O-5 변경 시점.** 프로필 목록 순서와 덮어쓰기는 다음 단계 경계에 적용된다(지금과 같다).
- 시험: 프로필 목록 `[A, B]`일 때 같은 chain 훅에서 A의 패치가 먼저 적용된다. 목록을 `[B, A]`로 바꾸면 다음 단계에서 순서가 뒤집힌다. `hookOrder` 덮어쓰기는 목록 순서보다 우선한다.

### 5.3 플러그인 기능 호출의 통합 경로

지금 확인한 것(코드 읽기):

- 플러그인이 `g.capability(key)`로 부르면 `guardCapabilityService`(`ext-host/src/primitives/capability-guard.ts:122-208`)가 서비스 메서드를 감싼다. 그 안에서 하는 일은 선언 검사, 재실행 문맥의 효과 분류 검사(`isEffectAllowed`), 멱등 키 검사, 호출 문맥 채우기뿐이다. 정책 평가, 승인, `tool.call.before`, `guard.tool.before`, `effect.intent|exec|result`, `tool.result`, 시크릿 마스킹은 없다(이들은 `core-tools/src/pipeline.ts`의 `gate`와 `execute`에만 있다).
- 서비스 쪽에서 남는 안전장치: 루트와 보호 경로 검사(`cap-workspace/src/roots.ts`), 작업 폴더 밖 쓰기 승인(`cap-workspace/src/write-access.ts`), 셸의 샌드박스 래핑(`cap-workspace/src/shell/run.ts`).
- 주도 함수 안에서는 효과 표(`ext-host/src/primitives/effects` 계열의 `REPLAY_EFFECT_TABLE`)가 `workspace.files.write`, `edit`, `workspace.shell.run`을 거부한다. `on` 핸들러에서는 `idempotent` 메서드만 허용한다. 도구 `execute`, 명령, 확장 메서드, setup에서는 검사 없이 모두 부를 수 있다(`replayContextOf`가 null, `capability-guard.ts:70-74`).
- E0로 고친 것: 이 경로가 대화의 `interactive`와 읽기 전용 샌드박스 천장을 호출 문맥에 싣는다(`capability-guard.ts:95-110`의 `untrustedContext`, 호출 조건은 `LoopPort.callConditions`, `core-loop/src/service.ts:982-989`, 커밋 `32a96b116`, `efefd10a6`). `engine-block-surface-inventory.md` §3a의 "버려짐"은 이 트리에서는 해소되어 있다. 효과 작업자도 `request.interactive`와 `request.sandbox`를 싣는다(`effect-worker.ts:118-124`). 이 스펙은 그 값이 파이프라인에서 쓰이도록 한다.
- 플러그인이 등록한 도구 결과의 `details`는 항상 `null`이다(`core-tools/src/entries.ts:424-428`).

통합 규칙:

- **U-1 분류.** 플러그인 코드의 기능 호출 하나를 이렇게 나눈다. (가) 도구 매핑이 있는 메서드(`ToolSpec.method`로 모델 도구가 있는 것: `read`, `write`, `edit`, `grep`, `bash`, `web_search` 등)는 효과 여부와 무관하게 파이프라인 경로다. (나) 도구 매핑이 없고 `readOnly: true`로 선언된 메서드는 가벼운 경로다. (다) 도구 매핑이 없고 `readOnly`가 아닌 메서드는 파이프라인 경로이고 도구 이름은 합성한 `cap:<기능 id>.<메서드>`다. 읽기 호출도 도구 매핑이 있으면 정책의 deny 규칙(경로 기반)을 받아야 하기 때문에 (가)에 둔다 [제안].
- **U-2 가벼운 경로가 하는 일.** 서비스 안의 안전장치(루트, 보호 경로, 샌드박스)는 그대로 돈다. 훅과 승인은 없고 `effect.*` 기록도 없다. 대신 호출 한 줄(플러그인, `기능.메서드`, 요청 키, 성공 여부, 걸린 시간)이 턴 기록의 플러그인 호출 목록에 남는다(저장은 M5d). 대화 로그에는 쓰지 않는다.
- **U-3 파이프라인 경로가 하는 일.** `ToolService.executeForPlugin`(4.6)이 모델 도구 호출과 같은 순서로 도구 이름 해석, 스키마 검증, `tool.call.before`, 정책 평가, 승인, 시크릿 사용 승인, `guard.tool.before`, `effect.intent`, 키 잠금과 풀 슬롯, 실행, `tool.result`, 결과 기록, `tool.execution.*`를 지난다(`L1.tools.spec` §4.2 표의 1~11단계 전부).
- **U-4 호출 주체와 기록.** 도구 결과 항목과 효과 기록의 호출 주체는 `plugin:<이름>`이다. 플러그인 도구 안에서 부른 호출은 `parentToolCallId`에 바깥 도구 호출 id를 싣는다(`ToolCallPayload.parentToolCallId`는 이미 계약에 있다: `contracts/src/extensions/hooks/tool.ts:53,104,168,185`. `L1.tools.spec` §4.2의 "중첩 호출의 진입점은 미결"을 이 규칙이 채운다). 턴이 있으면 그 `turnId`와 `stepId`를 쓰고 없으면(대화 시작 훅, 명령) 턴 없는 효과 기록으로 남긴다 [미확인: 턴 없는 호출의 효과 기록 스키마가 `turnId: null`을 허용하는지는 읽지 않았다. 12절 O-7]. 층 A 구현은 합성 `trn`·`stp` id로 남겼다(4.6 구현 기록).
- **U-5 재생 안전.** 호출 키는 `해시(범위, 디스패치 키 또는 주도권 계통과 기준 판 번호, 호출 순번)`이다(`ext-host/src/primitives/state.ts:170-196`의 요청 id 규칙과 같다). 같은 키로 다시 불리면 기록된 결과를 돌려주고 실행하지 않는다. 의도만 있고 결과가 없는 호출은 `unknown`으로 두고 다시 실행하지 않는다(지금 `requestEffect`의 규칙, `effect-worker.ts:207-209`). 이 보장이 있으므로 재실행되는 문맥(주도 함수, `on` 핸들러)에서 `write`, `edit`, `run`을 거부하던 효과 표 검사는 파이프라인 경로 호출에서는 적용하지 않는다. 가벼운 경로의 `capability.undeclared` 메서드는 효과가 없다고 선언된 것이 아니므로 파이프라인 경로(위 (다))로 가고 거부 대신 이 키 규칙을 받는다.
- **U-6 권한 모드.** 플러그인 호출도 대화의 권한 모드로 평가한다. `bypass`면 코어가 카드를 띄우지 않고, `default`와 `acceptEdits`는 모델 호출과 같은 규칙으로 묻는다. 플러그인이 자기 호출의 위험 등급을 낮춰 신고하는 길은 없다(위험 등급은 기능 정의의 `ToolSpec`과 메서드 선언에서 온다). 번들과 사용자 플러그인을 구별하지 않는다(한 등급). 훅의 묻기는 모드와 상관없이 묻는다(4.2). **[결정: 2026-11-17 사용자, U2]** 초안 출신 호출(`overlay_draft`, 호출 주체 `plugin:<이름>`이 초안일 때)은 권한 모드와 무관하게 항상 승인 카드를 띄우고 "초안" 표시를 단다. 위 `bypass` 규칙은 검토본 플러그인에만 적용한다(M5c §4.3.8).
- **U-7 다른 플러그인의 훅.** `tool.call.before`, `guard.tool.before`, `tool.result`, `tool.execution.*`가 모두 발화하고 payload의 `caller`는 `plugin:<이름>`이다.
- **U-8 되돌이 방지.** (가) 자기 호출 건너뛰기: 플러그인 P가 낸 호출에서는 P 자신의 핸들러를 부르지 않는다. (나) 훅 스택: 훅 핸들러 안에서 시작된 호출은 `Ambient`(`ext-host/src/primitives/ambient.ts:23-45`의 `point`, `dispatchKey`에 더해 `hookStack: { plugin, point, tool, argsHash }[]`)에 현재 핸들러를 쌓는다. 새 호출의 `(플러그인, 도구, argsHash)`가 스택에 이미 있으면 `[fresnel:hook_cycle]`로 거부한다. (다) 깊이 상한: 스택 길이가 설정 `l1.tools.pluginCallDepth`(기본 3, 범위 1~8) 넘으면 `[fresnel:hook_depth]`로 거부한다. (라) 거부는 호출한 핸들러에게 오류 결과로 돌아가고 훅 결과 값 `blocked`와 사유로 기록된다. 시험: 플러그인 P가 자기 `tool.result` 핸들러 안에서 `write`를 부르면 P의 핸들러는 그 호출에 돌지 않는다. P의 `tool.call.before`가 Q의 도구를 부르고 Q의 `tool.call.before`가 다시 P의 같은 호출을 만들면 `hook_cycle`이다.
- **U-9 호출자 신원은 호스트가 정한다.** 격리 프로세스의 플러그인은 서비스 객체를 갖지 못하고 요청만 보낸다. 신원 `plugin:<이름>`은 연결을 연 호스트가 붙인다. 요청 본문의 신원 주장은 무시한다. 엔진 안의 플러그인은 래퍼가 `target.extension`으로 붙인다(지금 `untrustedContext`와 같다).
- **U-10 효과 작업자.** `requestEffect`의 작업자도 서비스를 직접 부르지 않고 `executeForPlugin(via: "effect")`를 부른다. 요청 키는 기존 `key`다. `effect.requested|started|settled` 기록은 그대로 두고 파이프라인의 기록이 더해진다.
- **U-11 중첩 호출의 승인 상속** [제안]. 플러그인 도구 호출(예: 대체 `edit`)이 사용자 승인을 받은 뒤 그 안에서 같은 플러그인이 부르는 호출은, (가) 위험 등급이 바깥 호출 이하이고 (나) 정책 deny 규칙에 걸리지 않고 (다) 훅의 묻기가 없을 때 바깥 호출의 승인 증거(`approval`)를 물려받아 카드를 다시 띄우지 않는다. 훅 발화, 샌드박스, 보호 경로는 그대로다. 근거: 대체 도구는 위험 등급이 원본 이상으로 고정되어(`core-tools/src/registry.ts:141-151`) 승인을 한 번 받는데, 안에서 쓰는 `workspace.files.edit` 호출이 한 번 더 묻으면 대체 도구가 쓸 수 없게 된다. 12절 O-4.

  상속은 승인을 건너뛰는 길이므로 다음으로 좁힌다(구현 2026-11-18, enE2u). 위 (가)~(다)는 스펙 그대로이고 아래는 스펙이 말하지 않아 더한 [제안]이다.
  1. **사람이 답한 승인에서만 나온다.** 승인 기록이 `resolvedBy: "user"`일 때만이다. 훅의 `answer`, 무인 처리, 만료, 취소, 정책 자동 허용은 승인 기록이 없거나 사람의 답이 아니므로 상속하지 않는다. 도구 승인은 허용만, 검토 카드는 사람의 답(`answer`, `deny`) 모두 물려준다(되돌림은 그 결정의 결과다).
  2. **승인이 가리킨 대상에만 쓴다.** 같은 대화의 승인이어야 한다. 도구 승인은 그 승인을 받은 바깥 호출 안의 호출(`parentToolCallId`)이다. 검토 카드는 본문 `review.writes`(되돌림 쓰기 호출 입력의 정규 JSON sha256 hex 목록)에 입력이 든 쓰기다. 다른 경로나 다른 내용의 쓰기는 해시가 달라 새 카드를 띄운다. 호스트의 사람 결정(학습 제안 승인·수정)은 호스트가 결정을 실행하는 동안만 켜는 허용(`ToolService.withHumanDecision`, `HumanDecisionGrant.covers`)이 가리킨 호출이다. 학습 제안은 그 제안의 `learning.queue` 증거를 단 지식 스킬·메모리 쓰기다.
  3. **한 번 쓰면 끝이다.** 키는 `<승인 id>:<호출 입력 해시>`이고 같은 키는 한 번만 통과한다. 같은 승인 id라도 다른 호출(다른 hunk)은 자기 해시로 한 번씩 통과한다. 쓴 키는 의도 기록 `effect.intent.inheritedApproval.key`에 남고, 재시작 뒤에도 이 기록을 읽어 다시 받지 않는다(재생 규칙의 요청 id 멱등과 별개다). 실행 전에 막힌 호출(훅 block, 가드)은 키를 쓰지 않은 것으로 둔다.
  4. **막는 것은 그대로다.** 정책 deny는 상속보다 먼저다. 플러그인 훅의 `block`도 적용된다. 훅이 물은 호출은 상속하지 않는다(위 (다)). 시크릿 사용 승인 증거로는 쓰지 않는다(`userApprovalId`를 채우지 않고 `inheritApplied`에만 둔다).
  5. **플러그인이 승인 id를 지어내지 못한다.** 주장(`PluginCallRequest.inheritApproval`)은 엔진이 승인 기록과 대조하므로 없는 id, 취소된 승인, 답하지 않은 승인, 다른 쓰기에는 소용이 없다. 주장을 싣는 길(`CallOptions.inheritApproval`)은 내장 확장(`contextTrusted`)만 쓴다. 격리·외부 플러그인의 `engine.call` 기능 호출은 같은 가드를 지나므로 주장이 버려진다. 호스트의 사람 결정 허용은 플러그인이 받지 못하는 `ToolService` 메서드다.
  6. **기록.** 상속한 호출의 `effect.intent`에 `inheritedApproval: { approvalId, key }`가 남는다(옛 읽기 쪽은 선택 필드라 영향이 없다). 턴 기록(M5d)의 `CallRecord`에 `inheritedApprovalId`로 옮기는 것은 M5d가 정한다.
  알려진 한계 [제안]: 검토 카드의 `writes`는 카드를 연 플러그인이 정한다. 사용자는 카드의 파일 목록을 보고 답하므로 목록에 없는 경로의 쓰기는 해시가 있어도 카드의 뜻 밖이지만, 엔진은 경로와 카드 파일 목록의 일치를 따로 검사하지 않는다. 도구 승인의 상속은 위 대상 규칙이 바깥 호출까지만이라 안쪽 호출의 경로·내용을 바깥 호출의 인자와 대조하지 않는다.
- **U-12 무인 실행.** 파이프라인 경로의 `interactive`는 대화의 값이다. 중첩과 플러그인 호출은 `depth`를 올리지 않는다(`approvals/unattended.ts:16-34`는 `depth !== 0`이면 묻지 않고 거부하므로, 중첩을 깊이로 세면 모든 중첩 호출이 조용히 거부된다). 대신 `via`와 `hookStack` 길이를 따로 둔다.
- **U-13 모델 쪽 `guardExecution`.** `guard.output.before`의 `execution` 대상(`core-loop/src/guard-execution.ts:26`, L2가 파일 쓰기 전에 부른다)은 파이프라인 경로에서는 `guard.tool.before`와 겹친다. 이 스펙은 이를 건드리지 않는다. 겹침 제거는 12절 O-8.
- **U-14 범위 밖.** `g.commit`, `g.record`, `readRecords`, `post`는 기능 호출이 아니라서 이 경로 밖이다(레코드 블록의 보장은 별도다).

### 5.4 변경 기록

- **F-1** 파이프라인 경로로 부른 `workspace.files.write|edit`의 반환 `change`는 부모 도구 결과의 `details.fileChanges`에 `source: "observed"`로 합쳐진다. 부모가 없는 호출(훅, 명령)은 그 호출 자신의 결과 항목에 싣는다. [E2 소유: 플러그인 코드의 서비스 호출을 파이프라인이 보는 길이 E2다. 이 트랙이 낸 관찰 항목은 내장 기능 도구(`capability`가 있는 항목)의 결과 `FileChange`뿐이다. 그 경우 F-2처럼 `details`의 모양은 바꾸지 않는다.]
- **F-2** 모델이 부른 내장 `write|edit`의 결과 `details`는 지금처럼 `FileChange`이고 `fileChangesOf`가 한 건으로 읽는다(옛 기록 호환).
- **F-3** 코어가 쓰는 `fileChanges`는 `tool.result` 체인이 끝난 뒤 합쳐진다. 체인 안의 훅이 `details`를 지워도 최종 결과에는 남는다. 시험: 내장 `edit`의 관찰 변경에 `tool.result` 핸들러가 `details: null` 패치를 내도 결과의 `fileChanges`는 보존된다. 플러그인 도구의 보고 항목은 체인이 `fileChanges`를 보지 않으므로(합치기가 뒤에 있다) `details: null`은 빈 패치다. 그 항목에 대해서는 체인이 예약 키를 흉내 낸 목록을 내도 보고 항목이 이긴다는 것을 시험한다(`core-tools/test/file-changes.test.ts`).
- **F-4** 플러그인 도구의 `ctx.changes.report(entries)` 호출은 `source: "reported"`로 합쳐지고, 같은 `path`에 `observed`가 이미 있으면 `observed`가 이긴다. 입력은 `Omit<FileChangeEntry, "source">`다(`source`는 코어가 정한다). 모양이 틀린 항목은 버린다.
- **F-5** 변경 탭, 서버 리뷰 `collectDiffs`, 되감기는 `fileChangesOf`만 읽는다. 도구 이름과 인자 모양을 보는 코드는 승인 카드 미리보기로만 남는다. [예외: 변경 탭의 "추적 밖" 목록(명령 `bash`, 하위 에이전트 `agent`)은 이름으로 가른다. 그 호출들이 바꾼 파일을 알 원천이 P-4 계측(`observedCoreCalls`) 전에는 갖춰지지 않았다.]
- **F-6** 완료된 호출만 변경으로 센다. 오류 결과(`isError`)는 `observed` 항목이 있어도 "실패"로 표시하되 이미 디스크에 쓴 변경은 `observed`로 남긴다(쓴 뒤 오류가 난 경우를 숨기지 않는다) [제안]. [구현 상태: 코어는 오류 결과에서도 관찰·보고 항목을 `details`에 남긴다. 변경 탭은 오류 결과를 세지 않는다(기존 동작). "실패로 표시하면서 보이기"는 변경 탭의 파일 항목 모양(`FileEdit.state`가 `failed`를 받지 않는다)을 넓혀야 하므로 미결이다.]

### 5.5 대체 도구

- **P-1** 지금 대체가 거는 조건: 매니페스트 `replaces`에 내장 도구 이름이 있고 신뢰 등급이 허용되며(`ext-host/src/primitives/host-api.ts:549-553`), 원본이 "내장 기능 도구"여야 한다(`forbiddenReason`: `core.*` 접두의 파이프라인 도구는 `core_pipeline`, 기능이 없거나 MCP 서버 도구면 `not_builtin`, `core-tools/src/registry.ts:66-75`). 같은 이름을 둘 이상이 대체하면 `replace_conflict`다(`registry.ts:133-139`). 후보는 `pending`으로 등록되고 `tool_replace` 승인(kind `tool`, `core-tools/src/replace-gate.ts`)을 받아야 `active`가 된다. 대체 항목의 위험 등급은 원본 아래로 내려가지 않고 분류가 합쳐지며 `capability`는 비운다(`registry.ts:141-151`).
- **P-2** 대체 도구도 같은 파이프라인이다(레지스트리의 항목이라서 `tool.call.before`부터 `tool.result`까지 모두 돈다). 정책 평가는 `evaluateReplacement`(저장소 허용 규칙을 버리고 기본 허용을 낮춤).
- **P-3** 한 층 정리 뒤 "내장 기능 도구"의 뜻이 바뀐다. 원본이 번들 플러그인의 도구가 된다. 조건을 "`capability`가 있고 MCP가 아님"에서 "번들 플러그인이 등록했고 `replaceable`이 `false`가 아님"으로 바꾼다. `core.*` 도구(`tool_search`, `spawn` 등)는 계속 대체 불가다. 대체 가능한 부품 목록은 블록 모델 `parts`(4.8)로 노출한다.
- **P-4** 대체 도구는 코어의 파일·프로세스 서비스 위에 만든다. 이 규칙을 지키게 하는 방법:
  1. 격리 프로세스에서 도는 플러그인(사용자, 프로젝트 등급, P1 이후)은 파일 쓰기와 프로세스 실행이 샌드박스로 막혀 있으므로 코어 서비스(통합 경로) 말고 길이 없다. 구조로 강제된다.
  2. 엔진 안에서 도는 플러그인(번들, 또는 `ext.<이름>.isolation` 예외 설정으로 허용된 것)은 막을 수 없다. 대신 (가) 플러그인 카드에 "코드가 직접 실행됨"을 표시하고 (나) `tool_replace` 승인 본문의 안내(`replace-gate.ts:21-22`: "내장 도구의 경로 보호는 대체 도구가 직접 지켜야 한다")를 이 경우에만 싣는다. 격리된 플러그인에는 이 안내를 싣지 않는다.
  3. 실행 중 계측: 도구 호출마다 코어 서비스 호출 수(`observedCoreCalls`)를 센다. 위험 등급이 `write` 이상인 대체 도구가 `observedCoreCalls = 0`이고 `reported` 변경도 없이 성공하면 턴 기록에 `untracked_write`를 남기고 변경 탭의 "추적 밖" 줄로 보낸다.
- **P-5** 프로필에서 두 플러그인이 같은 도구를 대체하면 프로필 편집 때 충돌로 알린다(이 문서 5.5절). 레지스트리의 `replace_conflict`가 마지막 방어선이다.

## 6. 층 재편

### 6.1 옮길 것 (L2 전 패키지 목록)

판단 기준 [결정 B, 결정: 2026-11-17 사용자, U4 확정]: 빠지면 블록의 보장이 깨지는 것은 코어(L1)다(사람에게 묻기, 샌드박스를 거치는 파일·프로세스 서비스, 도구 파이프라인이 기대는 것). 나머지는 같은 등급의 번들 플러그인이다. 크기와 가져다 쓰는 곳은 다른 에이전트의 정적 읽기(줄 수는 `wc -l`)다.

수치: `cap-*` 8개 합계 src 약 44,900줄, test 약 46,100줄. 패키지 밖에서 `@fresnel/cap-*`를 import하는 곳은 `apps/host`뿐이다(src 28개 파일, test 28개 파일). `core-*`, `group-*`, `plugins/*`, `apps/cli`, `apps/desktop`은 `cap-*`를 import하지 않는다. `cap-*` 사이의 src import는 0건이고 협력은 기능 id와 매니페스트 `requires`로만 한다(`cap-dialog/src/manifest.ts:37`, `cap-artifacts/src/manifest.ts:33`).

| 패키지 | (가) 코어로 옮길 부분 | (나) 번들 플러그인으로 남는 부분 | 가져다 쓰는 곳 | 크기 | 재수출 먼저 |
|---|---|---|---|---|---|
| `cap-workspace` (src 4,428줄) | 서비스 본체(층 D2, 2026-11-18 실측, `xeon/packages/core-workspace` 1,845줄): 경로 검사 `roots.ts`(215), 쓰기 허용 승인 `write-access.ts`(245)와 `write-access-adapter.ts`(86)와 `ports/`(59), 셸 실행 `shell/run.ts`(277, 샌드박스 래핑은 `execute`, 옛 `run.ts:149-183`)와 `shell/unattended.ts`(17)와 `shell/upstream/bash.ts`(126), 원자 쓰기 `files/atomic.ts`(92), 줄세우기 `files/queue.ts`(60), 경로 정규화 `files/upstream/path-utils.ts`(47), 그 의존인 `errors.ts`(169), `deps.ts`(53), `env.ts`(58, `WorkspaceEnv`, `src/shell/env.ts`는 두지 않았다), `scope.ts`(28), `upstream/get-or-throw.ts`(10), `upstream/output.ts`(303, `bash.ts`가 쓰는 `OutputBuffer`). `FileChange` 생산은 옮기지 않았다(4.7, 변경 기록 트랙) | 남은 부분(src 2,609줄): 모델 도구 `read`, `write`, `edit`, `grep`, `bash`의 인자 해석과 결과 모양(`files/`의 read·write·edit·grep·rg·api, `truncate/paging.ts`, `files/upstream/read.ts`, `edit-diff.ts`), 이미지(`images/` 전체), 등록 `plugin.ts`(`plugin.ts:166-184`), 조립 `service.ts`, 설정 `settings.ts`, `manifest.ts`, 서비스 의존에 설정 모양을 입힌 `deps.ts`(별칭). 정의는 F `defs/workspace.ts`에 그대로 있다. 셸 쪽 모델 파일은 따로 두지 않았다 | `apps/host` 3곳(`assembly/extensions.ts:48`, `assembly/catalog.ts:26`, `assembly/settings-sources.ts:19`). 기능 id 소비: `core-tools/src/plugin.ts:40-44,114-119`, `core-tools/src/entries.ts:278-300`, `core-tools/src/policy/rules.ts:31,46`(문자열 `"workspace.files"` 하드코딩), `cap-artifacts/src/plugin.ts:113`, `cap-dialog/src/plugin.ts:119` | L | 아니다(실행: 재수출하지 않았다). `cap-workspace` 파일들이 `@fresnel/core-workspace`에서 직접 가져가고, 호스트는 `writeAccessTitle`만 그쪽에서 가져간다. 기능 id(`workspace.files`, `workspace.shell`)와 등록은 cap에 그대로 둔다. 이유는 §9 6단계 기록 |
| `cap-dialog` (src 4,190줄) | `ask/`(368줄: `service.ts`, `expiry.ts`, `mapping.ts`)와 `ports/approvals.ts`는 **완료(층 D1, 2026-11-18)**: `core-tools/src/ask/`로 옮겼다(`service.ts` 177줄, `expiry.ts` 100, `mapping.ts` 97, `approvals.ts` 166, `errors.ts` 111, 새 `deps.ts` 27. 옛 파일은 지웠다). 승인 서비스 본체는 이미 `core-tools/src/approvals/`(1,265줄)에 있어 사람에게 묻기 블록의 큰 부분은 L1이다 | `commands/`(770), `status/`(362), `notify/`(534), `attachments/`(372), `session-adapter.ts`, `upstream/pi/prompt-templates.ts`(325) 와 `ask_user` 도구 등록(호스트 `apps/host/src/assembly/l2-units.ts:193-199`가 한다) | `apps/host` 5곳(`assemble.ts:3`, `assembly/ports.ts:78`, `assembly/extensions.ts:44`, `assembly/handler-failed.ts:1`). 기능 id: `dialog.ask`(`l2-units.ts:193-199`), `dialog.commands|status|attachments|notify`(`l2-units.ts:163-183`) | M | 예. `ask/`를 `core-tools/src/ask/`로 옮겼다. `cap-dialog`는 재수출을 두지 않았다(9절 6단계) |
| `cap-mcp` (5,590줄) | 없음 | 전부. `client/`(2,524), `servers/`, `transport/`, `elicitation/`. 훅은 호스트가 선언한다(`apps/host/src/assembly/cap-mcp.ts:88-98`)이고 도구 등록도 호스트(`cap-mcp.ts:190-205`)가 한다. `plugin.ts`와 `manifest.ts`가 없다 | `apps/host` 6곳(`assembly/cap-mcp.ts:20-27`, `assembly/cap-web.ts:58`, `assembly/extensions.ts:67`, `assembly/mcp-start.ts:5`, `m4/ext-read-port.ts:48`). 기능 id: 호스트 `cap-mcp.ts:175,190-205`, `cap-web.ts:234` | M (조립 코드를 호스트에서 패키지로 옮기는 일) | 불필요(이동이 없음) |
| `cap-web` (11,577줄) | 없음. 외부 접근 정책(`policy/`, SSRF, 마스킹)은 웹 기능의 정책이고 도구 파이프라인이 기대지 않는다 | 전부. `plugin.ts`, `manifest.ts`는 있으나(`hooks: []`) 도구 등록은 호스트(`apps/host/src/assembly/cap-web.ts:336-375`)가 한다 | `apps/host` 9곳(`assembly/cap-web.ts:47`, `web-providers.ts:1`, `web-policy-writer.ts:8`, `web-header-secrets.ts:9` 등). 기능 id: `group-helm/src/knowledge.ts:127-129` | M (도구 등록과 훅을 패키지로) | 불필요 |
| `cap-knowledge` (9,646줄) | 없음 | 전부. 스킬, 메모리, 검색, 원장, 쓰기 승인 게이트(`approval/`, 승인은 코어의 묻기를 쓴다) | `apps/host` 4곳(`assembly/learning.ts:3`, `proposals.ts:13`, `extensions.ts:45`). 기능 id: `group-learning/src/index.ts:60-63`, `group-helm/src/knowledge.ts:100-122`, `m4/dialog-area-bridge.ts:129,135` | S (이미 플러그인 모양) | 불필요 |
| `cap-work` (3,463줄) | 없음 | 전부. 단, `goals/gate.ts`가 `@fresnel/core-agents`의 `goalGateDecision`을 정적으로 import한다(`package.json` dependencies에 `core-agents`, `goals/settings.ts`도). 한 층 규칙(6.3)이 이를 금지하므로 계산 함수를 `contracts`로 올리거나 `AgentService`의 메서드로 노출한다. **[완료, 층 E]** `goalGateDecision`을 `contracts/src/capabilities/goal-gate.ts`로 올리고, 판정은 `agents.judge`로 부른다. `package.json`과 `tsconfig.json`에서 `core-agents`를 뺐다 | `apps/host` 2곳(`extensions.ts:47`, `catalog.ts:25`). 기능 id: `group-helm/src/outputs.ts:98`, `m4/dialog-area-bridge.ts:123,126` | M | 불필요 |
| `cap-artifacts` (4,276줄) | 없음 | 전부. 거절된 hunk 되돌리기는 `g.capability(WorkspaceFilesKey).edit`를 부르므로(`plugin.ts:110-113`) 통합 경로(5.3)를 탄다 | `apps/host` 4곳(`extensions.ts:38`, `m4/dialog-area-port.ts:2`, `m4/dialog-area-bridge.ts:15`) | S | 불필요 |
| `cap-schedule` (1,755줄) | 없음 | 전부. 리더, 저장소, 러너가 `apps/host`에 있다(`assembly/schedule*.ts`, `handlers/schedule.ts`) | `apps/host` 13곳 | S (패키지 안은 그대로) | 불필요 |

L3와 나머지: `group-helm`, `group-learning`, `group-guide`, `group-account-rotation`, `group-provider-anthropic-oauth`, `plugin-builder`는 이미 플러그인이다. 이동은 없고 층 이름만 바뀐다(6.3). `group-sdk`는 플러그인 API 라이브러리라서 플러그인 등급에 두지 않고 X와 같은 쪽의 "플러그인 SDK"로 본다 [제안, 12절 O-9].

이동 총량: 코어로 가는 것은 `cap-workspace`의 약 1,100줄과 `cap-dialog`의 약 400줄이다(src 합계 약 1,500줄, 시험 포함 약 3,000줄 안팎으로 어림 [미확인: 시험 파일의 소속은 파일별로 가르지 않았다]). 나머지 6개 패키지는 이동 없이 조립 위치(호스트에서 패키지로)와 `import` 규칙만 바뀐다.

### 6.2 내장 전용 통로

지금의 게이트와 사실(정적 읽기):

- 포트 게이트는 한 곳이다. `requirePortAccess`(`ext-host/src/primitives/host-api.ts:261-269`)가 `providePort`와 `port`만 막고 외부(비내장) 플러그인은 `service_reserved`를 받는다. 외부가 직접 얻는 `fresnel.*` 포트는 0개다. `ExtHost.ports`(`ext-host/src/primitives/host.ts:612-620`)와 `hostOf`(`host-api.ts:198`)에는 게이트가 없다.
- 포트 말고도 내장 전용 분기가 있다: `contextTrusted`(내장만 호출자 종류, 시크릿 승인 증거, interactive를 호출자가 넘긴 대로 통과: `host-api.ts:391`, `capability-guard.ts:185-192`), `providerTrusted`(내장 공급자의 `idempotent`만 믿음: `capability-guard.ts:138`, `bindings.ts:132-137`), `registerTool`의 위험 등급 `read`/`write` 금지(`host-api.ts:534-545`), 설정 네임스페이스(`settingValue`: 외부는 `ext.<이름>.`만, 내장 그룹은 `l3.<이름>`: `host-api.ts:662-666`, `group-sdk/src/define-group.ts:166-170`), 예약 이름(`contracts/src/extensions/validate.ts:727-733`), tier(`operations/tier.ts:104-124`), 안전 모드가 내장 L1·L2만 남기는 규칙(`operations/safe-mode.ts:44-49`), `g.delegate`(외부에는 `group.delegateUnavailable`: `group-sdk/src/wrap.ts:93,297-299`).
- group-helm은 내장이 아니다. 매니페스트 신뢰가 `user`이고 기본 플러그인으로 사용자 확장 위치에 복사되어 `builtin: false`로 로드된다(`apps/host/src/assembly/default-plugins.ts:21`, `catalog.ts:154-156`, `ext-host/src/loading-trust/entry-loader.ts:266`). 포트를 쓰지 않고 공개 면(`g.drive`, `g.capability`, `g.registerMethod`, `g.settings`, `g.record`, `g.commit`)만으로 동작한다. 즉 Helm은 지금도 사용자 플러그인과 같은 격이다. 번들(`bundled` 출처)이라도 신뢰 등급은 사용자이고 격리 대상이다(엔진 설계 §3.1, M5c §4.6.9). 내장 전용 통로를 쓰는 쪽은 `cap-*`와 `group-learning`이다.
- 사용자 설정의 셸 훅 단위는 `builtin: true`로 만들어진다(`ext-host/src/operations/hooks/runner.ts:377`). 현재 분기에서는 권한 상승이 보이지 않지만 플래그 의미가 "호스트 소유"와 "내장"으로 섞여 있다 [미확인].

번들 플러그인이 쓰는 내장 전용 통로와 결정 [제안]:

| 통로 | 쓰는 쪽(`path:line`) | 결정 | 이유 |
|---|---|---|---|
| `AgentService.judge`(`fresnel.agents` 포트) | `cap-work/src/goals/gate.ts:148`(포트 획득 `cap-work/src/plugin.ts:129`) | 공개 기능으로: `agents.judge`(F3 정의, 멱등, `requestId` 필수, 주도 한도에 차감). **[완료, 층 E]** `contracts/src/capabilities/defs/agents.ts`(1.0.0), 공급자는 core-agents(매니페스트 `provides`, `host.provide(AgentsJudgeKey, …)`). 한도 차감은 아래 [미결] [근거: ext-host/src/primitives/lease.ts] | 완료 게이트가 `on` 핸들러에서 판정하므로 주도 명령 `model`만으로는 모자란다. 사용자 플러그인의 "통과할 때까지 고치기"도 같은 걸 쓴다 |
| `g.delegate`, `delegateStatus`, `cancelDelegates`(`fresnel.agents` 포트) | `group-learning/src/handlers.ts:295,357,397,428`, `group-learning/src/index.ts:127` | 공개로: 모든 플러그인에게 열고 `agent.spawn.before`(4.3.3)를 지난다. `group.delegateUnavailable` 분기 삭제 | 서브에이전트 블록을 부르는 길을 내장 전용으로 둘 이유가 없다. 부모 프로필과 권한 상속은 블록의 보장이다 |
| `ModelService`(`fresnel.models`) 전체: `complete`, `stream`, 해석 | `core-*`만(`core-context/src/plugin.ts:66`, `core-agents/src/plugin.ts:90`). 번들 플러그인의 직접 사용은 `apps/host/src/assembly/cap-web.ts:233`(선택) | `complete`는 공개 기능 `models.complete`로(멱등, 주도 한도 차감, 기록), 나머지는 내장 전용 유지. **[완료, 층 E]** `contracts/src/capabilities/defs/models.ts`(1.0.0), 공급자는 core-models(`src/complete-capability.ts`, `completeForPlugin`을 감싼다) | 한 번의 모델 호출은 블록이다(`engine-block-surface-inventory.md` §2). 해석·스트림·제공자 표는 코어 내부 |
| `ContextService`(`fresnel.context`) | `core-loop/src/plugin.ts:97`, `apps/host/src/assemble.ts:1240` | 내장 전용 유지 | 조립과 컴팩션을 단독으로 부르는 용도가 없다. 영향은 `request.*` 훅과 `thread.compact.before`로 준다 |
| `ApprovalService`(`fresnel.approvals`) | `cap-dialog/src/plugin.ts:111`, `cap-artifacts/src/plugin.ts:103`, `cap-knowledge/src/plugin.ts:139`, `cap-workspace/src/plugin.ts:115`, `cap-schedule/src/plugin.ts:49`, `apps/host/src/assembly/cap-web.ts:230`, `cap-mcp.ts:132` | 공개로: 질문 카드는 `dialog.ask`(코어로 내려감)와 주도 `ask`, `awaitUser`가 이미 공개다. 도구 승인 카드를 올리는 일은 통합 호출 경로와 훅의 묻기가 맡는다. 서비스 자체는 내장 전용 | 승인 큐를 직접 만지는 번들(웹 도메인 승인, 지식 쓰기 승인, 예약 실행 승인)은 "도구 승인 카드를 올리는" 공개 방법이 필요하다: 기능 메서드가 `input_required`를 돌려주면 코어가 카드를 올리는 규약이 이미 있다(`core-tools/src/entries.ts:118-160`). 이 규약을 공개 문서로 올린다 |
| `ToolService`/`ToolsPort`의 위험 등급 `read`/`write` 등록 | `cap-work/src/plugin.ts:78`, `cap-knowledge/src/plugin.ts:257-285`, `cap-workspace/src/plugin.ts:172-175`, `group-learning/src/review/propose.ts:335-337`, `plugin-builder/src/group-tools.ts:114-126` | 격리된 플러그인에는 공개(실행 중 검사 포함), 엔진 안 플러그인은 유지 | 5.3의 통합 경로로 중첩 호출의 실제 위험 등급이 기록된다. 선언이 `read`인데 `write` 호출을 하면 그 호출을 `risk_mismatch`로 거부한다. 선언을 믿는 근거가 생긴다. 격리 전에는 이 검사만으로 비내장에게 열지 않는다 |
| `contextTrusted`(호출자가 넘긴 호출 문맥 통과) | `core-tools/src/entries.ts:105-117`(어댑터가 채움) | 내장 전용 유지, 더 좁힘 | 통합 경로에서는 호스트가 문맥을 채우므로 번들이 넘긴 문맥을 믿을 이유가 없다. 코어 어댑터만 남는다 |
| `providerTrusted`(내장 공급자의 `idempotent`만 신뢰) | `capability-guard.ts:138` | 유지 | 기능을 공급하는 쪽의 선언 신뢰 문제라서 호출 경로 통합과 별개다. 공급자가 비내장이면 5.3 U-5의 기록 멱등이 대신 보호한다 |
| `fresnel.os`(logger, clock, dirs) | 거의 모든 `cap-*`(`cap-work/src/plugin.ts:91`, `cap-knowledge/src/plugin.ts:134`, `cap-dialog/src/plugin.ts:108` 등) | 공개: `g.log`, `g.clock` | 민감하지 않은 기본 도구. 막을 이유가 없다 |
| `fresnel.store`/`session` 전체(접두 표, 투영기, 이벤트 피드) | `cap-work/src/plugin.ts:89-90`, `cap-knowledge/src/plugin.ts:135-143`, `cap-artifacts/src/plugin.ts:97-99`, `apps/host/src/assembly/cap-mcp.ts:112`, `cap-web.ts:227-229` | 부분 공개. `g.state/commit/record/readRecords`는 이미 공개이고, 접두 표와 투영기는 내장 전용 유지 | 번들이 자기 표(`cap_web_*`, `cap_mcp_servers`, `cap.work` 투영)를 가진다. 사용자 플러그인에게 SQL 표를 주는 설계는 이 스펙의 범위 밖이다(12절 O-14) |
| `fresnel.exec`, `fresnel.sandbox`, `fresnel.process`, `fresnel.secrets` | `cap-workspace`(코어로 이동), `cap-dialog/src/plugin.ts:107`(셸 템플릿), `cap-knowledge/src/plugin.ts:136-137`(선택), `apps/host/src/assembly/mcp-process.ts:44,52`(MCP stdio), `external-hooks.ts:119`(셸 훅) | 파일·셸 서비스는 코어로 내려가 기능 `workspace.shell`로 공개(통합 경로). stdio 서버 기동과 시크릿 해제는 내장 전용 유지 | 장기 실행 프로세스와 시크릿 풀기는 통합 호출 경로의 "한 번 호출" 모양에 맞지 않는다. 사용자 MCP 서버는 MCP 설정으로 선언만 하고 코어/번들이 띄운다 |
| `ExtHostPortKey`(`fresnel.ext`)와 `fresnel.loop`/`tasks`/`groups`/`tools` 서비스 전체 | `core-*`만 | 내장 전용 유지 | 코어 자신의 조립용 |
| `fresnel.session` 공개 조회, `readRecords` | 공개 | 유지 | |
| `requestEffect`, `awaitUser`, `callContext` | 번들 사용 없음(`requestEffect`) | 공개 유지. `requestEffect`는 통합 경로로 | |

훅 안에서 부른 `agents.judge`, `models.complete`의 한도: 주도 프레임이 있으면 그 프레임의 한도에서, 주도 프레임이 없는 보통 턴이면 코어 루프(프레임 0)의 한도에서 뺀다(엔진 설계 §2.3). 기록 스펙은 `FrameMark.used`로 소비량을 둔다. **[완료, enE2m]** [근거: ext-host/src/primitives/lease.ts, core-agents/src/plugin.ts, core-models/src/complete-capability.ts] 공급자가 새로 판정·호출했을 때만(`judged`, `replayed: false`) `ExtHost.chargeDriveTokens(threadId, tokens)`를 불러 맨 위 프레임과 스택 아래 모든 프레임의 `used.tokens`에 더한다. 기록된 판정을 따른 호출과 재생은 더하지 않는다. 주도 프레임이 없으면 더할 곳이 없다(코어 루프 프레임 0은 한도가 없다). 한도가 다 차면 다음 명령 직전 검사(`assertBudget`)가 `budget`으로 반납한다

### 6.2.1 코어 단위 항상 켜기와 기능 메서드 위험 등급 (enE2m 기록, 2026-11-18)

- `core-workspace`는 설치 단위가 아닌 라이브러리라 항상 켜짐 집합에 더하지 않는다. `cap-workspace`·`cap-dialog`의 필수 표시(`REQUIRED_BY_CORE`)는 남겼다: 지우면 코어 시험은 통과하지만 `apps/cli`의 `scenario-3`(그룹 하나만 켠 프로필에서 `read` 도구를 쓰는 턴)이 깨진다. 지울지는 정해야 한다(`profile-project-loader.md` §4.1.17 기록). [미결]
- `MethodDef.risk`: 도구 매핑이 없는 쓰기 메서드의 위험 등급. 선언이 없으면 `exec`. 같은 효과의 모델 도구와 같은 등급으로 맞췄다: 대화 안 상태·내부 기록만 바꾸면 `read`(`task_write`, `artifact_create`, `review_request`가 `read`인 것과 같다), 작업 공간이나 공유 상태 파일을 쓰면 `write`(`skill_manage`, `memory_manage`와 같다), 실행·네트워크는 `exec`. [제안: 메인 세션, 사용자 확인 대기]

| 기능 | 메서드: 등급 |
|---|---|
| `agents.judge` | `judge`: read |
| `models.complete` | `complete`: read |
| `artifacts.registry` | `archive`: read |
| `artifacts.reviews` | `approve`, `reject`, `comment`, `close`: read / `submit`: write(작업 폴더를 되돌린다) |
| `dialog.aside` | `ask`: read |
| `dialog.attachments` | `add`: read |
| `dialog.commands` | `register`, `run`: read |
| `dialog.notify` | `emit`: read |
| `dialog.status` | `setItem`, `clearItem`: read |
| `dialog.styles` | `register`, `select`: read |
| `knowledge.ledger` | `decide`, `rollback`: write |
| `knowledge.memory` | `add`, `remove`, `replace`: write |
| `knowledge.skills` | `create`, `edit`, `patch`, `reindex`, `remove`, `writeFile`: write |
| `mcp.client` | `callTool`, `connect`, `reconnect`: exec / `disable`: read |
| `schedule.entries` | `cancel`: write / `fire`: exec |
| `web.research` | `cancel`: write / `start`: exec |
| `work.goals` | `set`, `clear`, `judge`: read |
| `work.reports` | `build`: read |
| `work.tasks` | `create`, `update`, `link`: read |
| `workspace.images` | `register`: read |

  도구 매핑이 있는 메서드(`workspace.files`의 `write`·`edit`, `workspace.shell`의 `bash` 등)는 매핑의 `policy.risk`를 쓰므로 위 표에 없다. 파일 쓰기와 셸은 모델이 부른 도구와 같은 등급이다.
- `dialog.commands.run`을 `read`로 둔 것은 판단이다: 템플릿은 텍스트를 돌려주고 동작 명령의 핸들러가 하는 일은 핸들러 안의 기능 호출이 각자의 등급으로 지난다.
- 켜 본 결과: `l1.tools.pluginCalls` 기본값을 켰다. 시험 8개 가운데 6개(helm-sigkill, ext-method, dialog-area, goal-judge, uc2 둘)는 등급 선언으로 풀렸다. `review-approval`의 hunk 거절과 `proposals` UC-3(과 cli의 같은 거절 시험)은 풀리지 않았다. 원인(`review-approval`은 카드 내용을 찍어 확인했다): 사용자가 이미 답한 검토 카드가 적용하는 되돌림이 `plugin:cap-artifacts`의 `workspace.files.edit` 호출(도구 매핑이 있는 `write`)로 가서 새 승인 카드를 띄우고 시험에는 답하는 쪽이 없다. `proposals` UC-3도 같은 모양으로 본다(승인한 제안이 스킬 파일을 쓰는 호출이 새 카드를 띄운다. 카드는 확인하지 않았다). 승인 상속(U-11, 사용자의 답을 이 호출이 이어받기)이 연결되면 풀린다. 등급을 `read`로 낮추면 풀리지만 파일 쓰기를 승인 없이 지나게 하는 것이라 하지 않았다. [미결] **해결(enE2u, 2026-11-18)**: 승인 상속(U-11)을 이어 세 시험이 통과한다. `review-approval` hunk 거절은 검토 카드의 `writes` 해시로, `proposals` UC-3(카드 내용 확인: `cap:knowledge.skills.create`, 호출 주체 `plugin:learning`, 입력의 증거가 `learning.queue`)은 호스트의 사람 결정 허용으로 풀렸다. UC-3은 승인 기록이 없는 `proposal.decide` 결정이라 승인 id 주장으로는 이을 수 없었다.

### 6.3 새 의존 규칙

층 지도: F 계약 / X 플러그인 체계 / L0 플랫폼 / L1 코어 / 플러그인(한 등급) / L4 앱 [결정 B, 결정: 2026-11-17 사용자, U4 확정]. 코드 디렉터리 이름은 그대로다.

- **DR-15 플러그인 등급** [제안]: `packages/cap-*`, `packages/group-*`, `packages/plugin-builder`는 "플러그인" 등급(`fresnel.layer`: `"P"`, 순위 4)이다. 순위는 F 0, X 1, L0 2, L1 3, P 4, L4 5다.
  1. 플러그인은 서로 import하지 않는다. 같은 등급 규칙(DR-02)이 `cap-*` 사이와 `group-*` 사이뿐 아니라 `cap-*`와 `group-*` 사이에도 적용된다(지금도 DR-14가 `group-*`의 `cap-*` import를 막는다).
  2. 플러그인은 `@fresnel/contracts`, `@fresnel/ext-host`의 등록·주입 API, 플러그인 SDK(`@fresnel/group-sdk`), 외부 패키지만 import한다. `core-*`와 `platform-*`를 import하지 않는다. 코어와 L0는 `contracts`의 서비스 타입과 `fresnel.*` 포트, 기능 id로만 쓴다. 시험 파일은 지금의 예외(`test/` 아래의 `core-*`, `platform-*` devDependency)를 유지한다.
  3. 그러므로 `cap-work`의 `core-agents` 정적 import(위 6.1)는 위반이다. 기능이나 `contracts`로 옮긴다.
  4. 조립 루트(`apps/host`)만 플러그인 구현을 직접 import한다(지금 DR-14 예외 2와 같다).
- **구현**: `xeon/scripts/check-layers.ts`의 `RANK`와 `expectedLayer`(`:20`, `:107-121`)에 `P`를 더하고 `cap-*`와 `group-*`를 `P`로 본다. 도메인 대조(`:127-137`)는 그대로다. `package.json`의 `"fresnel": {"layer": "L2"}`와 `"L3"`은 전환 동안 `P`의 별칭으로 읽는다. `xeon/.dependency-cruiser.cjs`는 `LAYERS`(`:7-15`)에서 `^packages/cap-`과 `^packages/group-`을 한 항목으로 합치고, `sameLayer`(`:25-45`)가 이 항목에서 `group-sdk`만 예외로 허용한다(`DR-02/group-sdk` 예외 id 유지). `no-upward-import-from-L2`와 `-L3` 규칙은 `-P` 하나가 된다. 두 도구는 같이 고친다(`.dependency-cruiser.cjs:5`의 주석). 허용 목록 파일(`xeon/scripts/dependency-allowlist.json`)의 `DR-02/group-sdk`는 그대로, `DR-07/workspace-test-spawn`은 코어로 옮긴 파일의 경로로 갱신한다.
- **효과**: 순위 규칙은 L2 → L3 import를 허용하던 면이 사라지고 같은 등급 import 금지로 바뀐다. 실제 import 그래프는 바뀌지 않는다(`cap-*`와 `group-*`는 지금도 서로를 import하지 않는다). `check-layers.ts`의 계산에서 바뀌는 것은 허용 표와 `expectedLayer`뿐이다.
- **구현 기록(층 F, 2026-11-18)**: 지금 강제하는 것. (1) `check-layers.ts`: `RANK`는 F 0, X 1, L0 2, L1 3, P 4, L4 5이고, `cap-*`, `group-*`, `plugin-builder`는 P다. 선언 `"layer": "L2"`, `"L3"`은 P 디렉터리에서만 P로 읽는다(DR-03). 도메인 검사는 cap-*에 `routes.yaml`의 `layout.L2`를 쓴다. P끼리 import는 DR-02다(`DR-02/group-sdk`, `DR-02/plugin-builder-group-sdk`는 그대로). (2) DR-15: P 패키지의 소스 import와 `dependencies`·`peerDependencies`·`optionalDependencies`에서 L0(`platform-*`)와 L1(`core-*`, `plugins/*`)을 거부한다. `contracts`, `ext-host`, `group-sdk`는 허용이다. 시험 파일과 `devDependencies`는 예외다. (3) `.dependency-cruiser.cjs`: `no-upward-import-from-P`, `no-same-layer-import-P-cap`, `no-same-layer-import-P-group`, `no-l0-or-l1-import-from-P`, 그리고 허용 쌍마다 `no-l0-or-l1-import-from-P-<id>`. 두 도구는 같은 커밋에서 고쳤다. (4) 허용 목록 두 항목 **[미결]**(12절 O-20) [근거: xeon/scripts/dependency-allowlist.json]: `DR-15/cap-dialog-core-tools`(`packages/cap-dialog`, `@fresnel/core-tools`, 진입점 `.`. 소스 9개 파일과 `dependencies`, 재수출 1건), `DR-15/cap-workspace-core-workspace`(`packages/cap-workspace`, `@fresnel/core-workspace`, 진입점 `.`. 소스 12개 파일과 `dependencies`). 이유는 L1 분할(D-27, D-28)이 서비스를 코어로 옮겼고 플러그인이 그 서비스를 주입받는 구조는 후속이다. `approvedBy`는 `pending-user-approval`이다(승인은 사용자가 정한다). 허용 목록 스키마에는 만료 필드가 없어 시한은 이 절과 O-20에 적는다. 후속 설계가 끝나면 두 항목을 지운다. 지금은 두 항목이 없으면 `just check-layers`와 `just depcruise`가 실패한다.
- 같은 등급 안에서 훅 tier가 하나가 되는 것(5.2 O-2)과 이 규칙은 짝이다. `assignTier`는 `layer === "L1"`이면 `core`, 그 밖의 내장은 `builtin`으로 나누는데(`ext-host/src/operations/tier.ts:117`) 새 기본에서는 `core`(L1)와 `plugin`(나머지)이다. 코어 쪽으로 가는 새 L1 코드(`ask/`, 파일 서비스)는 훅을 달지 않는다.

## 7. 실패와 경계 사례

| # | 상황 | 규칙 |
|---|---|---|
| E-1 | 훅이 `ask`를 냈지만 사람이 없는 실행(`interactive: false`)이고 `l1.tools.unattended.approval = "deny"` | 카드 없이 거부(`resolvedBy: "noninteractive"`). 훅 결과 `asked`, 사유에 "확인 불가" |
| E-2 | `bypass` 모드에서 훅의 `ask` | 카드를 띄운다. 정책 deny는 deny다 |
| E-3 | `ask.human.before` 핸들러가 예외 | 결정 없음으로 보고 사람에게 묻는다(open). 훅 결과 `error` |
| E-4 | `agent.spawn.before`가 `ask`를 낸 호출이 서브에이전트 안(`depth > 0`)이거나 사람이 없는 실행 | 사람 화면이 없는 호출이라 core-agents가 승인 서비스를 부르기 전에 카드 없이 거부한다(`[fresnel:denied_by_extension] <사유> (confirmation unavailable)`). 부모는 거부 결과를 받는다. 승인 서비스의 `unattendedPlan`은 이 자리에 적용되지 않는다(그 정책은 승인 서비스 안에서 도는 것이라 서브에이전트 훅의 묻기가 거치지 않는다). 서브에이전트 대화의 `interactive`는 부모와 같아서 실제로는 `depth > 0`만 이 경우를 만든다 |
| E-5 | 훅이 낸 호출이 `tool.call.before`의 `ask`를 만나 사람 응답을 기다림 | 대기 동안 훅의 시간 예산 시계는 멈춘다(`awaitUser`, `ext-host/src/primitives/host-api.ts:631-644`). 바깥 핸들러의 `first` 예산(30초)은 같은 `HandlerGate`로 멈춘다 |
| E-6 | 플러그인 호출이 순환(P→Q→P) | `[fresnel:hook_cycle]` 거부 (5.3 U-8) |
| E-7 | 재시작 중에 묻기 카드가 열려 있음 | 승인 서비스가 기록에서 요청을 복원한다(`scanApprovals`, `approvals/service.ts` open의 replay 분기). `ask.human.before`는 복원된 요청에는 다시 발화하지 않는다 |
| E-8 | 파이프라인 경로 호출의 `effect.exec`만 있고 결과가 없는 채 재시작 | `unknown`으로 두고 다시 실행하지 않는다(지금 `requestEffect`와 같은 규칙) |
| E-9 | `tool.result` 훅이 `details`를 바꿈 | `fileChanges`는 보존 (5.4 F-3) |
| E-10 | 대체 도구가 코어 서비스를 거치지 않고 파일을 씀(엔진 안 실행) | 변경이 `observed`에 없다. 쓰기 위험 등급 대체 도구가 계측 0이면 `untracked_write` (5.5 P-4 3) |
| E-11 | 기본 `l1.tools.pluginCallDepth`를 넘는 중첩 | `[fresnel:hook_depth]` 거부 |
| E-12 | 지금 발화하지 않는 훅을 번들이 선언 | 로딩 진단 경고(`hook_not_fired`). 동작은 없다 |
| E-13 | `thread.resources` 핸들러가 존재하지 않는 경로를 냄 | 경로 하나만 버리고 진단. 훅은 실패가 아니다 |
| E-14 | `lifecycle.lease.rejected`를 구독하는 Helm(`group-helm/src/index.ts:55`)에서 E3가 중재를 없앰 | 구독은 남고 발화만 멎는다. Helm의 처리기는 새 주도권 규칙 스펙이 갈음한다 |

## 8. 지금 코드와의 차이

크기: S 반나절 이하, M 1~3일, L 1주 안팎.

| # | 위치 | 변경 | 크기 |
|---|---|---|---|
| D-1 | `contracts/src/extensions/hooks.ts:158, 188-247, 264-311, 375-, 927-939, 1042-1055` | `HookKind`에 `ask`, `agent`, `HookSignatures` 4행, `HOOK_NAMES`, `HOOKS`, `FIRST_DENY`, `CHAIN_RULES`, `FailOpenFirstHookName`에 `ask.human.before` | M |
| D-2 | `contracts/src/extensions/hook-positions.ts` (신규) | `HOOK_POSITIONS` 50행, 위치 종류별 검사 | M |
| D-3 | `contracts/src/extensions/hooks/tool.ts:84-98` | `ToolCallDecision`을 3종 union으로. `ask`, `replace` 스키마 | S |
| D-4 | `ext-host/src/primitives/fold/` 및 `dispatch.ts` | `tool.call.before`, `agent.spawn.before`의 합치기 규칙(H-2) | M |
| D-5 | `core-tools/src/pipeline.ts:503-545, 583-660, 978-995` | `dispatchToolCall`이 `ask`, `replace`를 해석하고 `decide`가 훅 ask를 정책 결과와 합치며 카드를 한 장으로 | M |
| D-6 | `contracts/src/services/approvals.ts:81-97, 234-256` | `ToolApprovalBody.askedBy`, `resolvedBy`에 `"extension"`, `resolvedByExtension` | S |
| D-7 | `core-tools/src/approvals/service.ts:394-405, 385` | `ask.human.before|after` 발화 | M |
| D-8 | `core-agents/src/service.ts:1269(provision), 1376(spawn), 1421(delegate), 1088(recordSettled)` | `agent.spawn.before|after` 발화, `loop.spawn`과 `g.delegate`와 `agent` 도구가 같은 입구(`provision`)를 지남을 확인. 디스패치는 플러그인이 ext-host에서 잇는다(`plugin.ts`) | M |
| D-9 | `ext-host` 매니페스트 검증(`contracts/src/extensions/validate.ts`) | 내부 훅 거부 `hook_internal`, `hook_not_fired` 경고 | S |
| D-10 | `group-sdk/src/` 와 `ext-host/src/primitives/host-api.ts:273-296` | `g.subscribe`, `EventEnvelope`, 샘플 옵션 | M |
| D-11 | `apps/host/src/assembly/cap-mcp.ts:170` | `thread.mcp.after` 발화를 `applyBoundary` 보고서로 연결(H-8, `onServersChange` 콜백은 쓰지 않는다) | S |
| D-12 | 대화 열기 경로(`core-persistence/src/open-chain.ts`(새 파일), `points.ts`, `lifecycle.ts`(새 대화), `resume.ts`(열기), `lifecycle-branch.ts`(포크)) | `thread.resources` 발화와 스킬 탐색 합류(H-7) | M |
| D-13 | `ext-host/src/primitives/capability-guard.ts:80-120, 187-` | 분류(U-1), `executeForPlugin` 호출, 효과 표 검사 완화(U-5). **완료(층 C)**: 분류 `routeOf`, 파이프라인 `callThroughPipeline`, 멱등 키 `identityOf`. 가벼운 경로의 턴 기록 줄은 M5d 대기(U-2) | L |
| D-14 | `contracts/src/services/tools.ts` `ToolService` | `executeForPlugin`, `PluginCallRequest`. **완료(층 A)**: 값은 `capabilities/plugin-call.ts`에 두고 `ToolsPort`·`ToolService`가 `executeForPlugin`을 가진다(4.6 구현 기록) | S |
| D-15 | `core-tools/src/pipeline.ts`(+ `entries.ts`) | 플러그인 호출을 위한 `prepare`/`execute` 진입점, 합성 도구 이름, `caller: plugin:*`, 승인 상속(U-11). **완료(층 A)**: `executeForPlugin`(pipeline.ts)과 `plugin-call.ts`. 호출 주체 `plugin:*`, 합성 효과 id, 재생 검사, 승인 상속(증거 검증). 합성 `cap:` 항목은 **층 C**가 정의에서 호출 때 만든다(등록하지 않는다, 4.6 구현 기록). 가벼운 경로는 옛 직접 경로다(D-13) | L |
| D-16 | `ext-host/src/primitives/ambient.ts:26-57`, `dispatch.ts`, `capability-guard.ts` | `hookStack`, 순환·깊이 검사(U-8), 설정 `l1.tools.pluginCallDepth`. **완료(층 C)**: 스택 칸은 `dispatch.ts`가 쌓고 `callThroughPipeline`이 호출 칸을 더한다. 순환은 `plugin_call_hook_cycle`, 깊이는 core-tools가 `hook_depth`로 거부 | M |
| D-17 | `ext-host/src/primitives/effect-worker.ts:115-157` | 서비스 직접 호출을 `executeForPlugin`으로. **완료(층 C)**: `viaPipeline`(via `effect`, 요청 키 `key`). 기록은 그대로 | S |
| D-18 | `contracts/src/capabilities/tool-meta.ts:22-27` | `CallerId`에 `plugin:<이름>`. **완료(층 A)**: 패턴 고정, 승인 기록 패턴(`records/catalog/approval.ts`)도 넓힘 | S |
| D-19 | `contracts/src/capabilities/file-change.ts` (신규) | `FileChangeEntry`, `fileChangesOf`, 예약 키 | S |
| D-20 | `core-tools/src/entries.ts:424-428`(`resourceResult`), `core-tools/src/pipeline.ts`(`finishCall`), `core-tools/src/file-changes.ts`(신규) | 플러그인 도구 결과의 `details`를 널로 고정하지 않고 `ctx.changes.report`와 관찰 변경을 합치며 `tool.result` 뒤 병합. 입력 타입은 `Omit<FileChangeEntry, "source">`(`contracts/src/extensions/ports.ts`) | M |
| D-21 | `apps/desktop/src/views/panels/changes/changes-model.ts`. `apps/desktop/src/views/approval-form.ts`는 `DIFF_HEAD_ROWS`를 내보내기만 한다(인자 기반 그림 `fileChangeViewOfArgs`는 승인 카드 미리보기에 남는다) | 변경 탭 원천을 완료 결과의 `fileChangesOf`로 교체. 출력 모양(`ChangesView`)은 그대로 | M |
| D-22 | `cap-artifacts/src/reviews/collect.ts:53-75` | `fileChangesOf` 사용 | S |
| D-23 | `contracts/src/blocks/` (신규)와 `contracts/src/wire-settings/wire/*` | `BLOCK_MODEL`, `blocks.describe`, `blocks.applied`, 호스트 처리기 | M |
| D-24 | `client/src/workbench/canvas/hooks.ts` | 중복 표를 `HOOK_POSITIONS`에서 파생 | S |
| D-25 | `ext-host/src/operations/tier.ts:9-15, 107-128`, `dispatch.ts:158-169` | tier 셋(O-2), 프로필 순서 키(O-1) | M |
| D-26 | `scripts/check-layers.ts:20, 107-137`, `.dependency-cruiser.cjs:7-45` | `P` 등급(6.3). **완료(층 F, 2026-11-18)**: `P`와 DR-15(P.2)를 두 도구에 넣고 `L2`·`L3` 별칭을 받는다. 시험 14건을 `scripts/check-layers.test.ts`에 더했다. 남은 두 위반은 허용 목록 `DR-15/*`에 [미결](12절 O-20) [근거: xeon/scripts/dependency-allowlist.json]. 기록은 6.3 구현 기록 | M |
| D-27 | `cap-workspace` → 새 코어 서비스 | 6.1. **완료(층 D2, 2026-11-18)**: 서비스 부분을 `core-workspace`(L1, 이름 [제안])로 옮겼다. 기능 id와 등록은 cap에 남았다. 시험 분할과 포크 기록 분할은 §9 6단계 기록 | L |
| D-28 | `cap-dialog/src/ask/` → `core-tools/src/ask/` | 6.1. **완료(층 D1, 2026-11-18)**: 질문 서비스를 `core-tools/src/ask/`로 옮겼다. 옛 src 652줄(`ask/` 368, `ports/approvals.ts` 166, `errors.ts` 111, `ports/timers.ts` 7)이 새 src 678줄(`service.ts` 177, `expiry.ts` 100, `mapping.ts` 97, `approvals.ts` 166, `errors.ts` 111, `deps.ts` 27)이 됐다. 시험 `ask-flow` 410줄, `ask-restart.fault` 120, `ask-schema` 197, `ask-wait` 81은 `core-tools/test/ask/`로, 시험 대역 `adapter` 54줄은 `core-tools/test/ask/support/`, `real-approvals` 186과 `timers` 36은 `core-tools/src/testing/`로 옮겼다. 새 `test/ask/support/harness.ts`(86줄)는 질문 의존만 잇는 대역이다. 설정 층을 읽는 `ask-defaults.test.ts`는 cap-dialog에 남았다 | M |
| D-29 | `apps/host/src/assembly/cap-web.ts:336-375`, `cap-mcp.ts:190-205` | 도구 등록과 훅을 각 패키지의 `plugin.ts`로 | M |
| D-30 | `cap-work/src/goals/gate.ts`, `settings.ts` | `core-agents` import 제거. **완료(층 E)**: `goalGateDecision`은 contracts(`capabilities/goal-gate.ts`)로, `l1.agents.judge.maxRuns` 선언은 `wire-settings/settings/judge-limit.ts`로 올렸다(키 소유는 L1.agents 그대로). 판정은 `g.capability(AgentsJudgeKey)`로 한다. cap-work는 `@fresnel/core-*`를 import하지 않는다 | M |
| D-31 | `core-tools/src/registry.ts:66-75`, `replace-gate.ts:21-22` | 대체 가능 조건(P-3), 안내 문구 조건부(P-4) | S |
| D-32 | `core-tools/src/policy/rules.ts:31,46` | 문자열 `"workspace.files"` 하드코딩을 F 기능 정의의 id `WorkspaceFiles.id`로(코어 서비스 id가 아니라 F의 기능 id다. core-tools는 core-workspace를 import하지 않는다). **완료(층 D2, 2026-11-18)** | S |

## 9. 옮김 순서

각 단계는 그 자체로 병합할 수 있고 트리를 녹색으로 둔다. 단계 안에서 일하는 사람은 `just verify`를 돌리지 않는다(병합 직전에만).

1. **데이터 먼저(동작 변화 없음).** D-2, D-19, D-24, D-23의 `blocks.describe`. 기존 46개 훅의 위치 데이터만 더하고 발화는 안 건드린다. 이 단계 끝에 화면이 위치 데이터를 읽을 수 있다.
2. **새 훅 쌍과 결정 어휘.** D-1, D-3~D-9. 새 훅은 구독자가 없으면 아무 일도 하지 않는다. `tool.call.before`의 합치기(D-4)는 구독자가 `block`만 내는 동안 지금과 결과가 같다.
3. **이벤트 구독 면.** D-10, D-11, D-12(`thread.resources`와 그 결과 `workspace`: H-7, A-20. U6의 구현이므로 선택이 아니라 이 단계의 예정 항목이다). `g.on`은 그대로 받는다. 번들과 템플릿을 `g.subscribe`로 옮기는 일은 이 뒤에 하나씩.
4. **변경 기록.** D-19 사용 시작(D-20, D-22), 마지막에 D-21(데스크톱). 옛 형식(`FileChange` 한 건)도 `fileChangesOf`가 읽으므로 기존 대화는 그대로 보인다.
5. **층 이름과 규칙.** D-26을 `P` 별칭으로 먼저 넣고(`L2`, `L3` 선언이 계속 통과), `cap-work`의 `core-agents` import(D-30)를 없앤 뒤 규칙을 켠다.
   층 F 기록(2026-11-18): D-26을 넣었다. `cap-work`의 `core-agents` import는 층 E(D-30)에서 이미 없어졌다. 두 도구가 `P`, `L2`·`L3` 별칭, P끼리 DR-02, P → L0·L1 DR-15를 강제하고 실제 트리는 0위반이다. 그 위반 두 쌍(`cap-dialog` → `core-tools`, `cap-workspace` → `core-workspace`)은 6단계 재수출 이동이 아니라 플러그인이 코어 서비스를 포트로 받는 구조를 만들어야 없어진다. 그래서 허용 목록 `DR-15/*`에 [미결]로 두었다(6.3 구현 기록, 12절 O-20) [근거: xeon/scripts/dependency-allowlist.json]. 이 두 쌍을 없애는 일은 이 단계의 밖이다.
6. **재수출 이동.** D-28(`ask/`)을 새 위치에 복사하고 `cap-dialog`가 재수출한다. 호스트 import를 새 경로로 바꾼 뒤 옛 파일을 지운다. D-27도 같은 방식(코어 서비스 파일 이동, 기능 id 유지, `cap-workspace`가 재수출). 가져다 쓰는 곳이 호스트뿐이라 한 번에 한 파일씩 옮겨도 녹색이다.
   층 D1 기록(2026-11-18): `ask/`를 `core-tools/src/ask/`로 옮겼다. 복사, 가져다 쓰는 곳 전환, 옛 파일 삭제를 한 변경에 했고 중간 상태는 남기지 않았다. 재수출은 두지 않았다: cap-dialog 파일들이 `@fresnel/core-tools`에서 `createAskService`, `questionApprovalsOver`, `DialogFailure`·`guarded`·`toCapabilityError`(옛 `errors.ts`), `Timers`를 직접 가져온다. 예외로 `ApprovalsPortFactory` 타입만 `DialogPluginOptions`의 공개 타입이라 cap-dialog 색인에서 재수출을 유지한다. 호스트(`apps/host`)는 `ask/`, `ports/approvals.ts`, `errors.ts`를 가져다 쓰지 않아 import를 바꾸지 않았다(`dialog.ask` 등록과 `ask_user` 도구 등록은 그대로다). 설정 층을 읽는 `ask-defaults.test.ts`는 cap-dialog에 남았다. 시험 대역은 `@fresnel/core-tools/testing`으로 함께 쓴다.
   층 D2 기록(2026-11-18): D-27의 서비스 파일을 `core-workspace`(L1, 패키지 이름 [제안])로 옮겼다. 복사, 가져다 쓰는 곳 전환, 옛 파일 삭제를 한 변경에 했다. 재수출은 두지 않았다: `cap-workspace`의 파일들이 `@fresnel/core-workspace`에서 직접 가져가고, 호스트는 `writeAccessTitle`만 가져간다(재수출을 두면 cap이 서비스 이름을 한 번 더 내보내야 하는데, 가져다 쓰는 곳이 호스트 한 곳뿐이라 두지 않았다). 기능 id와 등록은 cap에 남았다. 시험은 셸, 경로, 오류, 출력, 쓰기 허용(셸 부분)이 `core-workspace/test`로 갔고, 파일 도구의 쓰기 허용 시험은 `cap-workspace/test/write-access-files.test.ts`로 나눴다. 쓰기 허용 어댑터의 통합 시험은 `core-tools` 대역을 쓰므로 L2에 남았다(DR-02: L1 패키지가 L1 패키지를 devDependency로 두지 않는다). 시험 대역은 두 패키지가 각자 둔다(DR-08). 포크 기록은 `PATCHES.md`와 `UPSTREAM.json`을 나눴다(`path-utils`, `bash`, `output`은 core가 기록한다). `DR-07/workspace-test-spawn`은 cap에 그대로 두고 `DR-07/core-workspace-test-spawn`을 더했다.

7. **통합 호출 경로.** D-13~D-18. 먼저 읽기 전용 가벼운 경로만 적용하고(동작 변화 없음), 다음에 파이프라인 경로를 "설정 `l1.tools.pluginCalls` = off"로 숨겨서 넣는다. 번들(Helm의 `work.tasks.create`, 학습의 지식 쓰기)을 그 뒤에 켜서 확인한 뒤 기본값을 켠다. 마지막으로 재생 검사 완화(U-5)를 켠다. 이 단계는 주도 스펙의 `tool` 명령(E2)과 같은 진입점을 쓰므로 E2와 함께 병합하고, 로드맵에서는 M5a-2(E2) 한 곳이 소유한다(M5e에 중복 항목을 두지 않는다). 5·6단계(L1 분할)는 M5c가 내장 플러그인(`cap-workspace`, `cap-dialog`)을 프로필에서 뺄 수 있게 하는 일과 쓰기 범위 변경(M5c §4.1.17, §4.4.4)보다 먼저다.
   층 C 기록(2026-11-18): 설정 `l1.tools.pluginCalls`의 기본값은 거짓으로 두었다(이 단계 스펙대로 "숨겨서 넣는다"; 2026-11-18 enE2m에서 위험 등급 선언을 더하고 참으로 켰다). 켜 보니 apps/host 통합 시험 8개(helm-sigkill, ext-method, dialog-area, proposals UC-3, goal-judge, review-approval, uc2.real-engine, uc2.command-only)가 실패했다: 도구 매핑이 없는 쓰기 기능 메서드(`dialog.commands.run`, `work.tasks.create` 등)가 위험 등급 `exec`(MethodDef에 등급 필드가 없어 보수적 기본값)를 받아 기본 권한 모드에서 승인 카드를 띄우고 시험에는 답하는 쪽이 없다. [미결] 메서드 정의에 위험 등급을 선언할지, 카드를 받아들이고 시험이 답하게 할지 정해야 기본값을 켤 수 있다. 학습의 단위 시험 대역은 설정을 꺼 옛 경로로 돈다(4.6 구현 기록).
8. **조립 이동과 정리.** D-29, D-25(tier 셋 [결정: 2026-11-17 사용자, U3]. 프로필 순서(M5c)가 준비된 뒤), D-31, D-32. 같은 파일 `core-tools/src/pipeline.ts`, `ext-host/src/primitives/dispatch-types.ts`를 기록 스펙(M5d §8)도 고치므로 D-3~D-5·D-15를 먼저 병합하고 M5d의 판정 싱크는 그 위에 얹는다. 매니페스트 검증 수정(`hook_internal`, `hook_not_fired`)은 M5c의 매니페스트 변경(`contracts/src/extensions/validate.ts`, `manifest.ts`)과 한 트랙이 한 번에 한다.

   층 E 기록(2026-11-18): 공개 기능 `agents.judge`(core-agents 공급)와 `models.complete`(core-models 공급)을 더했다. 두 메서드는 `idempotent`이고 `readOnly`가 아니다(토큰을 쓰므로 U-1 (다), 합성 이름 `cap:models.complete`). 판정 `requestId`는 `judge:<단계 id 또는 턴 id>:<goalId>`다(단계 id가 없는 호출은 턴 id를 쓴다). `models.complete`의 호출자 이름은 `caller.extension`이고 재생 범위도 그 이름이다(등록 id가 따로 없어서) [제안]. 실패는 `agents.judge`에서 값(`capped`, `failed`), `models.complete`에서는 거부(`CapabilityError`)다. 요청 타입은 `requestId`를 필수로 고정해(`idempotent: true` 교차 타입) 컴파일러가 잡는다. 판정 타입(`JudgeInput`, `JudgeOutcome`)은 `capabilities/judge.ts`로 옮겼고 `services/agents.ts`가 다시 내보낸다. 시험 대역은 판정을 `(input, options)`로 받는다. [미결] [근거: xeon/packages/cap-work/src/goals/gate.ts] 차감 연결(6.2)과 게이트의 `fresnel.agents is not available` 문구는 바꾸지 않았다(이름이 옛 포트를 가리킨다).

## 10. 수용 기준

| # | 기준 | 근거 |
|---|---|---|
| A-1 | `HOOK_POSITIONS`의 키가 `HOOK_NAMES` 50개와 같고 위치 종류별 개수가 블록·경계 21, 이벤트 24, 내부 5다. 46개 기존 이름 문자열이 이전 빌드와 같다 | R21, 결정 A, H-5 |
| A-2 | 사람에게 묻기와 서브에이전트에 앞뒤 훅이 있다. 서브에이전트는 `agent` 도구, `loop.spawn`, `g.delegate` 세 경로 모두에서 `agent.spawn.before|after`가 한 번씩 발화한다 | 결정 A, 4.3 |
| A-3 | `tool.call.before`가 `ask`를 내면 카드가 뜨고 허용 시 실행, 거부 시 거부 결과가 모델에 간다. `bypass`에서도 뜬다. 정책 deny는 deny다 | 4.2, H-1 |
| A-4 | [결정: 2026-11-17 사용자, U3] 앞 핸들러 `ask`, 뒤 핸들러 `block`이면 `block`이다 | H-2 |
| A-5 | 무인 실행에서 훅 `ask`가 설정 `l1.tools.unattended.approval`대로 거부, 대기, 만료한다 | E-1 |
| A-6 | 기록된 결과값(`result`, `reason`, `decision`)에서 `hookOutcomeOf`가 표시값 여섯을 파생하고, 막음과 시간 초과가 다른 값이다. 변환표의 모든 행이 시험된다 | R12, 4.5 |
| A-7 | 사용자 등급 매니페스트가 내부 훅을 선언하면 거부된다 | H-4 |
| A-8 | 이벤트 구독의 예외는 턴 결과를 바꾸지 못하고 같은 `eventKey`가 재전달에서 유지된다 | H-6, 4.4 |
| A-9 | 주도 플러그인이 코드로 `write`를 부르면 턴 기록과 변경 탭에 남고, 다른 플러그인의 `tool.call.before`가 그 호출을 막을 수 있고, `bypass`가 아닌 모드에서는 카드가 뜬다 | R10, 5.3 |
| A-10 | 플러그인이 자기 `tool.result` 안에서 부른 호출에는 자기 핸들러가 돌지 않고, P→Q→P 순환은 `hook_cycle`로 거부된다 | U-8 |
| A-11 | 재생 안전: 같은 호출 키로 다시 불러도 파일이 한 번만 바뀐다 | U-5 |
| A-12 | 대체 도구가 낸 변경이 변경 탭과 리뷰 diff에 나온다. 이름이 `edit`이 아니어도 된다(읽기는 이름을 보지 않는다). 보고 경로(`ctx.changes.report`)와 내장 `edit`의 관찰 경로는 이 트랙이 시험한다(`core-tools/test/file-changes.test.ts`, 변경 탭 `changes-model.test.ts`, 리뷰 `collect-diffs.test.ts`). 플러그인 코드가 코어 서비스를 부른 변경의 관찰(F-1)은 E2 뒤에 시험한다 | R22, 4.7, F-1, F-5 |
| A-13 | `tool.result` 훅이 `details`를 지워도 `fileChanges`가 남는다 | F-3 |
| A-14 | 위험 등급 `write` 이상인 대체 도구가 코어 서비스를 부르지 않고 성공하면 `untracked_write`가 기록된다 | P-4 |
| A-15 | `check-layers.ts`와 `dependency-cruiser`가 `cap-*`↔`group-*` import를 같은 등급 위반으로 거부하고, `cap-work`가 `core-agents`를 import하면 위반이다 | 6.3 |
| A-16 | `blocks.describe`가 6개 블록, 3개 경계, 50개 위치를 돌려주고 블록별 `hooks`가 `HOOK_POSITIONS`와 일치한다 | 4.8, 4.9 |
| A-17 | 모든 변경에서 시스템 프롬프트, 환경 블록, 도구 설명의 모델 입력이 바이트 단위로 같다(스냅샷) | 1.3 |
| A-18 | `SettingRef.scope`에 `thread`가 없고 `profile`이 있다. 부록 A의 우선순위가 `managed > launch > profile > local > project > user`다 | 4.8, 부록 A |
| A-19 | `CallerId` 패턴이 `plugin:<이름>`을 받고 이름 스키마 최대 길이(32자)가 72자 상한 안이다 | 4.6 |
| A-20 | [결정: 2026-11-17 사용자, U6] 대화 시작 경계의 결과 `workspace`가 첫 턴 전에 같은 프로젝트 루트 안일 때만 반영된다 | H-7 |

[정정 2026-11-18, 이 트랙] A-12의 "도구 이름이 `edit`이 아니어도"는 `replaces` 대체 경로에서는 성립하지 않는다. 대체 등록은 원본 내장 도구와 같은 이름으로 묶인다(`core-tools/src/registry.ts`의 `addReplacement`가 이름으로 원본을 찾는다). 그래서 대체 `edit`의 이름은 `edit`이다. 이름과 무관하다는 말은 읽는 쪽(변경 탭, 리뷰)의 규칙이고, 그 시험은 이름이 `patch_file`인 결과로 한다.

## 11. 다른 스펙과 맞이르는 곳

- **주도·격리**: `tool` 명령과 `executeForPlugin`은 같은 진입점이다(5.3, 9절 7단계). `model` 명령은 `model` 블록의 앞뒤 훅을 지나야 하는데 지금 `ModelService.complete`가 이미 `request.provider.before`, `guard.model.before` 등을 발화한다(`core-models/src/pipeline.ts:349-366`, 인벤토리 §2). 컨텍스트 앞 훅(`request.context.before`, `request.system.before`)은 `complete`에 적용되지 않는다(`core-context/src/assemble.ts:139-160`는 턴 조립 전용). `model` 명령이 이 둘을 건너뛴다는 사실은 주도 스펙이 확정했다(엔진 설계 §1.2: `model` 명령은 모델 호출 앞 훅 `request.provider.before`, `guard.model.before`만 지나고 컨텍스트 조립 앞 훅은 지나지 않는다). 격리 프로세스의 `capability()`는 요청·응답으로 `executeForPlugin`에 이르고(U-9) 이벤트 구독은 응답 없는 알림이다(4.4). `ext.<이름>.isolation` 설정이 읽히지 않는 문제(F5)와 P-4 2번이 맞물린다.
- **프로필·프로젝트·로더(M5c)**: 훅 순서 기본값이 프로필의 플러그인 목록 순서다(O-1). 프로필의 설정 값이 블록의 설정 겹이므로 `blocks.applied`가 프로필 값을 읽는다. `replaces` 충돌은 프로필 편집 때 알린다(P-5). 프로필 저장소는 이미 `profiles.json`(`apps/host/src/assembly/m4/profile-store.ts:21`)이고 스키마가 설정 키를 제한하지 않는다(`contracts/src/wire-settings/wire/profile-test-run.ts`).
- **턴 기록과 지표(M5d)**: 훅 결정값(ask, replace 포함)과 표시값 변환(4.5), 플러그인 호출 목록(U-2, U-4), 호출 주체 `plugin:<이름>`과 승인 상속(U-11), `untracked_write`, 가벼운 경로 호출 줄, 이벤트 처리 시간이 기록 대상이다. 저장 모양과 기록된 결과값은 M5d가 정의한다(`HookRun.decision`, `CallRecord.caller`·`via`, `pluginCalls`, `flags.untrackedWrite`). 이벤트 처리의 지연이 턴의 결과를 바꾸지 못한다는 요구는 M5d의 `late: true`(기록이 늦었다는 표시)와 같은 말이다.
- **Craft 화면(`docs/xeon/review/m6/craft-flows.md`)**: 블록 상세(S8)는 `blocks.describe`와 `blocks.applied`를 읽는다. 단계 분류 `PHASES`(`start/think/act/wrap`)는 위치 데이터가 대신한다. "순서가 중요" 표시는 O-4로 다시 계산한다. 경고 "대체 `edit`이 변경 탭에 잡히지 않을 수 있음"(`craft-plan.md` §7.3)은 이 스펙의 변경 기록과 계측(P-4)으로 사라지거나 "추적 밖" 표시로 바뀐다. 화면이 보일 말: 훅 결과 여섯 값, "코드가 직접 실행됨", 위치 이름(블록 이름과 앞/뒤).
- **E3 프레임 스택**: `lifecycle.lease.rejected`가 사라진다(H-10). 턴 시작 훅에 `driver`를 더하는 일(`docs/xeon/review/m5/drive-isolation.md` §2.5)은 `input.agent.before`(collect)의 payload에 필드를 더하는 일이라 이 스펙의 위치 데이터와 충돌하지 않는다. 훅 안에서 부른 플러그인 호출의 한도는 6.2 끝 문단을 따른다.

## 12. 미결

| # | 질문 | 제안 기본값 |
|---|---|---|
| O-2 | 훅의 묻기에 "이 대화에서 계속 허용"을 줄지 | 주지 않는다(`once`뿐). 반복 질문 피로가 생기면 훅이 `rememberFor` 같은 필드를 선택하게 한다 |
| O-3 | `thread.switch|fork|tree.before`를 내부로 둘지 | 내부. 쓰려는 번들이 없다 |
| O-4 | 중첩 호출 승인 상속(U-11)을 쓸지 | 쓴다. 안 쓰면 대체 도구와 플러그인 도구의 이중 승인이 생긴다. 구현했다(좁힌 규칙은 U-11) |
| O-5 | `bash`가 바꾼 파일을 어떻게 추적하는지(변경 관찰 범위) | 이 스펙에서는 하지 않는다. 별도 트랙 |
| O-6 | 도구 인자 재작성 훅(`L1.tools.spec` §4.10) | M5e에 넣지 않는다 |
| O-7 | 턴 없는 호출(대화 시작 훅, 명령)의 효과 기록 `turnId: null` 허용 여부 | 구현 트랙의 첫 일로 `F.records` 스키마를 읽고 정한다 |
| O-8 | `guard.output.before`의 `execution` 대상(`guardExecution`)과 `guard.tool.before`의 겹침 제거 | 이 스펙에서는 두고 이름만 정리한다 |
| O-9 | `group-sdk`를 플러그인 등급에 둘지 SDK로 둘지 | SDK(플러그인 API 라이브러리). 의존 방향 때문에 규칙은 `DR-02/group-sdk` 예외로 지금과 같다 |
| O-19 | [제안] U3의 세부: 합치기를 두 위치에만 쓰는 것, 모든 핸들러가 돈 뒤 정하는 것, 등급 이름(`guard`, `plugin`, `core`)과 순서. 사용자가 정한 것은 `block` > `replace` > `ask`와 등급 셋, guard 맨 앞이다 | 5.1 H-2, 5.2 O-2대로. 사용자가 다르게 정하면 고친다 |
| O-11 | 번들이 쓰는 내부 상태 기능(`work.tasks.create` 등)이 `default` 모드에서 카드를 띄우는 문제 | 도구 매핑이 없는 `idempotent` 기능은 위험 등급 `write`이지만 내부 상태 전용이라 평가를 `allow`로 하는 선언(`MethodDef.internalState`)을 더한다 [미확인: 지금 정책의 처리] |
| O-12 | 새 설정 `l1.tools.pluginCallDepth`, `l1.tools.pluginCalls`(전환 스위치)의 이름 | 그대로. 전환이 끝나면 `pluginCalls`는 지운다 |
| O-13 | `thread.start`를 경계 훅으로 두면서 `g.subscribe`에서도 받을지 | 받는다(이벤트 목록에는 넣지 않고 경계 목록에서만). 둘 다 쓰는 코드가 없다 |
| O-14 | 사용자 플러그인에게 접두 저장 표(SQL)를 줄지 | 주지 않는다. 상태 문서와 레코드(`g.state`, `g.record`)만 |
| O-15 | 안전 모드(`operations/safe-mode.ts:44-49`)는 내장 L1·L2만 남긴다. tier를 셋으로 줄이면(O-2) "번들" 구분이 정렬에서 사라진다 | 출처 표시(`source: builtin`)를 유지해 안전 모드가 계속 번들만 남기게 한다 |
| O-20 [미결] [근거: xeon/scripts/dependency-allowlist.json] | `cap-dialog`가 `core-tools`(질문 서비스 `createAskService`, `DialogFailure`, `guarded`, `toCapabilityError`, `Timers`, `questionApprovalsOver`)를, `cap-workspace`가 `core-workspace`(경로 검사, 셸 실행, 쓰기 허용, 원자 쓰기, `WorkspaceFailure`, `WorkspaceEnv`)를 소스에서 import한다. P.2(DR-15) 위반이다. 없앨 설계를 정한다 | [제안] 코어가 서비스를 기능 id와 포트로 내고, 플러그인은 F에 둔 타입과 `g.capability`(포트)로만 쓴다. 서비스 타입(오류 유니온, 의존, 셸 API)을 F로 올리는 일이 크다. 소스 9개(`cap-dialog`)와 12개(`cap-workspace`) 파일과 시험이 바뀌므로 1일을 넘는다. 층 F는 허용 목록 두 항목(`DR-15/cap-dialog-core-tools`, `DR-15/cap-workspace-core-workspace`, `approvedBy: pending-user-approval`)으로 둔다. 승인과 시한은 사용자가 정한다 |

## 13. 요구 추적표



| 요구 | 자리 | 상태 |
|---|---|---|
| R10 | 4.6, 5.3, 8절 D-13~D-18, 10절 A-9~A-11 | 둠 |
| R21 | 3절, 4.1~4.4, 5.1, 5.2, A-1~A-8 | 둠 |
| R22 | 4.7, 5.4, 5.5, A-12~A-14 | 둠. 되감기 구현은 보류라 입력만 정함 |
| 결정 A (블록마다 앞과 뒤 + 경계 셋) | 3절, 4.3 | 둠 |
| 결정 B (층 재편) | 6절 | 둠. [결정: 2026-11-17 사용자, U4] 확정 |
| 결정 C (블록의 네 겹과 보장) | 4.8, 4.9, 부록 A | 둠 |
| 결정 D (플러그인 호출을 도구 블록에 태움) | 5.3 | 둠 |
| R12 (훅 결과 값) | 4.5(결정값, 기록된 결과값, 표시값, 변환표), H-9, A-6 | 둠. 저장 모양은 M5d |
| R21 의 일부: 같은 위치 순서와 합치기 | 4.2 결정 합치기, 5.1 H-2, 5.2 O-1~O-2, A-4 | 둠. [결정: 2026-11-17 사용자, U3] |
| 대화 시작 경계의 결정 값 | 5.1 H-7, A-20 | 둠. [결정: 2026-11-17 사용자, U6] |
| 훅 선언의 결정 선언(`decides`), 기록 블록의 빈 Hook 겹 명시(M6 요청 M5e-1·2) | 4.1.1, 4.9 | 둠 |
| 위치에 못 놓은 것 | `L1.tools.spec` §4.10의 인자 재작성 훅(O-6), `bash`의 파일 변경 관찰(O-5), 기록 블록의 쓰기 훅(기록 블록은 이벤트만, 결정 A) | 범위 밖으로 표시 |

## 14. 용어 등록 요청

`xeon/packages/client/src/i18n/terms.json`을 기준으로 교차 점검 2 §3이 찾은 것이다. 이 스펙은 금지 별칭(`thread` → "세션", `hook` → "지점", "연결 지점", "소켓", `testRun` → "시험 대화", `secret` → "비밀", `driver` → "임대", "진행권", `pluginGroup` → "의도 그룹")을 쓰지 않는다. 등록과 정리는 `terms.json`을 갱신하는 트랙이 한다.

**새로 등록할 말**

| 말 | 쓰는 곳 | 비고 |
|---|---|---|
| 테스트 대화(Craft 전용 AI 대화), 테스트 실행(초안을 얹은 임시 구성) | M5c, M5d, M5e, 화면 스펙 흐름 8, `m5-plan.md` §7 | `testRun`(Test run, ui "테스트")과의 관계를 정의한다. M5d §2: "테스트 실행 = 기존 Test run과 같은 통로"이므로 `testRun`의 ui를 "테스트 실행"으로. "테스트 실행"은 [결정: 2026-11-17 사용자] |
| Inject / Hook / Drive(화면 이름) | 전체 | 영어 표기이고 한국어 이름은 쓰지 않는다(ADR §3.3.1). `hook` ui "훅"과 정리. 코드 의미의 "주입"(의존성 주입, `injectionMode`)은 유지 |
| 프로필 칩 | M5c, 화면 스펙, `m5-plan.md` | 신규 |
| 테스트(Craft의 화면 이름) [결정: 2026-11-17 사용자] | 화면 스펙, `m5-plan.md` | 사용자가 "시험장"을 반려하고 "테스트"로 정했다. 테스트 대화·테스트 실행과 같은 말뿌리다 |
| Craft 화면 이름: 개요, 프로필, 검토함, 테스트, 지표, 플러그인(여섯) [결정: 2026-11-17 사용자] | 화면 스펙 | 지금 `terms.json`의 `benchmark`(성능 측정), `workbench` 등과의 관계를 정한다 |
| 지침 추가 | craft-flow, M5c §4.10 | 프로필 화면의 한 줄 지침 플러그인 입구 |
| 덧씌우기, 일회 사용, 공통 묶음, 시작 Drive, 검토함, 검토본, 원본, 초안 | M5c, craft-flow | 신규 |
| 대화 폴더, 프로젝트(루트), 기본 폴더 | M5c | "프로젝트"가 신규 |
| 프레임, 맡기기(handoff), 단계 함수 | 엔진 설계 | 신규. 용어 "단계"(step)와 혼동하지 않는다 |
| 블록, 앞/뒤, 훅 위치, 루프 경계, 이벤트 구독, 통합 호출 경로, 호출 주체 | M5e | "경계"가 `stepBoundary`("단계가 끝나면")와 "단계 경계"와 겹치므로 "루프 경계"로 구별한다. 훅 "위치"는 `placement`(배치)와 구별한다 |
| 턴 기록, 재료, 지난 턴에 돌려 보기, 살펴볼 것 | M5d | `trace`(트레이스, 금지 "턴 재생")와 `replayTest`(재실행 검사)와의 경계를 한 줄로 정의한다. "지난 턴에 돌려 보기"는 `replayTest`가 아니다 |
| 프레임 깊이, 에이전트 깊이, 호출 깊이 | 엔진 설계, M5e | 이름을 나눠 쓴다(2절) |
| 결정값, 기록된 결과값, 표시값 | M5e, M5d | 4.5 |
| 플러그인 정체, 버전 정체 | 엔진 설계, M5c, M5d | `pluginId`, `versionId` |

**`terms.json`에서 걷거나 고칠 항목**

| 항목 | 처리 |
|---|---|
| `extension`, `pluginGroup`, `layerExtensionRuntime`의 `ui` 값 | 화면에서 쓰지 않기로 결정했으므로 `status`를 `legacy`로, `ui` 값 제거 |
| `testRun`(ui "테스트") | ui를 "테스트 실행"으로. `forbid.docs`의 "시험 대화"는 유지하고 "시험장"을 금지 목록에 더한다(사용자가 2026-11-17에 그 이름을 반려했다. 이 요청이 확인되면) |
| `hook`의 `forbid`("지점", "연결 지점", "소켓") | 유지. 문서의 남은 "지점"은 "위치"나 훅 이름으로 치환(ADR, 화면 스펙, `m5-plan.md`, `_notes/m4-decisions.md`) |
| `secret`의 `forbid`("비밀") | 유지. "비밀 값"은 "시크릿 값"으로 치환 |
| `thread`의 `forbid`("세션") | 유지. 문서의 thread 뜻 "세션"은 "대화"로("세션 폴더"는 "대화 폴더"). 에이전트 작업 맥락을 뜻하는 "메인 세션"은 위반이 아니지만 혼동되므로 "메인 에이전트" 권고 |
| `driver`(ui "주도") | "주도권"과 Drive(화면 이름)의 관계를 한 표기로 정리한다. 금지는 "임대", "진행권" |
| `workbench`(ui "크래프트") | 사용자 결정 문장의 "Craft"와 한 표기로 정리한다 |

## 부록 A. 블록별 기존 설정 키

출처: `contracts/src/wire-settings/settings/define.ts`의 카탈로그와 각 패키지 `src/settings.ts`. 설정 범위는 managed, user, project, local, launch(이번 실행)다(`contracts/src/wire-settings/settings/layers.ts:4,8-14`, 우선순위 managed > launch > local > project > user). M5c가 `profile` 범위를 launch 아래 local 위에 더한다(managed > launch > profile > local > project > user > default). `thread` 범위는 없다. 설정 정의에는 블록 필드가 없고 `ui.tab`만 있어서 아래 분류는 이 스펙의 제안이다(`SettingRef`가 이 분류를 데이터로 만든다). 기본값은 읽은 값이다.

| 블록 | 키(기본값) | 정의 위치 |
|---|---|---|
| 컨텍스트 조립 | `l1.context.autoCompact`(true), `reserveTokens`(16384), `keepRecentTokens`(20000), `compactionInstructions`(""), `pruneToolResults`(false), `pruneThresholdChars`(200), `reinjectRecentFiles`(5), `cacheWarming`(off) | `core-context/src/settings.ts:39-123` |
| | `l1.models.routing.summary`(요약기 모델, null) | `core-models/src/settings.ts:233` |
| | `l1.tools.exposure.deferThreshold`(64, 도구 설명을 미리 싣는 범위) | `core-tools/src/settings.ts:137` |
| | `skills.*`, `memory.*`(지침, 스킬 주입 예산), `commands.advertise`(true) | `cap-knowledge/src/settings.ts:17-96`, `cap-dialog/src/settings.ts:45` |
| 모델 호출 | `l1.models.default`, `routing.review|summary|subagent|judge|search`, `groupRouting`, `thinkingLevel`(medium), `thinkingBudgets`, `allowedModels`, `deniedModels`, `providers`, `accounts`, `rateLimit`, `cacheRetention`(short), `retry`({3, 2000ms, 60000ms}) | `core-models/src/settings.ts:218-353` |
| 도구 실행 | `l1.tools.permissionMode`(bypass, `default|acceptEdits|bypass`), `bypassAllowed`(true, managed만), `rules`, `unattended.approval`(expire), `unattended.timeoutSeconds`(3600), `output.maxLines|maxBytes` | `core-tools/src/settings.ts:55-168` |
| | `l0.sandbox.enabled`(true), `onUnavailable`, `protectedPaths.extra`, `writeRoots.extra`(쓰기 허용 폴더), `network.blockedDomains`, `credentialFiles`, `nestedNamespaces` 등 | `platform-sandbox/src/settings.ts:15-128` |
| | `l0.exec.shell`, `defaultTimeoutMs`, `unattendedTimeoutMs`, `envAllowlist.extra`, `l2.workspace.shell.*`, `read.*` | `platform-exec/src/settings.ts`, `cap-workspace/src/settings.ts` |
| | `l2.web.policy.allow|ask|deny|default|unseenUrl|allowPrivateNetwork|robots` | `cap-web/src/settings.ts:158-220` |
| | `l2.mcp.allowedServers|deniedServers|managedOnly|approvalMode|connectTimeoutMs|callTimeoutMs` | `cap-mcp/src/settings.ts:46-89` |
| | `l0.secrets.approval.default|writeHosts`, `lease.ttlSeconds|maxUses` | `platform-secrets/src/settings.ts:92-124` |
| | 훅: `x.operations.hookOrder|hookDisabled|hookDefs|hookEnvAllow`, `budget.firstMs|chainMs|tapMs|streamTapMs|shutdownMs|setupMs|uiMs|hookMs`, `autoDisable.*`, `safeMode.*` | `ext-host/src/operations/settings-keys.ts:96-306` |
| 사람에게 묻기 | `l2.dialog.ask.timeoutSec`(0), `notify.os|completed|approvalWaiting|questionWaiting|error|backgroundCompleted` | `cap-dialog/src/settings.ts:21,111-151` |
| | `l1.tools.unattended.*`(위), `l0.exec.unattendedTimeoutMs` | 위 |
| 서브에이전트 | `l1.agents.maxDepth`(1, 범위 0~5), `maxConcurrent`(8), `resultMaxChars`(24000), `judge.maxRuns`(3) | `core-agents/src/settings.ts:11-57` |
| | `l1.tasks.limits.subagents|modelCalls|tools`, `l1.models.routing.subagent|judge`, `l2.work.goal.delegatedTimeoutSec` | `core-tasks/src/settings.ts:25-56`, `cap-work/src/settings.ts:24` |
| 기록 | `l1.persistence.retention.maxAgeDays|maxCount`, `autoResume`, `maxResumeAttempts`, `export.format` | `core-persistence/src/settings.ts:9-69` |
| | `l0.exec.outputSpillBytes|spillRetentionDays|spillMaxBytes`, `l0.store.*`, `x.operations.trace.enabled|retentionDays|storeRequestBody` | `platform-exec/src/settings.ts`, `platform-store/src/settings.ts`, `ext-host/src/operations/settings-keys.ts:216-241` |
| 블록 밖(기본 흐름) | `l1.loop.maxSteps`, `gate.maxContinues`(8), `repeat.*` | `core-loop/src/settings.ts:22-77` |
| 주도 | `x.primitives.driveDefaultLimits`, `x.primitives.driveLimits`(천장), `x.primitives.driveMaxDepth`(깊이 상한, 기본 3 [권고: 메인 세션, 확인 대기]. 이름은 [제안]이고 C0에서 확정. 프로필이 `profile` 범위로 바꿀 수 있는 것은 앞의 기본 한도와 깊이 상한이다) | `ext-host`(정의 위치는 구현 때 정한다). 범위 규칙은 M5c §3.3 |

블록에 키가 없는 것: 샌드박스 프로필 `read-only`는 설정이 아니라 호출 옵션이고(`contracts/src/services/sandbox.ts:111`), 도구 대체에는 설정 키가 없으며 상태(`pending|active|denied`)만 있다(`L1.tools.spec` §4.13). 서브에이전트의 백그라운드 전용 키도 없다.

확인하지 못한 점: 각 키의 개별 허용 범위는 일부만 읽었다(`cap-knowledge`의 `memory.*`, `skills.*`). 키가 전부 위 표에 있는지는 `settings.list` 결과와 대조해 구현 트랙이 확정한다.

