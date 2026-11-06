// 켜기·끄기 실패 토스트. caustic 규칙대로 실패(danger)는 저절로 닫히지 않으므로 닫기 단추를 달고, 같은 실패가 쌓여 아래 스위치를 가리지
// 않게 앞서 띄운 실패 토스트는 새로 띄울 때 닫는다(F-S4-3).
import { t } from "@fresnel/client/i18n";
import { toast, type ToastOptions } from "@caustic/react";

const last: { id: number | undefined } = { id: undefined };

/** 실패 토스트를 띄운다. 앞선 실패 토스트는 닫는다. 띄운 토스트의 id를 돌려준다 */
export function showFailureToast(options: ToastOptions): number {
  if (last.id !== undefined) toast.dismiss(last.id);
  last.id = toast({
    ...options,
    tone: "danger",
    dismissLabel: options.dismissLabel ?? t("desktop.workbench.toast.dismiss"),
  });
  return last.id;
}
