// 엔진(`engine`, P-15): 연결 상태, 엔진 버전, 다시 연결·다시 시작·진단 복사.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button, toast } from "@caustic/react";
import type { ReactNode } from "react";
import { useEngineState, useLinkBanner } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";

export function EngineScreen(): ReactNode {
  const commands = useCommands();
  const link = useLinkBanner();
  const engine = useEngineState();
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-240 flex-1 flex-col gap-4 px-3 pt-6 pb-4">
      <h1 className="text-text-primary">{t("desktop.workbench.engine.title")}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-ui-sm">
        <dt className="text-text-tertiary">{t("desktop.workbench.engine.phase")}</dt>
        <dd className="font-mono">
          {link.phase}
          {link.attempt > 0 && (
            <span className="text-text-tertiary">
              {" "}
              {t("desktop.workbench.engine.attempt", { attempt: link.attempt })}
            </span>
          )}
        </dd>
        <dt className="text-text-tertiary">{t("desktop.workbench.engine.state")}</dt>
        <dd className="font-mono">{engine === null ? "-" : engine.kind}</dd>
      </dl>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            commands.reconnect();
          }}
        >
          {t("desktop.workbench.engine.reconnect")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            detach(commands.restartEngine(), rethrow);
          }}
        >
          {t("desktop.workbench.engine.restart")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            detach(
              commands.copyDiagnostics().then((ok) => {
                if (ok) toast({ tone: "success", title: t("desktop.workbench.engine.copied") });
                return undefined;
              }),
              rethrow,
            );
          }}
        >
          {t("desktop.workbench.engine.copy")}
        </Button>
      </div>
    </div>
  );
}
