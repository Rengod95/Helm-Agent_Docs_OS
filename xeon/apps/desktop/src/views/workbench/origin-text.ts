// 플러그인이 어디서 왔는지의 글(AGE-76 plugMin: 사용자가 넣은 것은 어디서나 "직접 설치"로 쓴다).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";

const ORIGIN_TEXT: Readonly<Record<NonNullable<ExtListEntry["origin"]>, MessageId>> = {
  builtin: "desktop.workbench.origin.builtin",
  managed: "desktop.workbench.origin.managed",
  user: "desktop.workbench.origin.user",
  project: "desktop.workbench.origin.project",
};

export const originText = (origin: ExtListEntry["origin"]): string =>
  origin === undefined ? "-" : t(ORIGIN_TEXT[origin]);
