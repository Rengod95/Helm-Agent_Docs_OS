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
- 절단 띠는 커밋 수만큼 칸을 그리고, 모든 절단이 같을 때만 칸을 칠합니다. wire가 칸별 값을 주지 않기 때문입니다.
- Test run의 멈춤 표지는 명령 결과가 든 값입니다. 목록에는 표지가 없습니다. "멈춤" 뒤에는 "이어서"와 "한 경계씩"만 보이고, 새 턴을 여는 동작은 없습니다.
- 맥락 칸이 시험이나 대화이면 그 대화 id의 Test run만 보입니다. replay 기록에는 대화가 없어 대화 맥락에서는 보이지 않습니다.
- 글은 모두 `desktop.tests.*` 메시지 키입니다. 색은 caustic 토큰 클래스만 씁니다. caustic `Badge`의 `tone`은 deprecated 표시가 있어 쓰지 않고, `Tag`(`test-detail.tsx`)를 씁니다.

## 아직 없는 것과 이유

- 벤치마크, 보호 경로 검사(`scripts/core-diff-check.ts`): 실행 wire가 없습니다(W-30). 시트에서 고를 수는 있지만(개발 모드일 때) 시작하지 못합니다.
- 켬/끔 비교: 작업 폴더 격리(T-TEST-ISO)가 없어 잠겨 있고 "작업 폴더를 격리하는 기능이 아직 없어요"를 보입니다.
- 절단별 같음·다름 칸 강조와 replay 실행 취소: wire `ReplayReport`에 `cuts`가 없고 취소 wire도 없습니다(W-29).
- 시험 시트의 프로필 고르기: 프로필 목록 읽기(`profile.list`)를 이 화면에 붙이지 않았습니다. `thread.create`에 `profileId`를 보내지 않습니다.
- 새 Test run 대화는 `thread.create { testRun: true }`로 만들며, 이 호출이 만든 대화는 `ext.test.list`에 기록이 없어 목록에 나타나지 않습니다 [미결].
- 화면을 다시 연 뒤의 멈춘 표지: `thread.list`의 `testRun.paused`를 앱이 아직 받지 않아 명령 결과로만 알고 있습니다.
- 트레이스 막대(§6.22.5): 목록 행에 `turnId`가 없어 턴을 고를 수 없습니다.
- 비용 확인 대화: 예상 실행 수와 비용 범위를 wire가 주지 않아 글로만 묻습니다. 지금 시작할 수 있는 종류 가운데 비용이 드는 것은 없어 열리지 않습니다.
- 플러그인 빌더로 만들기, "새 그룹" 작성기: m4/auth 트랙(플러그인 빌더)이 들어오기 전이라 이 화면에 두지 않았습니다.
