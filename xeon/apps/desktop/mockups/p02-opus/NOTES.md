# P-02 대화 셸 목업 (p02-opus)

실행(`xeon/apps/desktop`에서):

- 개발 서버: `MOCKUP=p02-opus MOCKUP_PORT=5181 mise exec -- bun run mockup`
- 정적 빌드: `MOCKUP=p02-opus MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태: `?state=S1`~`S7`(기본 S1), 테마: `?theme=dark`. 창 위 "목업 전용" 띠의 `Select` 두 개로도 바꿉니다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `main.tsx` | 진입점, URL 상태·테마, 개발용 띠 |
| `store.tsx` | 목업 로컬 상태(S1~S7 초기값, 패널, 승인 결정, 입력, 폭 단계) |
| `app.tsx` | `AppShell` 조립, 전역 바로 가기 키, 상태 표시줄 칸 |
| `titlebar.tsx`, `start-panel.tsx`, `stage.tsx`, `end-panel.tsx` | 제목 띠, 시작 영역, 무대, 끝 영역 |
| `tool-approval.tsx` | 도구 승인 카드(`AgentRequest` 조합) |
| `palette.tsx`, `locked-dialog.tsx` | S7 팔레트, S5 O-01 잠긴 대화 |
| `fixtures.ts` | 스펙 §8.2 고정 데이터 그대로(타입만 덧붙임) |
| `icons.ts` | lucide-react 진입점(아래 "환경" 참고) |
| `parts/` | caustic에 없어 직접 만든 부품(아래 표) |
| `shots/S1.png`~`S7.png` | 1280px 라이트 스크린숏 |

## 쓴 caustic 부품

`AppShell`, `AppShellTitlebar`, `AppShellStart`, `AppShellStage`, `AppShellEnd`, `SidePanel`(start inspector 폭 끌기, end pane),
`ListNavigation`/`ListNavigationGroup`/`ListNavigationItem`(navigation, sessions), `Breadcrumb`/`BreadcrumbItem`/`BreadcrumbCurrent`,
`IconButton`, `Button`, `Badge`, `Chip`, `Kbd`, `Menu`/`MenuItem`/`MenuSeparator`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`,
`EmptyState`(dashed, agent), `ScrollArea`, `Message`, `MessageCode`, `Thinking`, `ToolCall`, `AgentRequest`(permission, 기록 allowed/denied/answered),
`ChoiceGroup`/`ChoiceGroupItem`(answer), `Input`, `Card`, `Composer`(모드 steer/followUp, 모델, 사용량 고리, 보내기·중단),
`Suggestions`/`SuggestionsItem`, `Alert`(warning), `Dialog`(alert, 팔레트), `DialogTitle`, `DialogDescription`,
`Combobox`(mode inline, 묶음), `Popover`/`PopoverTitle`/`PopoverDescription`, `Progress`, `Select`/`SelectOption`.

## 직접 만든 부품(`parts/`, caustic 토큰과 Tailwind 유틸리티만)

| 파일 | 메운 빈틈 |
|---|---|
| `status-bar.tsx` | C-03 상태 표시줄(창 아래 28px 띠, `Button xs ghost` + `Popover` 칸), C-05 게이지(`Progress`로 대신) |
| `notice-list.tsx` | C-02 알림함(종류, 안 읽음, 시각) |
| `tool-row.tsx` | `ToolCall`에 접기·펼치기가 없음(실패한 bash는 처음부터 펼침), C-15 도구 출력 |
| `question-card.tsx` | `AgentRequest`에 질문 kind가 없음(permission은 방패 고정, proposal은 영어 "Proposal ·" 머리). permission 카드 치수를 따름 |
| `disclosure.tsx` | 카드 안 작은 접기 줄("인자 (2)"). `Accordion`은 48px 머리라 큼 |
| `rich-text.tsx` | C-06 Markdown: 백틱 인라인 코드만 `<code>` |
| `streaming-text.tsx` | `Message streaming`에 작성 중 커서가 없음. 깜빡이는 커서 하나 |
| `observe-band.tsx` | `Composer`에 "관찰 중" 잠금 상태가 없음 |

`mockup.css`는 caustic 스타일 import, 목업 폴더 `@source`, 높이 100%, 커서 깜빡임 keyframes(색 없음)만 둡니다.

