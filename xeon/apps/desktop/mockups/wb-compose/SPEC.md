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

크래프트 내비 "구성" 하나가 구성기를 엽니다(결정 C-6: "만들기"는 구성 안의 새 플러그인 그룹 동작이고 내비 항목이 아닙니다. 진입은 f01-compose-entry). 화면 머리(`WorkbenchHead`: 제목, 그룹 이름 한 단어, 설명 한 줄) 오른쪽에 주요 동작 하나(solid)와 `SegmentedControl` 하나가 있고, 컨트롤이 보기 넷을 바꿉니다: 그룹 · 흐름 · 프로필 · 코드. 머리 설명에는 개수·명령·사용법을 넣지 않습니다. 가운데는 투명한 캔버스(점 격자만, 바탕색 없음, DP-01)입니다. 캔버스 보기(그룹·흐름)는 머리와 캔버스 사이에 가로 경계선 하나를 긋고(`parts/rail.tsx`), 양 끝에 `+` 표식을 둡니다. 옛 언어 이식이라 세로 레일은 두지 않습니다. 왼쪽 패널은 크래프트 내비 그대로입니다. 블록 팔레트("블록")와 고른 블록의 상세("속성")는 오른쪽 well 탭입니다(받은 요청 다음, 기록·대화 앞).

### 2.1 그룹 쌓기 (보기 "그룹")

- 세 열이 층을 나눕니다. 열 머리는 caustic `SectionHeader`(짧은 이름 하나, 층 코드·개수 없음)입니다. 왼쪽 "이 맥락의 기능": 맥락 대화에서 기능을 주는 확장과 그 기능 포트. 가운데 "블록": 슬롯 블록을 쌓습니다. 그룹 이름과 읽기 전용·작성 중은 화면 머리가 말합니다. 오른쪽 "기록과 상태": 블록이 내는 것(공개 기록, 입력 큐, 상태 문서). 포트 이름은 사람이 읽는 말이고, 기록 종류 id는 코드 보기에만 둡니다.
- 블록 하나 = 그룹 안 코드 한 덩어리. 겉모양은 caustic GraphNode 기본 면(옛 언어: 면 + 1px 테두리 + 높이 1, 반지름 lg)입니다. 블록에는 이름, 왼쪽 소비 포트(기능 id), 오른쪽 출력 포트, 검사 문장만 둡니다. 아이콘·연산 표지·훅·fold·요약 줄은 블록에 그리지 않고, 훅은 well "속성"에서 봅니다.
- 선은 관련 있는 것만 그립니다: 고른 블록에 닿는 선과 검사에 걸린 선. 나머지 포트는 점만 남습니다. 점선으로 optional과 requires를 나누지 않습니다. 제공하는 확장이 꺼진 포트는 속이 빈 점입니다.
- 고른 블록만 고리(GraphNode `selected`)를 받습니다. 층 색으로 블록을 칠하지 않습니다.
- Helm 참고 구성의 블록 일곱: 신호 감지(`tool.execution.after` tap, `boundary.settle.after` tap, `stuck`/`repeat`/`newDomain` → pending, `grp.helm.signal.detected`, 제안 post), 렌즈 주입(`input.agent.before` collect, 6개 중 신호 순서로 `maxLenses` 3), 단계 머신(drive: diverge → explore → converge → apply, 턴 4 · spawn 8 · 토큰 400k, `loop.spawn explorer`), 쓰기 거부(`tool.call.before` first, 실패하면 거부, diverge·explore에서 main과 `subagent:explorer`), 지식 소비(converge에서 `web.search`, `knowledge.search/skills/memory` 읽기, 모두 optional, 출처별 저하), 발견 기록(`grp.helm.discovery.recorded`, `grp.helm.inquiry.finished`, `work.tasks` 멱등 쓰기), 상태 복원(`thread.start` tap).
- 검사(인라인): 블록 안 마지막 줄에 검사 문장 하나(실패는 danger 글자색, 경고는 warning 글자색). 검사 코드는 화면에 내지 않습니다. 실패 블록은 danger 면(caustic `GraphNode state="invalid"`), 관련 선은 danger 점선. 캔버스 바로 위에 `Alert tone="danger"` 한 문장으로 개수만 말합니다(DP-28). 아래 코드 이름은 구현 참고용입니다.
  - `drive_duplicate`: drive 블록이 둘 — "drive는 그룹마다 하나예요. 단계 머신에 상태로 합쳐요"
  - `on_capability_call`: on 핸들러 블록이 기능 포트에 이어짐 — on 핸들러는 기능을 부르지 않습니다(ADR-0015). first 훅이면 예외가 거부가 됩니다.
  - `capability_missing`: `requires` 기능에 이 맥락의 provider가 없음 — scope가 켜지지 않습니다(X.primitives §3.7 규칙 5).
  - 경고 `maxLenses > maxSpawns`: 렌즈 일부가 skipped가 됩니다(L3.helm §6).
