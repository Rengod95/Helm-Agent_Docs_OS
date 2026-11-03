import { L } from "../_shell/i18n";
import { navigateToPage } from "../_shell/routes";

// 설정 탭 13개(TAB_SPECS 순서, permissions와 sandbox 분리, 스펙 §6.13). P-10~P-13은 이 중 한 탭이다.
export const TABS = [
  { id: "overview", label: "개요" },
  { id: "models", label: "모델" },
  { id: "budgets", label: "예산과 한도" },
  { id: "providers", label: "계정과 제공자" },
  { id: "secrets", label: "시크릿" },
  { id: "permissions", label: "권한" },
  { id: "sandbox", label: "샌드박스" },
  { id: "session", label: "대화와 컨텍스트" },
  { id: "tools", label: "도구와 웹" },
  { id: "plugins", label: "플러그인과 그룹" },
  { id: "runtime", label: "실행과 서비스" },
  { id: "appearance", label: "외관" },
  { id: "advanced", label: "고급" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

// 묶음 E(N-49): 영어 화면(?lang=en)이면 셸 사전(L)으로 바꾼다. 한국어 화면은 그대로.
export const tabLabel = (id: TabId): string => L(TABS.find((t) => t.id === id)?.label ?? id);

/** 전용 화면이 따로 있는 탭과 그 목업 폴더. 탭을 누르면 옆 시안으로 옮긴다(_shell/routes.ts navigateToPage). */
export const TAB_PAGES: Partial<Record<TabId, string>> = {
  budgets: "p11-accounts",
  providers: "p11-accounts",
  secrets: "p10-secrets",
  tools: "p12-tools-web",
  plugins: "p13-plugins",
};

/** 나머지 탭(일반 폼, 개요 탭 포함)은 P-09가 그린다. */
export const GENERIC_PAGE = "p09-settings";

/** 탭이 사는 시안 폴더. */
export function tabFolder(id: TabId): string {
  return TAB_PAGES[id] ?? GENERIC_PAGE;
}

/** 설정 탭을 눌렀을 때: 다른 시안 폴더의 탭이면 그리로 옮기고(?tab=<id>) true. 같은 시안(here)이면 false: 페이지가 그 자리에서 탭을 바꾼다. */
export function gotoTabPage(id: TabId, here: string): boolean {
  const folder = tabFolder(id);
  if (folder === here) return false;
  return navigateToPage(folder, `tab=${id}`);
}
