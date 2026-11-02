# P-02 대화 셸 목업 (p02-opus)

실행(`xeon/apps/desktop`에서):

- 개발 서버: `MOCKUP=p02-opus MOCKUP_PORT=5181 mise exec -- bun run mockup`
- 정적 빌드: `MOCKUP=p02-opus MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태: `?state=S1`~`S7`(기본 S1), 테마: `?theme=dark`. 창 위 "목업 전용" 띠의 `Select` 두 개로도 바꿉니다.

## 파일

창 셸(왼쪽 패널, 오른쪽 막대·well, 상태 표시줄, 팔레트, 개발용 띠, 글꼴, 아이콘, 공용 고정 데이터, 승인·질문 카드, 알림 목록)은 `../_shell`에 있습니다(`_shell/README.md`). 이 폴더는 P-02 고유 부분만 둡니다.

| 파일 | 하는 일 |
|---|---|
| `main.tsx` | 진입점: 글꼴, `MockRoot`(S1~S7), `ShellStateProvider`, 페이지 상태 |
| `store.tsx` | P-02 상태(대화 고르기, 승인 결정, 입력, 연결·잠김). 셸 상태를 함께 실어 `useMock()` 하나로 읽음 |
| `app.tsx` | `Shell`에 대화 내용·받은 요청 탭·상태 칸·팔레트 동작을 꽂음, ⌘.·⌘L |
| `stage.tsx` | 대화 머리, 트랜스크립트, 입력창, 빈 상태 |
| `inbox.tsx` | 오른쪽 well 받은 요청 탭 내용 |
| `locked-dialog.tsx` | S5 O-01 잠긴 대화 |
| `fixtures.ts` | 트랜스크립트(공용 데이터는 `_shell/fixtures.ts`) |
| `parts/` | 도구 호출 행, 인라인 코드, 작성 중 커서, 관찰 띠 |
| `shots/S1.png`~`S7.png` | 1280px 라이트 스크린숏 |

## 쓴 caustic 부품

`SidePanel`(왼쪽, docked outline, inspector 폭 끌기, size sm), `ListDescription`/`ListDescriptionRow`, `Input`, `FloatingBar`/`FloatingBarItem`(vertical, 새 `badge` prop), `Card`(variant well)/`CardPanel`,
`ListNavigation`/`ListNavigationGroup`/`ListNavigationItem`(navigation, sessions, size sm),
`IconButton`, `Button`, `Badge`, `Menu`/`MenuItem`/`MenuSeparator`,
`EmptyState`(dashed, agent), `ScrollArea`, `Message`, `MessageCode`, `Thinking`, `ToolCall`, `AgentRequest`(permission, 기록 allowed/denied/answered),
`ChoiceGroup`/`ChoiceGroupItem`(answer), `Input`, `Card`, `Composer`(모드 steer/followUp, 모델, 사용량 고리, 보내기·중단),
`Suggestions`/`SuggestionsItem`, `Alert`(warning), `Dialog`(alert, 팔레트), `DialogTitle`, `DialogDescription`,
`Combobox`(mode inline, 묶음), `Popover`/`PopoverTitle`/`PopoverDescription`, `Progress`, `Select`/`SelectOption`.

## 직접 만든 부품(`parts/`, caustic 토큰과 Tailwind 유틸리티만)

| 파일 | 메운 빈틈 |
|---|---|
| `_shell/parts/status-bar.tsx` | C-03 상태 표시줄(창 아래 28px 띠, `Button xs ghost` + `Popover` 칸), C-05 게이지(`Progress`로 대신) |
| `_shell/parts/notice-list.tsx` | C-02 알림함(종류, 안 읽음, 시각) |
| `tool-row.tsx` | `ToolCall`에 접기·펼치기가 없음(실패한 bash는 처음부터 펼침), C-15 도구 출력 |
| `_shell/parts/question-card.tsx` | `AgentRequest`에 질문 kind가 없음(permission은 방패 고정, proposal은 영어 "Proposal ·" 머리). permission 카드 치수를 따름 |
| `rich-text.tsx` | C-06 Markdown: 백틱 인라인 코드만 `<code>` |
| `streaming-text.tsx` | `Message streaming`에 작성 중 커서가 없음. 깜빡이는 커서 하나 |
| `observe-band.tsx` | `Composer`에 "관찰 중" 잠금 상태가 없음 |

`mockup.css`는 caustic 스타일 import, 목업 폴더 `@source`, 높이 100%, 커서 깜빡임 keyframes(색 없음)만 둡니다.

## 설계 원칙 반영(스펙 §13.1 DP-01~10)

- 표면은 왼쪽 패널과 오른쪽 well뿐. 대화 영역은 창 바탕(bg-app) 그대로이고 카드로 감싸지 않습니다.
- 제목 띠·경로 없음. 찾기는 왼쪽 패널 머리, 패널 열기는 대화 머리(닫혔을 때만), 받은 요청·탐구·작업은 오른쪽 막대, 설정은 왼쪽 패널 바닥.
- 키 칩·단축키 표기 없음(단축키는 동작만).
- 여백은 창 바깥 한 곳(6px)과 각 부품 안쪽 한 곳에서만.
- 오른쪽: 접으면 `FloatingBar` 세로 막대(받은 요청 수 배지), 펼치면 누른 아이콘 모서리에서 커지는 `Card variant="well"` 안에 `CardPanel`. 넓은 폭은 대화 영역을 밀고(헤어라인), 1100px 이하는 대화 위에 떠 그림자 하나.
- well 안의 승인·질문 카드는 상자 없이(`flat`) 간격으로만 묶습니다. 대화 안의 같은 카드는 헤어라인 표면입니다.

## 3차(DP-12~16)

- 검은 화면: `fonts.css` 첫 줄의 원격 Google Fonts `@import`가 번들 CSS 맨 앞에 남아, 호스트가 막히면 스타일시트와 모듈 스크립트가 함께 멈춰 React가 마운트되지 않았습니다(호스트를 막은 헤드리스 Chrome에서 재현: `styleSheets 0`, `#root` 비어 있음). `fonts.ts`로 고쳐 막힌 상태에서도 그려지고 SUIT가 실립니다.
- 승인 상세는 `ListDescription` 한 목록(명령, 위험도, 시크릿, 인자).
- 왼쪽 패널은 위아래 끝까지 붙는 docked 면, 머리는 `Input` 찾기 + 늘 보이는 접기 버튼.
- 상태 칩은 caustic `ToolCall` 쪽에서 앞 아이콘 여백을 2px로 맞춤.