- 빈 구성기: 그룹 이름 `Field` + `Input`(이름 규칙은 틀렸을 때 Field 오류로만)과 "블록을 여기에 쌓아요" 놓을 곳(caustic `EmptyState`, 점선, 그림 없음), 같은 무게의 시작점 넷(Helm 복제, 진행·정책·관찰 템플릿, outline). 기능 열은 흐리게 보여 이 맥락에서 쓸 수 있는 기능을 미리 알립니다.

### 2.2 흐름 캔버스 (보기 "흐름")

- drive 블록의 단계 머신을 위에서 아래로 그립니다. 노드 = 커밋된 phase 하나이고 이름은 한국어 단계 이름입니다(대기 · 확산 · 탐색 · 수렴 · 적용, p05-helm과 같은 말). 선 = 전이이고 이름표를 달지 않습니다. 전이 이벤트 이름, ◇ 단계 경계 표지, 캔버스 머리의 설명 줄과 주도 상한 줄은 두지 않습니다.
- 탐색은 렌즈마다 자식 노드로 펼치고 "모으기" 노드에서 합칩니다. 렌즈 노드에는 이름만 둡니다(렌즈 id·아이콘 없음).
- 노드에 주도 소모 숫자(턴·spawn)와 효과 줄을 두지 않습니다. 노드 겉모양은 그룹 블록과 같습니다(GraphNode 기본 면, 고른 노드만 고리).
- 쓰기 거부 구간: 가드가 켜지는 단계(확산, 탐색과 그 자식)를 덮는 연한 면 하나와 왼쪽 위 이름 "쓰기 거부" 한 마디.
- 오른쪽 "끝" 노드: 결과 다섯(적용함, 멈춤, 한도, 실패, 발견 없음)이 입력 포트입니다. 단계의 나가는 길(끝으로 가는 점선)은 고른 단계에만 포트와 선을 그립니다.
- 편집: 팔레트(well "블록")의 노드 종류(단계, 모델 턴, 자식 펼치기, 모으기, 기능 읽기, 사람 확인, 기록·post, 끝)를 끌어 놓고 포트를 끌어 잇습니다. 끄는 동안 초안 선(점선, tone 색)과 받을 수 있는 포트만 커집니다(`GraphPort state="target"`). 연결을 떼면 아래 노드가 흐려집니다.
- 사람 확인(gate) 노드에는 배지를 달지 않습니다. drive는 `loop.ask`로 답을 기다리며 그동안 drive lock(주도)을 잠시 내려놓습니다(ADR-0022 §3.5 5번, X-17). 옛 "런타임에 없음" 배지는 뺐습니다(f01-compose-entry와 같음).

### 2.3 프로필 쌓기 (보기 "프로필")

- 지금 값과 프로필 값을 견주는 선 격자 하나(`LineGridBlock`): 층 · 확장 · 지금 · 프로필 · 적용 뒤. 층 칸(외부 훅, 그룹, 플러그인, 기능, 코어; 층 코드 없음)이 그 층의 행을 묶습니다. 프로필 칸은 켜기·끄기·그대로(`SegmentedControl` xs). "그대로"는 enable·disable 어디에도 넣지 않습니다(§6.28 그대로). 코어는 "끌 수 없어요" 한 마디만. tier·훅 메타는 행에 두지 않습니다.
- 바뀌는 행만 "적용 뒤" 칸을 soft 채움과 진한 글자로 보입니다. 프로필 고르기 `Select`는 화면 머리 동작 자리에 둡니다.
- 순서가 뜻을 가지는 곳만 끌어 옮깁니다.
  - 주도 칸: 한 그룹 또는 자동입니다. 그룹 칩 하나(`Chip` outline), 후보는 옆에(꺼진 후보는 취소선). 바꾸면 다음 경계에 지금 주도를 회수합니다(group-sdk §3.5). 설정 키 이름과 설명 문장은 화면에 내지 않습니다.
  - 막기 순서: (tier, loadIndex, 등록 순번). tier는 바꿀 수 없고 같은 tier 안에서만 옮깁니다. 칩만 화살표로 잇고(tier 이름표 없음), 구역 머리 동작 자리에 "런타임에 없음" 배지(neutral outline)를 답니다(§6 간극 5).
