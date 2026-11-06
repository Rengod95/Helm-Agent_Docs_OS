import { t } from "@fresnel/client/i18n";
import { Alert, Button } from "@caustic/react";
import type { ReactNode } from "react";

/**
 * 예약 만들기·고치기 시트 아래의 서비스 모드 안내(SC-07). 앱을 끄면 예약이 돌지 않는다는 것을 저장하기 전에 보이고,
 * "서비스 켜기"는 예약 화면 위 띠와 같은 동작(`schedule.enableService`)이다
 */
export function ServiceOffNotice(props: {
  readonly canEnable: boolean;
  readonly onEnable: () => void;
}): ReactNode {
  return (
    <Alert
      tone="warning"
      size="sm"
      action={
        <Button size="xs" variant="ghost" disabled={!props.canEnable} onClick={props.onEnable}>
          {t("desktop.schedules.service.enable")}
        </Button>
      }
    >
      {t("desktop.schedules.sheet.serviceOff")}
    </Alert>
  );
}
