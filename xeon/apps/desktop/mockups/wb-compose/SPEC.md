# 블록 구성기 스펙 제안 (wb-compose)

크래프트 "구성"(P-21)과 "만들기"(P-22)의 폼·목록 화면을 캔버스 구성기 하나로 바꾸는 제안입니다. 플러그인을 블록으로 쌓고 잇고 흐름으로 묶습니다. 이 문서는 desktop-ux spec에 합칠 원고이고, spec.md는 고치지 않았습니다.

- 시안: `xeon/apps/desktop/mockups/wb-compose/` (`?state=S1..S8`, `?theme=dark`)
- 실행: `MOCKUP=wb-compose MOCKUP_PORT=8881 mise exec -- bun run mockup`
- 근거: L3.helm.spec(§3.1, §3.4~§3.8, §4.2, §4.5, §4.6, §6, §7), L3.slots.spec(§3.1, §3.3), L3.group-sdk.spec(§3.5 DriveArbiter), F.extensions.spec(§3.4 훅 표, §4.1 fold), X.primitives.spec(§4.4 주도 상한), X.operations.spec(§3.1 tier와 정렬 키)

## 1. 목적과 범위

- 사용자가 L3 플러그인 그룹의 구조(슬롯, 훅, 연산, 소비 기능, 내는 기록)를 공간으로 보고, 참고 그룹(Helm)을 복제해 고치고, drive 단계 머신을 노드 그래프로 편집하고, 프로필을 층별로 쌓고, 결과가 어떤 뼈대 파일이 되는지 확인하게 합니다.
- 구성기는 **설계 모델**입니다. 런타임에는 블록이 없고, 블록은 매니페스트(`points`, `optional`, `requires`, `recordKinds`, `usesDrive`, `usesPost`)와 `setup(g)` 코드로 풀립니다(§6 간극 1).
- 설치된 그룹(Helm)의 구성은 매니페스트와 소스에서 읽은 읽기 전용 보기입니다. 고치려면 "복제해서 고치기"로 새 그룹(예: `lens-review`)을 만듭니다. 구성기는 남의 설치본 코드를 다시 쓰지 않습니다.

## 2. 화면

크래프트 내비 "구성"과 "만들기"가 같은 구성기를 엽니다. 화면 머리(h-10) 오른쪽 `SegmentedControl` 하나가 보기 넷을 바꿉니다: 그룹 · 흐름 · 프로필 · 코드. 가운데는 투명한 캔버스(점 격자만, 바탕색 없음, DP-01)이고 왼쪽 패널은 크래프트 내비 그대로입니다. 블록 팔레트("블록")와 고른 블록의 상세("속성")는 오른쪽 well 탭입니다(받은 요청 다음, 기록·대화 앞).

### 2.1 그룹 쌓기 (보기 "그룹")