- 주도와 막기 순서는 격자 아래, 경계선 하나 뒤에 나란히 둡니다.
- 맨 위 "실효 스택"(지표 칸 셋, `LineGridMetric`): 맥락 대화의 지금 값과 프로필을 합친 결과(바뀌는 확장 수, 주도, 렌즈 수). 켜지는 훅 수와 설정 키 이름, 꼬리 설명은 두지 않습니다. 구역 머리 동작: 이 대화에 적용(유일한 solid, `settings.set { scope: "session" }` 여러 번, 하나라도 실패하면 되돌림), 테스트 대화로, 저장(둘 다 outline).

### 2.4 테스트 실행 (흐름 보기의 상태)

- 흐름 머리의 "테스트 대화에서 돌려 보기" → 테스트 대화를 만들고 그룹을 켠 뒤 같은 캔버스가 실행 보기로 바뀝니다.
- 캔버스 위 한 줄: 테스트 대화와 경과, 멈춤·이어서, 한 경계씩, 다시 돌려 검사, 테스트 결과(모두 outline). 주도 사용량 막대와 숫자는 두지 않습니다.
- 지금 단계 노드는 tone 고리, 지난 단계는 흐린 이름, 아직 안 온 단계는 55% 불투명. 돌고 있는 렌즈는 흐르는 점선, 실패 렌즈는 danger 면, 끝난 렌즈는 발견 수 하나. 도구 호출 줄은 두지 않습니다.
- 가드 발화: 쓰기 거부 구간 이름 아래 "1번 막았어요" 한 줄. 오른쪽 "기록" 열(caustic `Timeline`, 새것이 위)이 주도·단계·막음 사건을 사람이 읽는 말과 시각으로 보입니다(이벤트 이름 없음).
- "다시 돌려 검사"는 이 테스트 대화의 테이프로 P-19 replay를 엽니다. "테스트 결과"는 P-19 그 행.

### 2.5 코드 보기 (보기 "코드", 읽기 전용)

- 세 열: 블록 목록(그룹 머리 포함, caustic `ListNavigation`, 아이콘·연산 표지 없음) · 만들 파일 10개(drive 템플릿 `group-sdk/templates/index.json` 그대로, 점선으로 나눈 글줄, 그 위에 단계 블록 → 매니페스트 → 뼈대 → 검사를 글자로) · 고른 파일의 생성 결과(`src/index.ts`, `plugin.json`).
- 블록을 고르면 그 블록에서 나온 파일만 진하게, 코드 줄은 soft 면(색 없음)으로 보입니다. 줄 옆 블록 아이콘 홈, 파일별 추가 줄 수, "읽기 전용" 안내 줄은 두지 않습니다.
- 보기 전용입니다. CLI는 제품 화면이 아니므로 명령을 내거나 복사하지 않습니다. 만들기 동작은 이 보기에 두지 않습니다(§6 간극 2).

## 3. 상태

| id | 보기 | 내비 | 보이는 것 |
|---|---|---|---|
| S1 | 그룹 | 구성 | Helm 참고 구성, 단계 머신 블록 고름, well 닫힘 |
| S2 | 그룹 | 구성 | 빈 구성기, well "블록" 팔레트 열림 |
| S3 | 그룹 | 구성 | lens-review 검사 실패 3 + 경고 1, 캔버스 위 Alert |
| S4 | 흐름 | 구성 | Helm 단계 머신, 쓰기 거부 구간, 끝 노드 |
| S5 | 흐름 | 구성 | lens-review 편집: converge 다음 포트를 사람 확인 노드로 끄는 중. 왼쪽 패널 닫음, well 팔레트 |
| S6 | 흐름 | 구성 | Helm 테스트 실행: explore 진행 중, 렌즈 셋(돎·끝남·실패), 가드 발화, 경계 기록 |
| S7 | 프로필 | 구성 | 프로필 "탐구 중심" 쌓기, 실효 스택 |
| S8 | 코드 | 구성 | lens-review 뼈대, 단계 머신 블록의 줄 강조 |