## 강조·깊이 규칙(2차 수정)

- 항목마다 강조는 하나: 지금 화면 내비는 굵기만, 고른 대화 행만 올린 바탕, 예약 실패는 빨간 숫자만, 대화 행 승인 수는 색 없는 글자, 알림은 종류 아이콘 색만.
- 보이는 깊이는 한 단계: 패널과 대화 안 승인·질문 카드는 그림자 대신 `border-subtle` 헤어라인. 떠 있는 것은 입력창(`Composer`), 오른쪽 막대, 좁은 폭에서 뜬 패널(그림자 하나, 헤어라인 없음), 대화 상자뿐.
- 장식 띠 제거: 시작 영역 머리("새 대화" 줄) 없음(새 대화는 폴더 묶음 +, ⌘N, 팔레트), 무대 머리는 한 줄(제목 · 목표). 작업 폴더는 제목 띠 경로에 있으므로 좁은 폭에서만 무대 머리에 보임.
- 상자 남발 제거: 제안·알림은 패널 위 행, 빈 상태는 점선 상자 없이, 입력창 아래 키 안내 줄 없음(placeholder가 말함), 버튼 안 `Kbd` 칩 없음(승인 카드는 한 줄 키 안내).

## 브리프와 다르게 한 것

- 승인 카드 버튼 순서는 caustic 규칙을 따랐습니다: 거부(N)가 시작 쪽, "이 대화에서 항상(⇧Y)"과 "허용(Y)"이 끝 쪽. 와이어프레임은 허용이 앞입니다.
- 개발용 `Select`는 창 위 별도 띠(목업 전용)에 둡니다. DOM에서는 맨 뒤라 앱 Tab 순서(건너뛰기 → 왼쪽 패널 → 대화 → 입력창 → 오른쪽 막대·well → 상태 표시줄)를 흐트리지 않습니다.
- 브리프의 제목 띠, Breadcrumb, 무대 머리의 탐구·작업 버튼, `Kbd` 표기, 끝 영역 `Tabs`는 DP-05·06·10에 따라 없앴습니다(기능은 위 자리로 옮김).
- 무대 머리에서 작업 폴더를 뺐습니다(제목 띠 경로와 겹침, 사용자 2차 피드백). 좁은 폭(경로에서 폴더가 빠질 때)에만 보입니다.
- 메시지 앞 "나/어시스턴트" 이름 줄은 두지 않았습니다. caustic `Message`가 사람(산세리프 말풍선)과 에이전트(세리프)를 목소리로 나눕니다.
- 실행 중에는 `Composer`가 Enter 제출을 막으므로, 실행 중 Enter는 큐 입력(steer)으로 받아 "다음 도구 라운드 뒤 들어가요 (steer)"와 함께 붙입니다.
- 승인 카드는 그 승인을 낸 대화(캐시 무효화 조사)에서만 트랜스크립트에 보입니다. S6은 브리프대로 같은 자리에 a2 질문 카드를 둡니다.

## 확인한 것

- 1280·1000·700px에서 가로 스크롤 없음. 1000px은 오른쪽 well이 대화 위에 뜨고(막대 아이콘이나 ⌘J), 700px은 왼쪽 패널도 뜹니다(대화 머리의 열기 버튼이나 ⌘\). Esc로 닫습니다.
- `grep -E '#[0-9a-fA-F]{3,6}|rgb\(' mockups/p02-*`(이 폴더) 비어 있음.
- 랜드마크: `main`(대화) 하나, `aside` 두 개(대화와 이동, 맥락 패널), `role="status"` 하나. 라벨 없는 버튼 0, 중복 id 0(헤드리스 Chrome DOM 검사).
- axe는 돌리지 못했습니다: 작업 트리에 `axe-core`가 없고 설치는 목업 범위 밖이라 위 DOM 검사로 대신했습니다.

## 알려진 한계

- caustic `ListNavigationItem`의 화면 리더 상태 단어가 영어("Running:", "Failed:")입니다(caustic i18n 빈틈).
- 팔레트 목록 높이는 caustic listbox 상한이라 8개 중 일부는 스크롤해야 보입니다.

## 환경

`_shell/icons.ts`는 caustic 아이콘 어댑터(`@caustic/react/icons`)를 다시 내보냅니다(DP-17). 이름은 lucide 이름 그대로입니다.
세트는 Solar 하나입니다(DP-17).
