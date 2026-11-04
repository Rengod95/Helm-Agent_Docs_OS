# 데스크톱 셸 (`views/shell`)

S-01 앱 셸의 자리(슬롯), 영역 바꾸기, 맥락 모델의 정본 설명입니다. 화면 트랙은 이 문서의 계약만 쓰고 셸 파일을 고치지 않습니다. 설계 근거는 `docs/xeon/L4/desktop-ux/spec.md` §4.1, §4.8, §4.9입니다.

## 구성

가져올 때는 파일 경로를 그대로 씁니다(묶음 `index.ts`는 없음).

| 파일 | 하는 일 |
|---|---|
| `state/shell/layout.ts` | 폭 단계 `wide`(1100 초과) / `medium`(721~1100) / `compact`(720 이하)와 단계별 패널 기본값 |
| `state/shell/model.ts` | 순수 상태 함수: 영역, 영역별 자리, 맥락, 패널 열림 |
| `state/shell/store.ts`, `hooks.ts` | 모델을 zustand 스토어로 감쌈(zustand는 `state/` 아래에서만 import). 훅 `useShell(selector)`, `useShellActions()`. 진입점은 `state/shell/index.ts` |
| `views/shell/registry.ts` | 화면과 오른쪽 탭 등록부 `createShellRegistry()`, 타입 `ScreenDef`, `EndTabDef` |
| `views/shell/keybindings.ts` | 바로 가기 키 표(`ACTION_IDS`, `DEFAULT_KEYMAP`, `resolveKeymap`, `formatKey`) |
| `views/shell/shortcuts.ts` | 키 → 동작 처리. 셸이 맡는 동작은 여기서 끝나고 나머지는 `onAction`으로 감 |
| `views/shell/nav.ts` | 왼쪽 내비 항목 표(대화 다섯, 작업대 여섯) |
| `views/shell/persist.ts` | 영역과 자리를 로컬 설정에 저장·복원 |
| `views/shell/toaster-slot.ts` | 토스트 자리 계산 |
| `views/shell/shell.tsx`, `start-panel.tsx`, `end-panel.tsx`, `context-picker.tsx` | 화면 부품 |
| `settings-store/local.ts` | 로컬 설정 저장소 |

앱 조립은 `src/main.tsx`(스토어, 등록부, 로컬 설정 연결)와 `src/views/desktop-registry.tsx`(지금 만들어진 화면 등록)입니다. `src/views/shell/` 파일 이름은 위 표에서 `views/shell/`을 줄여 적었습니다.

## 슬롯

| 슬롯 | 누가 채우나 | 어떻게 |
|---|---|---|
| 무대(가운데) | 화면 트랙 | `registry.registerScreen({ id, area, label, icon, badge?, render })`(`desktop-registry.tsx`에 더함). `id`는 내비 항목 id(`nav.ts`)와 같다 |
| 오른쪽 탭 | 화면 트랙, 플러그인 well | `registry.registerEndTab({ id, area, label, icon, badge?, width?, screens?, render })`. 막대 칸 6개 뒤는 "더 보기" |
| 왼쪽 대화 목록 | 대화 트랙 | `Shell`의 `threadList` 속성 |
| 상태 표시줄(S-03) | 대화 트랙 | `Shell`의 `statusBar` 속성(지금 `status-bar.tsx`) |
| 명령 팔레트(S-02) | T-CHAT1 | `Shell`의 `palette` 속성. 열림은 `useShell(s => s.paletteOpen)`, 여닫기는 `setPaletteOpen` |
| 설정 화면 | 설정 트랙 | `Shell`의 `settingsScreen` 속성. 두 영역 공통이고 영역 자리에 저장하지 않음 |
| 토스트(S-04) | 셸 | caustic `toast()`를 부르면 셸의 `Toaster`가 그림. well이 열려 있으면 well 왼쪽 끝 |