- 폭: 1280은 캔버스를 폭에 맞추고 높이는 88% 밑으로 줄이지 않고 세로 스크롤합니다. 1000(medium)은 폭 맞춤으로 약 70%까지 줄이고 줌 캡슐로 키워 팬합니다. 720 이하(compact)는 캔버스 대신 개요 편집기입니다: 그룹은 caustic `LayerTree`(블록 → 기능·출력, 끌어 옮기면 쌓는 순서, 검사 코드 표지 없음), 흐름은 caustic `List`(단계 이름 + 다음 단계 한 줄). 프로필·코드는 한 열로 접힙니다.
- 오류·빈·읽는 중: 검사 실패는 S3. 빈은 S2. 읽는 중은 provider·출력 열 자리에 `Skeleton`(시안에 없음). 오프라인이면 적용·테스트 외 동작을 잠급니다.

## 4. 상호작용

- 블록·노드 누름 → 고름(잉크 고리). well "속성"이 머리(`PageSection` group, 블록 이름) 아래 블록 자리, 훅, 기능과 제공하는 확장, 검사를 `ListDescription`으로 보입니다. 연산·fold·코드 위치는 내지 않습니다. 고른 것이 없으면 `EmptyState` 한 줄입니다.
- 팔레트(well "블록", caustic `List`, 이름만, 설명·아이콘·연산 표지 없음) 행 끌기 → 그룹 열에 쌓기 또는 흐름 캔버스에 놓기. 그룹 열에서 블록을 위아래로 끌면 쌓는 순서가 바뀌고(뜻은 코드의 등록 순번, 같은 훅 안 순서만 바뀜), 이 사실을 놓을 때 한 줄로 알립니다.
- 포트 끌기 → 초안 선. 맞는 포트만 target으로 커지고 나머지는 흐려집니다. 맞지 않는 쌍(on 핸들러 ↔ 기능, 출력 ↔ 출력)은 놓으면 검사 줄을 남깁니다.
- 줌 캡슐: 줄이기·키우기, 숫자 누르면 맞춤으로.
- "복제해서 고치기" → 구성 안에서 lens-review(작성 중)로 같은 블록을 가져옵니다.
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
2. **블록 → 코드 생성 경로 없음.** 지금 뼈대 만들기는 템플릿 복사와 치환 셋(`__ID__`, `__TITLE__`, `__VERSION__`)만 합니다(L3.slots §3.3.6 R5). 블록에서 `points`·`optional`·`recordKinds`와 `setup` 등록 줄을 채우려면 `ext.scaffold { template, name, dir, composition }` `[gap:W-27]`과 그 뒤 패치 단계가 필요합니다.
3. **구성 검사 코드 부족.** F `validateManifest`·`validateUsage`에 `drive_duplicate`(scope당 `g.drive` 둘), `on_capability_call`(on 핸들러의 기능 호출, 지금은 ADR-0015 규칙뿐이고 정적 검사가 없음)이 없습니다. `capability_missing`은 런타임에서 scope가 안 켜지는 것으로만 드러납니다. 제안: 클라이언트가 부를 수 있는 `ext.validateComposition` wire.
4. **drive 안 사람 확인 원시 없음.** `loop.turn`·`loop.spawn`·`post`·`commit`만 있습니다. 승인 대기는 post + 다음 경계 재호출로 흉내 낼 수 있지만 주도를 쥔 채 기다리는지, 반납하는지 정해지지 않았습니다(X.primitives §4.4). 제안: `loop.ask({ requestId, card })` 또는 `pending` 상태 + `lifecycle` 훅.
5. **핸들러 순서 입력 없음.** 순서는 (tier, loadIndex, 등록 순번)이고 loadIndex는 로더 순서입니다(X.operations §3.1). 프로필에서 같은 tier 안 순서를 바꾸려면 `x.operations.loadOrder` 같은 설정이 필요합니다. 없으면 순서 칸은 보기 전용으로 둡니다.
6. **일반 drive 그룹의 단계 머신 선언 없음.** Helm만 `TRANSITIONS`를 export합니다. 흐름 캔버스를 다른 그룹에 쓰려면 매니페스트나 group-sdk에 `phases`/`transitions` 선언(상태 스키마의 phase 유니온과 전이표)을 둡니다.
7. **테스트 실행 단계별 진행 이벤트.** 상태 문서는 비공개라 phase를 바깥에서 읽을 수 없습니다(F.extensions §3.6). 테스트 대화에 한해 `grp.<id>.state.committed`의 `phase`만 노출하는 진단 투영 `[제안]`이 필요합니다. "한 경계씩"은 테스트 대화 전용 `trial.step` wire `[gap:W-34]`.
8. **provider 해석 view-model.** 기능 id → 이 맥락에서 그 기능을 주는 확장(꺼짐 포함)을 한 번에 주는 wire가 없습니다 `[gap:W-15]`.

## 7. caustic

