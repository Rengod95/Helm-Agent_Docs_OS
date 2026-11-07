import { t } from "@fresnel/client/i18n";
import { Alert, Button } from "@caustic/react";
import type { ReactNode } from "react";
import { RestartNowButton } from "../../restart-confirm-dialog.tsx";

/**
 * 예약 만들기·고치기 시트 아래의 서비스 모드 안내(SC-07). 앱을 끝내면 예약이 멈춘다는 것을 저장하기 전에 보이고,
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

/**
 * 서비스 모드를 켰지만 엔진이 아직 다시 시작하지 않아 꺼진 것과 같을 때의 안내. 시트에서 "서비스 켜기"를 누르면 꺼짐 안내가
 * 사라지고 이 안내가 그 자리에 온다. 글과 단추는 예약 화면 띠와 같다(셸이 없으면 단추는 그리지 않는다)
 */
export function ServiceRestartNotice(): ReactNode {
  return (
    <Alert
      tone="warning"
      size="sm"
      action={<RestartNowButton size="xs" info={t("desktop.restart.info")} />}
    >
      {t("desktop.schedules.service.restartNeeded")}
    </Alert>
  );
}
