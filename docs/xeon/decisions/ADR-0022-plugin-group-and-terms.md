---
id: adr.0022
layer: adr
domain: plugin-group-terms
kind: adr
status: draft
depends_on: [adr.0007, adr.0016, adr.0017, adr.0018, adr.0019, adr.0021, architecture.overview.spec, architecture.layers.spec, F.extensions.spec, F.conversation.spec, F.records.spec, F.capabilities.spec, F.wire-settings.spec, X.primitives.spec, X.loading-trust.spec, X.operations.spec, L0.process.spec, L0.secrets.spec, L1.loop.spec, L2.schedule.spec, L3.group-kit.spec, L3.authoring.spec, L4.desktop-ux.spec, eng.operations.glossary]
binds: [xeon/packages/contracts/src/extensions/**, xeon/packages/contracts/src/conversation/**, xeon/packages/ext-host/**, xeon/packages/group-kit/**, xeon/packages/client/**]
---

# ADR-0022 플러그인 그룹 모델과 도메인 용어 정리

## 1. 상태와 날짜

- 상태: proposed(제안). 문서 검사(`docs-route`)의 상태 값에 proposed가 없어 프런트매터는 draft로 둡니다. 사용자가 §3.2를 확인하면 accepted로 올립니다.
- 날짜: 2026-11-01
- 근거 문서:
  - `_notes/domain-terms-review-2.md`(이하 "리뷰 2") §13 결정 목록. 저장소 밖 메모입니다.
  - `_notes/m4-decisions.md` "2026-11-01 user decisions (2)·(3)·(4)"
- [결정: 2026-11-01 사용자] 리뷰 2 §13의 1~12번 제안을 승인합니다. 다만 §4.2(플러그인 그룹, scope, drive)는 설명을 더 들은 뒤 정합니다.
- [결정: 2026-11-01 사용자] 리뷰 2 §13 13번(작업대 이름)은 **Bench**입니다. 상표 확인은 남아 있습니다.
- [결정: 2026-11-01 사용자] 이름은 두 단계로 둡니다. 기계 id(코드, wire, 저장 문자열)와 표시 이름(문서 용어, 화면 라벨 ko·en, 도움말 한 줄)을 따로 두고, 화면 라벨이 더 정확한 곳만 골라서 id까지 맞춥니다(선택적 통일).
- [결정: 2026-11-01 사용자] 제품 이름은 Fresnel(프레넬)입니다. 이 ADR의 용어는 제품 이름과 함께 바꿉니다. 바꾸는 순서와 범위는 별도 계획(이름 변경 계획)을 사용자가 승인한 뒤 정합니다.
- 이 ADR은 이름과 모델만 정합니다. 코드와 문서 변경은 사용자 승인 뒤 이름 변경 트랙에서 합니다(§4.3).

## 2. 맥락

- 지금 확장은 설치 단위이고 종류가 `plugin`과 `group` 둘입니다(`F.extensions.spec` §2, 매니페스트 `kind`). 그룹은 L3 전용 확장 하나이고, 여러 플러그인의 묶음이 아닙니다. 사용자는 "묶음은 그룹, 하나는 플러그인"으로 이해했습니다(리뷰 2 §4.1).
- `scope`가 두 뜻으로 쓰입니다. 확장 하나가 엔진에 등록한 것 전체(`X.primitives.spec` §4.5)와 설정 범위(`F.wire-settings.spec`)입니다.
- "임대"가 세 가지에 쓰입니다. `sys_leases`의 프로세스 간 자원 잠금(`L0.process.spec`), 예약 틱을 돌릴 프로세스 선출(실행권), 한 대화 안의 drive 임대(`X.primitives.spec` §4.4)입니다.
- "세션"은 CLI가 쓰던 화면 이름이고 코드는 처음부터 `thread`입니다. CLI는 제품 표면에서 빠졌습니다(사용자 결정 2026-11-01).
- "turn"은 pi와 OpenAI Agents SDK에서 모델 호출 1번을 뜻하기도 해서 우리 정의(입력 하나에 대한 작업 전체)와 계속 헷갈립니다.
- 용어집(`eng.operations.glossary`)에 M4 용어 20여 개가 없고, 정의가 문서마다 어긋나는 곳이 있습니다(그룹, fold 개수).
- 용어 정적 검사(term lint)를 설계했습니다(`_notes/i18n-term-lint-design.md`). 0단계는 용어 원본 파일과 원본 자체 검사이고, 용어 내용과 상관없이 시작할 수 있습니다.

## 3. 결정

### 3.1 용어 정책

1. [결정: 2026-11-01 사용자] 개념마다 기계 id, 문서 용어, 화면 라벨 ko·en, 도움말을 둡니다. 화면 라벨은 기계 id를 대신하지 않습니다. 작업대(Bench)에서는 라벨 옆에 id를 회색 mono로 붙입니다.
2. [결정: 2026-11-01 사용자] 선택적 통일: 아래 경우에만 기계 id를 문서 용어에 맞춥니다.
   - 같은 말이 두 뜻으로 쓰여 코드에서도 헷갈리는 경우(scope, lease, session, loop)
   - 업계 표준 이름과 어긋나 읽는 사람이 계속 틀리는 경우(turn → Run, point → Hook)
   - 비유어나 직역어(소켓, 내구, 원장, 슬롯)
3. [제안] 저장 문자열은 따로 다룹니다. 사용자 데이터에 남는 값(이벤트 kind `turn.*`·`scope.changed`·`lease.*`, id 접두 `trn_`, 테이블 이름 `sys_leases`)은 이 ADR에서 바꾸지 않습니다. 바꾸려면 L1 저장 마이그레이션이 필요하므로 이름 변경 계획에서 따로 묻습니다.
4. [결정: 2026-11-01 사용자] 용어 원본은 한 곳에 둡니다. 원본에서 i18n 카탈로그의 `term.*` 키, 용어집 표, 목업 용어 파일을 생성하고, 검사가 나머지 문자열을 대조합니다(§4.4).

### 3.2 플러그인 그룹 모델 [미결: 사용자 확인 대기]

리뷰 2 §4.2와 §13 3번입니다. 2026-11-01 사용자가 추가 설명을 요청했고, 아래는 그 설명을 담은 제안입니다. 사용자 확인 전에는 코드와 문서를 바꾸지 않습니다.

#### 3.2.1 확장, 플러그인, 플러그인 그룹 [미결: 사용자 확인 대기]

```
Extension (확장)    = 설치·배포 단위 = manifest + 플러그인 1개 이상
 ├─ Plugin (플러그인): 한 층에 속하는 단일 기능 단위
 │    예) L0 시크릿 제공자, L1 모델 라우터, L2 web provider, L3 오케스트레이터
 └─ Plugin Group (플러그인 그룹): 여러 층의 플러그인을 묶어 한 번에 켜고 끄는 단위
      예) Helm = L3 오케스트레이터 + L2 탐색 기능 + 훅 몇 개 + 화면
Profile (프로필)    = 켤 플러그인·플러그인 그룹 목록 + 각 설정 값을 이름 붙여 저장한 것
```

- 계약 변경: F 매니페스트 `kind: "plugin" | "group"`을 `plugins[]`와 선택적 `group` 선언으로 바꿉니다.
- 화면의 "플러그인 그룹"은 이 묶음을 뜻합니다. Helm, 학습은 플러그인 그룹입니다.

#### 3.2.2 Registration (지금 이름 scope) [미결: 사용자 확인 대기]

`scope`를 **Registration**(등록)으로 바꿉니다. 엔진 내부 개념이며 화면에 쓰지 않습니다.

- `host.scope()`(바꾼 뒤 이름은 §3.6 표)는 정의만 등록합니다. setup은 처음 켜질 때 한 번 실행되고, 그 세대(generation)를 모든 thread가 함께 씁니다.
- 켜짐 상태는 thread마다 둡니다. 전역 켜기는 새 thread의 기본값을 정합니다.
- 새 대화는 setup을 다시 실행하지 않고 곧바로 묶입니다. 그 대화의 상태 문서만 준비합니다.
- 실행 중에 전역으로 또는 대화 하나에서 끌 수 있습니다. 유휴이면 바로, 실행 중이면 다음 단계 경계에서 적용합니다.
- 끄면 다음 순서로 처리합니다.
  1. 핸들러를 빼고, drive lock이 있으면 반납합니다.
  2. `scope.changed`를 기록합니다.
  3. 어느 thread도 쓰지 않으면 정리(cleanup)를 실행합니다.
  4. 이미 큐에 들어간 post 항목은 그대로 전달됩니다.
- 자동으로 꺼지는 경우: 실패 횟수 상한을 넘을 때(`X.operations.spec` 자동 끄기), setup이 실패할 때, 안전 모드일 때입니다.
- 이 동작은 지금 `X.primitives.spec` §4.5와 같습니다. 바뀌는 것은 이름입니다.

#### 3.2.3 drive 넓히기 [미결: 사용자 확인 대기]

- drive 함수는 연출자 역할을 하는 플러그인 코드입니다. 별도 모델 루프를 띄우지 않습니다.
  - drive lock을 받을 때 마지막 커밋 상태를 들고 한 번 불리고, 이후 turn(바꾼 뒤 Run)이 정착할 때마다 다시 불립니다.
  - `loop.turn`은 같은 thread에서 사용자에게 보이는 보통 Run을 하나 실행합니다.
  - `loop.spawn`은 하위 thread(Subthread)에서 격리된 서브에이전트를 실행합니다.
  - 요청 id로 재생에 안전합니다(ADR-0015). Drive limits 안에서만 실행합니다.
  - 반납 조건은 유휴 연속, 오류, 한도 소진, 끄기, `ask`입니다.
- 드라이버가 없으면 L1 기본 루프가 평소처럼 응답합니다.
- 넓히기: L3 그룹 외의 플러그인도 매니페스트에 `drives`를 선언할 수 있습니다. 허용 여부는 정책 `drive_requires_group`이 정합니다. 지금은 `kind`가 `group`이 아니면 항상 `drive_requires_group` 오류입니다(`X.primitives.spec` §4.4.1).
- [제안] 정책의 기본값은 "그룹만 허용"으로 두고, 설정으로 풉니다. 설정 키 이름은 F가 정합니다.
- 한 thread에 drive lock은 하나뿐이라는 규칙(ADR-0007 §3.6)은 그대로입니다.

#### 3.2.4 이 절이 accepted가 되면 바뀌는 것

- ADR-0007 §3.6과 `X.primitives.spec` §4.4.1의 "drive는 그룹만"을 부분 대체합니다(`adr.readme` §1.4 부분 번복). ADR-0007 상태 절에 한 줄을 더합니다.
- `L3.group-kit.spec`의 `DriveArbiter` 후보 정의가 "drive를 선언한 플러그인"으로 넓어집니다.
- 설정 `x.primitives.activeDriveGroup`의 이름(§3.6 표)이 함께 바뀝니다.

### 3.3 적용 범위와 신뢰

1. [결정: 2026-11-01 사용자, 리뷰 2 §13 4번] 프로필과 켜짐 상태는 전역 → 프로젝트 → 대화 순서로 덧씌웁니다.
   - 전역: 내 기본 프로필
   - 프로젝트: 이 폴더에서만 켜는 플러그인 그룹, 이 폴더의 기본 프로필. 이 층은 새로 생깁니다.
   - 대화: 이 대화에서만 끄거나 켠 것, 이 대화에 적용한 프로필
2. [결정: 2026-11-01 사용자, 리뷰 2 §13 4번] 화면은 덧씌운 결과만 보여 주고, 항목마다 출처 배지(전역 / 프로젝트 / 이 대화)를 붙입니다.
3. [결정: 2026-11-01 사용자, 리뷰 2 §13 4번] 신뢰(trust)는 덧씌우기와 별개인 일회성 관문입니다. 프로젝트 폴더가 가져온 플러그인 코드가 있을 때만 한 번 묻습니다(`X.loading-trust.spec`). 신뢰 등급 넷(내장 / 사용자 설치 / 이 프로젝트 / 신뢰 안 함)은 출처 배지로만 보입니다.
4. [결정: m4-decisions 2026-10-31 UX 5번] 프로필은 데스크톱보다 낮은 층(호스트 설정)에 저장하고 데스크톱·웹·앱이 호스트를 거쳐 함께 씁니다.
5. [미결: 사용자 확인 대기] 덧씌우기 결과를 Registration의 thread별 켜짐 상태(§3.2.2)로 옮기는 규칙. §3.2와 함께 정합니다.

### 3.4 Hook, fold, post

1. [결정: 2026-11-01 사용자, 리뷰 2 §13 5번] 지점(point)을 **Hook**(훅)으로 부릅니다. 정확한 정의는 "런타임 생애주기 훅"입니다. `thread`·`lifecycle` 종류 훅은 루프 밖(대화 생성, 확장 켜짐)에서도 발화합니다. 핸들러는 **Hook handler**입니다.
2. [결정: 2026-11-01 사용자, 리뷰 2 §13 5번] fold 이름 `tap`, `first`, `chain`, `collect`는 그대로 둡니다. fold는 훅의 성질이고 플러그인이 고르지 않습니다. webpack tapable과의 대응은 다음과 같습니다.

| fold | tapable | 하는 일 |
|---|---|---|
| `tap` | SyncHook / AsyncParallelHook | 모두에게 알리고 결과는 무시합니다(관찰) |
| `first` | BailHook | 처음 결정을 낸 핸들러가 이깁니다(막기·허용) |
| `chain` | WaterfallHook | 값을 차례로 넘기며 고칩니다(수정) |
| `collect` | 대응 없음 | 각자 낸 조각을 모읍니다(예: 시스템 프롬프트 조각) |

3. [결정: 2026-11-01 사용자, 리뷰 2 §13 6번] 훅 종류 `session`은 `thread`로 바꿉니다. 훅 이름 `session.*`은 `thread.*`가 됩니다.
4. post 이름과 `when` 세 값(`steer`, `followUp`, `next`)은 그대로 둡니다(ADR-0013). 화면 라벨은 [제안]입니다(§3.6 표).

### 3.5 대화 모델과 나머지 이름

1. [결정: 2026-11-01 사용자, 리뷰 2 §13 6번] 대화 모델은 **Thread → Run → Step → Item**입니다.
   - Thread: 코드·문서는 Thread, 화면은 "대화"입니다. 남은 "session" 쓰임은 정리합니다. 설정 범위 `session`은 `launch`(이번 실행), 프로세스 락 키 `session:<threadId>`는 `thread:<threadId>`, 훅 종류 `session`은 `thread`가 됩니다. pi 원문 인용만 예외입니다.
   - Run: 지금의 turn입니다. 입력 하나를 받아 에이전트가 다 끝낼 때까지입니다. 모델 호출이 여러 번일 수 있습니다. OpenAI Assistants의 Run과 같습니다.
   - Step: 모델 호출 1번과 그 호출이 부른 도구 결과입니다. 이름은 그대로입니다.
   - Item: 대화 기록에 쌓이는 낱개입니다. 이름은 그대로입니다. [미결] 리뷰 2 §8.3은 Entry를 첫 후보로 적었습니다. 오케스트레이터 전달은 Item 유지이므로 사용자 확인이 한 번 더 필요합니다.
2. [결정: 2026-11-01 사용자, 리뷰 2 §13 7번] **Input Queue**(대화에 들어갈 입력 대기열)와 **Task Queue**(L2 work의 작업 목록)를 나눠 부르고 화면에서도 구분합니다.
3. [결정: 2026-11-01 사용자, 리뷰 2 §13 8번] 영어 원어를 문서 용어로 씁니다: Active branch, Compaction checkpoint, Subthread, Durable event / Ephemeral event, Projection, Content store(blob은 코드에만), Knowledge history.
4. [결정: 2026-11-01 사용자, 리뷰 2 §13 9번] 잠금 이름을 나눕니다.
   - **Process lock**: 여러 프로세스 중 하나만 자원을 쥐게 하는 잠금(`sys_leases`, epoch 펜싱)
   - **Scheduler leader**: 예약 틱을 돌릴 프로세스 하나
   - **Driver**: 한 대화에서 지금 진행을 맡은 플러그인. 메커니즘 이름은 **drive lock**
   - **Drive limits**: 드라이버가 쓸 수 있는 Run·서브에이전트·토큰 한도
   - "~권"(실행권, 진행권)은 모두 없앱니다.
5. [결정: 2026-11-01 사용자, 리뷰 2 §13 6번·12번] **Question**(질문)은 `loop.ask`와 승인 종류 `question`을 같은 개념으로 묶은 이름입니다(ADR-0018). 드라이버가 물으면 drive lock을 잠시 내려놓는다는 규칙만 붙습니다(m4-decisions Canvas 8번).
6. [결정: 2026-11-01 사용자, 리뷰 2 §13 12번] 나머지 이름:
   - **Display name**(디스플레이 네임): 매니페스트 `displayName`
   - **Test run**(테스트): 실제 대화에 영향 없는 격리 대화. 지금 이름은 trial(시험 실행, 시험 대화)입니다.
   - **Trace**(트레이스): 한 번의 Run 동안 어떤 플러그인이 어느 훅에서 무엇을 했는지의 시간순 기록. 지금 이름은 턴 재생입니다.
   - **Plugin UI**(플러그인 UI)와 **Placement**(표시 위치): ADR-0021의 화면 기여(`views`)와 slot입니다.
   - **Native UI**(기본 UI)와 **Plugin App**(플러그인 앱): ADR-0021의 선언형 모드와 프레임 모드입니다.
   - **Plugin Builder**(플러그인 빌더): 대화로 플러그인을 만드는 플러그인. 지금 이름은 제작 확장(authoring)입니다.
   - **Group SDK**와 **Stages**(trigger, fan-out, fan-in, apply): 지금 이름은 group-kit과 슬롯입니다.
7. [결정: 2026-11-01 사용자, 리뷰 2 §13 10번] L2는 **Capability**(기능, 인터페이스 단위)와 **Provider**(구현체)로 부릅니다. "웹 provider"는 "web 기능의 provider"로 부릅니다.
8. [결정: 2026-11-01 사용자, 리뷰 2 §13 11번] **Schedule**(예약)로 통일합니다. 종류는 한 번(`once`)과 반복(`recurring`)입니다. "루프", "timer"는 없앱니다. 시크릿 계열은 **Secret**, **Secret ref**(`secret://`), **Secret registry**(시크릿 목록 파일), **Injection mode**(주입 방식: 환경 변수, 플레이스홀더 치환, HTTP 프록시, 브라우저 입력)입니다.
9. [결정: 2026-11-01 사용자, 리뷰 2 §13 1번] 층 이름은 L0 **System**, L1 **Agent Core**, L2 **Capabilities**, L3 **Orchestration**, L4 **Apps**, F **Contracts**, X **Extension Runtime**입니다. 층 코드(`L1` 등)는 문서와 의존 규칙에 남깁니다. [미결] 화면에 층 숫자를 남길지는 사용자가 정합니다.
10. [결정: 2026-11-01 사용자, 리뷰 2 §13 2번] 엔진과 호스트 이름(리뷰 2 §3.3):
    - Engine: 그대로. X + L0 + L1을 조립한 라이브러리입니다.
    - **Runtime Server**(런타임 서버): 지금의 호스트. 엔진을 품고 프로세스로 실행되며 요청을 받습니다. X의 확장 호스트(ext-host)와 겹치지 않게 바꿉니다.
    - **Runtime API**(런타임 API): 지금의 호스트 계약(wire). F 계약과 헷갈리지 않게 프로토콜 이름으로 부릅니다.
    - Transport: 그대로.
    - **Background service**(백그라운드 서비스): 지금의 서비스 모드
    - **Embedded**(앱 내장): 지금의 사이드카. 화면은 "이 컴퓨터(앱 안)"입니다.
11. [결정: 2026-11-01 사용자 (4)] 작업대의 이름은 **Bench**입니다.
12. [결정: 2026-11-01 사용자, 리뷰 2 §13 11번] 용어집을 플랫폼 용어(Fresnel)와 플러그인 그룹 용어(Helm, 학습) 두 절로 나눕니다. 렌즈 같은 말은 Helm 화면 안에서만 씁니다.

### 3.6 이름 대응표

- 열의 뜻: 지금 id는 코드·wire·설정의 현재 문자열입니다. 새 id는 바꾼 뒤의 코드 이름입니다. "그대로"는 바꾸지 않습니다. "저장 유지"는 §3.1 3번에 따라 저장 문자열을 두고 코드 이름만 바꿉니다.
- 표지: 줄 끝 [미결]은 §3.2 확인 대기, [제안]은 작성자 제안입니다. 표지가 없는 줄의 개념과 문서 용어는 [결정: 2026-11-01 사용자]입니다. 화면 라벨은 사용자가 `ui-terms-guide.md`를 검토 중이므로 모두 [제안]입니다.
- 새 id 중 리뷰 2에 없는 코드 이름은 모두 [제안]이고 F 문서가 정본으로 정합니다.

| 개념 | 지금 id | 새 id (코드) | 문서 용어 | 화면 ko | 화면 en | 근거 |
|---|---|---|---|---|---|---|
| 대화 | `thread`, `ThreadId`, 화면·CLI "세션" | 그대로 | Thread | 대화 | Conversation | §13-6 |
| 설정 범위 session | `SettingScope` `"session"` | `"launch"` | launch(이번 실행) | 이번 실행 | This launch | §13-6 |
| 대화 프로세스 락 키 | `session:<threadId>` | `thread:<threadId>` | Process lock | — | — | §13-6, §13-9 |
| 훅 종류 session | `PointKind` `"session"`, `session.*` 훅 | `"thread"`, `thread.*` | thread 훅 | — | — | §13-6 |
| Run | `TurnId`(`trn_`), `TurnStatus`, wire `turn.start`·`turn.interrupt`·`turn.resume`·`turn.busy`, 이벤트 `turn.*` | `RunId`(`trn_` 저장 유지), `RunStatus`, `run.start`·`run.interrupt`·`run.resume`·`run.busy`, 이벤트 저장 유지 [제안] | Run | 응답 | Response | §13-6 |
| Run 경계 훅 | `boundary.turn.before`, `boundary.turn.after` | `boundary.run.before`, `boundary.run.after` [제안] | Run 경계 | — | — | §13-5·6 |
| drive가 여는 Run | `loop.turn` | `loop.run` [제안] | — | — | — | §13-6 |
| Step | `StepId`(`stp_`), `boundary.step.*` | 그대로 | Step | 단계 | Step | §13-6 |
| 단계 경계 | step boundary | 그대로 | Step boundary | 단계가 끝나면 | After this step | §13-6 |
| Item | `ItemKind` | 그대로 | Item [미결: Entry 여부] | 항목 | Item | §13-6 |
| Hook | `PointName`, `PointDecl`, `PointKind`, `POINTS`, `POINT_NAMES` | `HookName`, `HookDecl`, `HookKind`, `HOOKS`, `HOOK_NAMES` [제안] | Hook(런타임 생애주기 훅) | 훅 | Hook | §13-5 |
| Hook handler | handler | 그대로 | Hook handler | 핸들러 | Handler | §13-5 |
| fold | `Fold` `tap`·`first`·`chain`·`collect` | 그대로 | fold | 보기·막기·고치기·모으기 | Observe·Block·Modify·Collect | §13-5 |
| post | `PostWhen` `steer`·`followUp`·`next` | 그대로 | post | 입력 넣기: 바로·끝난 뒤·다음 요청에 | Post: Now·After·Next request | ADR-0013 |
| Registration [미결] | `host.scope`, `ScopeFn`, `ScopeHandle`, `ScopeStatus`, `ScopeId`, `ScopeInfo`, 이벤트 `scope.changed` | `host.register`, `RegistrationFn`, `RegistrationHandle`, `RegistrationStatus`, `RegistrationId`, `RegistrationInfo`, 이벤트 저장 유지 [제안] | Registration | (화면에 쓰지 않음) | — | §13-3 |
| 플러그인 [미결] | 매니페스트 `kind: "plugin"` | `plugins[]` 항목 | Plugin | 플러그인 | Plugin | §13-3 |
| 플러그인 그룹 [미결] | 매니페스트 `kind: "group"`, "의도 그룹" | `group` 선언 | Plugin Group | 플러그인 그룹 | Plugin group | §13-3 |
| 확장 | `ExtensionManifest` | 그대로 | Extension | 확장 | Extension | §13-3 |
| 프로필 | `Profile`, `profile.*`(T-F) | 그대로 | Profile | 프로필 | Profile | §13-4 |
| 신뢰 | trust 등급 | 그대로 | Trust | 신뢰: 내장·사용자 설치·이 프로젝트·신뢰 안 함 | Trust: Built-in·Installed·This project·Untrusted | §13-4 |
| Driver | drive 임대, `lease.acquired`·`lease.released`·`lease.rejected` | `DriveLock*` 타입, 이벤트 저장 유지 [제안] | Driver / drive lock | 주도 | Lead | §13-9 |
| Driver 고르는 설정 [미결] | `x.primitives.activeDriveGroup` | `x.primitives.activeDriver` [제안] | — | 주도 플러그인 | Leading plugin | §13-3·9 |
| drive 정책 [미결] | 오류 `drive_requires_group` | 정책 `drive_requires_group` | — | — | — | §4.2 설명 |
| Drive limits | `driveLimits`, `driveDefaultLimits`, 임대 상한 | 그대로(문서 용어만) | Drive limits | 주도 한도 | Lead limits | §13-9 |
| Process lock | `sys_leases`, 자원 임대 | 테이블 저장 유지, 코드 타입 `ProcessLock*` [제안] | Process lock | — | — | §13-9 |
| Scheduler leader | `scheduler` 임대, 실행권 | 코드 타입 `SchedulerLeader*` [제안] | Scheduler leader | — | — | §13-9 |
| Question | `loop.ask`, `ApprovalKind` `"question"` | 그대로 | Question | 질문 | Question | §13-12 |
| Display name | `displayName` | 그대로 | Display name | 디스플레이 네임 | Display name | §13-12 |
| Test run | `trial`, `ThreadSummary.trial`, `trial.*`(T-F) | `testRun`, `ThreadSummary.testRun`, `testRun.*` [제안] | Test run | 테스트 | Test | §13-12 |
| Trace | `trace.turn`(T-F) | `trace.run` [제안] | Trace | 트레이스 | Trace | §13-12 |
| Replay test | `replayDrive` | 그대로 | Replay test [제안] | 재실행 검사 | Replay test | 리뷰 2 §11 |
| Plugin UI | 매니페스트 `views`, `ViewContribution` | `ui`, `UiContribution` [제안] | Plugin UI | 플러그인 UI | Plugin UI | §13-12 |
| Placement | slot `page`·`well`·`card`·`status`·`command`·`settings` | `placement`, `well` → `panel` [제안] | Placement | 전체 화면·옆 패널·대화 카드·상태 표시줄·명령·설정 | Page·Side panel·Card·Status bar·Command·Settings | §13-12 |
| Native UI | `mode: "declarative"`, `ViewNode` | `mode: "native"` [제안] | Native UI | 기본 UI | Native UI | §13-12 |
| Plugin App | `mode: "frame"`, `FrameDecl`, `x.views.frames`, `x.views.allowProjectFrames` | `mode: "app"`, `AppDecl`, `x.ui.apps`, `x.ui.allowProjectApps` [제안] | Plugin App | 플러그인 앱 | Plugin app | §13-12 |
| Plugin Builder | 제작 확장, `L3.authoring.*`, `group-authoring` | `plugin-builder` 패키지 [제안] | Plugin Builder | 플러그인 빌더 | Plugin Builder | §13-12 |
| Group SDK | `group-kit`, `defineGroup` | `group-sdk` 패키지, `defineGroup` 그대로 [제안] | Group SDK | 그룹 SDK | Group SDK | §13-12 |
| Stages | group-kit 슬롯(트리거·펼치기·모으기·적용) | `stages`: `trigger`, `fanOut`, `fanIn`, `apply` [제안] | Stages | 단계 자리: 트리거·펼치기·모으기·적용 | Trigger·Fan-out·Fan-in·Apply | §13-12 |
| Capability | 능력(cap), `cap-*`, `CapabilityId` | 그대로 | Capability | 기능 | Capability | §13-10 |
| Provider | provider | 그대로 | Provider | 제공자 | Provider | §13-10 |
| Schedule | 루프·timer, `TriggerSpec.kind` `"loop"` | `"repeat"` [제안] | Schedule(once / recurring) | 예약: 한 번·반복 | Schedule: Once·Recurring | §13-11 |
| Secret | 비밀 | 그대로 | Secret | 시크릿 | Secret | §13-11 |
| Secret ref | 비밀 핸들, `secret://` | 그대로 | Secret ref | 시크릿 참조 | Secret ref | §13-11 |
| Secret registry | 메타 파일 | 코드 이름 확인 뒤 [제안] | Secret registry | 시크릿 목록 | Secret registry | §13-11 |
| Injection mode | 사용 모드, `SecretUseMode` | `InjectionMode` [제안] | Injection mode | 주입 방식 | Injection mode | §13-11 |
| Input Queue | 입력 큐, 내구 큐 | 그대로 | Input Queue | 대기 중인 메시지 | Queued messages | §13-7 |
| Task Queue | L2 work 작업 목록 | 그대로 | Task Queue | 작업 큐 | Tasks | §13-7 |
| Runtime Server | 호스트, `apps/host`, wire `host.*` | 그대로(id 단계) | Runtime Server | 런타임 서버 | Runtime server | §13-2 |
| Runtime API | 호스트 계약, wire | 그대로 | Runtime API | — | — | §13-2 |
| Background service | 서비스 모드 | 그대로 | Background service | 이 컴퓨터(백그라운드) | This computer (background) | §13-2 |
| Embedded | 사이드카 | 그대로 | Embedded | 이 컴퓨터(앱 안) | This computer (in app) | §13-2 |
| 층 L0~L4, F, X | 플랫폼, 코어, 능력, 의도 그룹, 배포 런타임, 계약, 확장 체계 | 층 코드 그대로 | System, Agent Core, Capabilities, Orchestration, Apps, Contracts, Extension Runtime | 시스템, 에이전트 코어, 기능, 오케스트레이션, 앱, 계약, 확장 런타임 | System, Agent Core, Capabilities, Orchestration, Apps, Contracts, Extension Runtime | §13-1 |
| Bench | 작업대, i18n `desktop.workbench.*` 등 | `bench` [제안] | Bench | Bench | Bench | §13-13 |
| 성능 측정 | `bench`(개발 모드 측정) | `perf` [제안, §6 2번] | Benchmark | 성능 측정 | Performance | 충돌 해소 |

## 4. 결과

### 4.1 좋은 점

- 같은 말이 두 뜻으로 쓰이던 곳(scope, 임대, 세션, 루프)이 사라집니다.
- Thread → Run → Step, Hook과 fold, Provider, Trace가 업계 이름과 맞아 외부 개발자가 플러그인을 쓰기 쉽습니다.
- 사용자 모델(묶음은 그룹, 하나는 플러그인)과 계약 모양이 같아집니다(§3.2 확인 뒤).
- 용어 원본 하나에서 카탈로그, 용어집, 목업 용어가 나와 다시 어긋나지 않습니다.

### 4.2 감수할 점

- 변경 범위가 큽니다. 2026-11-01 `xeon/foundation` 기준으로 코드(`xeon/`)와 문서(`docs/xeon`)의 대략 개수는 다음과 같습니다(단어 경계 기준, 다른 뜻 포함).

| 대상 | 코드 | 문서 |
|---|---|---|
| `scope` 단어 | 2,985 | 1,126 |
| `Scope*` 타입 | 801 | 413 |
| `Turn*` 타입 | 896 | 301 |
| `"turn.*"` 문자열 | 624 | 32 |
| `loop.turn` | 123 | 145 |
| `Point*`, `point` | 1,412 | 376 |
| `"session.*"` 훅 | 350 | 23 |
| `trial` | 579 | 34 |
| `group-kit` | 397 | 748 |
| "지점" | 575 | 1,583 |
| "임대" | 533 | 1,009 |
| "세션" | 666 | 2,121 |
| "능력" | 495 | 942 |

- `scope`, `lease`, `point`는 다른 뜻(설정 범위, Process lock, 일반 단어)과 섞여 있어 기계 치환만으로 끝나지 않습니다. 손으로 고칠 곳이 남습니다.
- 저장 문자열을 두면(§3.1 3번) 코드 이름과 저장 이름이 다른 곳이 생깁니다. F 문서에 대응을 적어야 합니다.
- 열린 브랜치(T-F `m4/f`, T-CAU1 `m4/cau1` 등)가 바뀐 이름 위로 rebase해야 합니다.

### 4.3 바뀌는 문서와 코드

이 ADR이 accepted가 되면 이름 변경 트랙이 다음을 바꿉니다. 순서와 커밋 나눔은 이름 변경 계획이 정합니다.

| 문서 | 바뀌는 곳 |
|---|---|
| `architecture.overview.spec`, `architecture.layers.spec` | 층 이름, 엔진·Runtime Server·Runtime API 그림 |
| `F.extensions.spec` | §2 용어(Hook, Registration, Plugin Group, Driver), 매니페스트(§3.2 확인 뒤), 훅 표의 `session` → `thread`, `boundary.turn.*` |
| `F.conversation.spec` | turn → Run, Item |
| `F.records.spec` | `lease.*`·`scope.changed` 저장 유지와 코드 이름 대응 |
| `F.wire-settings.spec` | `turn.*` → `run.*` 메서드, 설정 범위 `session` → `launch`, `x.views.*` 키 |
| `F.capabilities.spec` | Capability·Provider 용어 |
| `X.primitives.spec` | §2 용어, §4.4 drive(Driver, drive lock, 넓히기), §4.5 scope → Registration |
| `X.loading-trust.spec`, `X.operations.spec` | 신뢰 관문 문구, 프로젝트 덧씌우기, 자동 끄기 대상 이름 |
| `L0.process.spec` | Process lock, Scheduler leader, 락 키 `thread:<threadId>` |
| `L0.secrets.spec` | Secret ref, Secret registry, Injection mode |
| `L1.loop.spec` | Run, Step, `loop.run` |
| `L2.schedule.spec` | Schedule once / recurring, `loop` 종류 이름 |
| `L3.group-kit.spec`, `L3.authoring.spec` | Group SDK, Stages, Plugin Builder |
| `L4.desktop-ux.spec` | Bench, Plugin UI, Placement, Native UI, Plugin App, Test run, Trace, 화면 라벨 |
| ADR-0007, ADR-0017, ADR-0021 | 상태 절에 "용어는 ADR-0022" 한 줄. ADR-0007은 §3.2 accepted 때 부분 대체 |
| `eng.operations.glossary` | 항목 이름 교체, 플랫폼 용어와 플러그인 그룹 용어 두 절, M4 용어 추가, 화면 라벨 열은 생성 구역 |

### 4.4 용어 검사가 지키는 것

용어 검사 설계(`_notes/i18n-term-lint-design.md`)의 0단계를 이름 변경 트랙과 함께 넣습니다.

- 용어 원본(설계 기본값 `packages/client/src/i18n/terms.ts`)에 §3.6 표의 행을 넣습니다. §3.2 행과 화면 라벨은 `status: "proposed"`, 나머지 개념과 문서 용어는 `status: "decided"`입니다.
- 0단계 검사:
  - T-01~T-05: 개념 id·라벨·문서 용어 중복 금지, 금지어와 정식 이름의 모순 금지, 라벨 형식, 출처 문서 id 존재
  - C-01·C-02·C-03·C-06: ko·en 키 집합, ICU 인자, `term.*` 생성물 일치, en 문자열의 한글 금지
  - M-01: 목업 용어 파일이 원본과 같음
- 금지 별칭(`forbid`)으로 넣을 옛 이름: 지점, 의도 그룹, 임대(drive 뜻), 진행권, 실행권, 세션, 턴 재생, 시험 대화, 시험 실행, 제작 확장, 슬롯(group-kit 뜻), 능력, 비밀 핸들, 메타 파일, 작업대, 사이드카, 호스트 계약, 루프(예약 뜻). 0단계에서는 원본에만 적고, 문서·카탈로그 대조(D-02, C-05)는 1단계에서 경고로 켭니다.
- 검사가 잡지 못하는 것: 맞는 단어를 다른 뜻으로 쓴 문장(예: 일반 단어 scope)입니다. 리뷰로 보완합니다.

## 5. 대안

| 기준 | (a) 이름 그대로, 용어집만 정리 | (b) 모든 id를 문서 용어로 일괄 통일 | (c) 두 단계 + 선택적 통일 [채택] |
|---|---|---|---|
| 두 뜻 단어 | 남음 | 사라짐 | 사라짐 |
| 저장 데이터 | 영향 없음 | 이벤트 kind, id 접두 마이그레이션 필요 | 저장 문자열 유지 [제안] |
| 변경량 | 작음 | 가장 큼 | 큼 |
| 화면 라벨 바꾸기 | 문자열마다 | 문자열마다 | 원본 한 줄 |
| 채택하지 않은 이유 | 사용자 결정(2026-11-01) 선택적 통일과 맞지 않음 | 화면 라벨이 바뀔 때마다 코드 id까지 따라 바뀌고 저장 데이터를 옮겨야 함 | |

§3.2 플러그인 그룹 모델의 대안:

| 기준 | (a) 지금 모델(확장 = plugin 또는 group) | (b) scope와 그룹을 합침 | (c) 확장 = manifest + plugins, Plugin Group, Registration [제안] |
|---|---|---|---|
| 사용자 직관 | 그룹이 묶음으로 읽히지만 실제로는 하나 | 등록 상태와 묶음이 섞임 | 묶음은 그룹, 하나는 플러그인 |
| Helm 표현 | L3 확장 하나로만 표현 | 표현 가능하나 엔진 상태와 섞임 | 여러 층 플러그인을 그대로 표현 |
| 계약 변경 | 없음 | 큼 | 매니페스트 변경 |
| 채택하지 않은 이유 | 사용자 이해와 어긋남(리뷰 2 §4.1) | scope는 엔진 내부 등록 상태라 묶음과 수명이 다름 | |

## 6. 미결 사항

1. [미결: 사용자 확인 대기] §3.2 전체(Plugin Group 모델, Registration, drive 넓히기와 `drive_requires_group` 기본값)와 §3.3 5번.
2. [미결] 작업대 이름 Bench와 기존 개발 모드 성능 측정 `bench`(ui-terms-guide C12, m4-decisions UX 4번)가 겹칩니다. 제안은 측정 쪽 id를 `perf`, 문서 용어를 Benchmark로 바꾸는 것입니다.
3. [미결] Item과 Entry(리뷰 2 §8.3). §3.5 1번.
4. [미결] 저장 문자열(`turn.*`·`scope.changed`·`lease.*` 이벤트 kind, `trn_` 접두, `sys_leases`)을 유지할지 마이그레이션할지(§3.1 3번).
5. [미결] 화면에 층 숫자를 남길지(리뷰 2 §13 1번).
6. [미결] 화면 라벨 ko·en 전부. 사용자가 `ui-terms-guide.md` 검토를 마치면 용어 원본에서 `decided`로 바꿉니다.
7. [미결] Bench, Fresnel 상표 확인(KIPRIS, USPTO class 9·42).
8. [미결] 기존 L4 CLI 코드를 내부 개발 도구로 남길지 지울지. `cli.*` 카탈로그 키 667개의 처리와 용어 검사 대상이 여기에 달려 있습니다.
9. [가정] 리뷰 2 §11의 Replay test는 §13 목록에 없어 [제안]으로 둡니다.
