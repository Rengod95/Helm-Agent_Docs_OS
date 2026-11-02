// 목업 전용 라우팅: 시안 폴더끼리 한 앱처럼 오간다. 빌드 루트(<루트>/<폴더>/index.html) 안의 옆 폴더로 상대 URL 이동한다.
// 이동할 때 theme·lang·type·chrome·dev 쿼리는 지금 URL에서 가져가고 state는 가져가지 않는다(옮긴 시안은 처음 상태로 연다).
// 이 파일이 유일한 이동 창구다: 셸 내비·설정 버튼·영역 바꾸기·팔레트·설정 탭·크래프트 내비·goFolder가 모두 여기를 부른다.
// 내비 id → 시안 표는 PAGE_ROUTES 한 곳. 페이지가 뜨면 부모 창(비교 페이지)에 { type: "fresnel-route", page: <폴더> }를 알린다.
// 개발 서버(폴더가 곧 루트)에는 옆 폴더가 없어서 아무 데도 옮기지 않는다. 옮기려면 정적 빌드를 쓴다.

/** 지금 페이지의 폴더 이름: .../<폴더>/index.html 의 <폴더>. 개발 서버(루트가 곧 폴더)에서는 빈 문자열. */
export function currentFolder(): string {
  const parts = window.location.pathname.split("/").filter((p) => p !== "");
  const last = parts[parts.length - 1];
  if (last === "index.html") return parts[parts.length - 2] ?? "";
  return last ?? "";
}

const KEEP = ["theme", "lang", "type", "chrome", "dev"] as const;

/** 옆 폴더로 가는 상대 URL. 지금 쿼리에서 theme·lang·type·chrome·dev를 가져오고(state는 가져가지 않는다) query(예 "tab=budgets")를 덧붙인다. */
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

/** 옮길 수 있는 자리인가: 정적 빌드 안이어야 한다(개발 서버는 폴더가 루트라 옆 폴더가 없다). */
function canMove(): boolean {
  return currentFolder() !== "";
}

function go(folder: string, query: string): void {
  window.location.href = pageHref(folder, query);
}

/** 옆 폴더로 옮긴다. 지금 폴더와 같으면(또는 옮길 수 없으면) 아무것도 하지 않고 false: 호출한 페이지가 그 자리에서 바꾼다. */
export function navigateToPage(folder: string, query = ""): boolean {
  if (!canMove() || folder === currentFolder()) return false;
  go(folder, query);
  return true;
}

/** 시안 한 화면의 자리: 폴더와(있으면) 그 시안을 어느 상태·화면으로 열지 정하는 쿼리. */
export interface PageRoute {
  folder: string;
  /** 옆 시안의 쿼리(예 "state=S5"). 없으면 처음 상태. */
  query?: string;
}

/**
 * 내비 id → 옆 시안. 대화 내비, 설정 버튼, 크래프트 내비, 플러그인 화면 id("<확장>/<화면>")를 적는다.
 * 표에 없는 id는 목업 밖이라 누르면 아무 일도 없다(inert). 대화 목록의 행은 여기 없다:
 * 대화 하나를 URL로 여는 방법이 없어서(p02는 대화를 상태로만 고른다) 행은 페이지가 맡는다.
 */
export const PAGE_ROUTES: Readonly<Record<string, PageRoute>> = {
  // 대화 영역 주 내비(fixtures.nav). 대화(chat)가 시작 화면이다.
  chat: { folder: "p02-opus" },
  inbox: { folder: "p03-inbox" },
  proposals: { folder: "p06-proposals" },
  schedules: { folder: "p07-schedules" },
  connection: { folder: "p08-connection" },
  // 왼쪽 패널 아래 설정 버튼(두 영역 공통). 일반 설정은 P-09, 전용 탭은 _settings/tabs.ts가 맡는다.
  settings: { folder: "p09-settings" },
  // 크래프트 내비(fixtures.workbenchNav). 측정 = P-20(wb2-opus의 W7 화면), 엔진 = P-15 엔진(크래프트) 상태(d03 페이지 상태 묶음).
  overview: { folder: "wb-v3" },
  extensions: { folder: "c03-ext-list" },
  tests: { folder: "c01-trials" },
  metrics: { folder: "wb2-opus", query: "state=S5" },
  compose: { folder: "wb-compose" },
  engine: { folder: "d03-page-states", query: "page=p15&state=D-engine" },
  // 플러그인 화면(fixtures.pluginPages). review/queue는 꺼진 확장이라 옆 시안이 없다(inert).
  "helm/inquiry": { folder: "p05-helm" },
};

function routeOf(id: string): PageRoute | undefined {
  return Object.hasOwn(PAGE_ROUTES, id) ? PAGE_ROUTES[id] : undefined;
}

/** 내비 id(셸·크래프트·플러그인 화면)의 옆 폴더. 표에 없으면 undefined(inert). */
export function routeForNav(id: string): string | undefined {
  return routeOf(id)?.folder;
}

/** 지금 화면이 그 시안인가: 폴더가 같고, 표의 쿼리 값도 지금 URL과 같다(예: 같은 폴더라도 state가 다르면 다른 화면). */
function isHere(route: PageRoute): boolean {
  if (route.folder !== currentFolder()) return false;
  const now = new URLSearchParams(window.location.search);
  for (const [k, v] of new URLSearchParams(route.query ?? "")) {
    if (now.get(k) !== v) return false;
  }
  return true;
}

/** 내비 id로 옮긴다. 옆 시안이면 그리로 가고 true. 표에 없거나 지금 화면이면 false: 호출한 쪽(페이지의 onNavSelect)에 맡긴다. */
export function navigateToNav(id: string): boolean {
  const route = routeOf(id);
  if (route === undefined || !canMove() || isHere(route)) return false;
  go(route.folder, route.query ?? "");
  return true;
}

/** 영역 바꾸기(§4.9.2): 대화 영역은 대화 시안(chat), 크래프트 영역은 크래프트 개요 시안(overview)으로 옮긴다. */
export function navigateToArea(area: "chat" | "workbench"): boolean {
  return navigateToNav(area === "chat" ? "chat" : "overview");
}

/** 팔레트 항목 → 내비 id. 키는 "묶음:라벨"(fixtures.palette 그대로). 대화 묶음(대화 행)은 페이지가 맡는다. */
export const PALETTE_NAV: Readonly<Record<string, string>> = {
  "크래프트:크래프트 개요": "overview",
  "크래프트:확장": "extensions",
  "크래프트:Helm 탐구": "helm/inquiry",
  "설정:기본 모델": "settings",
};

/** 팔레트에서 시안으로 가는 항목이면 옮기고 true. 나머지는 false(페이지의 onPaletteRun이 맡는다). */
export function navigateToPaletteItem(group: string, label: string): boolean {
  const key = `${group}:${label}`;
  return Object.hasOwn(PALETTE_NAV, key) && navigateToNav(PALETTE_NAV[key] ?? "");
}

/** 부모 창(비교 페이지 iframe)에 지금 시안을 알린다. 최상위 창이면(부모가 없으면) 아무것도 하지 않는다. */
export function postRoute(folder: string = currentFolder()): void {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "fresnel-route", page: folder }, "*");
}
