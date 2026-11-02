# 공용 셸 (`mockups/_shell`)

모든 페이지 목업이 같은 창 셸 위에 자기 가운데 내용과 오른쪽 well 내용만 꽂습니다. 기준은 `p02-opus`이고 설계 원칙은 스펙 `docs/xeon/L4/desktop-ux/spec.md` §13(DP-01~17)입니다.

## 들어 있는 것

| 파일                    | 하는 일                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell.tsx`             | `Shell`: 왼쪽 패널(창 위아래 끝까지) · 투명한 가운데(`main`) · 오른쪽 떠 있는 세로 막대 + well · 상태 표시줄 · 팔레트 · 건너뛰기 링크 · 전역 단축키(⌘K, ⌘\, ⌘J, ⌘N, Esc, ⌘E 영역 바꾸기, ⌥⌘1 대화, ⌥⌘2 크래프트) |
| `state.tsx`             | `ShellStateProvider`, `useShell()`: 폭 단계(wide·medium·compact), 영역(`area`: chat·workbench), 크래프트 대화 맥락(`contextThreadId`), 왼쪽 패널, 오른쪽 well(열림·탭, 탭은 영역마다 기억), 팔레트               |
| `start-panel.tsx`       | 찾기 칸, 영역 바꾸기(`SegmentedControl` 대화·크래프트), 대화 영역: 주 내비(다섯, 연결 포함)·작업 폴더별 대화 목록(테스트 대화는 폴더 안 "테스트" 묶음) / 크래프트 영역: 보기 기준 칸(전체·대화·프로필·테스트, 대화는 따라감·고정)·크래프트 내비(여섯)·"플러그인 화면" 목록, 설정 |
| `right-panel.tsx`       | `RightTab`(+ `ext`, `expand`), `chatRightTabs()`(받은 요청·런타임·작업·플러그인 well), `workbenchRightTabs()`(받은 요청·기록·대화), 옛 `standardRightTabs()`                                                   |
| `workbench-head.tsx`    | `WorkbenchHead`, `WB_WIDTH`: 크래프트 화면 머리(h-10 한 줄 + 둘째 줄 요약, 패널이 닫히면 "맥락 <대화>")                                                                                                          |
| `workbench-fixtures.ts` | 스펙 §14.5 크래프트 고정 데이터(확장, 층 지도, helm 훅, 주도, 전환, Helm 탐구, 지표, 테스트, 프로필, 템플릿) + 기록·대화 탭 데이터                                                                               |
| `status.tsx`            | `defaultStatusCells()`(S-03 칸, compact 폭 축약)                                                                                                                                                               |
| `palette.tsx`           | 명령 팔레트(S-02)                                                                                                                                                                                              |
| `dev.tsx`               | `MockRoot`: `?state=`·`?theme=`와 개발용 띠(목업 전용)                                                                                                                                                         |
| `fonts.ts`              | `loadCausticFonts()`: caustic 글꼴을 렌더를 막지 않게(DP-15)                                                                                                                                                   |
| `icons.ts`              | caustic 아이콘 어댑터(Solar, DP-17) 다시 내보내기                                                                                                                                                              |
| `fixtures.ts`           | 공용 고정 데이터(대화 목록, 내비, 승인·제안·알림, 상태, 팔레트)                                                                                                                                                |
| `terms.ts`              | `T`: 화면에 보이는 도메인 용어 한 곳(층, 확장, 주도, 훅, 블록, 보기 기준, 테스트, 다시 돌려 검사 등). 용어가 확정 전이라 페이지는 이 말들을 직접 쓰지 않고 `T.<키>`로 끼웁니다. `josa()`는 받침에 맞는 조사 |
| `scenario.tsx`          | 눌러 볼 수 있는 시나리오: `?scenario=<id>`(`useScenarioParam`), 시간 순서 단계(`useTimeline`), 가짜 스트리밍(`useTypewriter`), `?dev=1`일 때만 왼쪽 아래에 뜨는 `ScenarioDock`(고르기·다시 시작) |
| `parts/`                | 상태 표시줄, 알림 목록, 도구 승인 카드, 질문 카드, 크래프트 "기록"(`RuntimeLog`)·"대화"(`ThreadTail`) 탭 내용, `ToneIcon`(DP-29 tone 아이콘 면)                                                                  |
| `shell.css`             | 높이 100%, 창 바탕, 커서 깜빡임. Tailwind가 이 폴더도 읽게 `@source`                                                                                                                                           |

## 새 페이지 목업 만들기

1. `mockups/<폴더>/`에 `index.html`(`lang="ko"`, `./main.tsx`), `mockup.css`, `main.tsx`를 둡니다. `env.d.ts`는 `_shell/env.d.ts`를 복사합니다.
2. `mockup.css`:

   ```css
   @import "@caustic/react/styles.css";
   @import "../_shell/shell.css";
   @source "./";
   ```

3. `main.tsx`(글꼴이 맨 먼저):

   ```tsx
   import {
     loadCausticFonts,
     MockRoot,
     ShellStateProvider,
     Shell,
     defaultStatusCells,
     standardRightTabs,
     useShell,
   } from "../_shell";
   import "./mockup.css";
   loadCausticFonts();

   const STATES = [{ id: "S1", label: "S1 기본" }] as const;

   function Page() {
     const shell = useShell();
     return (
       <Shell
         activeNav="proposals" // 지금 화면인 주 내비 항목
         stageLabel="제안" // main 랜드마크 이름
         threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
         rightTabs={standardRightTabs({ inbox: <MyInbox />, inboxBadge: 5 })}
         status={defaultStatusCells({
           layout: shell.layout,
           thread: false,
           pendingApprovals: 2,
           openEnd: shell.openEnd,
         })}
       >
         {/* 가운데 내용: 투명 면 위에 바로(카드로 감싸지 않음, DP-01) */}
       </Shell>
     );
   }

   createRoot(document.getElementById("root")!).render(
     <MockRoot states={STATES}>
       {(state) => (
         <ShellStateProvider>
           <Page />
         </ShellStateProvider>
       )}
     </MockRoot>,
   );
   ```

4. `mockups/index/pages.ts`에 한 줄 더합니다.
5. 실행: `MOCKUP=<폴더> MOCKUP_PORT=<포트> mise exec -- bun run mockup`, 빌드: `MOCKUP=<폴더> MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`.

## 두 영역(§4.9)

- 영역은 셸 상태입니다: `useShell().area`, `setArea("workbench")`. 왼쪽 패널 머리의 `SegmentedControl`이 바꾸고, 페이지는 `area`를 보고 가운데·오른쪽 탭을 고릅니다. 처음 영역은 `<ShellStateProvider initialArea="workbench">`.
- 크래프트 내비 id: `overview`, `extensions`, `tests`, `metrics`, `compose`, `engine`(여섯, "만들기"는 구성의 "새 그룹" 동작, C-6). 플러그인 화면 id는 `"<확장>/<화면>"`(`helm/inquiry`). 모두 `activeNav`·`onNavSelect`로 대화 내비와 같이 다룹니다.
- 배지·플러그인 화면 목록을 바꾸려면 `Shell`의 `workbench={{ nav, pages, onGoToThread }}`.
- 오른쪽 탭: 대화 영역은 `chatRightTabs({ inbox, runtime, runtimeBadge, work, plugins })`, 크래프트는 `workbenchRightTabs({ inbox, onGoToThread })`. 탭은 영역마다 따로 기억합니다. 영역을 바꾸면서 탭을 열 때는 `openEnd("runtime", "chat")`.
- 플러그인 well 탭은 `{ id: "helm/panel", ext: "helm", expand: { label, onSelect } }`처럼 주면 머리에 확장 이름과 "크게" 아이콘이 붙습니다(DP-21, DP-24).
- 상태 표시줄 런타임 칸: `defaultStatusCells({ ..., runtime: { drive: "helm", extFailures: 1, onOpen } })`. 값이 0인 승인·확장 실패 칸은 숨깁니다(DP-27).
- 크래프트 화면 머리: `<WorkbenchHead title="확장" meta="…" actions={…} sub="…" />`, 가운데 폭은 `WB_WIDTH`.
- 대화 영역 주 내비는 다섯입니다(대화, 받은 요청, 제안, 예약, 연결 — U-3).
- 보기 기준(§4.9.3, §4.9.5): `useShell().context`(`{kind:"all"} | {kind:"thread",threadId,pinned} | {kind:"profile",profileId} | {kind:"trial",threadId}`), `setContext`, `followThread(id)`(대화 영역에서 대화를 열면 셸이 부름: 고정이 아니면 따라감), `pinThread(id)`("크래프트에서 보기": 고정 + 크래프트로). 처음 값은 `<ShellStateProvider initialContext>`. 옛 `contextThreadId`는 호환용.
- 테스트 대화: `Thread.trial = { state: "running"|"pausing"|"paused"|"done", profile, target }`이면 목록에서 폴더 안 "테스트" 묶음으로 접힙니다. `threads.trialsOpen`(처음부터 펼침), `threads.onClearTrials`(주면 확인 대화 상자와 지우기는 페이지가 맡음).
- 상태 표시줄 진행 칸: `runtime.waiting`(사람 확인을 기다리며 주도를 놓은 그룹) → "<그룹> 확인 기다림", `runtime.detail`(Popover 둘째 줄).
- `ScenarioDock`의 `hint`: 시나리오 중 "다음에 누를 것" 한 줄(목업 전용).
- 대화 영역 런타임 무대 부품(머리·런타임 줄·런타임 행·런타임 탭·트랜스크립트 항목·상태 기계)은 `../_chat-rt`에 있습니다(묶음 A 공용).

## 자주 쓰는 것

- 지금 화면 표시: `activeNav`에 `nav[].id`(`chat`, `inbox`, `proposals`, `schedules`) 또는 크래프트 id. 그 항목만 굵기와 Solar bold 아이콘으로 보입니다. 다른 항목을 누르면 `onNavSelect(id)`가 불립니다(받은 요청은 셸이 오른쪽 well을 엽니다).
- 대화 목록: `threads.currentId`가 고른 행(올린 바탕은 이것 하나), `threads.draft`면 "새로 시작"에 새 대화 행.
- 오른쪽 탭 더하기: `standardRightTabs({...})` 결과에 `{ id, label, icon, badge?, content }`를 붙이거나 직접 배열을 만듭니다. `only: ["inbox"]`로 일부만 보입니다. 열기·바꾸기는 `useShell().openEnd(id)`.
- 상태 표시줄 칸 바꾸기: `defaultStatusCells({ ..., link })`로 연결 칸을 바꾸거나 결과 배열을 고칩니다.
- 처음부터 팔레트를 연 상태: `<ShellStateProvider initialPaletteOpen>`. 처음 탭: `initialTab`.
- 페이지 대화 상자가 열려 있으면 `modalOpen`을 줘서 셸이 Esc를 쓰지 않게 합니다.
- 받은 요청 탭 내용은 승인 결정 상태를 가진 페이지가 만듭니다(P-02는 `p02-opus/inbox.tsx`). 카드 부품은 `ToolApprovalCard`, `QuestionCard`, `NoticeList`를 씁니다.