- 등록되지 않은 화면 id는 무대에 "이 화면은 아직 없어요" 빈 상태가 그려집니다.
- 같은 `id`를 두 번 등록하면 `Bug`입니다.
- 화면 `id` 목록: 대화 `chat`, `inbox`, `proposals`, `schedules`, `connection`. 작업대 `overview`, `extensions`, `tests`, `metrics`, `compose`, `engine`. `tests`(P-19 테스트)는 `views/tests/`가 그리고 `views/workbench/index.tsx`가 등록합니다. 플러그인 화면은 `<확장>/<화면>`이고 아직 내비에 없습니다(T-VIEW가 `nav.ts` 표에 목록 슬롯을 더함 [미결]). 플러그인 화면은 `<확장>/<화면>`이고 내비에 없습니다. 오른쪽 탭 `helm`(Helm 패널)과 `plugin-pages`(그 밖의 `page`·`panel`)가 그립니다(T-VIEW). `nav.ts`의 목록 슬롯은 [미결]입니다.
- 오른쪽 탭은 `screens`(화면 id 목록)를 줄 수 있다. 주면 그 화면에서만 보이고(`registry.endTabs(area, screen)`), 없으면 영역의 모든 화면에서 보인다. `work` 탭은 `["chat"]`이다.
- 오른쪽 탭 id 규약: `inbox`(받은 요청), `runtime`, `work`, `helm`(대화 영역), `inspect`, `log`, `thread`(작업대 영역). `panel.inbox`·`panel.helm`·`panel.work` 키는 `inbox`·`helm`·`work` 탭 id를 엽니다.
- 문자열은 메시지 키(`desktop.shell.*`)입니다. 화면 이름과 라벨을 코드에 한국어로 쓰지 않습니다.
- 색과 간격은 caustic 토큰과 Tailwind 유틸리티뿐입니다. 셸은 재디자인 토큰을 쓰지 않습니다(T-LANG 되돌림).

## 영역 바꾸기

- 영역은 `chat`과 `workbench`(화면 이름 LightCraft·크래프트) 둘입니다. 바꾸기: 왼쪽 패널의 `SegmentedControl`, `area.toggle` ⌘E, `area.chat` ⌥⌘1, `area.workbench` ⌥⌘2.
- 영역마다 `AreaPlace { screen, scroll, endTab }`를 기억합니다(`ShellModel.places`). 바꿔도 다른 영역의 자리는 그대로이고 돌아오면 같은 화면·스크롤·오른쪽 탭입니다(시험 `area.switch-restores-place`).
- 화면은 `useShellActions().updatePlace({ screen?, scroll?, endTab? })`로 자기 자리를 갱신합니다. 스크롤은 영역을 떠날 때와 화면·탭이 바뀔 때 저장하고 그 밖에는 메모리에만 둡니다.
- 저장 키: `l4.desktop.window.area.current|chat|workbench`, `sidebarOpen`. 맥락은 저장하지 않습니다.
- 대화의 입력 초안은 대화 상태가 갖고 있으므로 영역을 바꿔도 남습니다.

## 맥락 모델(V-25)

`useShell(s => s.context)`가 `WorkbenchContext`를 줍니다.

```ts
type WorkbenchContext =
  | { kind: "all" }
  | { kind: "thread"; threadId: string; pinned: boolean }
  | { kind: "profile"; profileId: string }
  | { kind: "trial"; threadId: string };
```

- 작업대 화면 전부가 이 값 하나를 읽습니다(왼쪽 맥락 칸이 바꿈). 화면은 맥락을 자기 상태로 복사하지 않습니다.
- `thread`이고 `pinned`가 거짓이면 대화 영역에서 대화를 바꿀 때(`selectChatThread`) 함께 바뀝니다. `App`이 `ui.selectedThreadId`를 셸에 넘깁니다(시험 `workbench.context-follows-unless-pinned`).
- `pinThread(threadId)`: 고정하고 작업대로 감("크래프트에서 보기"). `unpinThread()`: 풀고 다시 따라감. 맥락 칸에서 대화를 직접 고르면 고정됩니다.
- `all`, `profile`, `trial`은 따라가지 않습니다. 앱을 켜면 `all`에서 시작합니다.
- 맥락 칸의 프로필 목록은 `Shell`의 `profiles` 속성으로 받습니다(T-BENCH가 채움).


## 바로 가기 키(V-15)

- 동작 22개는 spec §4.8과 같고 `ACTION_IDS`가 정본입니다. 키 표기 `Mod+Shift+I`(Mod는 macOS ⌘, 그 밖의 Ctrl). Alt가 있으면 글쇠는 `KeyboardEvent.code`입니다.
- 사용자가 바꾼 키는 `l4.desktop.appearance.keybindings`(동작 id → 키)이고 `resolveKeymap`이 기본 표에 얹습니다. 읽을 수 없는 키와 모르는 동작 id는 버립니다. 겹침은 `keyConflicts`로 검사합니다.
- 셸이 처리하는 동작: `palette.open`, `sidebar.toggle`, `panel.*`, `area.*`, `settings.open`, `nav.1~5`. 나머지(`thread.new`, `turn.interrupt`, `composer.focus`, `thread.next|prev`, `approval.next`, `help.shortcuts`)는 `Shell`의 `onAction(id)`로 갑니다. 화면 트랙이 `App`의 `onAction`에서 처리합니다.
- Esc는 열린 끝 영역, compact의 시작 영역 순으로 닫습니다. 팔레트나 대화 상자(`modalOpen`)가 열려 있으면 셸은 Esc를 쓰지 않습니다.

