// 목업 전용 라우팅: 시안 폴더끼리 한 앱처럼 오간다. 빌드 루트(mock-build/pages-v3/<폴더>/index.html) 안의 옆 폴더로 상대 URL 이동한다.
// 이동할 때 theme·lang·type·chrome·dev 쿼리를 유지한다. 페이지를 읽을 때 부모 창(비교 페이지)에 { type: "fresnel-route", page: <폴더> }를 알린다.
// 이 파일이 유일한 이동 창구다: 셸 내비·설정 탭·크래프트 내비·goFolder가 모두 navigateToPage를 부른다. 규칙(경로 표)은 아래 PAGE_ROUTES 한 곳.

/** 지금 페이지의 폴더 이름: .../<폴더>/index.html 의 <폴더>. 개발 서버(루트가 곧 폴더)에서는 빈 문자열. */
export function currentFolder(): string {
  const parts = window.location.pathname.split("/").filter((p) => p !== "");
  const last = parts[parts.length - 1];
  if (last === "index.html") return parts[parts.length - 2] ?? "";
  return last ?? "";
}

const KEEP = ["theme", "lang", "type", "chrome", "dev"] as const;

/** 옆 폴더로 가는 상대 URL. 지금 쿼리에서 theme·lang·type·chrome·dev를 유지하고 query(예 "tab=models&state=S2")를 덧붙인다. */
export function pageHref(folder: string, query = ""): string {
  const now = new URLSearchParams(window.location.search);
  const next = new URLSearchParams(query);
  for (const k of KEEP) {
    const v = now.get(k);
    if (v !== null && !next.has(k)) next.set(k, v);
  }
  const q = next.toString();
  return `../${folder}/index.html${q === "" ? "" : `?${q}`}`;
}

/** 옆 폴더로 이동한다. 이미 그 폴더면 아무것도 하지 않고 false. */
export function navigateToPage(folder: string, query = ""): boolean {
  if (folder === currentFolder()) return false;
  window.location.href = pageHref(folder, query);
  return true;
}

/** 부모 창(비교 페이지 iframe)에 지금 페이지를 알린다. 부모가 없으면(자기 자신이 최상위) 아무것도 하지 않는다. */
export function postRoute(folder: string = currentFolder()): void {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "fresnel-route", page: folder }, "*");
}
