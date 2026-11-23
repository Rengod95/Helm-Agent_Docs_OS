// 보안 정책(CSP `default-src 'self'`)은 문서에 끼운 `<style>` 요소를 막는다(style-src-elem). 라이브러리가 `<style>`로 내보내는 CSS는
// CSSOM의 구성 가능한 스타일시트(`document.adoptedStyleSheets`)로 옮겨 적용한다. 정책은 느슨하게 하지 않는다(AGE-77 F-40).
// 같은 글은 하나의 시트를 나눠 쓰고, 쓰는 곳이 모두 놓으면 시트를 뺀다.

export interface SheetHost<S> {
  adoptedStyleSheets: S[];
}

export interface CssAdopter {
  /** CSS 글을 문서에 적용한다. 돌려받은 함수로 놓는다(여러 번 불러도 한 번만 놓인다) */
  adopt(text: string): () => void;
}

export function createCssAdopter<S>(host: SheetHost<S>, make: (text: string) => S): CssAdopter {
  const owned = new Map<string, { readonly sheet: S; users: number }>();
  return {
    adopt(text) {
      let entry = owned.get(text);
      if (entry === undefined) {
        entry = { sheet: make(text), users: 0 };
        owned.set(text, entry);
        host.adoptedStyleSheets = [...host.adoptedStyleSheets, entry.sheet];
      }
      entry.users += 1;
      const mine = entry;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        mine.users -= 1;
        if (mine.users > 0) return;
        owned.delete(text);
        host.adoptedStyleSheets = host.adoptedStyleSheets.filter((sheet) => sheet !== mine.sheet);
      };
    },
  };
}

let shared: CssAdopter | null = null;

/** 화면 문서에 적용한다. 브라우저의 `CSSStyleSheet`와 `document`를 쓴다 */
export function adoptCss(text: string): () => void {
  shared ??= createCssAdopter(document, (css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  });
  return shared.adopt(text);
}