- 세 열이 층을 나눕니다. 왼쪽 `L1·L2`: 맥락 대화에서 기능을 주는 확장(provider)과 그 기능 포트. 가운데 `L3`: 그룹 머리(scope: 이름, 층·종류·신뢰·버전, 상태 스키마, 주도 상한, 설정 키) 아래에 슬롯 블록을 쌓습니다. 오른쪽 `F`: 블록이 내는 것(공개 기록 `grp.<그룹>.*`, 입력 큐 post, 비공개 상태 문서 `x_<그룹>_state`).
- 블록 하나 = 그룹 안 코드 한 덩어리. 머리에 슬롯 아이콘, 이름, 연산(`on`·`post`·`drive`·`record`·`scope`). 몸에 훅 이름(꾸밈 없는 글자)과 fold·실패 규칙(연한 글자, DP-31), 한 줄 요약, 왼쪽 소비 포트(기능 id, `requires`면 표시), 오른쪽 출력 포트.
- 선은 포트끼리만 잇습니다. `optional` 기능은 점선, `requires`는 실선. provider가 꺼진 포트는 속이 빈 점입니다.
- Helm 참고 구성의 블록 일곱: 신호 감지(`tool.execution.after` tap, `boundary.settle.after` tap, `stuck`/`repeat`/`newDomain` → pending, `grp.helm.signal.detected`, 제안 post), 렌즈 주입(`input.agent.before` collect, 6개 중 신호 순서로 `maxLenses` 3), 단계 머신(drive: diverge → explore → converge → apply, 턴 4 · spawn 8 · 토큰 400k, `loop.spawn explorer`), 쓰기 거부(`tool.call.before` first, 실패하면 거부, diverge·explore에서 main과 `subagent:explorer`), 지식 소비(converge에서 `web.search`, `knowledge.search/skills/memory` 읽기, 모두 optional, 출처별 저하), 발견 기록(`grp.helm.discovery.recorded`, `grp.helm.inquiry.finished`, `work.tasks` 멱등 쓰기), 상태 복원(`session.start` tap).
- 검사(인라인): 블록 안 마지막 줄에 tone 아이콘 면 + 문장 + 검사 코드(mono, 연한 글자). 실패 블록은 danger 면(caustic `GraphNode state="invalid"`), 관련 선은 danger 점선. 캔버스 바로 위에 `Alert tone="danger"` 하나로 개수와 막힌 동작(DP-28).
  - `drive_duplicate`: drive 블록이 둘 — "drive는 그룹마다 하나예요. 단계 머신에 상태로 합쳐요"
  - `on_capability_call`: on 핸들러 블록이 기능 포트에 이어짐 — on 핸들러는 기능을 부르지 않습니다(ADR-0015). first 훅이면 예외가 거부가 됩니다.
  - `capability_missing`: `requires` 기능에 이 맥락의 provider가 없음 — scope가 켜지지 않습니다(X.primitives §3.7 규칙 5).
  - 경고 `maxLenses > maxSpawns`: 렌즈 일부가 skipped가 됩니다(L3.helm §6).
- 빈 구성기: 그룹 머리(이름 입력, 이름 규칙 한 줄)와 "블록을 여기에 쌓아요" 놓을 곳, 시작점 넷(Helm 복제, drive·정책·관찰 템플릿). provider 열은 흐리게 보여 이 맥락에서 쓸 수 있는 기능을 미리 알립니다.

### 2.2 흐름 캔버스 (보기 "흐름")

- drive 블록의 단계 머신을 위에서 아래로 그립니다. 노드 = 커밋된 phase 하나. 선 = 전이 이벤트와 조건(`leaseGranted · pending`, `diverged`, `explored · done ≥ 1`, `converged · 발견 ≥ 1`).
- 모든 주 전이 선 이름 앞에 ◇(단계 경계)를 둡니다. drive 함수는 단계 하나를 처리하고 커밋한 뒤 반환하고, X가 마지막 커밋 상태로 다시 부릅니다(상태 기반 재호출). 캔버스 머리에 이 뜻을 한 줄로 둡니다.
- explore는 렌즈마다 `loop.spawn(explorer)` 자식 노드로 펼치고(agent tone 아이콘 면, 렌즈 id mono), "모으기" 노드에서 합칩니다(모두 done·failed·skipped, 부분 결과 허용).
- 노드 메타가 그 단계의 주도 소모입니다: diverge 턴 1, explore spawn 3, converge 턴 0(읽기 기능만), apply 턴 1. 캔버스 머리에 주도 상한 `{maxTurns, maxSpawns, maxTokens}`.
- 쓰기 거부 구간: 가드가 켜지는 단계(diverge, explore와 그 자식)를 덮는 연한 면(`neutral.well`) 하나와 그 왼쪽 위 이름(`tool.call.before · first`, 대상 `main · subagent:explorer`).
- 오른쪽 "끝 → idle" 노드: 결과 다섯(`applied`, `stopped`, `limit`, `failed`, `empty`)이 입력 포트이고, 각 단계의 나가는 포트(`aborted · error · 턴 0`, `모든 렌즈 실패`, `spawn 0`, `발견 0`)에서 점선이 옵니다.
- 편집: 팔레트(well "블록")의 노드 종류(단계, 모델 턴, 자식 펼치기, 모으기, 기능 읽기, 사람 확인, 기록·post, 끝)를 끌어 놓고 포트를 끌어 잇습니다. 끄는 동안 초안 선(점선, tone 색)과 받을 수 있는 포트만 커집니다(`GraphPort state="target"`). 연결을 떼면 아래 노드가 흐려집니다.
- 사람 확인(gate) 노드는 "런타임에 없음" 배지를 답니다. drive 안에서 사람 답을 기다리는 원시가 없습니다(§6 간극 4).

