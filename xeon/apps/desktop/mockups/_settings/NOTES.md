# 설정 묶음 시안 (P-09~P-13, O-05·O-06)

공용 셸(`../_shell`) 위의 설정 화면 공용 틀입니다. 각 페이지 폴더(`p09-settings`, `p10-secrets`, `p11-accounts`, `p12-tools-web`, `p13-plugins`)의 `mockup.css`가 `@source "../_settings"`로 이 폴더를 함께 읽습니다.

| 파일 | 하는 일 |
|---|---|
| `frame.tsx` | `SettingsFrame`: 셸 가운데에 탭 열(키 찾기 + 탭 13개, `ListNavigation kind="pages"`)과 폼 열(머리, 띠, 내용, 초안 바닥). well은 닫힌 채로 시작, compact 폭은 탭 열 대신 머리 `Select` |
| `row.tsx` | `SettingRow`(라벨 · 키 · 범위 배지 · 적용 시점, 아래 컨트롤과 `Field` 오류), `SettingSection`(고정 머리) |
| `parts.tsx` | 가려진 범위 값, 관리 잠금 문장, `List reorderable` 한국어 문구 |
| `tabs.ts` | 탭 13개, 전용 탭 → 시안 폴더. 탭을 누르면 `_shell/routes.ts`의 `navigateToPage`로 옆 시안에 간다(`?tab=<id>`, 같은 시안이면 그 자리에서 바꾼다) |
| `mount.tsx` | 진입 도우미(글꼴 → `MockRoot` → `ShellStateProvider`) |

- 설정 화면은 왼쪽 패널 바닥 "설정"이 지금 화면입니다(`activeNav="settings"`, `_shell/start-panel.tsx`에 굵기·selected 아이콘을 더함).
- 대화 목록에는 고른 행을 두지 않습니다(올린 바탕은 탭 열의 지금 탭 하나).
- 배지 강조는 하나: 범위는 neutral soft 배지, 적용 시점은 연한 글, "재시작 필요"만 warning 배지.
- O-05 재인증과 O-06 삭제 확인은 P-10의 상태(S2, S7, S8)입니다. P-11 회전 위험 확인(S2)도 같은 `Dialog kind="alert"`입니다.

빌드: `MOCKUP=<폴더> MOCKUP_OUT=<dir>/<폴더> mise exec -- bun run mockup:build`.
