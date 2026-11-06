# 테스트 화면 (`views/tests`)

테스트(P-19, 코드 id `tests`)의 화면입니다. 시험 목록, 고른 시험의 상세, Test run의 멈춤·이어서·한 경계씩, O-12 "새 시험" 시트를 그립니다. 설계는 `docs/xeon/L4/desktop-ux/spec.md` §6.26(P-19)과 §6.31(O-12)입니다. 순수 모델은 `packages/client/src/workbench/tests.ts`와 `tests-state.ts`(`@fresnel/client/workbench`)에 있고, 이 폴더는 명령을 부르고 그립니다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `tests-screen.tsx` | 화면 동작. `TestsScreen`이 명령, 목록 읽기, `testsUiReducer`를 묶는다 |
| `tests-view.tsx` | 그림. 목록 상태(읽는 중·오프라인·오류·빈 목록), 거르기, `Table`, 상세 자리, 알림 |
| `test-detail.tsx` | 상세. replay 판정·절단 띠·첫 차이·효과 수·실패 종류·"JSON 복사", Test run의 상태와 제어 |
| `new-test-sheet.tsx` | O-12 `Sheet`와 입력 칸(`NewTestForm`), 비용 확인 `Dialog`(`RunConfirmDialog`) |
| `tests-actions.ts` | 명령을 부르고 결과를 상태에 넣을 값으로 바꾼다. React를 쓰지 않아 명령 대역만으로 시험한다 |
| `tests-read.ts` | 목록 읽기 훅(`useTestList`). 연결이 살아 있을 때 읽고 `reload`로 다시 읽는다 |
| `tests-text.ts` | 모델 값을 메시지 키로 바꾸고 명령 오류를 실패 종류로 줄인다 |

명령은 `views/commands.ts`의 `TestCommands`(`commands.tests`)이고 구현은 `src/app/tests-commands.ts`입니다. 등록은 `views/workbench/index.tsx`의 `registerWorkbench`가 합니다(내비 항목은 `shell/nav.ts`의 `tests`).

## 규칙

- 목록은 `ext.test.list`의 `replay`와 `testRun` 기록만 보입니다. 벤치마크와 보호 경로 검사는 wire가 없어 목록에 없습니다(W-30).
- 개발 모드(`l3.authoring.devMode` 설정)가 아니면 replay·벤치마크·보호 경로 검사는 "새 시험"에서 "개발 모드에서만" 배지로 잠깁니다. Test run과 목록 읽기는 늘 열려 있습니다. 설정 키를 읽지 못하면 개발 모드가 아닌 것으로 봅니다.
- 판정은 실패 종류가 있으면 그것, 없고 같지 않으면 "digest 다름", 같으면 "같음"입니다(`replayVerdictOf`). 보고서 글은 `ReplayReport`를 그대로 복사합니다(`reportJsonOf`).
- 절단 띠는 `ReplayReport.cuts`의 커밋마다 칸 하나를 그립니다. 같은 절단은 회색 칸, 다른 절단은 붉은 칸입니다(시안 c01-trials). 칸이 200개를 넘으면 나머지는 정보 아이콘 뒤에 수로 적습니다.
- 화면은 "시험 대화" 구역(Test run)과 "재실행 검사 · 성능 측정 · 보호 경로 검사" 구역(replay)으로 나눕니다. 고른 행의 상세는 그 행의 구역 아래에 펼칩니다. 설명 글은 정보 아이콘(`InfoTip`, DP-58) 뒤에 둡니다. 720 아래 폭은 표 대신 두 줄 목록입니다(`compact`).
- Test run의 멈춤 표지는 명령 결과가 든 값입니다. 목록에는 표지가 없습니다. "멈춤" 뒤에는 "이어서"와 "한 경계씩"만 보이고, 새 턴을 여는 동작은 없습니다.
- 새 시험의 Test run은 대상(확장 이름)을 받아 `ext.test.run { kind: "testRun", target }`으로 시작합니다. 대화 이름은 대상 이름이고, 그 확장을 이 대화에서 켜며, `ext.test.list`에 `running` 기록을 남깁니다. 시작에 성공하면 "{이름} 시험 대화를 만들었어요." 알림을 보이고 목록을 다시 읽어 "실행 중" 행이 나타납니다. 행을 고르면 멈춤·이어서·한 경계씩이 보입니다.
- Test run 기록은 끝내는 wire가 없어 `running`으로 남습니다. 호스트를 다시 띄운 뒤 처음 읽을 때 `failed`로 바뀝니다(`test-record-store.ts`의 `interruptedOf`) [미결].
- 맥락 칸이 시험이나 대화이면 그 대화 id의 Test run만 보입니다. replay 기록에는 대화가 없어 대화 맥락에서는 보이지 않습니다.
- 글은 모두 `desktop.tests.*` 메시지 키입니다. 색은 caustic 토큰 클래스만 씁니다. caustic `Button`과 `Badge`는 `tone` prop이 lint(`no-deprecated`)에 걸려 `variant`만 씁니다. 판정 표지는 `Tag`(`test-detail.tsx`)를 씁니다.

## 아직 없는 것과 이유

- 벤치마크, 보호 경로 검사(`scripts/core-diff-check.ts`): 실행 wire가 없습니다(W-30). 시트에서 고를 수는 있지만(개발 모드일 때) 시작하지 못합니다.
- 켬/끔 비교: 작업 폴더 격리(T-TEST-ISO)가 없어 잠겨 있고 "작업 폴더를 격리하는 기능이 아직 없어요"를 보입니다.
- replay 실행 취소: 취소 wire가 없어 두지 않습니다(W-29).
- 시험 시트의 프로필 고르기: 프로필 목록 읽기(`profile.list`)를 이 화면에 붙이지 않았습니다. `thread.create`에 `profileId`를 보내지 않습니다.
- 제작 화면의 "새 Test run으로"(`compose-profile.tsx`, 프로필 적용)와 구성기 시험 실행(`compose-trial.tsx`)은 `thread.create { testRun: true }`로 대화만 만듭니다. 이 대화는 `ext.test.list`에 기록이 없어 목록에 나타나지 않습니다 [미결].
- 화면을 다시 연 뒤의 멈춘 표지: `thread.list`의 `testRun.paused`를 앱이 아직 받지 않아 명령 결과로만 알고 있습니다.
- 트레이스 막대(§6.22.5): 목록 행에 `turnId`가 없어 턴을 고를 수 없습니다.
- 비용 확인 대화: 예상 실행 수와 비용 범위를 wire가 주지 않아 글로만 묻습니다. 지금 시작할 수 있는 종류 가운데 비용이 드는 것은 없어 열리지 않습니다.
- 플러그인 빌더로 만들기, "새 그룹" 작성기: m4/auth 트랙(플러그인 빌더)이 들어오기 전이라 이 화면에 두지 않았습니다.
