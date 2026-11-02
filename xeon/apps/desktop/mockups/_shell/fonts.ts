// caustic 글꼴(@caustic/tokens/fonts.css)을 렌더를 막지 않게 싣는다.
// 원인(3차 검은 화면): fonts.css 첫 줄이 원격 `@import url(fonts.googleapis.com…)`이다. 번들 CSS 맨 앞에 그대로 남아,
// 원격 호스트가 느리거나 막히면(오프라인, 방화벽, Tauri) 스타일시트 전체가 끝나지 않는다. 모듈 스크립트는 앞선
// 스타일시트를 기다리므로 React가 아예 마운트되지 않고 빈 창(다크 창에서는 검은 화면)만 남는다.
// 그래서 fonts.css를 문자열(?inline)로 받아 원격 @import 줄만 떼어 비동기 <link>로 붙이고, 나머지(SUIT @font-face,
// Vite가 woff2를 내보냄)는 <style>로 바로 넣는다. 원격 글꼴이 안 와도 화면은 뜨고 대체 글꼴로 그린다.
import fontsCss from "@caustic/tokens/fonts.css?inline";

const IMPORT = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*;?|@import\s+["']([^"']+)["']\s*;?/g;

export function loadCausticFonts(): void {
  const remote: string[] = [];
  const local = fontsCss.replace(IMPORT, (_m: string, a?: string, b?: string) => {
    const href = a ?? b;
    if (href !== undefined) remote.push(href);
    return "";
  });
  const style = document.createElement("style");
  style.dataset["source"] = "caustic-fonts";
  style.textContent = local;
  document.head.prepend(style);
  for (const href of remote) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link); // 스크립트가 넣은 <link>는 렌더를 막지 않는다
  }
}
