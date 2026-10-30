# 공용 셸 (`mockups/_shell`)

모든 페이지 목업이 같은 창 셸 위에 자기 가운데 내용과 오른쪽 well 내용만 꽂습니다. 기준은 `p02-opus`이고 설계 원칙은 스펙 `docs/xeon/L4/desktop-ux/spec.md` §13(DP-01~17)입니다.

## 들어 있는 것

| 파일 | 하는 일 |
|---|---|
| `shell.tsx` | `Shell`: 왼쪽 패널(창 위아래 끝까지) · 투명한 가운데(`main`) · 오른쪽 떠 있는 세로 막대 + well · 상태 표시줄 · 팔레트 · 건너뛰기 링크 · 전역 단축키(⌘K, ⌘\, ⌘J, ⌘N, Esc) |
| `state.tsx` | `ShellStateProvider`, `useShell()`: 폭 단계(wide·medium·compact), 왼쪽 패널, 오른쪽 well(열림·탭), 팔레트 |
| `start-panel.tsx` | 찾기 칸, 주 내비, 작업 폴더별 대화 목록, 설정 |
| `right-panel.tsx` | `RightTab`, `standardRightTabs()`(받은 요청·탐구·작업) |
| `status.tsx` | `defaultStatusCells()`(S-03 칸, compact 폭 축약) |
| `palette.tsx` | 명령 팔레트(S-02) |
| `dev.tsx` | `MockRoot`: `?state=`·`?theme=`와 개발용 띠(목업 전용) |
| `fonts.ts` | `loadCausticFonts()`: caustic 글꼴을 렌더를 막지 않게(DP-15) |
| `icons.ts` | caustic 아이콘 어댑터(Solar, DP-17) 다시 내보내기 |
| `fixtures.ts` | 공용 고정 데이터(대화 목록, 내비, 승인·제안·알림, 상태, 팔레트) |
| `parts/` | 상태 표시줄, 알림 목록, 도구 승인 카드, 질문 카드 |
| `shell.css` | 높이 100%, 창 바탕, 커서 깜빡임. Tailwind가 이 폴더도 읽게 `@source` |

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
   import { loadCausticFonts, MockRoot, ShellStateProvider, Shell, defaultStatusCells, standardRightTabs, useShell } from "../_shell";
   import "./mockup.css";
   loadCausticFonts();

   const STATES = [{ id: "S1", label: "S1 기본" }] as const;

   function Page() {
     const shell = useShell();
     return (
       <Shell
         activeNav="proposals"                        // 지금 화면인 주 내비 항목
         stageLabel="제안"                             // main 랜드마크 이름
         threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
         rightTabs={standardRightTabs({ inbox: <MyInbox />, inboxBadge: 5 })}
         status={defaultStatusCells({ layout: shell.layout, thread: false, pendingApprovals: 2, openEnd: shell.openEnd })}
       >
         {/* 가운데 내용: 투명 면 위에 바로(카드로 감싸지 않음, DP-01) */}
       </Shell>
     );
   }

   createRoot(document.getElementById("root")!).render(
     <MockRoot states={STATES}>{(state) => <ShellStateProvider><Page /></ShellStateProvider>}</MockRoot>,
   );
   ```

4. `mockups/index/pages.ts`에 한 줄 더합니다.
5. 실행: `MOCKUP=<폴더> MOCKUP_PORT=<포트> mise exec -- bun run mockup`, 빌드: `MOCKUP=<폴더> MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`.

## 자주 쓰는 것

- 지금 화면 표시: `activeNav`에 `nav[].id`(`chat`, `inbox`, `proposals`, `schedules`, `connection`). 그 항목만 굵기와 Solar bold 아이콘으로 보입니다. 다른 항목을 누르면 `onNavSelect(id)`가 불립니다(받은 요청은 셸이 오른쪽 well을 엽니다).
- 대화 목록: `threads.currentId`가 고른 행(올린 바탕은 이것 하나), `threads.draft`면 "새로 시작"에 새 대화 행.
- 오른쪽 탭 더하기: `standardRightTabs({...})` 결과에 `{ id, label, icon, badge?, content }`를 붙이거나 직접 배열을 만듭니다. `only: ["inbox"]`로 일부만 보입니다. 열기·바꾸기는 `useShell().openEnd(id)`.
- 상태 표시줄 칸 바꾸기: `defaultStatusCells({ ..., link })`로 연결 칸을 바꾸거나 결과 배열을 고칩니다.
- 처음부터 팔레트를 연 상태: `<ShellStateProvider initialPaletteOpen>`. 처음 탭: `initialTab`.
- 페이지 대화 상자가 열려 있으면 `modalOpen`을 줘서 셸이 Esc를 쓰지 않게 합니다.
- 받은 요청 탭 내용은 승인 결정 상태를 가진 페이지가 만듭니다(P-02는 `p02-opus/inbox.tsx`). 카드 부품은 `ToolApprovalCard`, `QuestionCard`, `NoticeList`를 씁니다.