### 2.3 프로필 쌓기 (보기 "프로필")

- 층마다 띠 하나(X 외부 훅, L3 플러그인 그룹, plugin, L2 기능, L1 코어). 위가 바깥 tier입니다. 띠 안 블록마다 켜기·끄기·그대로(`SegmentedControl` xs). "그대로"는 enable·disable 어디에도 넣지 않습니다(§6.28 그대로). core tier는 잠금 표시만.
- 블록 줄에 "지금 <상태> → <바뀔 상태>"를 보입니다. 바뀌는 블록만 진한 글자.
- 순서가 뜻을 가지는 곳만 끌어 옮깁니다.
  - 주도 칸: `x.primitives.activeDriveGroup`은 한 그룹 또는 자동입니다. 칸에 그룹 칩 하나, 후보는 옆에. 바꾸면 다음 경계에 지금 주도를 회수합니다(group-sdk §3.5).
  - first·chain 훅 순서: (tier, loadIndex, 등록 순번). tier는 바꿀 수 없고 같은 tier 안에서만 옮깁니다. 런타임에 순서 입력이 없어 "런타임에 순서 입력 없음" 배지를 답니다(§6 간극 5).
- 오른쪽 "실효 스택": 맥락 대화의 지금 값과 프로필을 합친 결과(바뀌는 확장, drive, 덮어쓰는 설정, 켜지는 훅 수). 동작: 이 대화에 적용(`settings.set { scope: "session" }` 여러 번, 하나라도 실패하면 되돌림), 테스트 대화로, 저장.

### 2.4 테스트 실행 (흐름 보기의 상태)

- 흐름 머리의 "테스트 대화에서 돌려 보기" → 테스트 대화를 만들고 그룹을 켠 뒤 같은 캔버스가 실행 보기로 바뀝니다.
- 캔버스 위 한 줄: 테스트 대화 이름과 경과, 주도 사용량 막대 셋(턴 1/4, spawn 3/8, 토큰 120k/400k), 멈춤·이어서, 한 경계씩, replay로, 테스트 결과.
- 지금 단계 노드는 tone 고리, 지난 단계는 흐린 이름, 아직 안 온 단계는 55% 불투명. 돌고 있는 렌즈는 회전 아이콘과 흐르는 점선, 실패 렌즈는 danger 면. 렌즈 노드 둘째 줄이 그 자식의 마지막 도구 호출입니다.
- 가드 발화: 쓰기 거부 구간 이름 아래 "거부 1 · bash · exec" 칩. 오른쪽 "경계 기록" 열이 커밋·주도·거부 이벤트를 시간순으로 보입니다.
- "replay로"는 이 테스트 대화의 테이프로 P-19 replay를 엽니다. "테스트 결과"는 P-19 그 행.

### 2.5 코드 보기 (보기 "코드", 읽기 전용)

- 세 열: 블록 목록(그룹 머리 포함) · 만들 파일 10개(drive 템플릿 `group-sdk/templates/index.json` 그대로, caustic `CodeRealization`, 단계 블록 → 매니페스트 → 뼈대 → 검사) · 고른 파일의 생성 결과(`src/index.ts`, `plugin.json`).
- 블록을 고르면 그 블록에서 나온 파일만 진하게, 코드 줄은 올린 면(현재 항목과 같은 raised, 색 없음)으로 보입니다. 줄 옆 홈에 블록 아이콘을 블록이 시작하는 줄에만.
- "명령 복사": `fresnel group new lens-review --drive`. 블록 내용은 생성 뒤 덮어쓸 패치로 보입니다(§6 간극 2).