## 강조·깊이 규칙(2차 수정)

- 항목마다 강조는 하나: 지금 화면 내비는 굵기만, 고른 대화 행만 올린 바탕, 예약 실패는 빨간 숫자만, 대화 행 승인 수는 색 없는 글자, 알림은 종류 아이콘 색만.
- 보이는 깊이는 한 단계: 시작·끝 패널과 승인·질문 카드는 그림자 대신 `border-subtle` 헤어라인. 떠 있는 것은 입력창(`Composer`)과 시트로 뜬 패널(AppShell의 그림자, 헤어라인 없음), 대화 상자뿐.
- 장식 띠 제거: 시작 영역 머리("새 대화" 줄) 없음(새 대화는 폴더 묶음 +, ⌘N, 팔레트), 무대 머리는 한 줄(제목 · 목표). 작업 폴더는 제목 띠 경로에 있으므로 좁은 폭에서만 무대 머리에 보임.
- 상자 남발 제거: 제안·알림은 패널 위 행, 빈 상태는 점선 상자 없이, 입력창 아래 키 안내 줄 없음(placeholder가 말함), 버튼 안 `Kbd` 칩 없음(승인 카드는 한 줄 키 안내).

## 브리프와 다르게 한 것

- 승인 카드 버튼 순서는 caustic 규칙을 따랐습니다: 거부(N)가 시작 쪽, "이 대화에서 항상(⇧Y)"과 "허용(Y)"이 끝 쪽. 와이어프레임은 허용이 앞입니다.
- 개발용 `Select`는 앱 제목 띠를 가리지 않도록 창 위 별도 띠(오른쪽)에 둡니다. DOM에서는 맨 뒤라 앱 Tab 순서(건너뛰기 → 제목 띠 → 시작 → 무대 → 입력창 → 끝 → 상태 표시줄)를 흐트리지 않습니다.
- 무대 머리에서 작업 폴더를 뺐습니다(제목 띠 경로와 겹침, 사용자 2차 피드백). 좁은 폭(경로에서 폴더가 빠질 때)에만 보입니다.
- 메시지 앞 "나/어시스턴트" 이름 줄은 두지 않았습니다. caustic `Message`가 사람(산세리프 말풍선)과 에이전트(세리프)를 목소리로 나눕니다.
- 실행 중에는 `Composer`가 Enter 제출을 막으므로, 실행 중 Enter는 큐 입력(steer)으로 받아 "다음 도구 라운드 뒤 들어가요 (steer)"와 함께 붙입니다.
- 승인 카드는 그 승인을 낸 대화(캐시 무효화 조사)에서만 트랜스크립트에 보입니다. S6은 브리프대로 같은 자리에 a2 질문 카드를 둡니다.

## 확인한 것

- 1280·1000·700px에서 가로 스크롤 없음. 1000px은 끝 영역이 시트(⌘J나 받은 요청 버튼), 700px은 시작 영역도 시트(⌘\ 또는 제목 띠 토글). Esc로 시트를 닫습니다.
- `grep -E '#[0-9a-fA-F]{3,6}|rgb\(' mockups/p02-*`(이 폴더) 비어 있음.
- 랜드마크: `main`(대화) 하나, `aside` 두 개(대화와 이동, 맥락 패널), `role="status"` 하나. 라벨 없는 버튼 0, 중복 id 0(헤드리스 Chrome DOM 검사).
- axe는 돌리지 못했습니다: 작업 트리에 `axe-core`가 없고 설치는 목업 범위 밖이라 위 DOM 검사로 대신했습니다.

## 알려진 한계

- caustic `ListNavigationItem`의 화면 리더 상태 단어가 영어("Running:", "Failed:")입니다(caustic i18n 빈틈).
- 팔레트 목록 높이는 caustic listbox 상한이라 8개 중 일부는 스크롤해야 보입니다.

## 환경

데스크톱 패키지는 `lucide-react`를 직접 의존하지 않아(bun 격리 설치) 목업 폴더에서 맨 이름 import가 풀리지 않습니다.
`icons.ts`가 caustic이 쓰는 같은 lucide-react를 상대 경로로 다시 내보냅니다. 앱 코드로 옮길 때 `package.json`에 `lucide-react`를 넣고 이 파일을 지우면 됩니다.
