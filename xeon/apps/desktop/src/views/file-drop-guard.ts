// `dragDropEnabled: false`(tauri.conf.json)에서는 Tauri가 파일 끌어놓기를 가로채지 않고 WebView에 HTML5 이벤트가 온다.
// 놓을 곳이 아닌 데(입력창 밖, 첨부가 막힌 입력창)에 파일을 놓으면 WebView가 그 파일 주소로 이동해 앱 화면이 사라진다.
// 창 수준에서 이미 처리되지 않은 파일 끌기는 놓기를 막는다. 입력창은 자기 `dragover`/`drop`에서 먼저 `preventDefault`를 부르므로 건드리지 않는다.

/** 가드가 읽는 끌기 이벤트의 필드만 든 모양. `DragEvent`가 그대로 맞는다 */
interface DropLikeEvent {
  readonly type: string;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  readonly dataTransfer: { readonly types: readonly string[]; dropEffect: string } | null;
}

/** 이 파일 끌기 가드가 쓰는 창의 모양 */
export interface DropTarget {
  addEventListener(type: "dragover" | "drop", listener: (event: DropLikeEvent) => void): void;
  removeEventListener(type: "dragover" | "drop", listener: (event: DropLikeEvent) => void): void;
}

/** 끌고 있는 것에 파일이 들었나. 글이나 링크 끌기는 가드가 보지 않는다 */
export function carriesFiles(types: readonly string[] | undefined): boolean {
  return types !== undefined && types.includes("Files");
}

function guard(event: DropLikeEvent): void {
  if (event.defaultPrevented) return;
  if (!carriesFiles(event.dataTransfer?.types)) return;
  event.preventDefault();
  if (event.type === "dragover" && event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = "none";
  }
}

/** 처리되지 않은 파일 끌기를 막는다. 해제 함수를 돌려준다 */
export function installFileDropGuard(target: DropTarget): () => void {
  target.addEventListener("dragover", guard);
  target.addEventListener("drop", guard);
  return () => {
    target.removeEventListener("dragover", guard);
    target.removeEventListener("drop", guard);
  };
}
