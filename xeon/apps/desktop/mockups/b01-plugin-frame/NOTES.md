# B01 플러그인 화면 호스트 — 메모

## 범위

coverage-v2 N-15~N-20, N-26. 작업대 P-18 한 화면에서 왼쪽 "플러그인 화면" 목록으로 세 화면을 오갑니다: 작업 흐름판(`taskflow/board`, 사용자 설치, frame), Helm 탐구(`helm/inquiry`, declarative), 노트 지도(`acme-notes/map`, 이 프로젝트, frame). 앞 실행(WIP `f2f7f30c`)의 틀, 다리 부품, 승인·링크·설정 대화 상자를 살렸고 시나리오 id, 프로젝트 화면 동의, 꺼짐 상태, 대체 화면 동작, 머리 이름 규칙을 고쳤습니다.

## 레이아웃 결정

- 셸 층과 플러그인 층을 나눕니다. 셸: 머리 첫 줄, 상자 경계(안쪽 1px 테두리 하나, 여백 없음), 상자 위 한 줄(확인 줄, 승인 대기, 늦음, 거절), 상자 안 자리표시(준비 대기, 내림, 다리 불일치, 꺼짐). 플러그인: 상자 안 문서만. 프레임 안 판은 일부러 앱과 조금 다른 손맛(둥근 카드, 자체 단추)으로 그려 "앱 화면이 아님"을 보입니다(ADR-0021 §3.6.8).
- 머리 이름은 결정 13대로 "표시 이름 + 회색 mono id · 등급 · 버전"입니다. 제목은 화면 `title`(작업 흐름판), 확장 표시 이름(작업 흐름)과 따로입니다.
- 확인 줄은 caustic `Alert`(neutral, sm) 하나에 "이 화면에서 묻지 않기" 체크와 거절(기본 초점)·허용을 둡니다. 상자 밖이라 프레임이 흉내 낼 수 없습니다(T-16).
- 대체 화면은 기본 부품 트리라 확인 줄 없이 바로 `call`합니다(렌더러가 누름을 압니다).
- 프로젝트 확장 화면 동의(N-26)는 별도 화면 대신 "켜는 방법" → 설정 대화 상자 한 장입니다. 두 조건(프로젝트 신뢰 allow, `x.views.allowProjectFrames` 사용자 범위)을 ListDescription 두 줄로 보이고, 폴더 신뢰가 없으면 스위치를 잠급니다.

## caustic

`Alert`, `Badge`, `Button`, `Checkbox`, `Dialog`, `EmptyState`, `ListDescription`, `Skeleton`, `Stepper`, `Progress`, `Switch`, `Tooltip`, `AgentRequest`(승인 카드), `Toaster`.

## 직접 만든 것과 빈틈

- `parts/frame-host.tsx`: 프레임 상자, 상자 안 자리표시, 확인 줄, 머리 표지. caustic에 "셸 경계 + 안쪽 자리표시" 부품이 없습니다.
- `parts/frame-board.tsx`: 프레임 안 문서 흉내(판, 의존 그래프, 노트 지도). 토큰 색만 씁니다.
- `parts/declarative.tsx`: 기본 부품 트리(대체 화면, Helm 탐구). `wb-opus` 부품을 가져다 씁니다.
- `flow.ts`: `?step=`을 읽는 작은 시나리오 상태 기계. B02·B03도 씁니다(일반적이면 `_shell/scenario.tsx`로 옮길 후보).

## 웹·좁은 폭

- 웹(B5): `xeon-view://`가 Tauri 전용이라 프레임 화면은 늘 `frame_blocked`이고, 대체 화면이 있으면 그것을, 없으면 자리표시를 보입니다. 외부 링크는 "새 탭에서 열기"입니다.
- 700px: 판 세 열이 좁아지지만 그대로 읽힙니다. 상태 표시줄은 연결·승인만 남습니다.
