# e01 화면 언어와 접근성 (N-49, N-50)

## 영어 스모크(N-49)
- `?lang=en`이면 셸 전체가 영어로 바뀝니다. `_shell/i18n.ts`(`LANG`, `L()`, `L2()`, `switchLang()`), `_shell/terms.en.ts`(`T_EN`, T의 모든 키), `_shell/ui.en.ts`(셸 문구 사전, 한국어 원문이 키). `?lang`이 없으면 다른 페이지는 예전과 같습니다. 개발 띠에 언어 Select가 붙는 것도 `?lang`이나 `?dev=1`일 때만입니다.
- 한국어로 남는 곳이 곧 "아직 메시지 키로 빼지 않은 문구"입니다(Y15 검사 자리). 1280·1000·700에서 대화, 작업대 확장 목록, 상태 표시줄 Popover, 설정 외관 탭을 찍었습니다(`chat-en*`, `wb-ext-en*`, `status-pop-en`, `settings-en*`).
- 깨진 곳과 셸에 넣은 일반 규칙:
  - 상태 표시줄이 1000에서 오른쪽 칸(알림)을 잘라 먹었습니다 → `parts/status-bar.tsx`: 칸 글은 말줄임, 개수·상태 점 칸(승인, 알림, 확장 실패, 진행 중, 연결, 엔진, 문맥, 목표)은 줄이지 않고 대상·모델·진행권 칸이 먼저 줄어듭니다. 자리가 넉넉하면 예전과 같습니다.
  - 대화 행 meta "Approvals 1"이 제목을 반 넘게 밀었습니다 → 영어는 "1 to approve"(숫자 먼저, 짧게).
  - 작업대 표는 caustic Table이 열 폭을 글 길이로 늘려 가로 스크롤이 생겨, 열마다 최소·최대 폭을 둔 격자(`e04-workbench-states/parts/ext-table.tsx`)로 그렸습니다. 글 칸은 한 줄 말줄임 + title, 상태 칸은 점이 먼저라 잘려도 상태가 읽힙니다.
  - 확장 표시 이름도 언어를 따릅니다(`extName()` → `L()`, 매니페스트 displayName의 locale 값 자리).
- 남은 문제(고치지 않고 보이게 둠):
  - 용어 조각으로 이은 문장은 영어에서 어순이 틀립니다("Helm Driving", "Helm이 Drive lease를 쥐고 있어요", "Runtime 보기"). 상태 표시줄 진행권 Popover와 런타임 줄이 그렇습니다. → 원칙 제안 E-3.
  - 한국어 원문을 키로 쓰는 사전은 같은 한국어가 뜻이 다를 때 부딪칩니다: "비밀"이 승인 카드 이름표(Secret)와 설정 탭(Secrets)에 같이 쓰여 탭이 "Secret"으로 나옵니다. → 메시지 키는 id로(원칙 E-4).
  - 200% 확대(`zoom-200`, 1280×800 창을 640×400 CSS px로 찍음)에서 대화 기록이 세로 150px 남짓만 남습니다(머리 2줄 + 승인 카드 + 입력창 2줄). → 원칙 E-6.

## 접근성(N-50)
- 초점 정류장 다섯: 1 영역 바꾸기 → 2 보기 기준 칸(작업대) / 내비·대화 목록(대화) → 3 가운데 → 4 오른쪽 well → 5 상태 표시줄. `focus-order`(작업대), `focus-order-chat`(대화) 덧그림은 목업 전용입니다. 정류장 사이 이동 키로 F6·⇧F6을 제안합니다(정류장 안은 Tab). ⌘⇧A(`approval.next`)는 기다리는 승인 카드로 바로 갑니다.
- 승인 카드 Y·N·⇧Y는 카드(또는 카드 안 버튼)에 초점이 있을 때만이고, 입력란 안에서는 글자로 들어갑니다(`keyboard-only-fail`). 답하면 카드가 기록 줄로 바뀌어 초점을 잃지 않게 입력창으로 옮깁니다.
- aria-live: 보이지 않는 polite 영역 하나 + alert 영역 하나(`LiveRegion`). 개발용 자막(`LiveCaptions`, 오른쪽 아래)이 같은 문장을 보입니다. 문장 목록은 SCENARIOS.md 끝에 있습니다. 초점 이동은 live로 읽지 않습니다(요소 이름으로 읽힘).
- 움직임 줄이기: caustic은 `prefers-reduced-motion` 미디어 쿼리만 있어 앱 설정으로 켤 고리가 없습니다. 목업은 `[data-motion="reduce"]`로 같은 규칙을 걸고(mockup.css), 가짜 스트리밍(useTypewriter)도 끕니다.
- 강제 색(고대비): 헤드리스 크롬에서 켤 수 없어 색 고정으로 흉내 냈습니다. `hc-broken`: 초점 고리(box-shadow)가 사라지고, 패널·well·입력창 면이 바탕과 합쳐지고, 고른 행·상태 점·켜진 스위치가 안 보입니다. `hc-fixed`: 초점 outline 2px Highlight, 면마다 1px 선, 고른 행·켜진 스위치 Highlight 면, 점은 글자색. 흉내에서 ToolCall 머리 글자가 사라지는데, 실제 forced-colors에서도 그런지 확인이 필요합니다.

## caustic 부품
`Select`, `Button`, `ToolApprovalCard`(셸, `AgentRequest`), `Alert`, `toast`, 공용 `_settings` 틀(`SettingsFrame`, `SettingRow`, `SettingSection`), `_chat-rt`(`ChatStage`, `ChatHead`, `ChatComposer`, `Items`, `RuntimePanel`).

## 직접 만든 것과 빈틈
- `parts/a11y-overlay.tsx`: 정류장 덧그림(각 정류장 요소 안에 포털로 넣어 창 크기를 따라감), 낭독 자막, 프로그램 초점 고리(`data-sim-focus`).
- caustic 빈틈: (1) 앱 설정용 움직임 줄이기 선택자, (2) `@media (forced-colors: active)` 규칙 묶음(초점 outline, 면 테두리, 선택 Highlight), (3) 영역 이동(F6) 같은 랜드마크 이동 도구.

## 웹·좁은 폭
- 웹은 같은 문구 사전을 씁니다. 700에서는 상태 표시줄이 연결·승인만 남아 영어 길이 문제가 없습니다. 좁은 폭 배치는 e05.
