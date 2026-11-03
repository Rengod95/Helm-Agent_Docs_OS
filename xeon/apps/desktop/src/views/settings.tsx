import { t } from "@fresnel/client/i18n";
import type { CommandError } from "./commands.ts";

// 설정 오류 문장(첫 실행 P-01과 키 등록이 같은 오류 값을 쓴다). 최소 설정 화면의 본문은 P-01 첫 실행 화면과
// P-09 설정 화면(`pages/settings`)으로 옮겼고, 여기에는 두 화면이 아직 쓰는 함수만 남긴다.

export function errorText(error: CommandError): string {
  if (error.kind === "offline") return t("desktop.settings.error.offline");
  if (error.kind === "unsupported") return t("desktop.settings.error.unsupported");
  if (error.kind === "rejected" && error.detail !== undefined) {
    // 값이 틀렸다는 host의 문장은 사용자가 고칠 수 있는 내용이라 그대로 보인다(예: 알 수 없는 모델 ...)
    return t("desktop.settings.error.rejectedDetail", { detail: error.detail });
  }
  if (error.kind === "rejected" && error.code !== null) {
    return t("desktop.settings.error.rejectedCode", { code: error.code });
  }
  return t("desktop.settings.error.failed");
}