- 더함: `node-graph`(`NodeGraph`, `GraphNode`, `GraphPort`, `GraphEdge`, `GraphDraft`). 포트 사이 선을 실제 점 위치에서 재고(CSS 배율·글꼴·크기 변화 추적), 선 상태 idle·done·active(흐르는 점선)·draft·invalid·muted와 점선, 선 가운데 이름표(캔버스 색 받침 `--graph-plate`), 노드 상태 idle·active·done·failed·invalid·dimmed와 selected, 변형 outline·solid·soft·ghost(놓을 곳), 포트 쪽 start·end·top·bottom과 상태 idle·connected·target·invalid·active·off. fixture 포함, catalog 항목과 기준 스냅숏은 아직 없습니다.
- 썼음: `GraphNode`·`GraphPort`·`NodeGraph`, `ZoomControl`(glass), `SectionHeader`(열 머리, `_shell/page` 거쳐), `LayerTree`(compact 개요), `List`·`ListRow`, `ListNavigation`, `Timeline`, `Chip`, `LineGridBlock`·`LineGridCell`·`LineGridMetric`·`LineGridMark`, `EmptyState`, `Field`, `SegmentedControl`, `Select`, `Button`, `Badge`, `Alert`, `ListDescription`, `Input`.
- 빈틈: 없습니다. 옛 언어의 `GraphNode` 기본 면을 그대로 쓰고, `parts/canvas.tsx` `blockClass`는 간격과 제목 글자만 줍니다. `CodeRealization`은 내려받기 단추가 필수이고(`downloadLabel`, 늘 그림) 끝난 단계에 success 색 체크를 써서(중립 변형 없음) 코드 보기는 토큰으로 직접 그렸습니다.
- 빈틈(시안 parts에 둠): 캔버스 호스트(맞춤 배율, 팬, 줌 상태, 투명 점 격자). `canvas-grid` 유틸리티는 `bg.canvas` 바탕색을 같이 칠해 DP-01과 맞지 않아 점 무늬만 따로 썼습니다. `canvas-hint`는 `Kbd`를 그려 DP-06과 부딪쳐 쓰지 않았습니다.

## 8. 새 원칙 제안

- DP-47 캔버스는 투명한 가운데 위의 점 격자 하나입니다. 캔버스 바탕색, 캔버스 테두리, 캔버스 카드를 두지 않습니다(DP-01). 구성 편집 캔버스이고 런타임 지도가 아니므로 지도 보기·미니맵은 두지 않습니다. 캔버스 위에 뜨는 것은 줌 캡슐 하나뿐이고, 상태 Alert는 캔버스 바로 위 줄에 둡니다.
- DP-48 층은 캔버스의 열로 나눕니다. 열 머리는 `SectionHeader`의 짧은 이름 하나입니다(층 코드·개수 없음). 선은 포트끼리만 잇고, 고른 블록의 선과 검사에 걸린 선만 그립니다.
- DP-49 캔버스 글자는 88% 밑으로 줄이지 않습니다. 맞춤이 그보다 작아야 하면 세로로 스크롤하고, 720px 이하에서는 같은 데이터를 개요 목록으로 보입니다.
- DP-50 캔버스는 중립입니다. 층 색·아이콘 면을 쓰지 않고, 고른 블록 고리와 주요 동작은 잉크이고, 의미 색은 실패 노드(danger 면)·검사 문장·실패 선에만 줍니다. 구간 표시(가드 구간 등)는 옅은 중립 면입니다.
- DP-51 구성기는 런타임이 집행하지 않는 것을 그릴 때 그 자리에 "런타임에 없음" 배지(neutral outline)를 답니다(핸들러 순서. 사람 확인 노드는 `loop.ask`가 생겨 뺐습니다). 설계와 실제가 다른 곳을 숨기지 않습니다.

## 9. 미결

1. (결정됨: "구성" 하나로 합치고 "만들기"를 그 안의 새 그룹 동작으로 둡니다.)
2. 설치된 그룹(Helm)의 블록 분해를 누가 소유하는가: 그룹 작성자가 매니페스트 `composition`으로 선언(정확), 데스크톱이 훅 이름으로 추정(작성자 부담 없음).
3. 블록 쌓는 순서에 뜻을 줄지. 지금은 같은 훅 안 등록 순번뿐이고 다른 훅 사이에는 뜻이 없습니다.
4. (결정됨: `loop.ask`가 사람 확인 원시입니다.)
5. 테스트 실행 "멈춤"이 화면 갱신만 멈출지, 테스트 대화의 주도를 실제로 멈출지(테스트 대화 전용 wire).
