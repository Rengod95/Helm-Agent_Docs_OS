// 문서(뷰포트) 스크롤 안전망. styles.css의 base 층이 html·body를 막고, 이 가드는 코드가 `scrollIntoView`나 초점 이동으로
// 문서를 움직였을 때 스크롤 위치를 0으로 되돌린다. 안쪽 스크롤 영역은 스크롤 이벤트가 문서까지 올라오지 않으므로 건드리지 않는다.

/** 가드가 쓰는 문서의 모양. `Document` 전체 대신 스크롤 위치만 적는다 */
interface GuardedDocument {
  readonly scrollingElement: { scrollTop: number; scrollLeft: number } | null;
}

/** 가드가 듣는 창의 모양. 문서의 스크롤 이벤트는 창까지 올라오므로 캡처 없이 듣는다 */
interface GuardedWindow {
  addEventListener(type: "scroll", listener: () => void): void;
  removeEventListener(type: "scroll", listener: () => void): void;
}

/** 문서 스크롤을 0으로 되돌리는 가드를 단다. 돌려주는 함수를 부르면 뗀다 */
export function installDocumentScrollGuard(doc: GuardedDocument, win: GuardedWindow): () => void {
  const reset = (): void => {
    const root = doc.scrollingElement;
    if (root === null) return;
    if (root.scrollTop === 0 && root.scrollLeft === 0) return;
    root.scrollTop = 0;
    root.scrollLeft = 0;
  };
  win.addEventListener("scroll", reset);
  return (): void => {
    win.removeEventListener("scroll", reset);
  };
}