## 3. 상태

| id | 보기 | 내비 | 보이는 것 |
|---|---|---|---|
| S1 | 그룹 | 구성 | Helm 참고 구성, 단계 머신 블록 고름, well 닫힘 |
| S2 | 그룹 | 만들기 | 빈 구성기, well "블록" 팔레트 열림 |
| S3 | 그룹 | 만들기 | lens-review 검사 실패 3 + 경고 1, 캔버스 위 Alert |
| S4 | 흐름 | 구성 | Helm 단계 머신, 쓰기 거부 구간, 끝 노드 |
| S5 | 흐름 | 만들기 | lens-review 편집: converge 다음 포트를 사람 확인 노드로 끄는 중. 왼쪽 패널 닫음, well 팔레트 |
| S6 | 흐름 | 구성 | Helm 테스트 실행: explore 진행 중, 렌즈 셋(돎·끝남·실패), 가드 발화, 경계 기록 |
| S7 | 프로필 | 구성 | 프로필 "탐구 중심" 쌓기, 실효 스택 |
| S8 | 코드 | 만들기 | lens-review 뼈대, 단계 머신 블록의 줄 강조 |

- 폭: 1280은 캔버스를 폭에 맞추고 높이는 88% 밑으로 줄이지 않고 세로 스크롤합니다. 1000(medium)은 폭 맞춤으로 약 70%까지 줄이고 줌 캡슐로 키워 팬합니다. 720 이하(compact)는 캔버스 대신 개요 편집기입니다: 그룹은 caustic `LayerTree`(블록 → 훅·기능·출력, 끌어 옮기면 쌓는 순서), 흐름은 단계 목록과 들여 쓴 전이. 프로필·코드는 한 열로 접힙니다.
- 오류·빈·읽는 중: 검사 실패는 S3. 빈은 S2. 읽는 중은 provider·출력 열 자리에 `Skeleton`(시안에 없음). 오프라인이면 적용·테스트·명령 복사 외 동작을 잠급니다.

## 4. 상호작용

- 블록·노드 누름 → 고름(tone 고리). well "속성"이 그 블록의 슬롯, 연산, 훅(fold·실패), 기능과 provider, 코드 위치, 검사를 `ListDescription`으로 보입니다.
- 팔레트 행 끌기 → 그룹 열에 쌓기 또는 흐름 캔버스에 놓기. 그룹 열에서 블록을 위아래로 끌면 쌓는 순서가 바뀌고(뜻은 코드의 등록 순번, 같은 훅 안 순서만 바뀜), 이 사실을 놓을 때 한 줄로 알립니다.
- 포트 끌기 → 초안 선. 맞는 포트만 target으로 커지고 나머지는 흐려집니다. 맞지 않는 쌍(on 핸들러 ↔ 기능, 출력 ↔ 출력)은 놓으면 검사 줄을 남깁니다.
- 줌 캡슐: 줄이기·키우기, 숫자 누르면 맞춤으로.
- "복제해서 고치기" → 만들기 내비, lens-review(작성 중)로 같은 블록을 가져옵니다.
- 테스트: 멈춤·이어서는 실행을 멈추지 않고 화면 갱신만 멈춥니다(실제 멈춤은 `/helm stop` 같은 그룹 명령). "한 경계씩"은 테스트 대화에서만 [제안].

## 5. 데이터 출처

