# kanban

`app` 프레임 화면(Plugin App) 하나를 가진 칸반 보드 예제다. 빌더의 앱 뼈대(`authoring_scaffold` mode `app`)에서 출발해 키웠다.
설치는 확장 폴더로 이 디렉터리를 넣으면 된다(앱 설정 `x.ui.apps`가 켜져 있어야 프레임이 뜨고, 확장은 기본으로 꺼져 있다).

- 상태: 카드 목록(id, 제목, 칸 `todo`, `doing`, `done` 가운데 하나, 칸 안의 순서)과 다음 카드 번호. 대화가 열려 있으면 대화 상태 문서에, 없으면 플러그인 저장소의 `board` 키에 둔다.
- 읽기 메서드 `board`, 쓰기 메서드 `move`(카드 id, 칸, 자리)와 `add`(제목, 할 일 칸 맨 끝).
- 모델 도구 `kanban_move_card`와 `kanban_add_card`는 메서드와 같은 함수(`moveCard`, `addCard`)를 쓴다.
- 화면(`ui/app/`): 카드를 끌어 다른 칸에 놓으면 `move`를 부른다. 셸이 `invalidate`를 보내면 `board`를 다시 읽는다. 대체 화면은 `ui/native/fallback.json`이다.
- 화면의 쓰기 호출마다 셸이 확인 줄을 띄운다(매니페스트 `label`인 "카드 옮기기", "카드 추가").

시험: `apps/host/test/handlers/kanban-ui-changes.test.ts`(실제 로더로 싣고 모델 도구로 옮긴 뒤 `ext.ui.changed`가 한 번 나가는지, 뼈대도 같은 로더로 실리는지), `apps/desktop/test/views/plugin/kanban-invalidate.test.ts`(알림이 프레임의 `invalidate`가 되는지), `packages/ext-host/test/loading-trust/example-kanban.test.ts`(화면 검사), `packages/core-authoring/test/example-kanban.test.ts`(제작 검사), `packages/core-authoring/test/example-kanban-store.test.ts`(대화 없이 여는 보드가 저장소에서 더하기와 옮기기를 값으로 주고받는지). 본보기 폴더는 워크스페이스 패키지가 아니므로 `just check examples/kanban`은 없다.
