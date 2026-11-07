import { t } from "@fresnel/client/i18n";
import type { StartupNotice } from "@fresnel/contracts/wire";
import { shortenHome } from "./pages/settings/settings-file-paths.ts";

// 시작 때 저장소가 0바이트 DB 파일을 옮기고 빈 새 DB를 만든 일(`host.status.startupNotices`)의 문구 조각.
// 띠 그림은 `store-replaced-banner.tsx`가 그린다. 원래 파일의 자리는 옮긴 파일의 경로(`movedTo`)다.

/** 알림 칸에서 옮긴 파일의 경로. 이 시작에서 그런 일이 없으면 null이다 */
export function movedStoreFileOf(notices: readonly StartupNotice[]): string | null {
  // 지금 알림 종류는 `store_empty_replaced` 하나라 첫 항목이 그 일이다. 종류가 늘면 판별로 고른다
  return notices[0]?.movedTo ?? null;
}

/** 띠 한 문장. 옮긴 자리는 사용자 홈을 `~`로 줄여 보인다(`shortenHome`) */
export function storeReplacedTextOf(movedTo: string): string {
  return t("desktop.status.storeReplaced.message", { path: shortenHome(movedTo) });
}
