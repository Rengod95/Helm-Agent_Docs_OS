# 크래프트 2차 시안 (W6–W9, Opus)

스펙 `docs/xeon/L4/desktop-ux/spec.md` §14(크래프트 시안 브리프)의 2차 화면 넷: P-19 테스트 실행, P-20 측정과 평가, P-21 구성, P-22 만들기. O-12 새 테스트는 W6의 상태(시트)로 그렸습니다. O-11 되돌리기 확인은 확장 상세(P-17, 1차 W3)에 속해 여기 없습니다.

- 실행: `MOCKUP=wb2-opus MOCKUP_PORT=8861 mise exec -- bun run mockup`
- 빌드: `MOCKUP=wb2-opus MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 셸: 크래프트 영역 셸(`fresnel(desktop): 크래프트 영역 셸`, wb1)을 그대로 씁니다. `_shell`은 고치지 않았습니다.

## 상태

| 이 앱 | §14.6 | 화면 | 보이는 것 |
|---|---|---|---|
| S1 | S12 | W6 | replay review 실패 행 고름, 아래 상세(판정, 절단 띠 41칸, 첫 차이 seq 212, 새 효과, 옵션, seq 212 이벤트 비교) |
| S2 | — | W6 · O-12 | 새 테스트 시트(replay: 대상 그룹, 테이프, 커밋 상한 200). 종류를 바꾸면 테스트 대화·bench·코어 변경 옵션 |
| S3 | — | W6 | bench 행 고름(예산 "사용자 결정 대기"), 표 위 시작 실패 `Alert`(종료 코드 2) |
| S4 | — | W6 | 빈 상태 "아직 돌린 테스트가 없어요" |
| S5 | S13 | W7 | 맥락 전체 · 7일: 요약 넷, 확장별 표, 핸들러 시간/예산 막대, 승격 보고, 코어 변경 검사 |
| S6 | — | W7 | 맥락 캐시 무효화 조사 · 1일 |
| S7 | — | W7 | 계측 꺼짐: 표 위 `Alert`, 값 "–" |
| S8 | S14 | W8 | 프로필 "탐구 중심" 편집 |
| S9 | — | W8 | "review 테스트" 적용 실패: 실패 키 둘과 되돌림 |
| S10 | — | W8 | 그룹 구성 탭: 슬롯 넷(트리거, 펼치기, 모으기, 적용) → "이 구성으로 만들기" |
| S11 | — | W9 | 1 종류(provider, X 훅 "준비 중" 잠김) |
| S12 | S15 | W9 | 2 이름 "Lens_Review" 오류 |
| S13 | — | W9 | 3 확인: 만들 파일 10개, 터미널 명령 복사 |
| S14 | — | W9 | 결과: 검사 셋, 다음 동작(편집기, 연결, 테스트 대화에서 켜기, replay 테스트) |

## 쓴 caustic 부품

`Table` 대신 직접 만든 `GridTable`(아래), `Button`, `IconButton`, `Select`, `SegmentedControl`(기간, 테스트 종류, 프로필 행 값), `Tabs`(soft, 구성 탭), `Alert`(emphasis lead), `Badge`, `Progress`(테스트 대화 진행), `ListDescription`(상세 이름표·값, DP-12), `CodeDiff`(이벤트 비교 대용, C-20), `Sheet`(O-12), `Field`, `Input`, `NumberField`, `Textarea`, `Checkbox`, `Switch`, `RadioGroup`, `Stepper`, `ListNavigation`(프로필 목록), `EmptyState`. 셸의 `WorkbenchHead`, `WB_WIDTH`, `ToneIcon`, `workbenchRightTabs`.

## 직접 만든 부품(`parts/`)

- `grid-table.tsx`: caustic `Table`에 행 하나 고르기(활성화)가 없고 행 사이 선이 늘 그려져 DP-26과 맞지 않습니다. 같은 토큰으로 ghost 표를 그리고, 고른 행은 caustic 현재 항목과 같은 raised 면입니다. caustic에 `selectionMode="single"`, `onRowActivate`, `dividers={false}`를 제안합니다.
- `budget-meter.tsx`: 예산 대비 시간 막대(`role="meter"`, C-05)와 행 끝 작은 추세 막대(C-17).
- `radio-list.tsx`: `RadioGroup` 행에 이름 + 연한 설명. `ChoiceGroup appearance="answer"`는 고른 행을 통째로 잉크 면으로 반전해서 한 화면에 묶음이 넷이면 너무 무겁습니다.
- `ext-cell.tsx`: 확장 이름 칸(층 mono 열 + 이름 + `project` 배지). §6.21 확장 행 부품의 표 칸 축약입니다.

## 스펙과 다르게 그린 곳

- W6 replay 상세: `replayDrive`(`group-sdk/src/testing/replay/replay-drive.ts`)는 첫 실패에서 멈추지 않고 커밋 시점을 모두 끊어 다시 돌립니다. 그래서 절단 띠 41칸을 모두 그렸고 17·18번이 다릅니다. `effects-doubled`는 이벤트열이 모두 같을 때만 판정합니다(`eventsOk`). 그래서 "digest 다름 + effects-doubled"를 함께 보이는 §14.5 고정 데이터는 코드에서 나올 수 없습니다. 판정 배지는 "digest 다름"으로 두고, 효과는 `EffectCounts`(turn·spawn·delegate·post)로 보였습니다. "work.task.create 2/1"은 `EffectCounts` 항목이 아니라서 post로 옮겼습니다.
- W7 맥락: 와이어프레임의 머리 "맥락 전체 v"는 두지 않았습니다. 맥락은 왼쪽 패널 맥락 칸이 정본이고(§4.9.3), 패널이 닫혔을 때만 머리에 보입니다(WorkbenchHead).
- W7 코어 변경 검사: P-19와 P-20 둘 다 같은 검사를 그리라고 합니다. W7에는 마지막 결과 한 줄과 "테스트 실행에서 보기"만 두고 상세는 W6에 둡니다(DP-23).
- W8 프로필 확장: 프로필 모델이 `enable`과 `disable`을 따로 가져서 체크 상자로는 "끄기"와 "그대로"를 구분하지 못합니다. 행마다 켜기·끄기·그대로 `SegmentedControl`입니다. core tier(core-loop)는 목록에서 뺐습니다.
- W9 템플릿 "준비 중": §14.5는 hint를 "준비 중"으로 바꿔 설명을 잃습니다. 설명은 그대로 두고 "준비 중" `Badge`를 붙였습니다. 결과는 Stepper의 넷째 단계가 아니라 세 단계가 모두 끝난 뒤의 같은 자리입니다.
- 예약 이름은 `apps/cli/src/group/rules.ts` 기준 23개입니다(SC-16은 24개). 이름 오류 문장은 규칙 전체(소문자로 시작, 2~32자)를 말합니다.
- drive 템플릿 파일 10개는 `group-sdk/templates/index.json` 목록 그대로입니다.

## 고정 데이터에 덧붙인 것

`fixtures.ts`의 `// [덧붙임]`: 테스트 대화 진행·프로필, replay 절단 결과, 첫 차이 이벤트, 효과 수, bench 행, 기간 배율, 핸들러 시간 넷(review 3.4s/5s = 68%로 경고 색 예시), 코어 변경 검사 경로 묶음, 설정 덮어쓰기 키, 슬롯 조각.

## 제안 원칙

- 크래프트 표 화면은 오른쪽 well을 닫은 채 엽니다(`initialEndOpen={false}`). 1280px에서 well(352px)이 열리면 표가 650px 밑으로 줄어듭니다.
- 표의 고른 행은 caustic 현재 항목과 같은 raised 면 하나로만 표시하고, 행 사이 선은 긋지 않습니다(DP-26).
- 고른 값이 여럿인 라디오 묶음은 반전 카드(`ChoiceGroup` card·answer) 대신 점 + 굵기로 표시합니다.
