# kanban-native

`examples/kanban`과 같은 칸반 보드를 `native` 방식(Fresnel 기본 부품)으로 그린 본보기다. 화면에는 코드가 없고 트리 파일만 있다.
설치는 확장 폴더로 이 디렉터리를 넣으면 된다(확장은 기본으로 꺼져 있다). 위젯 카탈로그 1.1.0 이상이 필요하다(`ui.widgets` `^1.1.0`).

- 상태: 카드 목록(id, 제목, 열 `todo`, `doing`, `done` 가운데 하나, 열 안의 순서, 보조 글과 꼬리표는 선택)과 다음 카드 번호. 처음 보드에는 본보기 카드 넷이 있다.
- 읽기 메서드 `board`: 열(`columns`), 카드(`cards`), 할 일 열의 카드(`todo`)를 같이 준다. 화면은 `/board/...`로 읽는다.
- 쓰기 메서드 `move`(카드 id, 열, 자리), `add`(열, 제목), `reorder`(카드 id, 할 일 안의 자리). 셋 다 `ownDataOnly`라 화면에서 부를 때 확인 줄이 없다.
- 모델 도구 `kanban_native_move_card`, `kanban_native_add_card`는 메서드와 같은 함수(`moveCard`, `addCard`)를 쓴다.
- 화면:
  - `board`(페이지)와 `side`(대화 오른쪽 패널): `ui/native/board.view.json`의 `Board`. 카드를 끌거나 키보드로 옮기면 `move`를, 열 아래 "더하기"는 `add`를 부른다.
  - `order`(페이지): `ui/native/order.view.json`의 `SortableList`. 할 일 순서를 끌어 바꾸면 `reorder`를 부른다.
- 놓는 즉시 화면이 바뀌고, 메서드가 실패하면 되돌린 뒤 한 줄로 알린다.

시험: `packages/ext-host/test/loading-trust/example-kanban-native.test.ts`(화면 검사), `packages/core-authoring/test/example-kanban-native.test.ts`(제작 검사), `apps/host/test/handlers/kanban-native-moves.test.ts`(실제 로더로 싣고 메서드와 도구가 같은 보드를 고치는지).
