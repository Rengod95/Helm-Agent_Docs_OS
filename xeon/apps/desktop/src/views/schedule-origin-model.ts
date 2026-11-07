import { t } from "@fresnel/client/i18n";

// 대화 머리의 예약 줄(예약이 시작한 대화). 글은 "예약 · <예약 제목> · <n>번째 실행"이고, 모르는 부분은 뺀다.

/**
 * 예약 줄의 글. `title`은 예약 제목(없거나 모르면 null), `ordinal`은 이 대화가 그 예약의 몇 번째 실행인지(모르면 null)다.
 * 둘 다 모르면 "예약"만 남는다
 */
export function scheduleOriginTextOf(title: string | null, ordinal: number | null): string {
  const parts = [t("desktop.threads.scheduleBadge")];
  if (title !== null) parts.push(title);
  if (ordinal !== null) parts.push(t("desktop.threads.scheduleOrigin.run", { count: ordinal }));
  return parts.join(" · ");
}
