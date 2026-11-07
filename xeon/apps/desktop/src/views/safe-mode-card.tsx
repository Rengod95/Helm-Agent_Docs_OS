// 안전 모드 시작 제안 카드(U-06). 연속 시작 실패가 제안 기준에 닿았고 안전 모드가 아니면 대화 화면의 입력창 바로 위에 그린다.
// 경고는 글로 보이고(제목과 한 문장), 안전 모드가 무엇을 끄는지의 긴 설명은 정보 아이콘 뒤다(DP-58). 원인 목록은 호스트가 확장 이름을 주지 않아 두지 않는다.
import { t } from "@fresnel/client/i18n";
import { Card, ListDescription, ListDescriptionRow } from "@caustic/react";
import { useId, type ReactNode } from "react";
import { useEngineState } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { RestartButtons, type RestartChoice } from "./restart-confirm-dialog.tsx";
import { useSafeMode } from "./safe-mode-context.ts";
import {
  canSwitchSafeModeOf,
  safeModeStartOfferedOf,
  safeModeSurfaceOf,
} from "./safe-mode-model.ts";
import { useShellRestart } from "./shell-restart-context.ts";

const RETRY: RestartChoice = {
  id: "retry",
  label: "desktop.safe.retry",
  variant: "outline",
  options: { confirmed: true },
};

const START: RestartChoice = {
  id: "start",
  label: "desktop.safe.start",
  variant: "solid",
  options: { safeMode: true, confirmed: true },
};

export function SafeModeCard(): ReactNode {
  const snapshot = useSafeMode();
  const shellRestart = useShellRestart();
  const engine = useEngineState();
  const commands = useCommands();
  const startOffered = safeModeStartOfferedOf(commands.restore.engineTarget()?.kind === "remote");
  const headingId = useId();
  if (snapshot === null || safeModeSurfaceOf(snapshot, shellRestart) !== "card") return null;
  return (
    <Card role="alert" aria-labelledby={headingId} size="sm" className="mt-2 grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1">
        <h2 id={headingId} className="text-ui-strong text-text-primary">
          {t("desktop.safe.suggest.title", { count: snapshot.startupFailures })}
        </h2>
        <div className="flex min-w-0 items-start gap-1">
          <p className="m-0 text-ui-sm text-text-secondary">
            {t(startOffered ? "desktop.safe.suggest.body" : "desktop.safe.suggest.remote")}
          </p>
          {startOffered ? <InfoTip text={t("desktop.safe.suggest.info")} /> : null}
        </div>
      </div>
      <ListDescription aria-label={t("desktop.safe.failures")}>
        <ListDescriptionRow term={t("desktop.safe.failures")}>
          {snapshot.startupFailures}
        </ListDescriptionRow>
      </ListDescription>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RestartButtons
          choices={startOffered ? [RETRY, START] : [RETRY]}
          size="sm"
          allowed={canSwitchSafeModeOf(engine?.kind ?? null)}
        />
      </div>
    </Card>
  );
}