## 로컬 설정(V-14)과 셸 명령

- `settings-store/local.ts`의 `LOCAL` 키 표와 `createLocalSettings(ipc)`. 읽을 때와 쓸 때 스키마로 검사합니다. 새 키는 `LOCAL`에 더하고 Rust `desktop_settings_write`의 허용 접두사(`l4.desktop.window.`, `appearance.`, `firstRun.`, `workbench.`) 안에 둡니다.
- 셸 명령(Tauri): `engine_retarget { target }`(W-08), `desktop_settings_read`, `desktop_settings_write { key, value }`. 모두 `DesktopIpc`(`transport/ipc.ts`)로 부르고 `capabilities/default.json`에 허용이 있습니다.
- OS 폴더 고르기(W-19)는 새 외부 의존(`tauri-plugin-dialog`) 승인이 필요해 아직 없습니다. 승인 전에는 O-07이 폴더 경로를 입력란으로 받습니다.

## 폭 단계

| 단계 | 폭 | 시작 영역 | 끝 영역 |
|---|---|---|---|
| wide | 1101 이상 | 붙박이 | 떠 있는 막대 + well |
| medium | 721~1100 | 붙박이 | 막대 + 무대 위 well |
| compact | 720 이하 | 시트(닫힌 채 시작, 내비를 고르면 닫힘) | 막대 + 무대 위 well |

단계가 바뀌면 시작 영역은 그 단계의 기본 열림으로, 끝 영역은 닫힘으로 돌아갑니다(시험 `shell.layout-steps-at-breakpoints`).

## 타입 검사

데스크톱은 caustic 소스를 직접 검사하지 않습니다. `apps/desktop/tsconfig.caustic.json`이 caustic `react` 패키지를 caustic 자체 설정(`external/caustic/tsconfig.json`, `exactOptionalPropertyTypes: false`)으로 검사하고 선언 파일을 `dist/caustic-react/`(gitignore)에 냅니다. 데스크톱 `tsconfig.json`은 이 프로젝트를 `references`로 걸어서 `@caustic/react`를 그 선언 파일로 읽습니다. 데스크톱 쪽은 strict 옵션 그대로입니다(`exactOptionalPropertyTypes: true`). `just check apps/desktop`의 typecheck(`tsc -b`)가 두 프로젝트를 차례로 짓습니다.

- caustic 설정에서 바뀐 것은 둘입니다. `types`는 `node` 대신 `bun`입니다(이 워크스페이스에는 `@types/node`가 직접 깔려 있지 않고, `@types/bun`이 같은 `process` 전역을 줍니다). `paths`는 `react`를 데스크톱의 `@types/react`로 돌립니다(caustic 쪽에서는 그 타입을 찾을 수 없습니다).
- 선언 파일이 쓰는 외부 의존(`class-variance-authority`, `@radix-ui/*`, `@solar-icons/react`)은 데스크톱 `tsconfig.json`의 `paths`가 caustic 자신의 `node_modules`로 풀어 줍니다. 데스크톱에 의존을 더하지 않았습니다. caustic에 외부 의존이 새로 생기면 같은 `paths`에 줄을 더해야 합니다. 데스크톱의 `skipLibCheck`(기본 설정) 아래에서는 풀리지 않은 선언이 오류 없이 `any`가 되기 때문입니다.
- solar 패키지 자신의 선언에 있는 충돌(`IconProps`, `Omit<SVGProps>`와 `Omit<IconBaseProps>`)은 `skipLibCheck: false`에서만 보입니다. caustic 설정도 같은 이유로 가리므로 그대로 둡니다.
- lint(type-aware)는 `dist/`가 없는 깨끗한 체크아웃에서도 통과합니다. caustic 소스는 turbo 입력이 아니므로 caustic을 올린 뒤(`just caustic-update`)에는 `TURBO_FORCE=true just check apps/desktop`으로 캐시를 건너뜁니다.

## 알려진 틈

- 대화 목록 행의 "테스트" 묶음, 대화 행 메뉴, 시작 영역 폭 끌기와 `sidebarWidth`·`endWidth` 저장은 아직 연결하지 않았습니다(키는 `LOCAL`에 있음).
- 셸의 탭 포커스 이동, axe 점검은 T-A11Y가 합니다.
- 시안(`mockups/_shell`)의 `line-grid`·`type-variants`·`radius` CSS는 가져오지 않았습니다(T-LANG 되돌림, 크래프트의 선 격자는 T-BENCH).