| 항목 | 출처 |
|---|---|
| 설치 그룹의 블록(훅·연산·기능·기록) | 매니페스트 `points`, `optional`, `requires`, `recordKinds`, `usesDrive`, `usesPost` `[gap:W-15]` + 블록 분해 `[gap: 새 view-model]` |
| 훅 fold·실패 규칙 | F 훅 표(`POINTS`) — 클라이언트 상수로 [제안] |
| 맥락의 provider | `ext.list` + 기능 표 `[gap:W-15]` |
| 단계 머신 노드·전이 | Helm은 `TRANSITIONS` 상수(§3.3). 일반 그룹은 없음 `[gap: 새 매니페스트 필드]` |
| 테스트 실행 진행 | `lease.*`, `scope.changed`, `grp.helm.state.committed`(phase만), 자식 `agent.*`, `tool.call` 결정 이벤트 |
| 프로필 | 데스크톱 로컬 `l4.desktop.workbench.profiles` `[gap:V-22]` |
| 실효 스택 | 대화의 유효 설정 + `GroupStatus` `[gap:W-24]` |
| 뼈대 파일 | `group-sdk/templates/index.json` `[gap:W-27]` |

## 6. 간극 (wire · F · X · 런타임)

1. **그룹 구성의 런타임 표현 없음.** 블록은 설계 시간에만 있습니다. 설치된 그룹을 블록으로 보이려면 "이 훅 핸들러가 어느 슬롯인가"를 알아야 하는데 매니페스트에는 훅 목록만 있습니다. 제안: 매니페스트에 선택 필드 `composition: { slot, points, op, consumes, produces }[]`(F.extensions §3.1)와 `validateComposition`. 없으면 훅 이름으로 추정합니다(시안의 Helm 분해는 spec을 읽고 손으로 만들었습니다).
2. **블록 → 코드 생성 경로 없음.** `fresnel group new`는 템플릿 복사와 치환 셋(`__ID__`, `__TITLE__`, `__VERSION__`)만 합니다(L3.slots §3.3.6 R5). 블록에서 `points`·`optional`·`recordKinds`와 `setup` 등록 줄을 채우려면 `ext.scaffold { template, name, dir, composition }` `[gap:W-27]`과 L4 CLI의 패치 단계가 필요합니다.
3. **구성 검사 코드 부족.** F `validateManifest`·`validateUsage`에 `drive_duplicate`(scope당 `g.drive` 둘), `on_capability_call`(on 핸들러의 기능 호출, 지금은 ADR-0015 규칙뿐이고 정적 검사가 없음)이 없습니다. `capability_missing`은 런타임에서 scope가 안 켜지는 것으로만 드러납니다. 제안: 클라이언트가 부를 수 있는 `ext.validateComposition` wire.
4. **drive 안 사람 확인 원시 없음.** `loop.turn`·`loop.spawn`·`post`·`commit`만 있습니다. 승인 대기는 post + 다음 경계 재호출로 흉내 낼 수 있지만 주도를 쥔 채 기다리는지, 반납하는지 정해지지 않았습니다(X.primitives §4.4). 제안: `loop.ask({ requestId, card })` 또는 `pending` 상태 + `lifecycle` 훅.
5. **핸들러 순서 입력 없음.** 순서는 (tier, loadIndex, 등록 순번)이고 loadIndex는 로더 순서입니다(X.operations §3.1). 프로필에서 같은 tier 안 순서를 바꾸려면 `x.operations.loadOrder` 같은 설정이 필요합니다. 없으면 순서 칸은 보기 전용으로 둡니다.
6. **일반 drive 그룹의 단계 머신 선언 없음.** Helm만 `TRANSITIONS`를 export합니다. 흐름 캔버스를 다른 그룹에 쓰려면 매니페스트나 group-sdk에 `phases`/`transitions` 선언(상태 스키마의 phase 유니온과 전이표)을 둡니다.
7. **테스트 실행 단계별 진행 이벤트.** 상태 문서는 비공개라 phase를 바깥에서 읽을 수 없습니다(F.extensions §3.6). 테스트 대화에 한해 `grp.<id>.state.committed`의 `phase`만 노출하는 진단 투영 `[제안]`이 필요합니다. "한 경계씩"은 테스트 대화 전용 `trial.step` wire `[gap:W-34]`.
8. **provider 해석 view-model.** 기능 id → 이 맥락에서 그 기능을 주는 확장(꺼짐 포함)을 한 번에 주는 wire가 없습니다 `[gap:W-15]`.

## 7. caustic

- 더함: `node-graph`(`NodeGraph`, `GraphNode`, `GraphPort`, `GraphEdge`, `GraphDraft`). 포트 사이 선을 실제 점 위치에서 재고(CSS 배율·글꼴·크기 변화 추적), 선 상태 idle·done·active(흐르는 점선)·draft·invalid·muted와 점선, 선 가운데 이름표(캔버스 색 받침 `--graph-plate`), 노드 상태 idle·active·done·failed·invalid·dimmed와 selected, 변형 outline·solid·soft·ghost(놓을 곳), 포트 쪽 start·end·top·bottom과 상태 idle·connected·target·invalid·active·off. fixture 포함, catalog 항목과 기준 스냅숏은 아직 없습니다.
- 썼음: `GraphNode`·`GraphPort`·`NodeGraph`, `ZoomControl`(glass), `LayerTree`(compact 개요), `CodeRealization`, `SegmentedControl`, `Select`, `Button`, `Badge`, `Alert`, `Progress`, `ListDescription`, `Input`.
- 빈틈(시안 parts에 둠): 캔버스 호스트(맞춤 배율, 팬, 줌 상태, 투명 점 격자). `canvas-grid` 유틸리티는 `bg.canvas` 바탕색을 같이 칠해 DP-01과 맞지 않아 점 무늬만 따로 썼습니다. `canvas-hint`는 `Kbd`를 그려 DP-06과 부딪쳐 쓰지 않았습니다.

## 8. 새 원칙 제안

- DP-47 캔버스는 투명한 가운데 위의 점 격자 하나입니다. 캔버스 바탕색, 캔버스 테두리, 캔버스 카드를 두지 않습니다(DP-01). 캔버스 위에 뜨는 것은 줌 캡슐 하나와 그 상태의 Alert뿐입니다.
- DP-48 층은 캔버스의 열이나 띠로 나눕니다. 열 머리는 층 mono 열과 짧은 이름 하나(DP-31). 선은 포트끼리만 잇고, 층을 건너는 선만 그립니다.
- DP-49 캔버스 글자는 88% 밑으로 줄이지 않습니다. 맞춤이 그보다 작아야 하면 세로로 스크롤하고, 720px 이하에서는 같은 데이터를 개요 목록으로 보입니다.
- DP-50 tone은 캔버스에서도 아이콘 면, 포트 점, 선에만 줍니다. 실패 노드만 danger 면을 쓰고, 그 밖의 구간 표시(가드 구간 등)는 `neutral.well` 면입니다.
- DP-51 구성기는 런타임이 집행하지 않는 것을 그릴 때 그 자리에 "런타임에 없음" 배지를 답니다(사람 확인 노드, 핸들러 순서). 설계와 실제가 다른 곳을 숨기지 않습니다.

## 9. 미결

1. 구성기를 "구성"과 "만들기" 두 내비에 둘지, "구성" 하나로 합치고 "만들기"를 그 안의 새 그룹 동작으로 둘지.
2. 설치된 그룹(Helm)의 블록 분해를 누가 소유하는가: 그룹 작성자가 매니페스트 `composition`으로 선언(정확), 데스크톱이 훅 이름으로 추정(작성자 부담 없음).
3. 블록 쌓는 순서에 뜻을 줄지. 지금은 같은 훅 안 등록 순번뿐이고 다른 훅 사이에는 뜻이 없습니다.
4. 사람 확인(gate)을 drive 원시로 넣을지, 그룹이 post와 상태로 직접 만들게 둘지.
5. 테스트 실행 "멈춤"이 화면 갱신만 멈출지, 테스트 대화의 주도를 실제로 멈출지(테스트 대화 전용 wire).
